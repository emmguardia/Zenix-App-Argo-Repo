import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CreditCard, Link2, Plus, Rocket, UserPlus } from 'lucide-react';
import { api, type AdminOrganization } from '../../api';
import { Badge, Card, ErrorNote, Modal, ORG_STATUS, PLAN_LABELS, Spinner, useToast } from '../../ui';

const inputCls = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

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

  const active = orgs.filter((o) => o.status === 'active').length;
  const pending = orgs.filter((o) => o.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500">
            {active} actif{active > 1 ? 's' : ''}{pending > 0 && ` · ${pending} en attente d'activation`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Nouveau client
        </button>
      </div>

      <CreateOrgModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />

      <div className="space-y-3">
        {orgs.map((org) => (
          <Card key={org.id} className="!p-5">
            <button
              onClick={() => setExpanded(expanded === org.id ? null : org.id)}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="font-bold text-slate-900">{org.name}</span>
                <Badge {...ORG_STATUS[org.status]} />
                {org.plan && <span className="text-sm text-slate-500">{PLAN_LABELS[org.plan]}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm text-slate-500">
                <span>{org.balance} crédit{org.balance > 1 ? 's' : ''}</span>
                {expanded === org.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
            {expanded === org.id && <OrgDetail org={org} onChanged={load} />}
          </Card>
        ))}
        {orgs.length === 0 && (
          <Card><p className="py-4 text-center text-sm text-slate-400">Aucun client — crée le premier avec le bouton au-dessus.</p></Card>
        )}
      </div>
    </div>
  );
}

function CreateOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', legal_type: 'entreprise', plan: 'start', siret: '', linked_domain: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/admin/orgs', {
        ...form,
        siret: form.siret || null,
        linked_domain: form.linked_domain || null,
      });
      toast(`Client "${form.name}" créé`);
      setForm({ name: '', legal_type: 'entreprise', plan: 'start', siret: '', linked_domain: '' });
      onCreated();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erreur à la création', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Nouveau client" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Nom (entreprise ou personne)</label>
          <input className={inputCls} placeholder="Ex. : Boulangerie Martin" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
            <select className={inputCls} value={form.legal_type}
              onChange={(e) => setForm({ ...form, legal_type: e.target.value })}>
              <option value="entreprise">Entreprise</option>
              <option value="association">Association</option>
              <option value="particulier">Particulier</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Formule</label>
            <select className={inputCls} value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              <option value="start">Zenix Start</option>
              <option value="relax">Zenix Relax</option>
              <option value="pro">Zenix Pro</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Domaine du site (optionnel)</label>
          <input className={inputCls} placeholder="monsite.fr" value={form.linked_domain}
            onChange={(e) => setForm({ ...form, linked_domain: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">SIRET (optionnel)</label>
          <input className={inputCls} placeholder="123 456 789 00012" value={form.siret}
            onChange={(e) => setForm({ ...form, siret: e.target.value.replace(/\s/g, '') })} />
        </div>
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Création…' : 'Créer le client'}
        </button>
      </form>
    </Modal>
  );
}

function OrgDetail({ org, onChanged }: { org: AdminOrganization; onChanged: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [stripeId, setStripeId] = useState(org.stripe_customer_id ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast(success);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally {
      setBusy(false);
    }
  };

  const readyToActivate = org.stripe_customer_id && org.plan && !org.stripe_subscription_id;

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
      {/* 1. Accès client */}
      <section>
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">1 · Accès client</h4>
        <p className="mb-2 text-sm text-slate-500">
          {org.members
            ? <>Connecté{org.members.includes(',') ? 's' : ''} : <span className="font-medium text-slate-700">{org.members}</span></>
            : 'Aucun compte lié — entre l\'email du compte Authentik du client :'}
        </p>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="email@client.fr" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <button
            disabled={busy || !email}
            onClick={() => run(() => api.post(`/admin/orgs/${org.id}/link-user`, { email }).then(() => setEmail('')), 'Compte client lié')}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Lier
          </button>
        </div>
      </section>

      {/* 2. Stripe */}
      <section>
        <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">2 · Facturation Stripe</h4>
        <p className="mb-2 text-sm text-slate-500">
          {org.stripe_subscription_id
            ? <>Abonnement actif : <span className="font-mono text-xs text-slate-700">{org.stripe_subscription_id}</span></>
            : org.stripe_customer_id
              ? <>Customer lié : <span className="font-mono text-xs text-slate-700">{org.stripe_customer_id}</span></>
              : 'Colle l\'ID du customer Stripe (Dashboard Stripe → Clients) :'}
        </p>
        {!org.stripe_subscription_id && (
          <div className="flex gap-2">
            <input className={inputCls} placeholder="cus_..." value={stripeId}
              onChange={(e) => setStripeId(e.target.value.trim())} />
            <button
              disabled={busy || !stripeId}
              onClick={() => run(() => api.patch(`/admin/orgs/${org.id}`, { stripe_customer_id: stripeId }), 'Customer Stripe lié')}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" /> Lier
            </button>
          </div>
        )}
      </section>

      {/* 3. Activation */}
      {!org.stripe_subscription_id && (
        <section>
          <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">3 · Activation</h4>
          {!readyToActivate && (
            <p className="mb-2 text-sm text-amber-700">
              Avant d'activer : lie un customer Stripe{!org.plan && ' et choisis une formule'}.
            </p>
          )}
          <button
            disabled={busy || !readyToActivate}
            onClick={() => setConfirmActivate(true)}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            <Rocket className="h-4 w-4" /> Activer le projet & le prélèvement
          </button>
        </section>
      )}

      <Modal open={confirmActivate} title={`Activer ${org.name} ?`} onClose={() => setConfirmActivate(false)}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            <CreditCard className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              Cette action déclenche <strong>immédiatement le premier prélèvement</strong> sur la
              carte du client et fixe la date anniversaire des prélèvements suivants.
              Le site doit être en ligne.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirmActivate(false)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
              Annuler
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirmActivate(false);
                run(() => api.post(`/admin/orgs/${org.id}/activate`), `${org.name} activé — premier prélèvement lancé 🚀`);
              }}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Oui, activer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
