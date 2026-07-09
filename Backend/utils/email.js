import jwt from 'jsonwebtoken';
import { getPool } from '../config/database.js';

/**
 * Emails transactionnels via l'email-service du cluster (même mécanique que la
 * vitrine : JWT RS256, issuer email-service). Réservé au STRICT nécessaire :
 * document à signer, échec de paiement, demande reportée à reconfirmer.
 * Ne doit jamais faire échouer l'action principale.
 */

function serviceToken() {
  return jwt.sign(
    { project: 'enzo', permissions: ['send_email'] },
    process.env.EMAIL_JWT_PRIVATE_KEY,
    { algorithm: 'RS256', issuer: 'email-service', expiresIn: '1h' }
  );
}

export async function sendClientEmail(toEmail, toName, title, message) {
  if (!process.env.EMAIL_SERVICE_URL || !process.env.EMAIL_JWT_PRIVATE_KEY) {
    console.warn('[email] non configuré (EMAIL_SERVICE_URL / EMAIL_JWT_PRIVATE_KEY), skip');
    return;
  }
  try {
    const res = await fetch(`${process.env.EMAIL_SERVICE_URL}/api/v1/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceToken()}` },
      body: JSON.stringify({
        template_id: process.env.EMAIL_TEMPLATE_ID || 'zenix-app-notification',
        to_email:    toEmail,
        to_name:     toName || '',
        project:     'enzo',
        subject:     `${title} - Zenix Web`,
        variables: {
          title,
          message,
          action_url: process.env.APP_URL || 'https://app.zenixweb.fr',
        },
      }),
    });
    if (!res.ok) console.error('[email] HTTP', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('[email] échec envoi:', e.message);
  }
}

/** Envoie à tous les comptes liés à l'organisation. */
export async function emailOrgMembers(orgId, title, message) {
  const [rows] = await getPool().execute(
    `SELECT u.email, u.name FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = ?`,
    [orgId]
  );
  for (const r of rows) {
    await sendClientEmail(r.email, r.name, title, message);
  }
}
