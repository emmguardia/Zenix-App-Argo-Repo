import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakePool } from './helpers/fake-db.js';

let pool;
mock.module('../config/database.js', {
  namedExports: { getPool: () => pool },
});

const {
  planCredits, getBalance, consumeCredit, refundCredit, createGrant, processDeferredTickets,
} = await import('../utils/credits.js');

beforeEach(() => {
  pool = new FakePool();
  delete process.env.PLAN_START_CREDITS;
  delete process.env.PLAN_RELAX_CREDITS;
  delete process.env.PLAN_PRO_CREDITS;
});

/* ── planCredits ───────────────────────────────────────────────────────── */

test('planCredits : valeurs par défaut des formules', () => {
  assert.equal(planCredits('start'), 2);
  assert.equal(planCredits('relax'), 6);
  assert.equal(planCredits('pro'), 12);
});

test('planCredits : essentiel = 0 (hébergement seul), formule inconnue = 0', () => {
  assert.equal(planCredits('essentiel'), 0);
  assert.equal(planCredits('inexistant'), 0);
  assert.equal(planCredits(null), 0);
});

test('planCredits : surcharge par variable d\'environnement', () => {
  process.env.PLAN_START_CREDITS = '4';
  assert.equal(planCredits('start'), 4);
});

/* ── getBalance ────────────────────────────────────────────────────────── */

test('getBalance : somme convertie en nombre', async () => {
  pool.queue([[{ balance: '5' }]]);
  assert.equal(await getBalance('org-1'), 5);
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, ['org-1']);
});

/* ── consumeCredit ─────────────────────────────────────────────────────── */

test('consumeCredit : lot trouvé → décompte, commit et release', async () => {
  pool.queue([[{ id: 'g1' }]], [{ affectedRows: 1 }]);
  const grantId = await consumeCredit('org-1');
  assert.equal(grantId, 'g1');
  assert.deepEqual(pool.tx, ['begin', 'commit', 'release']);
  // Le lot expirant le plus tôt part en premier (règle forfait avant pack)
  assert.match(pool.calls[0].sql, /ORDER BY expires_at ASC/);
  assert.match(pool.calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(pool.calls[1].params, ['g1']);
});

test('consumeCredit : solde à zéro → null, rollback et release', async () => {
  pool.queue([[]]);
  const grantId = await consumeCredit('org-1');
  assert.equal(grantId, null);
  assert.deepEqual(pool.tx, ['begin', 'rollback', 'release']);
});

test('consumeCredit : erreur SQL → rollback, release et erreur propagée', async () => {
  pool.queue([[{ id: 'g1' }]], new Error('boom'));
  await assert.rejects(() => consumeCredit('org-1'), /boom/);
  assert.deepEqual(pool.tx, ['begin', 'rollback', 'release']);
});

/* ── refundCredit ──────────────────────────────────────────────────────── */

test('refundCredit : recrédite le lot d\'origine sans jamais passer sous zéro', async () => {
  pool.queue([{ affectedRows: 1 }]);
  await refundCredit('g1');
  assert.match(pool.calls[0].sql, /GREATEST\(used - 1, 0\)/);
  assert.deepEqual(pool.calls[0].params, ['g1']);
});

/* ── createGrant ───────────────────────────────────────────────────────── */

test('createGrant : insertion → id retourné, stripe_invoice_id transmis', async () => {
  pool.queue([{ affectedRows: 1 }]);
  const expires = new Date('2026-08-19T00:00:00Z');
  const id = await createGrant('org-1', 'forfait', 2, expires, { stripeInvoiceId: 'in_123' });
  assert.equal(typeof id, 'string');
  assert.match(pool.calls[0].sql, /INSERT IGNORE INTO credit_grants/);
  const params = pool.calls[0].params;
  assert.equal(params[1], 'org-1');
  assert.equal(params[2], 'forfait');
  assert.equal(params[3], 2);
  assert.equal(params[6], 'in_123');
});

test('createGrant : doublon (webhook rejoué) → null', async () => {
  pool.queue([{ affectedRows: 0 }]);
  const id = await createGrant('org-1', 'forfait', 2, new Date(), { stripeInvoiceId: 'in_123' });
  assert.equal(id, null);
});

/* ── processDeferredTickets ────────────────────────────────────────────── */

test('processDeferredTickets : reporte → a_confirmer, nombre retourné', async () => {
  pool.queue([{ affectedRows: 3 }]);
  const n = await processDeferredTickets('org-1');
  assert.equal(n, 3);
  assert.match(pool.calls[0].sql, /SET status = 'a_confirmer'/);
  assert.match(pool.calls[0].sql, /status = 'reporte'/);
});
