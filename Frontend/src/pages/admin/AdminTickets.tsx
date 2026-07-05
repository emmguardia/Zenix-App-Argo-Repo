import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, Clock, Gift, X } from 'lucide-react';
import { api, type AdminTicket } from '../../api';
import { ADMIN_TICKET_STATUS, Badge, Card, ErrorNote, fmtDate, Spinner, useToast } from '../../ui';

const FILTERS = [
  { value: 'en_attente', label: 'À décider' },
  { value: 'valide',     label: 'À faire' },
  { value: 'reporte',    label: 'Reportés' },
  { value: 'termine',    label: 'Terminés' },
  { value: 'refuse',     label: 'Refusés' },
  { value: '',           label: 'Tous' },
];

export default function AdminTickets() {
  const toast = useToast();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [filter, setFilter] = useState('en_attente');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

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
      <h1 className="text-2xl font-bold text-slate-900">Demandes clients</h1>

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
                  <p className="mt-2 text-xs text-slate-400">
                    {t.created_by_name || t.created_by_email || '?'} · {fmtDate(t.created_at)}
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
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
