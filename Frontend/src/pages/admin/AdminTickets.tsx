import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, Clock, Gift, X } from 'lucide-react';
import { api, type AdminTicket } from '../../api';
import { Badge, Card, ErrorNote, fmtDate, Spinner, TICKET_STATUS } from '../../ui';

const FILTERS = [
  { value: '',           label: 'Tous' },
  { value: 'en_attente', label: 'En attente' },
  { value: 'valide',     label: 'Validés' },
  { value: 'reporte',    label: 'Reportés' },
  { value: 'refuse',     label: 'Refusés' },
  { value: 'termine',    label: 'Terminés' },
];

export default function AdminTickets() {
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

  const decide = async (id: string, decision: string) => {
    setBusy(id);
    try {
      await api.post(`/admin/tickets/${id}/decision`, { decision });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const complete = async (id: string) => {
    setBusy(id);
    try {
      await api.post(`/admin/tickets/${id}/complete`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorNote message={error} />;

  const btnCls = 'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:opacity-50';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Tickets — administration</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-3">
          {tickets.length === 0 && <Card><p className="text-sm text-slate-500">Aucun ticket.</p></Card>}
          {tickets.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{t.org_name}</span>
                    <Badge {...TICKET_STATUS[t.status]} />
                    {!t.credit_grant_id && t.status === 'en_attente' && (
                      <Badge label="HORS CRÉDIT" cls="bg-red-100 text-red-800" />
                    )}
                  </div>
                  <p className="mt-1 font-medium text-slate-800">{t.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.description}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    Par {t.created_by_name || t.created_by_email || '?'} — {fmtDate(t.created_at)}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col gap-1.5">
                  {['en_attente', 'reporte'].includes(t.status) && (
                    <>
                      <button disabled={busy === t.id} onClick={() => decide(t.id, 'valide')}
                        className={`${btnCls} bg-blue-600 text-white hover:bg-blue-700`}>
                        <Check className="h-3.5 w-3.5" /> Valider
                      </button>
                      <button disabled={busy === t.id} onClick={() => decide(t.id, 'refuse')}
                        className={`${btnCls} bg-red-600 text-white hover:bg-red-700`}>
                        <X className="h-3.5 w-3.5" /> Refuser
                      </button>
                      {!t.credit_grant_id && (
                        <>
                          <button disabled={busy === t.id} onClick={() => decide(t.id, 'reporte')}
                            className={`${btnCls} bg-purple-600 text-white hover:bg-purple-700`}>
                            <Clock className="h-3.5 w-3.5" /> Mois suivant
                          </button>
                          <button disabled={busy === t.id} onClick={() => decide(t.id, 'geste_commercial')}
                            className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-700`}>
                            <Gift className="h-3.5 w-3.5" /> Geste commercial
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {t.status === 'valide' && (
                    <button disabled={busy === t.id} onClick={() => complete(t.id)}
                      className={`${btnCls} bg-green-600 text-white hover:bg-green-700`}>
                      <CheckCheck className="h-3.5 w-3.5" /> Terminer
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
