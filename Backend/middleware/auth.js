import jwt from 'jsonwebtoken';
import { getPool } from '../config/database.js';

export const SESSION_COOKIE = '__Host-session';

export const sessionCookieOptions = {
  httpOnly: true,
  secure:   true,   // accepté sur http://localhost par les navigateurs modernes
  sameSite: 'lax',  // nécessaire : on arrive sur l'app via une redirection Authentik
  path:     '/',
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

/** Session = JWT signé par nous (SESSION_SECRET), posé au callback OIDC.
 *  Vérifie aussi que l'utilisateur existe toujours en base (compte supprimé
 *  = session révoquée, cookie nettoyé). */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }

  const [rows] = await getPool().execute('SELECT id FROM users WHERE id = ? LIMIT 1', [payload.uid]);
  if (!rows.length) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    return res.status(401).json({ error: 'Compte introuvable — reconnectez-vous' });
  }

  req.user = payload;
  next();
}

/** Admin = membre du groupe Authentik ADMIN_GROUP (flag posé au login). */
export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user.admin) return res.status(403).json({ error: 'Accès refusé' });
    next();
  });
}
