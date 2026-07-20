import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { FakePool } from './helpers/fake-db.js';

/* Environnement minimal : ni Discord ni email (les utilitaires se coupent
   d'eux-mêmes quand les variables sont absentes). */
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_secret_de_test';
delete process.env.DISCORD_WEBHOOK_URL;
delete process.env.EMAIL_SERVICE_URL;
delete process.env.PLAN_START_CREDITS;
delete process.env.STRIPE_COUPON_FREE_MONTH;

const realStripe = new Stripe('sk_test_bidon');

/* Faux client Stripe : signature déléguée au vrai SDK, factures et
   abonnements scriptables par test. */
let stripeInvoices = [];
let subscriptionUpdates = [];
const fakeStripe = {
  webhooks: {
    constructEvent: (...args) => realStripe.webhooks.constructEvent(...args),
  },
  invoices: {
    list() {
      const items = stripeInvoices;
      return { async *[Symbol.asyncIterator]() { yield* items; } };
    },
  },
  subscriptions: {
    async update(id, params) { subscriptionUpdates.push({ id, params }); return { id }; },
  },
};

let pool;
mock.module('../config/database.js', { namedExports: { getPool: () => pool } });
mock.module('../config/stripe.js', {
  namedExports: {
    getStripe: () => fakeStripe,
    planPrice: () => null,
    priceToPlan: () => null,
  },
});

const { default: router } = await import('../routes/stripe-webhook.js');

beforeEach(() => {
  pool = new FakePool();
  stripeInvoices = [];
  subscriptionUpdates = [];
  delete process.env.STRIPE_COUPON_FREE_MONTH;
});

function signedReq(event) {
  const payload = JSON.stringify(event);
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  return makeReq(payload, signature);
}

function makeReq(payload, signature) {
  return {
    method: 'POST',
    url: '/',
    originalUrl: '/',
    body: Buffer.from(payload),
    headers: signature ? { 'stripe-signature': signature } : {},
  };
}

function dispatch(req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); return this; },
    };
    router(req, res, (err) => (err ? reject(err) : resolve(res)));
  });
}

const ORG = {
  id: 'org-1',
  name: 'Test SARL',
  plan: 'start',
  status: 'active',
  billing_interval: 'monthly',
  stripe_customer_id: 'cus_123',
  stripe_subscription_id: 'sub_1',
};

const PERIOD_END = 1767225600; // 2026-01-01
const invoicePaidEvent = (overrides = {}) => ({
  id: 'evt_1',
  object: 'event',
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_00001',
      customer: 'cus_123',
      total: 3900,
      lines: { data: [{ period: { end: PERIOD_END } }] },
      ...overrides,
    },
  },
});

/* ── Sécurité ──────────────────────────────────────────────────────────── */

test('webhook : signature invalide → 400, aucun accès base', async () => {
  const res = await dispatch(makeReq(JSON.stringify(invoicePaidEvent()), 't=1,v1=fausse'));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Signature invalide' });
  assert.equal(pool.calls.length, 0);
});

test('webhook : signature absente → 400', async () => {
  const res = await dispatch(makeReq(JSON.stringify(invoicePaidEvent()), null));
  assert.equal(res.statusCode, 400);
  assert.equal(pool.calls.length, 0);
});

/* ── invoice.paid ──────────────────────────────────────────────────────── */

test('invoice.paid : lot forfait créé (2 crédits Start) expirant à la fin de période', async () => {
  pool.queue(
    [[{ ...ORG }]],           // findOrgByCustomer
    [{ affectedRows: 1 }],    // createGrant
    [{ affectedRows: 0 }],    // processDeferredTickets
    [{}]                      // audit
  );
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });

  const grant = pool.calls[1];
  assert.match(grant.sql, /INSERT IGNORE INTO credit_grants/);
  assert.equal(grant.params[1], 'org-1');
  assert.equal(grant.params[2], 'forfait');
  assert.equal(grant.params[3], 2); // crédits Start
  assert.deepEqual(grant.params[5], new Date(PERIOD_END * 1000));
  assert.equal(grant.params[6], 'in_00001');
});

