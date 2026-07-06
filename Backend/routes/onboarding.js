import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyDiscord } from '../utils/discord.js';

/**
 * Parcours première connexion du client :
 *   infos (nom/prénom/adresse/SIRET/tél) → plan (choix de l'offre) → review
 *   (validation manuelle Enzo) → contract (contrat déposé par Enzo, signé et
 *   re-déposé par le client) → payment (CGV + CB Stripe) → done
 *
 * Client déjà existant (abonnement Stripe actif lié par l'admin) :
 *   infos → done directement.
 */

const router = Router();
router.use(requireAuth);

async function getUserOrg(userId) {
  const [rows] = await getPool().execute(
    `SELECT o.* FROM organizations o
     JOIN memberships m ON m.organization_id = o.id
     WHERE m.user_id = ?
     ORDER BY o.created_at ASC LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/* ── GET /api/onboarding/state ─────────────────────────────────────────── */
router.get('/state', async (req, res) => {
  const org = await getUserOrg(req.user.uid);
  if (!org) return res.json({ step: 'infos', organization: null });
  res.json({
    step: org.onboarding_status,
    organization: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      pricing_tier: org.pricing_tier,
      billing_interval: org.billing_interval,
      status: org.status,
      contact_first_name: org.contact_first_name,
      contact_last_name: org.contact_last_name,
      cgv_accepted_at: org.cgv_accepted_at,
    },
  });
});

const NAME_RE = /^[^\d]+$/; // pas de chiffres dans les noms

const profileSchema = z.object({
  first_name: z.string().trim().min(1).max(20).regex(NAME_RE),
  last_name:  z.string().trim().min(1).max(30).regex(NAME_RE),
  phone:      z.string().trim().regex(/^\d{10}$/),
  address:    z.string().trim().min(5).max(1000),
  siret:      z.string().trim().regex(/^\d{14}$/).optional().or(z.literal('')),
  website:    z.string().trim().max(255)
                .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'domaine invalide')
                .optional().or(z.literal('')),
});

const FIELD_LABELS = {
  first_name: 'le prénom (20 lettres max, sans chiffres)',
  last_name:  'le nom (30 lettres max, sans chiffres)',
  phone:      'le téléphone (10 chiffres)',
  address:    "l'adresse complète",
  siret:      'le SIRET (14 chiffres, sans espaces)',
  website:    'le site internet (ex. monsite.fr)',
};

/* ── POST /api/onboarding/profile ──────────────────────────────────────── */
router.post('/profile', async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors)
      .map((f) => FIELD_LABELS[f] ?? f);
    return res.status(400).json({ error: `Vérifiez ${fields.join(', ')}` });
  }
  const d = parsed.data;
  const pool = getPool();

  let org = await getUserOrg(req.user.uid);

  if (!org) {
    // Nouveau client : l'organisation naît ici (transaction : org + liaison, tout ou rien)
    const id = randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO organizations (id, name, legal_type, siret, billing_address, linked_domain,
           contact_first_name, contact_last_name, contact_phone, onboarding_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plan')`,
        [id, `${d.first_name} ${d.last_name}`, d.siret ? 'entreprise' : 'particulier',
         d.siret || null, d.address, d.website || null, d.first_name, d.last_name, d.phone]
      );
      await conn.execute('INSERT INTO memberships (user_id, organization_id) VALUES (?, ?)', [req.user.uid, id]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    org = { id, onboarding_status: 'plan' };
  } else {
    // Client existant (fiche pré-créée par l'admin) : on complète
    const isExisting = org.status === 'active' && org.stripe_subscription_id;
    const next = isExisting ? 'done' : (org.plan ? 'review' : 'plan');
    await pool.execute(
      `UPDATE organizations SET siret = COALESCE(NULLIF(?, ''), siret), billing_address = ?,
         linked_domain = COALESCE(NULLIF(?, ''), linked_domain),
         contact_first_name = ?, contact_last_name = ?, contact_phone = ?, onboarding_status = ?
       WHERE id = ?`,
      [d.siret || '', d.address, d.website || '', d.first_name, d.last_name, d.phone, next, org.id]
    );
    org.onboarding_status = next;
  }

  await audit('client', req.user.uid, 'onboarding.profile', 'organization', org.id);
  if (org.onboarding_status === 'review') {
    notifyDiscord('📋 Infos client à valider', `**${d.first_name} ${d.last_name}** a complété ses informations.`);
  }
  res.json({ step: org.onboarding_status });
});

const planSchema = z.object({
  plan:     z.enum(['start', 'relax', 'pro']),
  interval: z.enum(['monthly', 'annual']).default('monthly'),
  tier:     z.enum(['standard', 'asso']).default('standard'),
});

/* ── POST /api/onboarding/plan ─────────────────────────────────────────── */
router.post('/plan', async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Offre invalide' });

  const org = await getUserOrg(req.user.uid);
  if (!org) return res.status(409).json({ error: 'Complétez d\'abord vos informations' });
  if (!['plan', 'infos'].includes(org.onboarding_status)) {
    return res.status(409).json({ error: 'Offre déjà choisie' });
  }

  await getPool().execute(
    "UPDATE organizations SET plan = ?, billing_interval = ?, pricing_tier = ?, onboarding_status = 'review' WHERE id = ?",
    [parsed.data.plan, parsed.data.interval, parsed.data.tier, org.id]
  );
  await audit('client', req.user.uid, 'onboarding.plan', 'organization', org.id, parsed.data);
  notifyDiscord('🆕 Nouvelle souscription à valider',
    `**${org.contact_first_name} ${org.contact_last_name}** a choisi **Zenix ${parsed.data.plan}** ` +
    `(grille ${parsed.data.tier === 'asso' ? 'ASSO' : 'entreprise'}, ${parsed.data.interval === 'annual' ? 'engagement 1 an — 12e mois offert' : 'mensuel sans engagement'}) — valide ses infos dans l'admin.`);
  res.json({ step: 'review' });
});

export default router;
