import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { applySecurityMiddleware } from './config/security.js';
import authRouter from './routes/auth.js';
import onboardingRouter from './routes/onboarding.js';
import orgsRouter from './routes/orgs.js';
import stripeWebhookRouter from './routes/stripe-webhook.js';
import adminOrgsRouter from './routes/admin/orgs.js';
import adminTicketsRouter from './routes/admin/tickets.js';
import adminStripeRouter from './routes/admin/stripe.js';

const app  = express();
const PORT = process.env.PORT || 3000;

applySecurityMiddleware(app);

/* ── Stripe webhook : corps BRUT requis pour la signature, AVANT json() ── */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRouter);

app.use(cookieParser());
app.use(express.json({ limit: '512kb' }));

/* ── Health ────────────────────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'zenix-app-backend' });
});

/* ── Auth (OIDC Authentik) ─────────────────────────────────────────────── */
app.use('/api/auth', authRouter);

/* ── Espace client ─────────────────────────────────────────────────────── */
app.use('/api/onboarding', onboardingRouter);
app.use('/api/orgs', orgsRouter);

/* ── Admin ─────────────────────────────────────────────────────────────── */
app.use('/api/admin/orgs',    adminOrgsRouter);
app.use('/api/admin/tickets', adminTicketsRouter);
app.use('/api/admin/stripe',  adminStripeRouter);

/* ── 404 ───────────────────────────────────────────────────────────────── */
app.use((_req, res) => {
  res.status(404).json({ error: 'Route introuvable' });
});

/* ── Erreur globale ────────────────────────────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

app.listen(PORT, () => {
  console.log(`[zenix-app-backend] :${PORT} — NODE_ENV=${process.env.NODE_ENV || 'development'}`);
});
