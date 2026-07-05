import Stripe from 'stripe';

let stripe = null;

export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

/** Price Stripe par formule (Dashboard → Produits) */
export const PLAN_PRICES = {
  start: () => process.env.STRIPE_PRICE_START,
  relax: () => process.env.STRIPE_PRICE_RELAX,
  pro:   () => process.env.STRIPE_PRICE_PRO,
};

/** Price Stripe → formule (pour détecter le plan d'un abonnement existant) */
export function priceToPlan(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_START) return 'start';
  if (priceId === process.env.STRIPE_PRICE_RELAX) return 'relax';
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  return null;
}
