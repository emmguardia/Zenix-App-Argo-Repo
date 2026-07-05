import jwt from 'jsonwebtoken';

export const SESSION_COOKIE = '__Host-session';

export const sessionCookieOptions = {
  httpOnly: true,
  secure:   true,   // accepté sur http://localhost par les navigateurs modernes
  sameSite: 'lax',  // nécessaire : on arrive sur l'app via une redirection Authentik
  path:     '/',
  maxAge:   7 * 24 * 60 * 60 * 1000,
};

/** Session = JWT signé par nous (SESSION_SECRET), posé au callback OIDC. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    req.user = jwt.verify(token, process.env.SESSION_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session invalide ou expirée' });
  }
}

/** Admin = membre du groupe Authentik ADMIN_GROUP (flag posé au login). */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.admin) return res.status(403).json({ error: 'Accès refusé' });
    next();
  });
}
