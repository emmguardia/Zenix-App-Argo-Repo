import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { getStripe, PLAN_PRICES } from '../config/stripe.js';
import { putObject } from '../config/r2.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgAccess } from '../middleware/orgAccess.js';
import { ticketLimiter } from '../config/security.js';
import { getBalance, listGrants, consumeCredit } from '../utils/credits.js';
import { audit } from '../utils/audit.js';
import { notifyDiscord } from '../utils/discord.js';
import { signedDownloadUrl } from '../config/r2.js';

const router = Router();

// Toutes les routes : authentifié + membre de l'organisation (anti-IDOR central)
router.use(requireAuth);
router.use('/:orgId', requireOrgAccess);

/* ── GET /api/orgs/:orgId — détail organisation + solde ────────────────── */
router.get('/:orgId', async (req, res) => {
  const balance = await getBalance(req.org.id);
  const { id, name, legal_type, siret, vat_number, billing_address, plan, status, linked_domain } = req.org;
  res.json({ organization: { id, name, legal_type, siret, vat_number, billing_address, plan, status, linked_domain }, balance });
});

/* ── GET /api/orgs/:orgId/credits — solde + détail des lots ────────────── */
router.get('/:orgId/credits', async (req, res) => {
  const [balance, grants] = await Promise.all([getBalance(req.org.id), listGrants(req.org.id)]);
  res.json({ balance, grants });
});

/* ── GET /api/orgs/:orgId/invoices — factures (relais Stripe) ──────────── */
router.get('/:orgId/invoices', async (req, res) => {
  if (!req.org.stripe_customer_id) return res.json({ invoices: [] });
  try {
    const list = await getStripe().invoices.list({ customer: req.org.stripe_customer_id, limit: 50 });
    res.json({
      invoices: list.data.map((inv) => ({
        id:     inv.id,
        number: inv.number,
        status: inv.status,
        amount: inv.total,
        currency: inv.currency,
        date:   inv.created,
        pdf:    inv.invoice_pdf,
      })),
    });
  } catch (e) {
    console.error('[orgs] invoices error:', e.message);
    res.status(502).json({ error: 'Impossible de récupérer les factures' });
  }
});

/* ── GET /api/orgs/:orgId/tickets ──────────────────────────────────────── */
router.get('/:orgId/tickets', async (req, res) => {
  const [tickets] = await getPool().execute(
    `SELECT t.id, t.title, t.description, t.status, t.created_at, t.decided_at, t.completed_at,
            t.credit_grant_id IS NOT NULL AS credit_consumed,
            u.name AS created_by_name
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.organization_id = ?
     ORDER BY t.created_at DESC`,
    [req.org.id]
  );
  res.json({ tickets });
});

const ticketSchema = z.object({
  title:       z.string().trim().min(3).max(255),
  description: z.string().trim().min(1).max(5000),
});

