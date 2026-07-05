import { useCallback, useEffect, useState } from 'react';
import { Info, Send } from 'lucide-react';
import { api, type Ticket } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, Spinner, TICKET_STATUS, useToast } from '../ui';

export default function Tickets() {
  const { currentOrg } = useAuth();
  const toast = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  if (!currentOrg) {
    return <Card><p className="text-slate-600">Votre espace n'est pas encore relié à un site.</p></Card>;
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post<{ creditConsumed: boolean; balance: number }>(
        `/orgs/${currentOrg.id}/tickets`,
        { title, description }
      );
      setTitle('');
      setDescription('');
      toast(res.creditConsumed
        ? 'Demande envoyée ! On s\'en occupe très vite.'
        : 'Demande envoyée ! Comme vous n\'avez plus de modification ce mois-ci, on revient vers vous rapidement.');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "L'envoi a échoué, réessayez", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Mes modifications</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
          (balance ?? 0) > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
        }`}>
          {balance ?? 0} restante{(balance ?? 0) > 1 ? 's' : ''} ce mois-ci
        </span>
      </div>

      <Card title="Que souhaitez-vous changer sur votre site ?">
        <form onSubmit={submit} className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="En quelques mots — ex. : Changer les horaires d'ouverture"
            required
            minLength={3}
            maxLength={255}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={"Décrivez le changement le plus précisément possible :\n• Sur quelle page ?\n• Quel texte ou quelle image remplacer, et par quoi ?"}
            required
            maxLength={5000}
            rows={5}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Info className="h-3.5 w-3.5" />
              Chaque demande utilise 1 modification de votre abonnement.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {submitting ? 'Envoi…' : 'Envoyer ma demande'}
            </button>
          </div>
        </form>
        {balance === 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Vous avez utilisé toutes vos modifications ce mois-ci. Vous pouvez quand même envoyer
            votre demande : selon le cas, on la fera le mois prochain, ou on vous proposera une solution.
          </p>
        )}
      </Card>

      <Card title={tickets.length ? 'Vos demandes' : undefined}>
        {tickets.length === 0 ? (
          <p className="py-2 text-center text-sm text-slate-400">
            Vous n'avez pas encore fait de demande. La première, c'est au-dessus 👆
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tickets.map((t) => {
              const st = TICKET_STATUS[t.status];
              return (
                <li key={t.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{t.title}</p>
                      <Badge label={st.label} cls={st.cls} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{t.description}</p>
                    <p className="mt-1 text-xs text-slate-400">Envoyée le {fmtDate(t.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
