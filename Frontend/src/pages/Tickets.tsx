import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { api, type Ticket } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, Spinner, TICKET_STATUS } from '../ui';

export default function Tickets() {
  const { currentOrg } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get<{ tickets: Ticket[] }>(`/orgs/${currentOrg.id}/tickets`),
      api.get<{ balance: number }>(`/orgs/${currentOrg.id}/credits`),
    ])
      .then(([t, c]) => { setTickets(t.tickets); setBalance(c.balance); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  useEffect(load, [load]);

  if (!currentOrg) return <Card><p className="text-slate-600">Aucune organisation liée.</p></Card>;
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotice('');
    try {
      const res = await api.post<{ creditConsumed: boolean; balance: number; warning: string | null }>(
        `/orgs/${currentOrg.id}/tickets`,
        { title, description }
      );
      setTitle('');
      setDescription('');
      if (res.warning) setNotice(res.warning);
      load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Erreur lors de la soumission');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Demandes de modification</h1>
        <span className="text-sm text-slate-500">
          Crédits restants : <span className="font-semibold text-slate-900">{balance ?? '—'}</span>
        </span>
      </div>

      {balance === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Vous n'avez plus de crédit ce mois-ci. Vous pouvez quand même soumettre votre demande :
            elle sera étudiée manuellement (traitement au mois suivant, geste commercial ou devis).
          </span>
        </div>
      )}

      <Card title="Nouvelle demande">
        <form onSubmit={submit} className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre (ex. : Changer la photo d'accueil)"
            required
            minLength={3}
            maxLength={255}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Décrivez précisément la modification souhaitée…"
            required
            maxLength={5000}
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">1 demande = 1 crédit, décompté à l'envoi.</p>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {submitting ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
          {notice && <p className="text-sm text-amber-700">{notice}</p>}
        </form>
      </Card>

      <Card title={`Historique (${tickets.length})`}>
        {tickets.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune demande pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{t.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{t.description}</p>
                  <p className="mt-1 text-xs text-slate-400">Soumis le {fmtDate(t.created_at)}</p>
                </div>
                <Badge {...TICKET_STATUS[t.status]} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
