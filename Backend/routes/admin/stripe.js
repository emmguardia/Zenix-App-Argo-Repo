import { Router } from 'express';
import { getPool } from '../../config/database.js';
import { getStripe } from '../../config/stripe.js';
import { requireAdmin } from '../../middleware/auth.js';

const router = Router();
router.use(requireAdmin);

/* ── GET /api/admin/stripe/customers — pour la liste déroulante de liaison ── */
router.get('/customers', async (_req, res) => {
  try {
    const stripe = getStripe();
    const customers = [];
    for await (const c of stripe.customers.list({ limit: 100 })) {
      customers.push({ id: c.id, name: c.name || '(sans nom)', email: c.email || '' });
      if (customers.length >= 300) break;
    }
    // Marque ceux déjà liés à une organisation
    const [rows] = await getPool().execute(
      'SELECT stripe_customer_id, name FROM organizations WHERE stripe_customer_id IS NOT NULL'
    );
    const linked = new Map(rows.map((r) => [r.stripe_customer_id, r.name]));
    res.json({
      customers: customers.map((c) => ({ ...c, linkedTo: linked.get(c.id) ?? null })),
    });
  } catch (e) {
    console.error('[admin] stripe customers:', e.message);
    res.status(502).json({ error: 'Impossible de lister les clients Stripe' });
  }
});

/* ── GET /api/admin/stripe/stats — MRR, répartition, revenus 6 mois ──────── */
router.get('/stats', async (_req, res) => {
  try {
    const stripe = getStripe();

    // MRR = somme des abonnements actifs (mensuels)
    let mrr = 0;
    let activeSubs = 0;
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100 })) {
      activeSubs++;
      for (const item of sub.items.data) {
        if (item.price?.recurring?.interval === 'month') {
          mrr += (item.price.unit_amount ?? 0) * (item.quantity ?? 1);
        }
      }
    }

    // Revenus encaissés par mois (6 derniers mois, factures payées)
    const now = new Date();
    const start = Math.floor(new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime() / 1000);
    const monthly = new Map();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthly.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
    }
    for await (const inv of stripe.invoices.list({ status: 'paid', created: { gte: start }, limit: 100 })) {
      const d = new Date(inv.created * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthly.has(key)) monthly.set(key, monthly.get(key) + (inv.amount_paid ?? 0));
    }

    // Répartition et états côté base locale
    const [byPlan] = await getPool().execute(
      "SELECT plan, COUNT(*) AS count FROM organizations WHERE status = 'active' AND plan IS NOT NULL GROUP BY plan"
    );
    const [statuses] = await getPool().execute(
      'SELECT status, COUNT(*) AS count FROM organizations GROUP BY status'
    );
    const [pendingTickets] = await getPool().execute(
      "SELECT COUNT(*) AS count FROM tickets WHERE status = 'en_attente'"
    );

    // Les 10 derniers paiements (factures), avec le nom du client
    const recent = await stripe.invoices.list({ limit: 10, expand: ['data.customer'] });
    const lastPayments = recent.data.map((inv) => ({
      id:       inv.id,
      number:   inv.number,
      customer: (typeof inv.customer === 'object' && inv.customer && 'name' in inv.customer
        ? (inv.customer.name || inv.customer.email) : inv.customer_name || inv.customer_email) || '?',
      amount:   inv.status === 'paid' ? inv.amount_paid : inv.amount_due,
      status:   inv.status,
      date:     inv.created,
    }));

    res.json({
      lastPayments,
      mrr,
      activeSubs,
      monthlyRevenue: [...monthly.entries()].map(([month, amount]) => ({ month, amount })),
      byPlan,
      statuses,
      pendingTickets: Number(pendingTickets[0].count),
    });
  } catch (e) {
    console.error('[admin] stripe stats:', e.message);
    res.status(502).json({ error: 'Impossible de récupérer les statistiques Stripe' });
  }
});

export default router;
