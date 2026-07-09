import { Router } from 'express';
import { getPool } from '../config/database.js';
import { getStripe } from '../config/stripe.js';
import { planCredits, createGrant, processDeferredTickets } from '../utils/credits.js';
import { audit } from '../utils/audit.js';
import { notifyDiscord } from '../utils/discord.js';
import { emailOrgMembers } from '../utils/email.js';

const router = Router();

async function findOrgByCustomer(customerId) {
  const [rows] = await getPool().execute(
    'SELECT * FROM organizations WHERE stripe_customer_id = ? LIMIT 1',
    [customerId]
  );
  return rows[0] ?? null;
}

async function setOrgStatus(orgId, status) {
  await getPool().execute('UPDATE organizations SET status = ? WHERE id = ?', [status, orgId]);
}

/* ── invoice.paid : prélèvement OK → lot forfait + tickets reportés ─────── */
async function onInvoicePaid(invoice) {
  const org = await findOrgByCustomer(invoice.customer);
  if (!org) {
    console.warn('[stripe] invoice.paid pour customer inconnu:', invoice.customer);
    return;
  }

  // Essentiel = 0 crédit inclus : on crée quand même un lot (quantité 0) pour
  // garder l'idempotence via stripe_invoice_id et la trace du cycle payé.
  const quantity = planCredits(org.plan);

  // Le lot expire à la fin de la période facturée (= prochain prélèvement)
  const periodEnd = invoice.lines?.data?.[0]?.period?.end ?? invoice.period_end;
  const expiresAt = new Date(periodEnd * 1000);

  // stripe_invoice_id unique → idempotent si Stripe rejoue l'événement
  const grantId = await createGrant(org.id, 'forfait', quantity, expiresAt, {
    stripeInvoiceId: invoice.id,
  });
  if (!grantId) return; // doublon, déjà traité

  if (org.status !== 'active') await setOrgStatus(org.id, 'active');

  // Tickets reportés → retour chez le client pour re-confirmation (+ email,
  // sinon le client ne sait pas que sa demande l'attend)
  const deferred = await processDeferredTickets(org.id);
  if (deferred > 0) {
    emailOrgMembers(org.id, 'Une demande attend votre confirmation',
      'Une demande de modification mise de côté le mois dernier est de retour dans votre espace client Zenix. Connectez-vous pour la confirmer ou l\'annuler.');
  }

  // Engagement 1 an : au 11e paiement, coupon 100% "une fois" → 12e mois à 0 €
  let freeMonthApplied = false;
  if (org.billing_interval === 'annual' && process.env.STRIPE_COUPON_FREE_MONTH) {
    const [cycles] = await getPool().execute(
      "SELECT COUNT(*) AS n FROM credit_grants WHERE organization_id = ? AND source = 'forfait'",
      [org.id]
    );
    if (Number(cycles[0].n) === 11 && org.stripe_subscription_id) {
      try {
        await getStripe().subscriptions.update(org.stripe_subscription_id, {
          discounts: [{ coupon: process.env.STRIPE_COUPON_FREE_MONTH }],
        });
        freeMonthApplied = true;
        await audit('system', null, 'subscription.free-month-applied', 'organization', org.id);
      } catch (e) {
        console.error('[stripe] coupon 12e mois:', e.message);
        notifyDiscord('⚠️ Coupon 12e mois NON appliqué', `**${org.name}** — à faire à la main : ${e.message}`);
      }
    }
  }

  await audit('system', null, 'credits.grant', 'organization', org.id, {
    source: 'forfait', quantity, invoice: invoice.id, deferredReturned: deferred,
  });
  notifyDiscord(
    '💰 Prélèvement réussi',
    `**${org.name}** — ${(invoice.total / 100).toFixed(2)} € (${org.plan})\n` +
    (quantity > 0 ? `+${quantity} crédits (expirent le ${expiresAt.toLocaleDateString('fr-FR')})` : 'Formule Essentiel — aucun crédit inclus') +
    (deferred ? `\n${deferred} demande(s) reportée(s) renvoyée(s) au client pour confirmation` : '') +
    (freeMonthApplied ? '\n🎁 **12e mois offert appliqué** — le prochain prélèvement sera à 0 €' : '')
  );
}

