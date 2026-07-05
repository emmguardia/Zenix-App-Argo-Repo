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
