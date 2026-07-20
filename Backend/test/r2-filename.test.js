import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition } from '../config/r2.js';

test('contentDisposition : accents translittérés dans le repli ASCII, nom UTF-8 complet en filename*', () => {
  const cd = contentDisposition('Devis février.pdf');
  assert.equal(cd, `attachment; filename="Devis fevrier.pdf"; filename*=UTF-8''Devis%20f%C3%A9vrier.pdf`);
});

test('contentDisposition : guillemets et antislash neutralisés dans le repli', () => {
  const cd = contentDisposition('a"b\\c.pdf');
  assert.match(cd, /filename="a_b_c\.pdf"/);
});

test('contentDisposition : apostrophes et parenthèses pct-encodées (RFC 5987)', () => {
  const cd = contentDisposition("Devis (v2) l'asso.pdf");
  const star = cd.split("filename*=UTF-8''")[1];
  assert.equal(star, 'Devis%20%28v2%29%20l%27asso.pdf');
});

test('contentDisposition : nom purement ASCII inchangé', () => {
  const cd = contentDisposition('contrat-2026.pdf');
  assert.equal(cd, `attachment; filename="contrat-2026.pdf"; filename*=UTF-8''contrat-2026.pdf`);
});
