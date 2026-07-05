import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { getStripe } from '../config/stripe.js';
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

export default router;