/* ── POST /api/orgs/:orgId/tickets — soumission (décompte immédiat) ────── */
router.post('/:orgId/tickets', ticketLimiter, async (req, res) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

  const { title, description } = parsed.data;

  // Décompte à la soumission, lot expirant le plus tôt d'abord.
  // Solde à zéro : soumission AUTORISÉE, sans décompte (décision manuelle Enzo).
  const grantId = await consumeCredit(req.org.id);

  const ticketId = randomUUID();
  await getPool().execute(
    `INSERT INTO tickets (id, organization_id, created_by, credit_grant_id, title, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticketId, req.org.id, req.user.uid, grantId, title, description]
  );

  const balance = await getBalance(req.org.id);
  await audit('client', req.user.uid, 'ticket.create', 'ticket', ticketId, {
    org: req.org.name, creditConsumed: !!grantId,
  });
  notifyDiscord(
    grantId ? '🎫 Nouveau ticket' : '⚠️ Ticket HORS CRÉDIT',
    `**${req.org.name}** — ${title}\npar ${req.user.name || req.user.email}${grantId ? '' : '\n**Aucun crédit disponible** → décision manuelle requise'}`
  );

  res.status(201).json({
    ticket: { id: ticketId, title, status: 'en_attente' },
    creditConsumed: !!grantId,
    balance,
    warning: grantId ? null : 'Plus de crédit disponible : votre demande sera étudiée manuellement.',
  });
});

/* ── GET /api/orgs/:orgId/documents ────────────────────────────────────── */
router.get('/:orgId/documents', async (req, res) => {
  const [documents] = await getPool().execute(
    `SELECT id, type, filename, created_at
     FROM documents
     WHERE organization_id = ?
     ORDER BY created_at DESC`,
    [req.org.id]
  );
  res.json({ documents });
});

/* ── GET /api/orgs/:orgId/documents/:docId/download — URL signée R2 ────── */
router.get('/:orgId/documents/:docId/download', async (req, res) => {
  // Le document doit appartenir à CETTE organisation (anti-IDOR)
  const [rows] = await getPool().execute(
    'SELECT id, r2_key, filename FROM documents WHERE id = ? AND organization_id = ? LIMIT 1',
    [req.params.docId, req.org.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document introuvable' });

  const url = await signedDownloadUrl(rows[0].r2_key, rows[0].filename);
  await audit('client', req.user.uid, 'document.download', 'document', rows[0].id, { org: req.org.name });
  res.json({ url, expiresIn: 300 });
});

/* ═══ Onboarding : contrat signé + paiement ═══════════════════════════════ */

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

/* ── POST /api/orgs/:orgId/documents/signed-contract ───────────────────────
 * Le client re-dépose le contrat signé (PDF). Les deux versions sont gardées.
 * Passage automatique contract → payment. */
router.post('/:orgId/documents/signed-contract', uploadPdf.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier PDF requis (10 Mo max)' });
  if (req.org.onboarding_status !== 'contract') {
    return res.status(409).json({ error: 'Le dépôt du contrat signé n\'est pas attendu à cette étape' });
  }

  const docId = randomUUID();
  const r2Key = `orgs/${req.org.id}/contrat-signe-${docId}.pdf`;
  await putObject(r2Key, req.file.buffer, 'application/pdf');
  await getPool().execute(
    `INSERT INTO documents (id, organization_id, type, r2_key, filename, uploaded_by)
     VALUES (?, ?, 'contrat_signe', ?, ?, ?)`,
    [docId, req.org.id, r2Key, `Contrat signé - ${req.org.name}.pdf`, req.user.uid]
  );
  await getPool().execute(
    "UPDATE organizations SET onboarding_status = 'payment' WHERE id = ?", [req.org.id]
  );

  await audit('client', req.user.uid, 'contract.signed-uploaded', 'document', docId, { org: req.org.name });
  notifyDiscord('✍️ Contrat signé déposé', `**${req.org.name}** a re-déposé le contrat signé — plus que le paiement.`);
  res.status(201).json({ step: 'payment' });
});

/* ── GET /api/orgs/:orgId/payment/config ───────────────────────────────── */
router.get('/:orgId/payment/config', (_req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (!publishableKey) return res.status(500).json({ error: 'Paiement non configuré (clé publique manquante)' });
  res.json({ publishableKey });
});

/* ── POST /api/orgs/:orgId/payment/accept-terms ────────────────────────────
 * Case "j'ai pris connaissance du contrat et des CGV" — horodatée (audit). */
router.post('/:orgId/payment/accept-terms', async (req, res) => {
  if (req.body?.accepted !== true) return res.status(400).json({ error: 'Acceptation requise' });
  await getPool().execute('UPDATE organizations SET cgv_accepted_at = NOW() WHERE id = ?', [req.org.id]);
  await audit('client', req.user.uid, 'terms.accepted', 'organization', req.org.id, {
    ip: req.headers['cf-connecting-ip'] || req.ip,
  });
  res.json({ accepted: true });
});

/* ── POST /api/orgs/:orgId/payment/setup-intent ────────────────────────── */
router.post('/:orgId/payment/setup-intent', async (req, res) => {
  if (req.org.onboarding_status !== 'payment') {
    return res.status(409).json({ error: 'Le paiement n\'est pas encore disponible' });
  }
  if (!req.org.cgv_accepted_at) {
    return res.status(400).json({ error: 'Acceptez d\'abord le contrat et les CGV' });
  }

  const stripe = getStripe();
  let customerId = req.org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name:  req.org.name,
      email: req.user.email,
      phone: req.org.contact_phone || undefined,
      metadata: { zenix_org: req.org.id, siret: req.org.siret || '' },
    });
    customerId = customer.id;
    await getPool().execute('UPDATE organizations SET stripe_customer_id = ? WHERE id = ?', [customerId, req.org.id]);
  }

  const intent = await stripe.setupIntents.create({
    customer: customerId,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  res.json({ clientSecret: intent.client_secret });
});

/* ── POST /api/orgs/:orgId/payment/subscribe ────────────────────────────────
 * Après confirmation du SetupIntent côté Stripe Elements : lance l'abonnement.
 * Le 1er prélèvement part immédiatement ; crédits + statut actif arrivent
 * par le webhook invoice.paid. */
router.post('/:orgId/payment/subscribe', async (req, res) => {
  if (req.org.onboarding_status !== 'payment') {
    return res.status(409).json({ error: 'Le paiement n\'est pas encore disponible' });
  }
  if (req.org.stripe_subscription_id) return res.status(409).json({ error: 'Abonnement déjà actif' });
  if (!req.org.stripe_customer_id) return res.status(400).json({ error: 'Carte non enregistrée' });

  const priceId = PLAN_PRICES[req.org.plan]?.();
  if (!priceId) return res.status(500).json({ error: `Offre ${req.org.plan} non configurée` });

  const stripe = getStripe();
  const pms = await stripe.paymentMethods.list({ customer: req.org.stripe_customer_id, limit: 1 });
  if (!pms.data.length) return res.status(400).json({ error: 'Aucune carte enregistrée — réessayez' });

  const subscription = await stripe.subscriptions.create({
    customer:               req.org.stripe_customer_id,
    items:                  [{ price: priceId }],
    default_payment_method: pms.data[0].id,
  });

  await getPool().execute(
    "UPDATE organizations SET stripe_subscription_id = ?, onboarding_status = 'done' WHERE id = ?",
    [subscription.id, req.org.id]
  );
  await audit('client', req.user.uid, 'subscription.create', 'organization', req.org.id, {
    subscription: subscription.id, plan: req.org.plan,
  });
  notifyDiscord('🚀 Abonnement souscrit', `**${req.org.name}** — ${req.org.plan} (1er prélèvement en cours)`);
  res.json({ subscribed: true });
});

export default router;
