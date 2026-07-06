import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { getPool } from '../../config/database.js';
import { getStripe, planPrice, priceToPlan } from '../../config/stripe.js';
import { requireAdmin } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { notifyDiscord } from '../../utils/discord.js';
import { putObject, deleteObject, signedDownloadUrl } from '../../config/r2.js';

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
  billing_interval:   z.enum(['monthly', 'annual']).optional(),
  pricing_tier:       z.enum(['standard', 'asso']).optional(),
  custom_price_id:    z.string().trim().max(255).optional().nullable(),
  linked_domain:      z.string().trim().max(255).optional().nullable(),
  stripe_customer_id: z.string().trim().max(255).optional().nullable(),
  contact_first_name: z.string().trim().max(20).optional().nullable(),
  contact_last_name:  z.string().trim().max(30).optional().nullable(),
  contact_phone:      z.string().trim().max(30).optional().nullable(),
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

  // Liaison d'un customer Stripe : détecte son abonnement actif éventuel
  // (client historique) → statut actif + plan + onboarding raccourci
  if (parsed.data.stripe_customer_id) {
    try {
      const subs = await getStripe().subscriptions.list({
        customer: parsed.data.stripe_customer_id, status: 'active', limit: 1,
      });
      const sub = subs.data[0];
      if (sub) {
        const plan = priceToPlan(sub.items.data[0]?.price?.id);
        await getPool().execute(
          `UPDATE organizations SET stripe_subscription_id = ?, status = 'active',
             plan = COALESCE(?, plan) WHERE id = ?`,
          [sub.id, plan, req.params.id]
        );
      }
    } catch (e) {
      console.warn('[admin] détection abonnement:', e.message);
    }
  }

  await audit('admin', req.user.uid, 'org.update', 'organization', req.params.id, parsed.data);
  res.json({ updated: true });
});

/* ── POST /api/admin/orgs/:id/validate — OK humain sur les infos client ────
 * review → contract : Enzo confirme que les infos ne sont pas bidon. */
router.post('/:id/validate', async (req, res) => {
  const [result] = await getPool().execute(
    `UPDATE organizations SET onboarding_status = 'contract', validated_at = NOW()
     WHERE id = ? AND onboarding_status = 'review'`,
    [req.params.id]
  );
  if (!result.affectedRows) return res.status(409).json({ error: 'Ce client n\'est pas en attente de validation' });

  await audit('admin', req.user.uid, 'org.validate', 'organization', req.params.id);
  res.json({ validated: true, next: 'Dépose le contrat d\'hébergement dans ses documents' });
});

/* ── DELETE /api/admin/orgs/:id — suppression complète d'un client ─────────
 * Annule l'abonnement Stripe, purge les fichiers R2, supprime tout en base
 * (cascade : memberships, crédits, tickets, documents). Double validation UI. */
router.delete('/:id', async (req, res) => {
  const pool = getPool();
  const [orgs] = await pool.execute('SELECT * FROM organizations WHERE id = ? LIMIT 1', [req.params.id]);
  const org = orgs[0];
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });

  // 1. Abonnement Stripe annulé (le customer est conservé côté Stripe : compta)
  if (org.stripe_subscription_id) {
    try { await getStripe().subscriptions.cancel(org.stripe_subscription_id); }
    catch (e) { console.warn('[admin] annulation subscription:', e.message); }
  }

  // 2. Fichiers R2 (documents + pièces jointes des tickets)
  const [docs] = await pool.execute('SELECT r2_key FROM documents WHERE organization_id = ?', [org.id]);
  const [atts] = await pool.execute(
    'SELECT a.r2_key FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id WHERE t.organization_id = ?',
    [org.id]
  );
  for (const { r2_key } of [...docs, ...atts]) {
    try { await deleteObject(r2_key); } catch (e) { console.warn('[admin] purge R2:', e.message); }
  }

  // 3. Base (cascade)
  await pool.execute('DELETE FROM organizations WHERE id = ?', [org.id]);

  await audit('admin', req.user.uid, 'org.delete', 'organization', org.id, { name: org.name });
  notifyDiscord('🗑️ Client supprimé', `**${org.name}** — abonnement annulé, données et fichiers purgés.`);
  res.json({ deleted: true });
});

