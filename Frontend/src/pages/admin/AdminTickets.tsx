import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, Clock, Gift, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { api, type AdminOrganization, type AdminTicket } from '../../api';
import { ADMIN_TICKET_STATUS, Badge, Card, ErrorNote, fmtDate, Modal, Spinner, useToast } from '../../ui';

const FILTERS = [
  { value: 'en_attente',  label: 'À décider' },
  { value: 'valide',      label: 'À faire' },
  { value: 'a_confirmer', label: 'Chez le client' },
  { value: 'reporte',     label: 'Reportés' },
  { value: 'termine',     label: 'Terminés' },
  { value: 'refuse',      label: 'Refusés' },
  { value: '',            label: 'Tous' },
];

export default function AdminTickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [filter, setFilter] = useState('en_attente');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toDelete, setToDelete] = useState<AdminTicket | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ tickets: AdminTicket[] }>(`/admin/tickets${filter ? `?status=${filter}` : ''}`)
      .then((r) => setTickets(r.tickets))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    try {
      await fn();
      toast(msg);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNote message={error} />;

  const btnCls = 'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Demandes clients</h1>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Ajouter une demande
        </button>
      </div>

      <AddTicketModal open={showAdd} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-3">
          {tickets.length === 0 && (
            <Card><p className="py-4 text-center text-sm text-slate-400">Rien ici 👌</p></Card>
          )}
          {tickets.map((t) => (
            <Card key={t.id} className="!p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{t.org_name}</span>
                    <Badge {...ADMIN_TICKET_STATUS[t.status]} />
                    {!t.credit_grant_id && ['en_attente', 'reporte'].includes(t.status) && (
                      <Badge label="Hors crédit" cls="bg-red-100 text-red-700" />
                    )}
                  </div>
                  <p className="mt-1.5 font-medium text-slate-800">{t.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.description}</p>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    {t.created_by_name || t.created_by_email || '?'} · {fmtDate(t.created_at)}
                    {t.attachments > 0 && (
                      <button
                        onClick={async () => {
                          const { url } = await api.get<{ url: string }>(`/admin/tickets/${t.id}/attachment`);
                          window.open(url, '_blank', 'noreferrer');
                        }}
                        className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline">
                        <Paperclip className="h-3 w-3" /> pièce jointe
                      </button>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col">
                  {['en_attente', 'reporte'].includes(t.status) && (
                    <>
                      <button disabled={busy === t.id}
                        onClick={() => act(t.id, () => api.post(`/admin/tickets/${t.id}/decision`, { decision: 'valide' }), 'Demande validée — au boulot 💪')}
                        className={`${btnCls} bg-blue-600 text-white hover:bg-blue-700`}>
                        <Check className="h-3.5 w-3.5" /> Valider
                      </button>
                      <button disabled={busy === t.id}
                        onClick={() => act(t.id, () => api.post(`/admin/tickets/${t.id}/decision`, { decision: 'refuse' }), t.credit_grant_id ? 'Refusée — crédit recrédité au client' : 'Refusée')}
                        className={`${btnCls} bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50`}>
                        <X className="h-3.5 w-3.5" /> Refuser
                      </button>
                      {!t.credit_grant_id && t.status === 'en_attente' && (
                        <>
                          <button disabled={busy === t.id}
                            onClick={() => act(t.id, () => api.post(`/admin/tickets/${t.id}/decision`, { decision: 'reporte' }), 'Reportée — se fera avec les crédits du mois prochain')}
                            className={`${btnCls} bg-white text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50`}>
                            <Clock className="h-3.5 w-3.5" /> Mois prochain
                          </button>
                          <button disabled={busy === t.id}
                            onClick={() => act(t.id, () => api.post(`/admin/tickets/${t.id}/decision`, { decision: 'geste_commercial' }), 'Validée en geste commercial 🎁')}
                            className={`${btnCls} bg-white text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50`}>
                            <Gift className="h-3.5 w-3.5" /> Offrir
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {t.status === 'valide' && (
                    <button disabled={busy === t.id}
                      onClick={() => act(t.id, () => api.post(`/admin/tickets/${t.id}/complete`), 'Marquée terminée ✅')}
                      className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}>
                      <CheckCheck className="h-3.5 w-3.5" /> Terminé
                    </button>
                  )}
                  <button disabled={busy === t.id}
                    onClick={() => {
                      if (t.credit_grant_id) setToDelete(t);
                      else act(t.id, () => api.delete(`/admin/tickets/${t.id}`), 'Demande supprimée');
                    }}
                    className={`${btnCls} bg-white text-slate-400 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-red-500`}>
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!toDelete} title={`Supprimer « ${toDelete?.title ?? ''} » ?`} onClose={() => setToDelete(null)}>
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Cette demande a <strong>consommé un crédit</strong> : en la supprimant,
            le crédit sera <strong>recrédité au client</strong> (sur son lot d'origine).
            La suppression est définitive.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setToDelete(null)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50">
              Annuler
            </button>
            <button
              onClick={() => {
                const t = toDelete!;
                setToDelete(null);
                act(t.id, () => api.delete(`/admin/tickets/${t.id}`), 'Demande supprimée — crédit recrédité');
              }}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700">
              Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Saisie manuelle : modification déjà faite ou reçue hors plateforme ──── */
function AddTicketModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [orgs, setOrgs] = useState<AdminOrganization[]>([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    organization_id: '', title: '', description: '',
    status: 'termine', date: new Date().toISOString().slice(0, 10), consume_credit: false,
  });
  const inputCls = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none';

  useEffect(() => {
    if (!open) return;
    api.get<{ organizations: AdminOrganization[] }>('/admin/orgs')
      .then((r) => setOrgs(r.organizations))
      .catch((e) => toast(e.message, 'error'));
  }, [open, toast]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ warning: string | null }>('/admin/tickets', {
        ...f, consume_credit: f.consume_credit,
      });
      toast(r.warning ?? 'Demande enregistrée');
      setF({ organization_id: '', title: '', description: '', status: 'termine', date: new Date().toISOString().slice(0, 10), consume_credit: false });
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Ajouter une demande manuellement" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">
        Pour enregistrer une modification déjà faite (date passée) ou une demande reçue
        par mail/téléphone. Elle apparaîtra dans l'historique du client.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Client</label>
          <select className={inputCls} required value={f.organization_id}
            onChange={(e) => setF({ ...f, organization_id: e.target.value })}>
            <option value="">— Choisir —</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Titre</label>
          <input className={inputCls} required minLength={3} maxLength={255} value={f.title}
            placeholder="Ex. : Mise à jour des horaires d'été"
            onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Description (optionnel)</label>
          <textarea className={inputCls} rows={3} maxLength={5000} value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
            <input className={inputCls} type="date" required value={f.date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setF({ ...f, date: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Statut</label>
            <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="termine">Terminé (déjà fait)</option>
              <option value="valide">À faire</option>
              <option value="en_attente">À décider</option>
            </select>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={f.consume_credit}
            onChange={(e) => setF({ ...f, consume_credit: e.target.checked })} className="h-4 w-4" />
          Décompter 1 crédit du client
        </label>
        <button type="submit" disabled={busy || !f.organization_id}
          className="w-full rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </Modal>
  );
}
