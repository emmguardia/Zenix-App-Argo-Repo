import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getPool } from '../config/database.js';
import { getOidcConfig, oidc, REDIRECT_URI } from '../config/oidc.js';
import { requireAuth, SESSION_COOKIE, sessionCookieOptions } from '../middleware/auth.js';
import { authLimiter } from '../config/security.js';
import { audit } from '../utils/audit.js';

const router = Router();

const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const OIDC_COOKIE = '__Host-oidc';
const oidcCookieOptions = {
  httpOnly: true,
  secure:   true,
  sameSite: 'lax', // le callback arrive par redirection cross-site depuis Authentik
  path:     '/',
  maxAge:   10 * 60 * 1000,
};

/* ── GET /api/auth/login — redirection vers Authentik ─────────────────── */
router.get('/login', authLimiter, async (_req, res) => {
  try {
    const config = await getOidcConfig();

    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();

    const authUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri:          REDIRECT_URI,
      scope:                 'openid email profile',
      state,
      code_challenge:        codeChallenge,
      code_challenge_method: 'S256',
    });

    // state + verifier signés dans un cookie court (10 min), anti-tampering
    const tmp = jwt.sign({ state, codeVerifier }, process.env.SESSION_SECRET, { expiresIn: '10m' });
    res.cookie(OIDC_COOKIE, tmp, oidcCookieOptions);
    res.redirect(authUrl.href);
  } catch (e) {
    console.error('[auth] login error:', e.message);
    res.redirect(`${FRONTEND_URL}/?error=auth-indisponible`);
  }
});

/* ── GET /api/auth/callback — retour d'Authentik ──────────────────────── */
router.get('/callback', authLimiter, async (req, res) => {
  try {
    const tmpToken = req.cookies?.[OIDC_COOKIE];
    if (!tmpToken) return res.redirect(`${FRONTEND_URL}/?error=session-expiree`);
    const { state, codeVerifier } = jwt.verify(tmpToken, process.env.SESSION_SECRET);
    res.clearCookie(OIDC_COOKIE, { ...oidcCookieOptions, maxAge: undefined });

    const config = await getOidcConfig();
    const currentUrl = new URL(req.originalUrl, process.env.APP_URL || 'http://localhost:3000');
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      expectedState:    state,
      pkceCodeVerifier: codeVerifier,
    });

    const claims = tokens.claims();
    const email = (claims.email || '').toLowerCase();
    const groups = Array.isArray(claims.groups) ? claims.groups : [];
    const isAdmin = groups.includes(process.env.ADMIN_GROUP || 'GRP Admins');

    if (!email) return res.redirect(`${FRONTEND_URL}/?error=email-manquant`);

    // Fiche pré-créée par l'admin : match par sub, sinon par email (1ère connexion)
    const pool = getPool();
    let [rows] = await pool.execute(
      'SELECT id, email, name FROM users WHERE authentik_sub = ? LIMIT 1',
      [claims.sub]
    );
    let user = rows[0];

    if (!user) {
      [rows] = await pool.execute('SELECT id, email, name FROM users WHERE email = ? LIMIT 1', [email]);
      user = rows[0];
      if (user) {
        await pool.execute(
          'UPDATE users SET authentik_sub = ?, name = COALESCE(NULLIF(name, \'\'), ?) WHERE id = ?',
          [claims.sub, claims.name || claims.preferred_username || '', user.id]
        );
      } else {
        // Auto-provision : le compte Authentik est créé par Enzo, c'est lui le contrôle
        // d'accès. Le client passera par l'onboarding (infos, offre...) au premier login.
        user = { id: randomUUID(), email, name: claims.name || '' };
        await pool.execute(
          'INSERT INTO users (id, authentik_sub, email, name) VALUES (?, ?, ?, ?)',
          [user.id, claims.sub, email, user.name]
        );
      }
    }

    const session = jwt.sign(
      { uid: user.id, sub: claims.sub, email, name: user.name || claims.name || '', admin: isAdmin },
      process.env.SESSION_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie(SESSION_COOKIE, session, sessionCookieOptions);

    await audit(isAdmin ? 'admin' : 'client', user.id, 'auth.login', 'user', user.id);
    res.redirect(FRONTEND_URL);
  } catch (e) {
    console.error('[auth] callback error:', e.message);
    res.redirect(`${FRONTEND_URL}/?error=auth-echec`);
  }
});

/* ── POST /api/auth/logout ─────────────────────────────────────────────── */
router.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions, maxAge: undefined });
  res.json({ message: 'Déconnecté' });
});

/* ── GET /api/auth/me — utilisateur + ses organisations ────────────────── */
router.get('/me', requireAuth, async (req, res) => {
  const [orgs] = await getPool().execute(
    `SELECT o.id, o.name, o.legal_type, o.plan, o.status
     FROM organizations o
     JOIN memberships m ON m.organization_id = o.id
     WHERE m.user_id = ?
     ORDER BY o.name`,
    [req.user.uid]
  );
  res.json({
    user: { id: req.user.uid, email: req.user.email, name: req.user.name, admin: req.user.admin },
    organizations: orgs,
  });
});

export default router;