/* ═══ Documents (dépôt / suppression / téléchargement) ════════════════════ */

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['application/pdf', 'application/zip'].includes(file.mimetype)),
});

const DOC_TYPES = ['contrat', 'cgv', 'devis', 'zip_offboarding', 'autre'];

/* ── GET /api/admin/orgs/:id/documents ─────────────────────────────────── */
router.get('/:id/documents', async (req, res) => {
  const [documents] = await getPool().execute(
    `SELECT d.id, d.type, d.filename, d.created_at, u.name AS uploaded_by_name
     FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.organization_id = ? ORDER BY d.created_at DESC`,
    [req.params.id]
  );
  res.json({ documents });
});

/* ── POST /api/admin/orgs/:id/documents — dépôt (PDF/ZIP, 15 Mo) ────────── */
router.post('/:id/documents', uploadDoc.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier PDF ou ZIP requis (15 Mo max)' });
  const type = DOC_TYPES.includes(req.body.type) ? req.body.type : 'autre';

  const [orgs] = await getPool().execute('SELECT * FROM organizations WHERE id = ? LIMIT 1', [req.params.id]);
  const org = orgs[0];
  if (!org) return res.status(404).json({ error: 'Organisation introuvable' });

  const docId = randomUUID();
  const ext = req.file.mimetype === 'application/zip' ? 'zip' : 'pdf';
  const r2Key = `orgs/${org.id}/${type}-${docId}.${ext}`;
  // multer livre le nom de fichier en latin1 → ré-encode (accents)
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  await putObject(r2Key, req.file.buffer, req.file.mimetype);
  await getPool().execute(
    `INSERT INTO documents (id, organization_id, type, r2_key, filename, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [docId, org.id, type, r2Key, filename, req.user.uid]
  );

  // Contrat déposé pendant l'étape contrat → le client est prévenu côté UI
  await audit('admin', req.user.uid, 'document.upload', 'document', docId, { org: org.name, type });
  res.status(201).json({ id: docId });
});

/* ── DELETE /api/admin/orgs/:id/documents/:docId ───────────────────────── */
router.delete('/:id/documents/:docId', async (req, res) => {
  const [rows] = await getPool().execute(
    'SELECT id, r2_key FROM documents WHERE id = ? AND organization_id = ? LIMIT 1',
    [req.params.docId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document introuvable' });

  try { await deleteObject(rows[0].r2_key); } catch (e) { console.warn('[admin] suppression R2:', e.message); }
  await getPool().execute('DELETE FROM documents WHERE id = ?', [rows[0].id]);
  await audit('admin', req.user.uid, 'document.delete', 'document', rows[0].id);
  res.json({ deleted: true });
});

/* ── GET /api/admin/orgs/:id/documents/:docId/download ─────────────────── */
router.get('/:id/documents/:docId/download', async (req, res) => {
  const [rows] = await getPool().execute(
    'SELECT id, r2_key, filename FROM documents WHERE id = ? AND organization_id = ? LIMIT 1',
    [req.params.docId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document introuvable' });
  const url = await signedDownloadUrl(rows[0].r2_key, rows[0].filename);
  res.json({ url, expiresIn: 300 });
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

  // Tarif spécial client prioritaire, sinon grille (standard/asso) + formule
  const priceId = org.custom_price_id || planPrice(org.plan, org.pricing_tier);
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
    metadata: {
      zenix_org:  org.id,
      engagement: org.billing_interval === 'annual' ? '1an-12e-mois-offert' : 'mensuel',
    },
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
