import { useCallback, useEffect, useState } from 'react';
import { Info, Paperclip, Send, X } from 'lucide-react';
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
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

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

  const toConfirm = tickets.filter((t) => t.status === 'a_confirmer');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = file
        ? await api.upload<{ creditConsumed: boolean }>(`/orgs/${currentOrg.id}/tickets`, file, { title, description })
        : await api.post<{ creditConsumed: boolean }>(`/orgs/${currentOrg.id}/tickets`, { title, description });
      setTitle(''); setDescription(''); setFile(null);
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

  const act = async (id: string, action: 'confirm' | 'cancel', msg: string) => {
    setBusy(id);
    try {
      await api.post(`/orgs/${currentOrg.id}/tickets/${id}/${action}`);
      toast(msg);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally { setBusy(null); }
  };

  const openAttachment = async (ticketId: string) => {
    const { url } = await api.get<{ url: string }>(`/orgs/${currentOrg.id}/tickets/${ticketId}/attachment`);
    window.open(url, '_blank', 'noreferrer');
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

      {/* Demandes reportées revenues ce mois-ci : le client décide */}
      {toConfirm.map((t) => (
        <div key={t.id} className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-5">
          <p className="font-semibold text-orange-900">Vous aviez demandé : « {t.title} »</p>
          <p className="mt-1 text-sm text-orange-800">
            Cette demande avait été mise de côté le mois dernier. Vos modifications sont
            de retour — la voulez-vous toujours ? (1 modification sera utilisée)
          </p>
          <div className="mt-3 flex gap-2">
            <button disabled={busy === t.id}
              onClick={() => act(t.id, 'confirm', 'C\'est noté, on s\'en occupe !')}
              className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
              Oui, je la veux toujours
            </button>
            <button disabled={busy === t.id}
              onClick={() => act(t.id, 'cancel', 'Demande annulée')}
              className="rounded-xl border border-orange-300 px-4 py-2 text-sm font-medium text-orange-800 hover:bg-orange-100 disabled:opacity-50">
              Non, annuler
            </button>
          </div>
        </div>
      ))}

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
          {file ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-slate-700">
                <Paperclip className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.name}</span>
              </span>
              <button type="button" onClick={() => setFile(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-50">
              <Paperclip className="h-4 w-4" />
              Joindre un fichier (photo ou PDF, optionnel — 1 seul)
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
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
            <strong> une</strong> demande : selon le cas, on la fera le mois prochain, ou on vous proposera une solution.
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
                    <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      Envoyée le {fmtDate(t.created_at)}
                      {(t.attachments ?? 0) > 0 && (
                        <button onClick={() => openAttachment(t.id)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                          <Paperclip className="h-3 w-3" /> pièce jointe
                        </button>
                      )}
                    </p>
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
