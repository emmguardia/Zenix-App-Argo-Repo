import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, ChevronDown, ChevronUp, Download, Pencil, Plus, Rocket, Trash2, Upload, UserPlus } from 'lucide-react';
import { api, type AdminDocument, type AdminOrganization, type StripeCustomer } from '../../api';
import { Badge, Card, ErrorNote, fmtDate, Modal, ORG_STATUS, PLAN_LABELS, Spinner, useToast } from '../../ui';

const inputCls = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

const ONBOARDING_LABELS: Record<string, { label: string; cls: string }> = {
  infos:    { label: 'Attend sa 1ère connexion', cls: 'bg-slate-200 text-slate-600' },
  plan:     { label: 'Choisit son offre',        cls: 'bg-slate-200 text-slate-600' },
  review:   { label: '⚠ Infos à valider',        cls: 'bg-amber-100 text-amber-800' },
  contract: { label: 'Contrat en cours',         cls: 'bg-violet-100 text-violet-700' },
  payment:  { label: 'Attend son paiement',      cls: 'bg-blue-100 text-blue-700' },
  done:     { label: '',                         cls: '' },
};

const DOC_LABELS: Record<string, string> = {
  contrat: 'Contrat', contrat_signe: 'Contrat SIGNÉ', cgv: 'CGV',
  devis: 'Devis', zip_offboarding: 'Export', autre: 'Autre',
};

