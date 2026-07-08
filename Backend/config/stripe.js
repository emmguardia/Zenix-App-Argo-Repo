import Stripe from 'stripe';

let stripe = null;

export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/** Price Stripe selon formule + grille (standard ou asso) */
export function planPrice(plan, tier = 'standard') {
  const suffix = tier === 'asso' ? '_ASSO' : '';
  return process.env[`STRIPE_PRICE_${String(plan).toUpperCase()}${suffix}`] || null;
}

/** Price Stripe → formule (pour détecter le plan d'un abonnement existant) */
export function priceToPlan(priceId) {
  if (!priceId) return null;
  for (const plan of ['essentiel', 'start', 'relax', 'pro']) {
    if (priceId === planPrice(plan, 'standard') || priceId === planPrice(plan, 'asso')) return plan;
  }
  return null;
}
