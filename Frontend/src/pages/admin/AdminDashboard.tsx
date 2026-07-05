import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Inbox, TrendingUp, Users } from 'lucide-react';
import { api, type AdminStats } from '../../api';
import { Card, ErrorNote, fmtMoney, PLAN_LABELS, Spinner } from '../../ui';

const PLAN_COLORS: Record<string, string> = { start: '#60a5fa', relax: '#2563eb', pro: '#1e3a8a' };
const MONTH_LABELS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<AdminStats>('/admin/stripe/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!stats) return <Spinner />;

  const pastDue = stats.statuses.find((s) => s.status === 'past_due')?.count ?? 0;
  const revenue = stats.monthlyRevenue.map((m) => ({
    name: MONTH_LABELS[Number(m.month.split('-')[1]) - 1],
    montant: m.amount / 100,
  }));
  const planData = stats.byPlan.map((p) => ({
    name: PLAN_LABELS[p.plan] ?? p.plan,
    value: Number(p.count),
    color: PLAN_COLORS[p.plan] ?? '#94a3b8',
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Tableau de bord</h1>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5"><TrendingUp className="h-6 w-6 text-emerald-600" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Revenu mensuel (MRR)</p>
              <p className="text-2xl font-bold text-slate-900">{fmtMoney(stats.mrr)}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5"><Users className="h-6 w-6 text-blue-600" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Abonnements actifs</p>
              <p className="text-2xl font-bold text-slate-900">{stats.activeSubs}</p>
            </div>
          </div>
        </Card>
        <Link to="/demandes">
          <Card className="transition-shadow hover:shadow-md">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-50 p-2.5"><Inbox className="h-6 w-6 text-amber-600" /></div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Demandes à décider</p>
                <p className="text-2xl font-bold text-slate-900">{stats.pendingTickets}</p>
              </div>
            </div>
          </Card>
        </Link>
        <Card className={pastDue > 0 ? '!border-red-200 !bg-red-50' : ''}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-red-50 p-2.5"><AlertTriangle className="h-6 w-6 text-red-500" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Paiements en échec</p>
              <p className="text-2xl font-bold text-slate-900">{pastDue}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Graphiques */}
      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Revenus encaissés (6 derniers mois)" className="lg:col-span-3">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={revenue}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => `${v}€`} />
              <Tooltip formatter={(v) => [`${v} €`, 'Encaissé']} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="montant" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Clients actifs par offre" className="lg:col-span-2">
          {planData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Aucun abonnement actif pour l'instant.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={planData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {planData.map((p) => <Cell key={p.name} fill={p.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-2 space-y-1">
                {planData.map((p) => (
                  <li key={p.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                      {p.name}
                    </span>
                    <span className="font-semibold text-slate-900">{p.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