export default function AdminOrgs() {
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    api.get<{ organizations: AdminOrganization[] }>('/admin/orgs')
      .then((r) => setOrgs(r.organizations))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const toReview = orgs.filter((o) => o.onboarding_status === 'review').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          {toReview > 0 && <p className="text-sm font-medium text-amber-700">{toReview} inscription{toReview > 1 ? 's' : ''} à valider</p>}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Client existant
        </button>
      </div>

      <CreateOrgModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />

      <div className="space-y-3">
        {orgs.map((org) => {
          const ob = ONBOARDING_LABELS[org.onboarding_status];
          return (
            <Card key={org.id} className="!p-5">
              <button
                onClick={() => setExpanded(expanded === org.id ? null : org.id)}
                className="flex w-full items-center justify-between gap-4 text-left"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="font-bold text-slate-900">{org.name}</span>
                  {org.onboarding_status === 'done'
                    ? <Badge {...ORG_STATUS[org.status]} />
                    : <Badge {...ob} />}
                  {org.plan && <span className="text-sm text-slate-500">{PLAN_LABELS[org.plan]}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm text-slate-500">
                  <span>{org.balance} crédit{org.balance > 1 ? 's' : ''}</span>
                  {expanded === org.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </button>
              {expanded === org.id && <OrgDetail org={org} onChanged={load} />}
            </Card>
          );
        })}
        {orgs.length === 0 && (
          <Card><p className="py-4 text-center text-sm text-slate-400">
            Aucun client. Un nouveau client apparaît ici dès sa première connexion — ou ajoute un client Stripe existant.
          </p></Card>
        )}
      </div>
    </div>
  );
}

/* ── "Client existant" : liaison d'un customer Stripe historique ──────────── */
function CreateOrgModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [customers, setCustomers] = useState<StripeCustomer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<{ customers: StripeCustomer[] }>('/admin/stripe/customers')
      .then((r) => setCustomers(r.customers))
      .catch((e) => toast(e.message, 'error'));
  }, [open, toast]);

  const selected = customers.find((c) => c.id === customerId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const { organization } = await api.post<{ organization: { id: string } }>('/admin/orgs', {
        name: selected.name !== '(sans nom)' ? selected.name : (selected.email || 'Client Stripe'),
        legal_type: 'entreprise',
      });
      await api.patch(`/admin/orgs/${organization.id}`, { stripe_customer_id: selected.id });
      if (email) await api.post(`/admin/orgs/${organization.id}/link-user`, { email });
      toast('Client importé — son abonnement Stripe a été détecté automatiquement s\'il existe');
      setCustomerId(''); setEmail('');
      onCreated();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Importer un client Stripe existant" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">
        Pour un client qui te paie déjà : choisis-le dans ta liste Stripe, son abonnement
        et sa formule seront détectés automatiquement. Les nouveaux clients, eux, n'ont
        pas besoin de ça : tout se fait à leur première connexion.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Client Stripe</label>
          <select className={inputCls} required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— Choisir dans Stripe —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id} disabled={!!c.linkedTo}>
                {c.name}{c.email ? ` · ${c.email}` : ''}{c.linkedTo ? ` (déjà lié à ${c.linkedTo})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Email de son compte Authentik (optionnel, liable plus tard)</label>
          <input className={inputCls} type="email" placeholder="email@client.fr" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={busy || !customerId}
          className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Import…' : 'Importer ce client'}
        </button>
      </form>
    </Modal>
  );
}

/* ── Détail d'un client ────────────────────────────────────────────────── */
function OrgDetail({ org, onChanged }: { org: AdminOrganization; onChanged: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [documents, setDocuments] = useState<AdminDocument[] | null>(null);
  const [docType, setDocType] = useState('contrat');
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  const loadDocs = useCallback(() => {
    api.get<{ documents: AdminDocument[] }>(`/admin/orgs/${org.id}/documents`)
      .then((r) => setDocuments(r.documents))
      .catch(() => setDocuments([]));
  }, [org.id]);

  useEffect(loadDocs, [loadDocs]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast(success);
      onChanged();
      loadDocs();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 space-y-5 border-t border-slate-100 pt-4">
      {/* Infos remplies par le client */}
      <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <p className="text-slate-500">Contact : <span className="font-medium text-slate-800">
          {org.contact_first_name ? `${org.contact_first_name} ${org.contact_last_name}` : '—'}</span></p>
        <p className="text-slate-500">Téléphone : <span className="font-medium text-slate-800">{org.contact_phone ?? '—'}</span></p>
        <p className="text-slate-500">SIRET : <span className="font-medium text-slate-800">{org.siret ?? '—'}</span></p>
        <p className="text-slate-500">Adresse : <span className="font-medium text-slate-800">{org.billing_address ?? '—'}</span></p>
        <p className="text-slate-500">Compte(s) : <span className="font-medium text-slate-800">{org.members ?? 'aucun'}</span></p>
        <p className="text-slate-500">Stripe : <span className="font-mono text-xs text-slate-700">{org.stripe_customer_id ?? '—'}</span></p>
        <p className="text-slate-500">Facturation : <span className="font-medium text-slate-800">
          Grille {org.pricing_tier === 'asso' ? 'Asso' : 'entreprise'} ·{' '}
          {org.billing_interval === 'annual' ? 'engagement 1 an (12ᵉ mois offert)' : 'mensuel sans engagement'}
          {org.custom_price_id && ' · tarif spécial'}</span></p>
        <p className="text-slate-500">Site : <span className="font-medium text-slate-800">{org.linked_domain ?? '—'}</span></p>
      </section>

      <EditInfos org={org} onSaved={onChanged} />

      {/* Lancement de l'abonnement : carte enregistrée, site en ligne → GO */}
      {org.onboarding_status === 'done' && !org.stripe_subscription_id && org.stripe_customer_id && (
        <button disabled={busy} onClick={() => setConfirmLaunch(true)}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          <Rocket className="h-4 w-4" /> Mettre en ligne & lancer l'abonnement
        </button>
      )}
      <Modal open={confirmLaunch} title={`Lancer l'abonnement de ${org.name} ?`} onClose={() => setConfirmLaunch(false)}>
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Le <strong>premier prélèvement part immédiatement</strong> sur sa carte enregistrée
            et fixe la date anniversaire. Son site doit être en ligne.
            {org.custom_price_id && <> Tarif spécial appliqué : <span className="font-mono text-xs">{org.custom_price_id}</span>.</>}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmLaunch(false)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
              Annuler
            </button>
            <button disabled={busy}
              onClick={() => {
                setConfirmLaunch(false);
                run(() => api.post(`/admin/orgs/${org.id}/activate`), `${org.name} : abonnement lancé 🚀 (crédits via le webhook)`);
              }}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              Oui, lancer
            </button>
          </div>
        </div>
      </Modal>

      {/* Validation des infos (étape review) */}
      {org.onboarding_status === 'review' && (
        <button disabled={busy}
          onClick={() => run(() => api.post(`/admin/orgs/${org.id}/validate`), 'Infos validées — dépose maintenant son contrat ci-dessous')}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
          <BadgeCheck className="h-4 w-4" /> Valider ses informations
        </button>
      )}
      {org.onboarding_status === 'contract' && !documents?.some((d) => d.type === 'contrat') && (
        <p className="rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-700">
          ⏳ Le client attend son contrat : dépose-le ci-dessous (type "Contrat"), il pourra le signer et le redéposer.
        </p>
      )}

      {/* Lier un compte Authentik */}
      <section>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Lier un compte de connexion</h4>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="email@client.fr" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
          <button
            disabled={busy || !email}
            onClick={() => run(() => api.post(`/admin/orgs/${org.id}/link-user`, { email }).then(() => setEmail('')), 'Compte lié')}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Lier
          </button>
        </div>
      </section>

      {/* Documents */}
      <section>
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Documents</h4>
        {documents === null ? <Spinner /> : (
          <>
            {documents.length > 0 && (
              <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          d.type === 'contrat_signe' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>{DOC_LABELS[d.type] ?? d.type}</span>
                        {d.filename}
                      </p>
                      <p className="text-xs text-slate-400">{fmtDate(d.created_at)}{d.uploaded_by_name ? ` · par ${d.uploaded_by_name}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button title="Télécharger"
                        onClick={async () => {
                          const { url } = await api.get<{ url: string }>(`/admin/orgs/${org.id}/documents/${d.id}/download`);
                          window.open(url, '_blank', 'noreferrer');
                        }}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                        <Download className="h-4 w-4" />
                      </button>
                      <button title="Supprimer" disabled={busy}
                        onClick={() => run(() => api.delete(`/admin/orgs/${org.id}/documents/${d.id}`), 'Document supprimé')}
                        className="rounded-lg p-2 text-red-400 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <select className={`${inputCls} !w-auto`} value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="contrat">Contrat</option>
                <option value="cgv">CGV</option>
                <option value="devis">Devis</option>
                <option value="zip_offboarding">Export fin de contrat</option>
                <option value="autre">Autre</option>
              </select>
              <label className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 ${busy ? 'opacity-50' : ''}`}>
                <Upload className="h-4 w-4" /> Déposer un fichier (PDF/ZIP)
                <input type="file" accept="application/pdf,application/zip" className="hidden" disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) run(() => api.upload(`/admin/orgs/${org.id}/documents`, file, { type: docType }), 'Document déposé');
                    e.target.value = '';
                  }} />
              </label>
            </div>
          </>
        )}
      </section>

      {/* Zone dangereuse : suppression complète, double validation */}
      <section className="border-t border-slate-100 pt-4">
        <button onClick={() => { setConfirmDelete(true); setDeleteText(''); }}
          className="flex items-center gap-1.5 text-sm font-medium text-red-500 hover:text-red-700">
          <Trash2 className="h-4 w-4" /> Supprimer ce client
        </button>
      </section>

      <Modal open={confirmDelete} title={`Supprimer ${org.name} ?`} onClose={() => setConfirmDelete(false)}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              <strong>Irréversible.</strong> Ça annule son abonnement Stripe, supprime toutes
              ses données (demandes, crédits, comptes liés) et purge ses fichiers.
              Ses factures restent archivées chez Stripe (obligation comptable).
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Pour confirmer, tape exactement : <span className="font-bold text-slate-800">{org.name}</span>
            </label>
            <input className={inputCls} value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
              placeholder={org.name} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
              Annuler
            </button>
            <button disabled={busy || deleteText !== org.name}
              onClick={() => {
                setConfirmDelete(false);
                run(() => api.delete(`/admin/orgs/${org.id}`), `${org.name} supprimé`);
              }}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700 disabled:opacity-40">
              Supprimer définitivement
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Édition de toutes les infos (au moment de la validation ou après) ──── */
function EditInfos({ org, onSaved }: { org: AdminOrganization; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Record<string, string>>({
    contact_first_name: org.contact_first_name ?? '',
    contact_last_name:  org.contact_last_name ?? '',
    contact_phone:      org.contact_phone ?? '',
    billing_address:    org.billing_address ?? '',
    siret:              org.siret ?? '',
    linked_domain:      org.linked_domain ?? '',
    name:               org.name,
    plan:               org.plan ?? 'start',
    pricing_tier:       org.pricing_tier ?? 'standard',
    billing_interval:   org.billing_interval ?? 'monthly',
    custom_price_id:    org.custom_price_id ?? '',
  });

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/orgs/${org.id}`, {
        ...f,
        siret: f.siret || null,
        linked_domain: f.linked_domain || null,
        custom_price_id: f.custom_price_id || null,
        contact_phone: f.contact_phone || null,
      });
      toast('Infos mises à jour');
      setOpen(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800">
        <Pencil className="h-4 w-4" /> Modifier les infos
      </button>
    );
  }

  const field = (label: string, key: keyof typeof f, props: Record<string, unknown> = {}) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      <input className={inputCls} value={f[key]} {...props}
        onChange={(e) => setF({ ...f, [key]: (e.target as HTMLInputElement).value })} />
    </div>
  );

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-blue-600">Modifier les infos</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('Nom affiché (organisation)', 'name')}
        {field('Site (sans https://)', 'linked_domain', { placeholder: 'monsite.fr' })}
        {field('Prénom du contact', 'contact_first_name', { maxLength: 20 })}
        {field('Nom du contact', 'contact_last_name', { maxLength: 30 })}
        {field('Téléphone', 'contact_phone', { maxLength: 10, inputMode: 'numeric' })}
        {field('SIRET', 'siret', { maxLength: 14, inputMode: 'numeric' })}
        <div className="sm:col-span-2">{field('Adresse de facturation', 'billing_address')}</div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Formule</label>
          <select className={inputCls} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
            <option value="start">Zenix Start</option>
            <option value="relax">Zenix Relax</option>
            <option value="pro">Zenix Pro</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Grille tarifaire</label>
          <select className={inputCls} value={f.pricing_tier} onChange={(e) => setF({ ...f, pricing_tier: e.target.value })}>
            <option value="standard">Entreprise (39/69/149€)</option>
            <option value="asso">Association (20/45/80€)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Engagement</label>
          <select className={inputCls} value={f.billing_interval} onChange={(e) => setF({ ...f, billing_interval: e.target.value })}>
            <option value="monthly">Mensuel sans engagement</option>
            <option value="annual">1 an (12ᵉ mois offert)</option>
          </select>
        </div>
        {field('Price Stripe spécial (optionnel)', 'custom_price_id', { placeholder: 'price_... (prioritaire sur la grille)' })}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setOpen(false)}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
          Annuler
        </button>
        <button disabled={busy} onClick={save}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </section>
  );
}
