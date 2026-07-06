import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../../config/database.js';
import { requireAdmin } from '../../middleware/auth.js';
import { refundCredit, createGrant } from '../../utils/credits.js';
import { signedDownloadUrl } from '../../config/r2.js';
import { audit } from '../../utils/audit.js';
import { notifyDiscord } from '../../utils/discord.js';

const router = Router();
router.use(requireAdmin);

/* ── GET /api/admin/tickets?status=en_attente — boîte de réception ─────── */
router.get('/', async (req, res) => {
  const status = ['en_attente', 'valide', 'refuse', 'reporte', 'a_confirmer', 'annule', 'termine'].includes(req.query.status)
    ? req.query.status : null;

  const [tickets] = await getPool().execute(
    `SELECT t.*, o.name AS org_name, u.name AS created_by_name, u.email AS created_by_email,
            (SELECT COUNT(*) FROM ticket_attachments a WHERE a.ticket_id = t.id) AS attachments
     FROM tickets t
     JOIN organizations o ON o.id = t.organization_id
     LEFT JOIN users u ON u.id = t.created_by
     ${status ? 'WHERE t.status = ?' : ''}
     ORDER BY t.created_at ASC`,
    status ? [status] : []
  );
  res.json({ tickets });
});

/* ── GET /api/admin/tickets/:id/attachment — URL signée ────────────────── */
router.get('/:id/attachment', async (req, res) => {
  const [rows] = await getPool().execute(
    'SELECT r2_key, filename FROM ticket_attachments WHERE ticket_id = ? LIMIT 1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pièce jointe introuvable' });
  const url = await signedDownloadUrl(rows[0].r2_key, rows[0].filename);
  res.json({ url, expiresIn: 300 });
});

const decisionSchema = z.object({
  decision: z.enum(['valide', 'refuse', 'reporte', 'geste_commercial']),
});

/* ── POST /api/admin/tickets/:id/decision ──────────────────────────────────
 * valide            : le travail sera fait (crédit déjà décompté à la soumission)
 * refuse            : recrédit sur le LOT D'ORIGINE, même expiré (anti-abus)
 * reporte           : ticket hors crédit mis en file → consommera le lot du
 *                     prochain mois (traité par le webhook invoice.paid)
 * geste_commercial  : validé gratuitement, tracé par un lot dédié (qty 1, used 1)
 */
router.post('/:id/decision', async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Décision invalide' });
  const { decision } = parsed.data;

  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT t.*, o.name AS org_name FROM tickets t
     JOIN organizations o ON o.id = t.organization_id
     WHERE t.id = ? LIMIT 1`,
    [req.params.id]
  );
  const ticket = rows[0];
  if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
  if (!['en_attente', 'reporte'].includes(ticket.status)) {
    return res.status(409).json({ error: `Ticket déjà décidé (${ticket.status})` });
  }

  switch (decision) {
    case 'valide': {
      await pool.execute(
        "UPDATE tickets SET status = 'valide', decided_at = NOW() WHERE id = ?",
        [ticket.id]
      );
      break;
    }
    case 'refuse': {
      if (ticket.credit_grant_id) await refundCredit(ticket.credit_grant_id);
      await pool.execute(
        "UPDATE tickets SET status = 'refuse', decided_at = NOW() WHERE id = ?",
        [ticket.id]
      );
      break;
    }
    case 'reporte': {
      if (ticket.credit_grant_id) {
        return res.status(400).json({ error: 'Ce ticket a déjà consommé un crédit, il ne peut pas être reporté' });
      }
      await pool.execute("UPDATE tickets SET status = 'reporte' WHERE id = ?", [ticket.id]);
      break;
    }
    case 'geste_commercial': {
      if (ticket.credit_grant_id) {
        return res.status(400).json({ error: 'Ce ticket a déjà consommé un crédit' });
      }
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const grantId = await createGrant(ticket.organization_id, 'geste_commercial', 1, expiresAt, { used: 1 });
      await pool.execute(
        "UPDATE tickets SET status = 'valide', credit_grant_id = ?, decided_at = NOW() WHERE id = ?",
        [grantId, ticket.id]
      );
      break;
    }
  }

  await audit('admin', req.user.uid, `ticket.${decision}`, 'ticket', ticket.id, { org: ticket.org_name });
  notifyDiscord('🎫 Décision ticket', `**${ticket.org_name}** — "${ticket.title}" → ${decision}`);
  res.json({ decided: true, decision });
});

/* ── POST /api/admin/tickets/:id/complete — validé → terminé ───────────── */
router.post('/:id/complete', async (req, res) => {
  const [result] = await getPool().execute(
    "UPDATE tickets SET status = 'termine', completed_at = NOW() WHERE id = ? AND status = 'valide'",
    [req.params.id]
  );
  if (!result.affectedRows) return res.status(409).json({ error: 'Ticket introuvable ou non validé' });

  await audit('admin', req.user.uid, 'ticket.complete', 'ticket', req.params.id);
  res.json({ completed: true });
});

export default router;