/* ── invoice.payment_failed : échec → past_due ──────────────────────────── */
async function onInvoicePaymentFailed(invoice) {
  const org = await findOrgByCustomer(invoice.customer);
  if (!org) return;

  await setOrgStatus(org.id, 'past_due');
  await audit('system', null, 'payment.failed', 'organization', org.id, {
    invoice: invoice.id, attempt: invoice.attempt_count,
  });
  emailOrgMembers(org.id, 'Problème de paiement',
    'Le prélèvement de votre abonnement Zenix n\'a pas pu être effectué. Votre site reste en ligne — vérifiez votre carte bancaire depuis votre espace client, ou répondez-nous via la messagerie.');
  notifyDiscord(
    '🔴 Échec de prélèvement',
    `**${org.name}** — ${(invoice.total / 100).toFixed(2)} € (tentative ${invoice.attempt_count})\n` +
    'Relances mail gérées par Stripe. Après 3 jours : intervention manuelle.'
  );
}

/* ── customer.subscription.updated / deleted ────────────────────────────── */
async function onSubscriptionUpdated(subscription) {
  const org = await findOrgByCustomer(subscription.customer);
  if (!org) return;

  if (subscription.status === 'active' && org.status === 'past_due') {
    await setOrgStatus(org.id, 'active');
  }
  notifyDiscord('🔄 Abonnement modifié', `**${org.name}** — statut Stripe: ${subscription.status}`);
}

async function onSubscriptionDeleted(subscription) {
  const org = await findOrgByCustomer(subscription.customer);
  if (!org) return;

  await setOrgStatus(org.id, 'canceled');
  await audit('system', null, 'subscription.canceled', 'organization', org.id, {
    subscription: subscription.id,
  });
  notifyDiscord(
    '👋 Résiliation',
    `**${org.name}** — abonnement terminé.\nPrévoir : coupure hébergement + migration sortante si demandée.`
  );
}

/* ── POST /api/stripe/webhook ───────────────────────────────────────────── */
// ⚠️ Monté AVANT express.json() dans server.js : la vérification de
// signature exige le corps brut.
router.post('/', async (req, res) => {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('[stripe] signature invalide:', e.message);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  try {
    switch (event.type) {
      case 'invoice.paid':                  await onInvoicePaid(event.data.object); break;
      case 'invoice.payment_failed':        await onInvoicePaymentFailed(event.data.object); break;
      case 'customer.subscription.updated': await onSubscriptionUpdated(event.data.object); break;
      case 'customer.subscription.deleted': await onSubscriptionDeleted(event.data.object); break;
      case 'setup_intent.succeeded':
        notifyDiscord('💳 CB enregistrée', `SetupIntent ${event.data.object.id} — customer ${event.data.object.customer || 'n/a'}`);
        break;
      case 'charge.dispute.created':
        notifyDiscord('⚠️ LITIGE bancaire', `Charge ${event.data.object.charge} — ${(event.data.object.amount / 100).toFixed(2)} € contesté. À traiter en priorité.`);
        break;
      case 'charge.refunded':
        notifyDiscord('↩️ Remboursement', `Charge ${event.data.object.id} — ${(event.data.object.amount_refunded / 100).toFixed(2)} €`);
        break;
      case 'payment_method.attached':
        notifyDiscord('💳 CB mise à jour', `Customer ${event.data.object.customer}`);
        break;
      default:
        console.log('[stripe] événement ignoré:', event.type);
    }
    res.json({ received: true });
  } catch (e) {
    // 500 → Stripe retentera la livraison
    console.error('[stripe] erreur traitement', event.type, ':', e.message);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
});

export default router;
