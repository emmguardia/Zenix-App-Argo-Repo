import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPool } from '../../config/database.js';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

/* ── GET /api/admin/messages — conversations (tous les clients) ─────────── */
router.get('/', async (_req, res) => {
  const [conversations] = await getPool().execute(
    `SELECT o.id, o.name, o.client_last_read_at,
       (SELECT body FROM messages m WHERE m.organization_id = o.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
       (SELECT created_at FROM messages m WHERE m.organization_id = o.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
       (SELECT sender FROM messages m WHERE m.organization_id = o.id ORDER BY m.created_at DESC LIMIT 1) AS last_sender,
       (SELECT MAX(created_at) FROM messages m WHERE m.organization_id = o.id AND m.sender = 'admin') AS last_admin_at,
       (SELECT COUNT(*) FROM messages m WHERE m.organization_id = o.id AND m.sender = 'client'
          AND (o.admin_last_read_at IS NULL OR m.created_at > o.admin_last_read_at)) AS unread
     FROM organizations o
     ORDER BY last_at IS NULL, last_at DESC, o.name ASC`
  );
  res.json({
    conversations: conversations.map((c) => ({
      ...c,
      // "Vu" = le client a ouvert la conversation après ton dernier message
      seen: !!(c.last_admin_at && c.client_last_read_at && new Date(c.client_last_read_at) >= new Date(c.last_admin_at)),
    })),
  });
});

/* ── GET /api/admin/messages/:orgId — fil + marque lu côté admin ────────── */
router.get('/:orgId', async (req, res) => {
  const [messages] = await getPool().execute(
    'SELECT id, sender, body, created_at FROM messages WHERE organization_id = ? ORDER BY created_at ASC LIMIT 500',
    [req.params.orgId]
  );
  const [orgs] = await getPool().execute(
    'SELECT client_last_read_at FROM organizations WHERE id = ? LIMIT 1', [req.params.orgId]
  );
  await getPool().execute('UPDATE organizations SET admin_last_read_at = NOW() WHERE id = ?', [req.params.orgId]);
  res.json({ messages, client_last_read_at: orgs[0]?.client_last_read_at ?? null });
});

const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

/* ── POST /api/admin/messages/:orgId ───────────────────────────────────── */
router.post('/:orgId', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Message vide ou trop long' });

  const id = randomUUID();
  const [result] = await getPool().execute(
    `INSERT INTO messages (id, organization_id, sender, sender_id, body)
     SELECT ?, id, 'admin', ?, ? FROM organizations WHERE id = ?`,
    [id, req.user.uid, parsed.data.body, req.params.orgId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Client introuvable' });
  res.status(201).json({ id });
});

export default router;
