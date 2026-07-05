import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';

/**
 * Ledger de crédits — principe : on ne "reset" jamais, on accorde des LOTS
 * qui expirent. Consommation triée par expires_at croissant → les lots
 * forfait (expiration proche) partent avant les packs (1 an).
 */

export function planCredits(plan) {
  const map = {
    start: Number(process.env.PLAN_START_CREDITS || 2),
    relax: Number(process.env.PLAN_RELAX_CREDITS || 6),
    pro:   Number(process.env.PLAN_PRO_CREDITS   || 12),
  };
  return map[plan] ?? 0;
}

/** Solde = Σ (quantity − used) des lots non expirés. */
export async function getBalance(orgId) {
  const [rows] = await getPool().execute(
    `SELECT COALESCE(SUM(quantity - used), 0) AS balance
     FROM credit_grants
     WHERE organization_id = ? AND expires_at > NOW() AND used < quantity`,
    [orgId]
  );
  return Number(rows[0].balance);
}

export async function listGrants(orgId) {
  const [rows] = await getPool().execute(
    `SELECT id, source, quantity, used, granted_at, expires_at
     FROM credit_grants
     WHERE organization_id = ?
     ORDER BY expires_at DESC`,
    [orgId]
  );
  return rows;
}

/**
 * Consomme 1 crédit sur le lot non expiré expirant le plus tôt.
 * Transaction + FOR UPDATE : pas de double décompte en concurrence.
 * @returns {string|null} id du lot consommé, ou null si solde à zéro
 */
export async function consumeCredit(orgId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id FROM credit_grants
       WHERE organization_id = ? AND expires_at > NOW() AND used < quantity
       ORDER BY expires_at ASC
       LIMIT 1 FOR UPDATE`,
      [orgId]
    );
    if (!rows.length) {
      await conn.rollback();
      return null;
    }
    await conn.execute(
      'UPDATE credit_grants SET used = used + 1 WHERE id = ?',
      [rows[0].id]
    );
    await conn.commit();
    return rows[0].id;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Recrédite le LOT D'ORIGINE, même expiré (règle anti-abus : un ticket
 * refusé après expiration du lot ne redonne rien d'utilisable).
 */
export async function refundCredit(grantId) {
  await getPool().execute(
    'UPDATE credit_grants SET used = GREATEST(used - 1, 0) WHERE id = ?',
    [grantId]
  );
}

/**
 * Crée un lot. stripeInvoiceId (unique) garantit l'idempotence des
 * webhooks invoice.paid rejoués par Stripe.
 */
export async function createGrant(orgId, source, quantity, expiresAt, { used = 0, stripeInvoiceId = null } = {}) {
  const id = randomUUID();
  const [result] = await getPool().execute(
    `INSERT IGNORE INTO credit_grants
       (id, organization_id, source, quantity, used, expires_at, stripe_invoice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, source, quantity, used, expiresAt, stripeInvoiceId]
  );
  return result.affectedRows ? id : null; // null = doublon (webhook rejoué)
}

/**
 * À l'arrivée d'un nouveau lot forfait : les tickets "reporté au mois
 * suivant" consomment le nouveau lot en FIFO et passent en validé.
 * Le surplus reste reporté (attendra le mois d'après).
 */
export async function processDeferredTickets(orgId) {
  const [tickets] = await getPool().execute(
    `SELECT id FROM tickets
     WHERE organization_id = ? AND status = 'reporte'
     ORDER BY created_at ASC`,
    [orgId]
  );

  const processed = [];
  for (const ticket of tickets) {
    const grantId = await consumeCredit(orgId);
    if (!grantId) break;
    await getPool().execute(
      `UPDATE tickets SET status = 'valide', credit_grant_id = ?, decided_at = NOW()
       WHERE id = ? AND status = 'reporte'`,
      [grantId, ticket.id]
    );
    processed.push(ticket.id);
  }
  return processed;
}
