import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from '../../config/database.js';
import { getStripe, PLAN_PRICES } from '../../config/stripe.js';
import { requireAdmin } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { notifyDiscord } from '../../utils/discord.js';

const router = Router();
router.use(requireAdmin);

/* ── GET /api/admin/orgs — liste + solde + membres ─────────────────────── */
router.get('/', async (_req, res) => {
  const [orgs] = await getPool().execute(
    `SELECT o.*,
       (SELECT COALESCE(SUM(quantity - used), 0) FROM credit_grants g
        WHERE g.organization_id = o.id AND g.expires_at > NOW() AND g.used < g.quantity) AS balance,
       (SELECT GROUP_CONCAT(u.email SEPARATOR ', ') FROM memberships m
        JOIN users u ON u.id = m.user_id WHERE m.organization_id = o.id) AS members
     FROM organizations o
     ORDER BY o.created_at DESC`
  );
  res.json({ organizations: orgs });
});

const orgSchema = z.object({
  name:               z.string().trim().min(1).max(255),
  legal_type:         z.enum(['entreprise', 'association', 'particulier']),
  siret:              z.string().trim().max(14).optional().nullable(),
  vat_number:         z.string().trim().max(20).optional().nullable(),
  billing_address:    z.string().trim().max(1000).optional().nullable(),
  plan:               z.enum(['start', 'relax', 'pro']).optional().nullable(),
  linked_domain:      z.string().trim().max(255).optional().nullable(),
  stripe_customer_id: z.string().trim().max(255).optional().nullable(),
});

/* ── POST /api/admin/orgs — créer une organisation ─────────────────────── */
router.post('/', async (req, res) => {
  const parsed = orgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides', details: parsed.error.flatten() });

  const d = parsed.data;
  const id = randomUUID();
  await getPool().execute(
    `INSERT INTO organizations (id, name, legal_type, siret, vat_number, billing_address, plan, linked_domain, stripe_customer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, d.name, d.legal_type, d.siret ?? null, d.vat_number ?? null, d.billing_address ?? null,
     d.plan ?? null, d.linked_domain ?? null, d.stripe_customer_id ?? null]
  );

  await audit('admin', req.user.uid, 'org.create', 'organization', id, { name: d.name });
  res.status(201).json({ organization: { id, ...d, status: 'pending' } });
});

/* ── PATCH /api/admin/orgs/:id — modifier (liaison Stripe incluse) ─────── */
router.patch('/:id', async (req, res) => {
  const parsed = orgSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (!entries.length) return res.status(400).json({ error: 'Aucun champ à modifier' });

  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  const [result] = await getPool().execute(
    `UPDATE organizations SET ${setClause} WHERE id = ?`,
    [...values, req.params.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Organisation introuvable' });

  await audit('admin', req.user.uid, 'org.update', 'organization', req.params.id, parsed.data);
  res.json({ updated: true });
});

const linkUserSchema = z.object({
  email: z.string().email().max(254),
  name:  z.string().trim().max(100).optional(),
});

/* ── POST /api/admin/orgs/:id/link-user — lier un compte (fiche pré-créée) ─ */
router.post('/:id/link-user', async (req, res) => {
  const parsed = linkUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

  const email = parsed.data.email.toLowerCase();
  const pool = getPool();

  const [orgRows] = await pool.execute('SELECT id, name FROM organizations WHERE id = ? LIMIT 1', [req.params.id]);
  if (!orgRows.length) return res.status(404).json({ error: 'Organisation introuvable' });

  // Fiche user pré-créée si inconnue : authentik_sub sera lié à la 1ère connexion
  let [userRows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  let userId = userRows[0]?.id;
  if (!userId) {
    userId = randomUUID();
    await pool.execute(
      'INSERT INTO users (id, email, name) VALUES (?, ?, ?)',
      [userId, email, parsed.data.name ?? '']
    );
  }

  await pool.execute(
    'INSERT IGNORE INTO memberships (user_id, organization_id) VALUES (?, ?)',
    [userId, req.params.id]
  );

  await audit('admin', req.user.uid, 'org.link-user', 'organization', req.params.id, { email });
  res.json({ linked: true, userId });
});

/* ── POST /api/admin/orgs/:id/activate — LE bouton (1er prélèvement) ───── */
router.post('/:id/activate', async (req, res) => {
  const pool = getPool();
  const [rows] = await pool.execute('SELECT * FROM organizations WHERE id = ? LIMIT 1', [req.params.id]);
  const org = rows[0];
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });
  if (org.stripe_subscription_id) return res.status(409).json({ error: 'Abonnement déjà actif' });
  if (!org.stripe_customer_id) return res.status(400).json({ error: 'Aucun customer Stripe lié' });
  if (!org.plan) return res.status(400).json({ error: 'Aucune formule définie' });

  const priceId = PLAN_PRICES[org.plan]?.();
  if (!priceId) return res.status(500).json({ error: `STRIPE_PRICE_${org.plan.toUpperCase()} non configuré` });

  const stripe = getStripe();

  // La CB doit avoir été enregistrée (Setup Intent) par le client
  const paymentMethods = await stripe.paymentMethods.list({ customer: org.stripe_customer_id, limit: 1 });
  if (!paymentMethods.data.length) {
    return res.status(400).json({ error: 'Aucun moyen de paiement enregistré par le client' });
  }

  const subscription = await stripe.subscriptions.create({
    customer:               org.stripe_customer_id,
    items:                  [{ price: priceId }],
    default_payment_method: paymentMethods.data[0].id,
  });

  await pool.execute(
    'UPDATE organizations SET stripe_subscription_id = ? WHERE id = ?',
    [subscription.id, org.id]
  );
  // Le passage en "active" + les crédits arrivent via le webhook invoice.paid

  await audit('admin', req.user.uid, 'org.activate', 'organization', org.id, {
    subscription: subscription.id, plan: org.plan,
  });
  notifyDiscord('🚀 Projet activé', `**${org.name}** — abonnement ${org.plan} lancé (1er prélèvement en cours)`);
  res.json({ activated: true, subscriptionId: subscription.id });
});

export default router;
