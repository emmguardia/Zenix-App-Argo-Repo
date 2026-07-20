import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { planPrice, priceToPlan } from '../config/stripe.js';

const PRICES = {
  STRIPE_PRICE_START:           'price_std_start',
  STRIPE_PRICE_RELAX:           'price_std_relax',
  STRIPE_PRICE_PRO:             'price_std_pro',
  STRIPE_PRICE_ESSENTIEL_ASSO:  'price_asso_essentiel',
  STRIPE_PRICE_START_ASSO:      'price_asso_start',
  STRIPE_PRICE_RELAX_ASSO:      'price_asso_relax',
  STRIPE_PRICE_PRO_ASSO:        'price_asso_pro',
};

beforeEach(() => {
  for (const [k, v] of Object.entries(PRICES)) process.env[k] = v;
});

test('planPrice : grille standard et grille asso', () => {
  assert.equal(planPrice('start'), 'price_std_start');
  assert.equal(planPrice('start', 'asso'), 'price_asso_start');
  assert.equal(planPrice('essentiel', 'asso'), 'price_asso_essentiel');
});

test('planPrice : price non configuré → null (jamais de chaîne vide)', () => {
  delete process.env.STRIPE_PRICE_PRO;
  assert.equal(planPrice('pro'), null);
});

test('priceToPlan : aller-retour sur les deux grilles', () => {
  assert.equal(priceToPlan('price_std_relax'), 'relax');
  assert.equal(priceToPlan('price_asso_pro'), 'pro');
  assert.equal(priceToPlan('price_asso_essentiel'), 'essentiel');
});

test('priceToPlan : price inconnu ou absent → null', () => {
  assert.equal(priceToPlan('price_inconnu'), null);
  assert.equal(priceToPlan(null), null);
  assert.equal(priceToPlan(undefined), null);
});
