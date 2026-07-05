import { getPool } from '../config/database.js';

/**
 * Journal d'audit — anti-litige ("je n'ai jamais demandé ça").
 * Ne doit jamais faire échouer l'action principale : erreurs loggées, pas relancées.
 *
 * @param {'client'|'admin'|'system'} actorType
 * @param {string|null} actorId    users.id (null pour system/webhooks)
 * @param {string} action          ex: 'ticket.create', 'org.activate'
 * @param {string} entity          ex: 'ticket', 'organization'
 * @param {string} entityId
 * @param {object} [details]
 */
export async function audit(actorType, actorId, action, entity, entityId, details = null) {
  try {
    await getPool().execute(
      `INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorType, actorId, action, entity, String(entityId), details ? JSON.stringify(details) : null]
    );
  } catch (e) {
    console.error('[audit] échec écriture:', e.message);
  }
}
