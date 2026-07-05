import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Plus, Rocket, UserPlus } from 'lucide-react';
import { api, type AdminOrganization } from '../../api';
import { Badge, Card, ErrorNote, ORG_STATUS, PLAN_LABELS, Spinner } from '../../ui';

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none';

export default function AdminOrgs() {
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ organizations: AdminOrganization[] }>('/admin/orgs')
      .then((r) => setOrgs(r.organizations))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Clients ({orgs.length})</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Nouvelle organisation
        </button>
      </div>

      {showCreate && <CreateOrgForm onCreated={() => { setShowCreate(false); load(); }} />}

      <div className="space-y-3">
        {orgs.map((org) => (
          <Card key={org.id}>
            <button
              onClick={() => setExpanded(expanded === org.id ? null : org.id)}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900">{org.name}</span>
                <Badge {...ORG_STATUS[org.status]} />
                {org.plan && <span className="text-sm text-slate-500">{PLAN_LABELS[org.plan]}</span>}
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span>{org.balance} crédit{org.balance > 1 ? 's' : ''}</span>
                {expanded === org.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
            {expanded === org.id && <OrgDetail org={org} onChanged={load} />}
          </Card>
        ))}
        {orgs.length === 0 && <Card><p className="text-sm text-slate-500">Aucun client pour l'instant.</p></Card>}
      </div>
    </div>
  );
}

function CreateOrgForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', legal_type: 'entreprise', plan: 'start', siret: '', linked_domain: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.post('/admin/orgs', {
        ...form,
        siret: form.siret || null,
        linked_domain: form.linked_domain || null,
      });
      onCreated();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Nouvelle organisation">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="Nom" required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select className={inputCls} value={form.legal_type}
          onChange={(e) => setForm({ ...form, legal_type: e.target.value })}>
          <option value="entreprise">Entreprise</option>
          <option value="association">Association</option>
          <option value="particulier">Particulier</option>
        </select>
        <select className={inputCls} value={form.plan}
          onChange={(e) => setForm({ ...form, plan: e.target.value })}>
          <option value="start">Zenix Start</option>
          <option value="relax">Zenix Relax</option>
          <option value="pro">Zenix Pro</option>
        </select>
        <input className={inputCls} placeholder="SIRET (optionnel)" value={form.siret}
          onChange={(e) => setForm({ ...form, siret: e.target.value })} />
        <input className={inputCls} placeholder="Domaine lié (ex. monsite.fr)" value={form.linked_domain}
          onChange={(e) => setForm({ ...form, linked_domain: e.target.value })} />
        <button type="submit" disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Création…' : 'Créer'}
        </button>
      </form>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </Card>
  );
}

function OrgDetail({ org, onChanged }: { org: AdminOrganization; onChanged: () => void }) {
  const [email, setEmail] = useState('');
  const [stripeId, setStripeId] = useState(org.stripe_customer_id ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      setMsg(success);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <p className="text-slate-500">Membres : <span className="text-slate-900">{org.members || 'aucun'}</span></p>
        <p className="text-slate-500">Customer Stripe : <span className="font-mono text-slate-900">{org.stripe_customer_id ?? '—'}</span></p>
        <p className="text-slate-500">Subscription : <span className="font-mono text-slate-900">{org.stripe_subscription_id ?? '—'}</span></p>
        <p className="text-slate-500">Domaine : <span className="text-slate-900">{org.linked_domain ?? '—'}</span></p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="email@client.fr" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <button
            disabled={busy || !email}
            onClick={() => run(() => api.post(`/admin/orgs/${org.id}/link-user`, { email }), 'Compte lié ✓')}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Lier un compte
          </button>
        </div>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="cus_..." value={stripeId}
            onChange={(e) => setStripeId(e.target.value)} />
          <button
            disabled={busy || !stripeId}
            onClick={() => run(() => api.patch(`/admin/orgs/${org.id}`, { stripe_customer_id: stripeId }), 'Customer Stripe lié ✓')}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
          >
            <Link2 className="h-4 w-4" /> Lier Stripe
          </button>
        </div>
      </div>

      {!org.stripe_subscription_id && (
        <button
          disabled={busy}
          onClick={() => {
            if (confirm(`Activer ${org.name} ?\n\nCela déclenche le PREMIER PRÉLÈVEMENT et fixe la date anniversaire.`)) {
              run(() => api.post(`/admin/orgs/${org.id}/activate`), 'Projet activé — prélèvement en cours ✓');
            }
          }}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Rocket className="h-4 w-4" /> Activer le projet & le prélèvement
        </button>
      )}

      {msg && <p className="text-slate-600">{msg}</p>}
    </div>
  );
}
