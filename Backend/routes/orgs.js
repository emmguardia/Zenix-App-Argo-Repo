import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { getStripe } from '../config/stripe.js';
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
            (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id = t.id) AS attachments,
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

const uploadTicketFile = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(null, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

/* ── POST /api/orgs/:orgId/tickets — soumission (décompte immédiat) ────────
 * Multipart : title, description + 1 fichier optionnel (PDF/image, 10 Mo). */
router.post('/:orgId/tickets', ticketLimiter, uploadTicketFile.single('file'), async (req, res) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

  const { title, description } = parsed.data;

  // Décompte à la soumission, lot expirant le plus tôt d'abord.
  const grantId = await consumeCredit(req.org.id);

  // Hors crédit : 1 seule demande en cours maximum
  if (!grantId) {
    const [open] = await getPool().execute(
      `SELECT COUNT(*) AS n FROM tickets
       WHERE organization_id = ? AND credit_grant_id IS NULL
         AND status IN ('en_attente', 'reporte', 'a_confirmer')`,
      [req.org.id]
    );
    if (Number(open[0].n) >= 1) {
      return res.status(409).json({
        error: 'Vous avez déjà une demande en attente hors crédit. Attendez sa réponse avant d\'en envoyer une autre.',
      });
    }
  }

  const ticketId = randomUUID();
  await getPool().execute(
    `INSERT INTO tickets (id, organization_id, created_by, credit_grant_id, title, description)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ticketId, req.org.id, req.user.uid, grantId, title, description]
  );

  if (req.file) {
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : req.file.mimetype.split('/')[1];
    const r2Key = `orgs/${req.org.id}/tickets/${ticketId}.${ext}`;
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    await putObject(r2Key, req.file.buffer, req.file.mimetype);
    await getPool().execute(
      'INSERT INTO ticket_attachments (ticket_id, r2_key, filename, size) VALUES (?, ?, ?, ?)',
      [ticketId, r2Key, filename, req.file.size]
    );
  }

  const balance = await getBalance(req.org.id);
  await audit('client', req.user.uid, 'ticket.create', 'ticket', ticketId, {
    org: req.org.name, creditConsumed: !!grantId, attachment: !!req.file,
  });
  notifyDiscord(
    grantId ? '🎫 Nouveau ticket' : '⚠️ Ticket HORS CRÉDIT',
    `**${req.org.name}** — ${title}\npar ${req.user.name || req.user.email}${req.file ? ' (+ pièce jointe)' : ''}${grantId ? '' : '\n**Aucun crédit disponible** → décision manuelle requise'}`
  );

  res.status(201).json({
    ticket: { id: ticketId, title, status: 'en_attente' },
    creditConsumed: !!grantId,
    balance,
    warning: grantId ? null : 'Plus de crédit disponible : votre demande sera étudiée manuellement.',
  });
});

/* ── GET /api/orgs/:orgId/tickets/:ticketId/attachment — URL signée ─────── */
router.get('/:orgId/tickets/:ticketId/attachment', async (req, res) => {
  const [rows] = await getPool().execute(
    `SELECT a.r2_key, a.filename FROM ticket_attachments a
     JOIN tickets t ON t.id = a.ticket_id
     WHERE t.id = ? AND t.organization_id = ? LIMIT 1`,
    [req.params.ticketId, req.org.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pièce jointe introuvable' });
  const url = await signedDownloadUrl(rows[0].r2_key, rows[0].filename);
  res.json({ url, expiresIn: 300 });
});

/* ── Tickets reportés revenus en début de mois : le client re-valide ────── */
router.post('/:orgId/tickets/:ticketId/confirm', async (req, res) => {
  const [rows] = await getPool().execute(
    "SELECT id, title FROM tickets WHERE id = ? AND organization_id = ? AND status = 'a_confirmer' LIMIT 1",
    [req.params.ticketId, req.org.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });

  const grantId = await consumeCredit(req.org.id);
  if (!grantId) return res.status(409).json({ error: 'Plus de crédit disponible ce mois-ci' });

  await getPool().execute(
    "UPDATE tickets SET status = 'en_attente', credit_grant_id = ? WHERE id = ?",
    [grantId, rows[0].id]
  );
  await audit('client', req.user.uid, 'ticket.reconfirm', 'ticket', rows[0].id, { org: req.org.name });
  notifyDiscord('🔁 Demande reportée confirmée', `**${req.org.name}** — "${rows[0].title}" (crédit du nouveau mois décompté)`);
  res.json({ confirmed: true });
});

router.post('/:orgId/tickets/:ticketId/cancel', async (req, res) => {
  const [result] = await getPool().execute(
    "UPDATE tickets SET status = 'annule' WHERE id = ? AND organization_id = ? AND status = 'a_confirmer'",
    [req.params.ticketId, req.org.id]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Demande introuvable ou déjà traitée' });
  await audit('client', req.user.uid, 'ticket.cancel', 'ticket', req.params.ticketId, { org: req.org.name });
  res.json({ canceled: true });
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

/* ── POST /api/orgs/:orgId/payment/card-saved ───────────────────────────────
 * Après confirmation du SetupIntent (0€ prélevé) : la carte est enregistrée.
 * AUCUN prélèvement ici — c'est Enzo qui lance l'abonnement depuis l'admin
 * quand le site est en ligne (conformité : pas de prélèvement avant mise en
 * ligne). L'onboarding est terminé, le statut reste "pending". */
router.post('/:orgId/payment/card-saved', async (req, res) => {
  if (req.org.onboarding_status !== 'payment') {
    return res.status(409).json({ error: 'Le paiement n\'est pas encore disponible' });
  }
  if (!req.org.stripe_customer_id) return res.status(400).json({ error: 'Carte non enregistrée' });

  const pms = await getStripe().paymentMethods.list({ customer: req.org.stripe_customer_id, limit: 1 });
  if (!pms.data.length) return res.status(400).json({ error: 'Aucune carte enregistrée — réessayez' });

  await getPool().execute(
    "UPDATE organizations SET onboarding_status = 'done' WHERE id = ?", [req.org.id]
  );
  await audit('client', req.user.uid, 'payment.card-saved', 'organization', req.org.id);
  notifyDiscord('💳 Carte enregistrée (0€)',
    `**${req.org.name}** a tout terminé — mets son site en ligne puis lance l'abonnement depuis l'admin.`);
  res.json({ saved: true });
});

export default router;
