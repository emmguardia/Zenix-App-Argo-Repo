import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { createHash, randomUUID } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getPool } from '../config/database.js';
import { getStripe } from '../config/stripe.js';
import { putObject, getObjectBuffer } from '../config/r2.js';
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
    `SELECT id, type, filename, created_at, requires_signature, signed_at
     FROM documents
     WHERE organization_id = ?
     ORDER BY created_at DESC`,
    [req.org.id]
  );
  res.json({ documents });
});

/* ── GET /api/orgs/:orgId/documents/:docId/download — URL signée R2 ────────
 * Si le document a été signé en ligne, on sert la version tamponnée. */
router.get('/:orgId/documents/:docId/download', async (req, res) => {
  // Le document doit appartenir à CETTE organisation (anti-IDOR)
  const [rows] = await getPool().execute(
    'SELECT id, r2_key, signed_r2_key, filename FROM documents WHERE id = ? AND organization_id = ? LIMIT 1',
    [req.params.docId, req.org.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Document introuvable' });

  const url = await signedDownloadUrl(rows[0].signed_r2_key || rows[0].r2_key, rows[0].filename);
  await audit('client', req.user.uid, 'document.download', 'document', rows[0].id, { org: req.org.name });
  res.json({ url, expiresIn: 300 });
});

/* ═══ Signature électronique en ligne (eIDAS — signature simple) ══════════ */

/** Onboarding : plus aucun document à signer → étape paiement. */
async function advanceIfAllSigned(org) {
  if (org.onboarding_status !== 'contract') return org.onboarding_status;
  const [rem] = await getPool().execute(
    'SELECT COUNT(*) AS n FROM documents WHERE organization_id = ? AND requires_signature = 1 AND signed_at IS NULL',
    [org.id]
  );
  if (Number(rem[0].n) > 0) return 'contract';
  await getPool().execute("UPDATE organizations SET onboarding_status = 'payment' WHERE id = ?", [org.id]);
  return 'payment';
}

/* ── POST /api/orgs/:orgId/documents/:docId/sign ────────────────────────────
 * Signature par clic : identité authentifiée (compte nominatif + session),
 * nom complet saisi, horodatage, IP et empreinte SHA-256 du document exact.
 * Un certificat de signature est tamponné en dernière page du PDF. */
router.post('/:orgId/documents/:docId/sign', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (req.body?.accepted !== true || name.length < 3 || name.length > 100) {
    return res.status(400).json({ error: 'Tapez votre nom complet et cochez la case d\'acceptation' });
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT * FROM documents WHERE id = ? AND organization_id = ? LIMIT 1',
    [req.params.docId, req.org.id]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'Document introuvable' });
  if (!doc.requires_signature) return res.status(400).json({ error: 'Ce document ne nécessite pas de signature' });
  if (doc.signed_at) return res.status(409).json({ error: 'Document déjà signé' });

  const original = await getObjectBuffer(doc.r2_key);
  const hash = createHash('sha256').update(original).digest('hex');
  const ip = String(req.headers['cf-connecting-ip'] || req.ip || '');
  const when = new Date();
  const whenFr = when.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'medium' });

  // Certificat de signature tamponné en dernière page
  const pdfDoc = await PDFDocument.load(original, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const lines = [
    ['CERTIFICAT DE SIGNATURE ELECTRONIQUE', bold, 16],
    ['', font, 11],
    [`Document : ${doc.filename}`, font, 11],
    [`Signé par : ${name}`, bold, 12],
    [`Le : ${whenFr} (heure de Paris)`, font, 11],
    [`Via : Espace Client Zenix (compte authentifié ${req.user.email})`, font, 11],
    [`Adresse IP : ${ip}`, font, 11],
    ['', font, 11],
    ['Empreinte SHA-256 du document original :', font, 11],
    [hash.slice(0, 32), font, 10],
    [hash.slice(32), font, 10],
    ['', font, 11],
    ['Signature électronique au sens des articles 1366 et 1367 du Code civil', font, 9],
    ['et du règlement européen eIDAS (UE) n° 910/2014.', font, 9],
    ['Zenix Web — Enzo Monnet-Mata · SIRET 991 413 600 00016 · zenixweb.fr', font, 9],
  ];
  let y = 780;
  for (const [text, f, size] of lines) {
    if (text) page.drawText(text, { x: 60, y, size, font: f, color: rgb(0.1, 0.12, 0.2) });
    y -= size + 10;
  }
  const stamped = await pdfDoc.save();

  const signedKey = `orgs/${req.org.id}/signe-${doc.id}.pdf`;
  await putObject(signedKey, Buffer.from(stamped), 'application/pdf');
  await pool.execute(
    `UPDATE documents SET signed_at = ?, signed_by = ?, signature_name = ?, signature_hash = ?,
       signature_ip = ?, signed_r2_key = ? WHERE id = ?`,
    [when, req.user.uid, name, hash, ip, signedKey, doc.id]
  );

  // Signer les CGV vaut acceptation horodatée des CGV
  if (doc.type === 'cgv') {
    await pool.execute('UPDATE organizations SET cgv_accepted_at = NOW() WHERE id = ?', [req.org.id]);
  }

  const step = await advanceIfAllSigned(req.org);

  await audit('client', req.user.uid, 'document.sign', 'document', doc.id, {
    org: req.org.name, name, hash, ip, type: doc.type,
  });
  notifyDiscord('✍️ Document signé en ligne', `**${req.org.name}** — ${doc.filename} (par ${name})`);
  res.json({ signed: true, step });
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

  // Le contrat d'origine est considéré signé (méthode manuscrite)
  await getPool().execute(
    `UPDATE documents SET signed_at = NOW(), signed_by = ?,
       signature_name = 'Signature manuscrite (document redéposé)', signed_r2_key = ?
     WHERE organization_id = ? AND type = 'contrat' AND requires_signature = 1 AND signed_at IS NULL`,
    [req.user.uid, r2Key, req.org.id]
  );

  const step = await advanceIfAllSigned(req.org);

  await audit('client', req.user.uid, 'contract.signed-uploaded', 'document', docId, { org: req.org.name });
  notifyDiscord('✍️ Contrat signé déposé (papier)', `**${req.org.name}** a re-déposé le contrat signé${step === 'payment' ? ' — plus que le paiement.' : ' — il reste des documents à signer.'}`);
  res.status(201).json({ step });
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
      email: req.org.billing_email || req.user.email,
      phone: req.org.contact_phone || undefined,
      metadata: { zenix_org: req.org.id, siret: req.org.siret || '', tva: req.org.vat_number || '' },
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

/* ═══ Messagerie (1 conversation par organisation) ════════════════════════ */

/* Ouvrir la conversation = messages lus (horodatage visible par l'admin seul) */
router.get('/:orgId/messages', async (req, res) => {
  const [messages] = await getPool().execute(
    'SELECT id, sender, body, created_at FROM messages WHERE organization_id = ? ORDER BY created_at ASC LIMIT 500',
    [req.org.id]
  );
  await getPool().execute('UPDATE organizations SET client_last_read_at = NOW() WHERE id = ?', [req.org.id]);
  // Aucune information de lecture n'est renvoyée au client
  res.json({ messages });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

router.post('/:orgId/messages', ticketLimiter, async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Message vide ou trop long (2000 caractères max)' });

  const id = randomUUID();
  await getPool().execute(
    "INSERT INTO messages (id, organization_id, sender, sender_id, body) VALUES (?, ?, 'client', ?, ?)",
    [id, req.org.id, req.user.uid, parsed.data.body]
  );
  notifyDiscord('💬 Nouveau message client',
    `**${req.org.name}** — ${parsed.data.body.slice(0, 180)}${parsed.data.body.length > 180 ? '…' : ''}`);
  res.status(201).json({ id });
});

export default router;
