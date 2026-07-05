import { getPool } from '../config/database.js';

/**
 * Garde anti-IDOR central : vérifie que l'utilisateur connecté est membre
 * de l'organisation :orgId (ou admin). Attache req.org.
 *
 * TOUTE route touchant une ressource d'organisation passe par ici —
 * jamais de contrôle d'appartenance éparpillé dans les routes.
 * 404 (et non 403) pour ne pas révéler l'existence d'une organisation.
 */
export async function requireOrgAccess(req, res, next) {
  const { orgId } = req.params;
  if (!orgId || orgId.length > 36) {
    return res.status(404).json({ error: 'Organisation introuvable' });
  }

  const [rows] = req.user.admin
    ? await getPool().execute(
        'SELECT * FROM organizations WHERE id = ? LIMIT 1',
        [orgId]
      )
    : await getPool().execute(
        `SELECT o.* FROM organizations o
         JOIN memberships m ON m.organization_id = o.id
         WHERE o.id = ? AND m.user_id = ? LIMIT 1`,
        [orgId, req.user.uid]
      );

  if (!rows.length) {
    return res.status(404).json({ error: 'Organisation introuvable' });
  }

  req.org = rows[0];
  next();
}
