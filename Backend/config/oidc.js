import * as oidc from 'openid-client';

let config = null;

/**
 * Découverte OIDC (Authentik) — mise en cache après le premier appel.
 * L'issuer est l'URL "OpenID Configuration Issuer" du provider Authentik.
 */
export async function getOidcConfig() {
  if (!config) {
    config = await oidc.discovery(
      new URL(process.env.OIDC_ISSUER_URL),
      process.env.OIDC_CLIENT_ID,
      process.env.OIDC_CLIENT_SECRET
    );
  }
  return config;
}

export const REDIRECT_URI = `${(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')}/api/auth/callback`;

export { oidc };
