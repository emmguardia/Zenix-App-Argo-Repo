import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { planCredits, consumeCredit, refundCredit } from './credits.js';

/**
 * Propositions d'amélioration — Enzo propose, le client décide.
 *
 * - Envoi groupé : toutes les propositions d'un envoi partagent un batch_id
 *   et partent dans UN SEUL email (moins de mails = moins de spam).
 * - Plafond : proposals_per_month du client (NULL = crédits de sa formule),
 *   moins les propositions encore sans réponse.
 * - Acceptation : 1 crédit décompté (même ledger que les demandes) → ticket
 *   créé directement en "valide" (À faire), puisque c'est Enzo qui l'a proposé.
 * - Sans réponse : la proposition reste "proposee" et se reporte au mois
 *   suivant, où elle pourra être acceptée avec les crédits du nouveau mois.
 */

export const MAX_PROPOSALS_PER_BATCH = 20;

/** Nombre de propositions par mois pour ce client. */
export function proposalLimit(org) {
  return org.proposals_per_month ?? planCredits(org.plan);
}

export async function countPending(orgId) {
  const [rows] = await getPool().execute(
    "SELECT COUNT(*) AS n FROM proposals WHERE organization_id = ? AND status = 'proposee'",
    [orgId]
  );
  return Number(rows[0].n);
}

export async function listProposals(orgId, { includeWithdrawn = false } = {}) {
  const [rows] = await getPool().execute(
    `SELECT p.id, p.batch_id, p.title, p.description, p.status, p.ticket_id,
            p.created_at, p.decided_at, t.status AS ticket_status
     FROM proposals p
     LEFT JOIN tickets t ON t.id = p.ticket_id
     WHERE p.organization_id = ? ${includeWithdrawn ? '' : "AND p.status <> 'retiree'"}
     ORDER BY p.created_at DESC`,
    [orgId]
  );
  return rows;
}

/**
 * Crée un envoi groupé. Vérifie le plafond (propositions en attente comprises).
 * @returns {{ batchId: string, ids: string[] } | { error: string }}
 */
export async function createBatch(org, items, adminId) {
  const limit = proposalLimit(org);
  const pending = await countPending(org.id);
  const available = Math.max(limit - pending, 0);

  if (items.length > available) {
    return {
      error: available === 0
        ? `Plus de place : ${pending} proposition${pending > 1 ? 's' : ''} sans réponse pour ${limit}/mois. Retire-en ou attends sa réponse.`
        : `Maximum ${available} proposition${available > 1 ? 's' : ''} pour ce client (${limit}/mois, ${pending} encore sans réponse).`,
    };
  }

  const batchId = randomUUID();
  const ids = items.map(() => randomUUID());
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const [i, item] of items.entries()) {
      await conn.execute(
        `INSERT INTO proposals (id, organization_id, batch_id, title, description, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ids[i], org.id, batchId, item.title, item.description, adminId]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { batchId, ids, pendingBefore: pending };
}

/**
 * Le client accepte : 1 crédit décompté, ticket "valide" créé, proposition liée.
 * Tout ou rien : en cas d'échec ou de double clic, le crédit repart sur son lot.
 * @returns {{ ticketId: string } | { error: string, status: number }}
 */
export async function acceptProposal(orgId, proposalId, userId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT id, title, description FROM proposals WHERE id = ? AND organization_id = ? AND status = 'proposee' LIMIT 1",
    [proposalId, orgId]
  );
  const proposal = rows[0];
  if (!proposal) return { error: 'Proposition introuvable ou déjà traitée', status: 404 };

  const grantId = await consumeCredit(orgId);
  if (!grantId) {
    return {
      error: 'Vous avez déjà utilisé toutes vos modifications ce mois-ci. La proposition reste disponible : vous pourrez l\'accepter dès le mois prochain.',
      status: 409,
    };
  }

  const ticketId = randomUUID();
  let alreadyHandled = false;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO tickets (id, organization_id, created_by, credit_grant_id, title, description, status, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, 'valide', NOW())`,
      [ticketId, orgId, userId, grantId, proposal.title, proposal.description]
    );
    // UPDATE conditionné sur le statut : double clic / second onglet → un seul passe
    const [result] = await conn.execute(
      `UPDATE proposals SET status = 'acceptee', ticket_id = ?, decided_at = NOW(), decided_by = ?
       WHERE id = ? AND status = 'proposee'`,
      [ticketId, userId, proposal.id]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      alreadyHandled = true;
    } else {
      await conn.commit();
    }
  } catch (e) {
    await conn.rollback();
    await refundCredit(grantId).catch((err) => console.error('[proposals] recrédit échoué:', err.message));
    throw e;
  } finally {
    conn.release();
  }
  if (alreadyHandled) {
    await refundCredit(grantId);
    return { error: 'Proposition déjà traitée', status: 409 };
  }
  return { ticketId, title: proposal.title };
}

/** Le client refuse. @returns {boolean} false si introuvable ou déjà traitée */
export async function refuseProposal(orgId, proposalId, userId) {
  const [result] = await getPool().execute(
    `UPDATE proposals SET status = 'refusee', decided_at = NOW(), decided_by = ?
     WHERE id = ? AND organization_id = ? AND status = 'proposee'`,
    [userId, proposalId, orgId]
  );
  return result.affectedRows > 0;
}

/** Enzo retire une proposition restée sans réponse (libère une place). */
export async function withdrawProposal(orgId, proposalId) {
  const [result] = await getPool().execute(
    `UPDATE proposals SET status = 'retiree', decided_at = NOW()
     WHERE id = ? AND organization_id = ? AND status = 'proposee'`,
    [proposalId, orgId]
  );
  return result.affectedRows > 0;
}

/** Texte de l'email d'un envoi groupé. Le template l'insère dans un seul
 *  paragraphe (retours à la ligne perdus) : une phrase, pas une liste. */
export function batchEmailMessage(titles, pendingBefore) {
  const quoted = titles.map((t) => `« ${t} »`);
  const list = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} et ${quoted.at(-1)}` : quoted[0];
  const n = titles.length;
  let message = `Ce mois-ci, je vous propose ${n === 1 ? 'une amélioration' : `${n} améliorations`} pour votre site : ${list}. `
    + 'Vous pouvez les accepter ou les refuser en un clic depuis votre espace client ; chaque proposition acceptée utilise une des modifications incluses dans votre abonnement. '
    + 'Sans réponse de votre part, elles restent disponibles le mois prochain.';
  if (pendingBefore > 0) {
    message += ` Pour rappel, ${pendingBefore} proposition${pendingBefore > 1 ? 's précédentes attendent' : ' précédente attend'} toujours votre réponse.`;
  }
  return message;
}
