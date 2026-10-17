import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakePool } from './helpers/fake-db.js';

let pool;
mock.module('../config/database.js', {
  namedExports: { getPool: () => pool },
});

const {
  proposalLimit, createBatch, acceptProposal, refuseProposal, withdrawProposal, batchEmailMessage,
} = await import('../utils/proposals.js');

beforeEach(() => {
  pool = new FakePool();
  delete process.env.PLAN_START_CREDITS;
});

const ORG = { id: 'org-1', plan: 'start', proposals_per_month: null };
const item = (n) => ({ title: `Proposition ${n}`, description: 'Détail' });

/* ── proposalLimit ─────────────────────────────────────────────────────── */

test('proposalLimit : par défaut = crédits de la formule', () => {
  assert.equal(proposalLimit({ plan: 'start', proposals_per_month: null }), 2);
  assert.equal(proposalLimit({ plan: 'relax', proposals_per_month: null }), 6);
});

test('proposalLimit : réglage du client prioritaire (contrat à 4 modifs)', () => {
  assert.equal(proposalLimit({ plan: 'start', proposals_per_month: 4 }), 4);
  assert.equal(proposalLimit({ plan: 'pro', proposals_per_month: 0 }), 0);
});

/* ── createBatch ───────────────────────────────────────────────────────── */

test('createBatch : 2 propositions Start → insérées dans une transaction, même batch', async () => {
  pool.queue([[{ n: 0 }]], [{ affectedRows: 1 }], [{ affectedRows: 1 }]);
  const r = await createBatch(ORG, [item(1), item(2)], 'admin-1');

  assert.ok(r.batchId);
  assert.equal(r.ids.length, 2);
  assert.equal(r.pendingBefore, 0);
  assert.deepEqual(pool.tx, ['begin', 'commit', 'release']);
  const inserts = pool.calls.filter((c) => /INSERT INTO proposals/.test(c.sql));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].params[2], r.batchId);
  assert.equal(inserts[1].params[2], r.batchId);
});

test('createBatch : au-delà du plafond → refusé sans rien insérer', async () => {
  pool.queue([[{ n: 0 }]]);
  const r = await createBatch(ORG, [item(1), item(2), item(3)], 'admin-1');
  assert.match(r.error, /Maximum 2 propositions/);
  assert.equal(pool.calls.length, 1);
});

test('createBatch : propositions sans réponse reportées → elles occupent des places', async () => {
  pool.queue([[{ n: 1 }]]);
  const r = await createBatch(ORG, [item(1), item(2)], 'admin-1');
  assert.match(r.error, /Maximum 1 proposition /);
});

test('createBatch : plus aucune place → message explicite', async () => {
  pool.queue([[{ n: 2 }]]);
  const r = await createBatch(ORG, [item(1)], 'admin-1');
  assert.match(r.error, /Plus de place/);
});

test('createBatch : erreur SQL → rollback', async () => {
  pool.queue([[{ n: 0 }]], [{ affectedRows: 1 }], new Error('boom'));
  await assert.rejects(createBatch(ORG, [item(1), item(2)], 'admin-1'), /boom/);
  assert.deepEqual(pool.tx, ['begin', 'rollback', 'release']);
});

/* ── acceptProposal ────────────────────────────────────────────────────── */

const PROPOSAL = [[{ id: 'p-1', title: 'Bandeau livraison', description: 'Détail' }]];

test('acceptProposal : 1 crédit décompté, ticket "valide" créé et lié', async () => {
  pool.queue(
    PROPOSAL,
    [[{ id: 'g-1' }]],        // consumeCredit : lot trouvé
    [{ affectedRows: 1 }],    // consumeCredit : used + 1
    [{ affectedRows: 1 }],    // INSERT ticket
    [{ affectedRows: 1 }]     // UPDATE proposal
  );
  const r = await acceptProposal('org-1', 'p-1', 'user-1');
  assert.ok(r.ticketId);

  const ticket = pool.calls.find((c) => /INSERT INTO tickets/.test(c.sql));
  assert.match(ticket.sql, /'valide'/);
  assert.equal(ticket.params[3], 'g-1'); // crédit rattaché au ticket
  assert.equal(ticket.params[4], 'Bandeau livraison');
  const upd = pool.calls.find((c) => /UPDATE proposals/.test(c.sql));
  assert.match(upd.sql, /status = 'proposee'/); // conditionné : anti double clic
});

test('acceptProposal : plus de crédit → 409, la proposition reste ouverte', async () => {
  pool.queue(PROPOSAL, [[]]);
  const r = await acceptProposal('org-1', 'p-1', 'user-1');
  assert.equal(r.status, 409);
  assert.match(r.error, /mois prochain/);
  assert.ok(!pool.calls.some((c) => /UPDATE proposals|INSERT INTO tickets/.test(c.sql)));
});

test('acceptProposal : double clic → second refusé, crédit recrédité', async () => {
  pool.queue(
    PROPOSAL,
    [[{ id: 'g-1' }]],
    [{ affectedRows: 1 }],
    [{ affectedRows: 1 }],    // INSERT ticket
    [{ affectedRows: 0 }],    // UPDATE proposal : déjà acceptée
    [{ affectedRows: 1 }]     // refundCredit
  );
  const r = await acceptProposal('org-1', 'p-1', 'user-1');
  assert.equal(r.status, 409);
  assert.ok(pool.tx.includes('rollback'));
  const refund = pool.calls.at(-1);
  assert.match(refund.sql, /used = GREATEST\(used - 1, 0\)/);
  assert.deepEqual(refund.params, ['g-1']);
});

test('acceptProposal : erreur à la création du ticket → rollback + recrédit', async () => {
  pool.queue(
    PROPOSAL,
    [[{ id: 'g-1' }]],
    [{ affectedRows: 1 }],
    new Error('base KO'),
    [{ affectedRows: 1 }]     // refundCredit
  );
  await assert.rejects(acceptProposal('org-1', 'p-1', 'user-1'), /base KO/);
  assert.deepEqual(pool.calls.at(-1).params, ['g-1']);
});

test('acceptProposal : proposition d\'une autre organisation → 404 (anti-IDOR)', async () => {
  pool.queue([[]]);
  const r = await acceptProposal('org-2', 'p-1', 'user-1');
  assert.equal(r.status, 404);
  assert.deepEqual(pool.calls[0].params, ['p-1', 'org-2']);
});

/* ── refuse / withdraw ─────────────────────────────────────────────────── */

test('refuseProposal / withdrawProposal : conditionnés à l\'organisation et au statut', async () => {
  pool.queue([{ affectedRows: 1 }], [{ affectedRows: 0 }]);
  assert.equal(await refuseProposal('org-1', 'p-1', 'user-1'), true);
  assert.equal(await withdrawProposal('org-1', 'p-1'), false);
  for (const c of pool.calls) {
    assert.match(c.sql, /organization_id = \? AND status = 'proposee'/);
  }
});

/* ── Email ─────────────────────────────────────────────────────────────── */

test('batchEmailMessage : une phrase avec les titres, rappel des précédentes', () => {
  const m = batchEmailMessage(['A', 'B'], 1);
  assert.match(m, /2 améliorations pour votre site : « A » et « B »\./);
  assert.match(m, /1 proposition précédente attend toujours/);
  assert.ok(!m.includes('\n'));
});

test('batchEmailMessage : une seule proposition, pas de rappel', () => {
  const m = batchEmailMessage(['Bandeau'], 0);
  assert.match(m, /une amélioration pour votre site : « Bandeau »\./);
  assert.ok(!/Pour rappel/.test(m));
});