test('invoice.paid : événement rejoué par Stripe → idempotent, traitement stoppé', async () => {
  pool.queue(
    [[{ ...ORG }]],
    [{ affectedRows: 0 }] // doublon stripe_invoice_id
  );
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });
  assert.equal(pool.calls.length, 2); // rien après le doublon
});

test('invoice.paid : customer inconnu → 200 sans effet', async () => {
  pool.queue([[]]);
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });
  assert.equal(pool.calls.length, 1);
});

test('invoice.paid : org past_due → repasse active', async () => {
  pool.queue(
    [[{ ...ORG, status: 'past_due' }]],
    [{ affectedRows: 1 }],
    [{}],                     // setOrgStatus(active)
    [{ affectedRows: 0 }],
    [{}]
  );
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });
  const statusCall = pool.calls[2];
  assert.match(statusCall.sql, /UPDATE organizations SET status/);
  assert.deepEqual(statusCall.params, ['active', 'org-1']);
});

/* ── Coupon 12e mois (engagement 1 an) ─────────────────────────────────── */

test('coupon 12e mois : appliqué au 11e paiement Stripe de l\'abonnement', async () => {
  process.env.STRIPE_COUPON_FREE_MONTH = 'zenix-12e-mois-offert';
  stripeInvoices = Array.from({ length: 11 }, (_, i) => ({ id: `in_${i}` }));
  pool.queue(
    [[{ ...ORG, billing_interval: 'annual' }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 0 }],
    [{}],                     // audit free-month
    [{}]                      // audit credits.grant
  );
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(subscriptionUpdates, [{
    id: 'sub_1',
    params: { discounts: [{ coupon: 'zenix-12e-mois-offert' }] },
  }]);
});

test('coupon 12e mois : client importé avec plus de 11 paiements → pas de coupon', async () => {
  process.env.STRIPE_COUPON_FREE_MONTH = 'zenix-12e-mois-offert';
  stripeInvoices = Array.from({ length: 30 }, (_, i) => ({ id: `in_${i}` }));
  pool.queue(
    [[{ ...ORG, billing_interval: 'annual' }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 0 }],
    [{}]
  );
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(subscriptionUpdates, []);
});

test('coupon 12e mois : abonnement mensuel sans engagement → jamais de coupon', async () => {
  process.env.STRIPE_COUPON_FREE_MONTH = 'zenix-12e-mois-offert';
  stripeInvoices = Array.from({ length: 11 }, (_, i) => ({ id: `in_${i}` }));
  pool.queue(
    [[{ ...ORG }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 0 }],
    [{}]
  );
  await dispatch(signedReq(invoicePaidEvent()));
  assert.deepEqual(subscriptionUpdates, []);
});

/* ── invoice.payment_failed ────────────────────────────────────────────── */

test('payment_failed : org passe past_due, membres prévenus', async () => {
  pool.queue(
    [[{ ...ORG }]],           // findOrgByCustomer
    [{}],                     // setOrgStatus(past_due)
    [{}],                     // audit
    [[]]                      // emailOrgMembers → memberships (vide)
  );
  const res = await dispatch(signedReq({
    id: 'evt_2',
    object: 'event',
    type: 'invoice.payment_failed',
    data: { object: { id: 'in_ko', customer: 'cus_123', total: 3900, attempt_count: 1 } },
  }));
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(pool.calls[1].params, ['past_due', 'org-1']);
});

/* ── Divers ────────────────────────────────────────────────────────────── */

test('événement non géré → 200 sans accès base', async () => {
  const res = await dispatch(signedReq({
    id: 'evt_3', object: 'event', type: 'customer.created', data: { object: { id: 'cus_x' } },
  }));
  assert.deepEqual(res.body, { received: true });
  assert.equal(pool.calls.length, 0);
});

test('erreur pendant le traitement → 500 pour que Stripe retente', async () => {
  pool.queue(new Error('base indisponible'));
  const res = await dispatch(signedReq(invoicePaidEvent()));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Erreur traitement webhook' });
});
