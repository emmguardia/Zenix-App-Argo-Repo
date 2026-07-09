import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api, type Message } from '../api';
import { useAuth } from '../auth';
import { Card, Spinner, useToast } from '../ui';

/** Messagerie client — aucune information de lecture n'est affichée ici. */
export default function Messages() {
  const { currentOrg } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!currentOrg) return;
    api.get<{ messages: Message[] }>(`/orgs/${currentOrg.id}/messages`)
      .then((r) => setMessages(r.messages))
      .catch(() => setMessages([]));
  }, [currentOrg]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages?.length]);

  if (!currentOrg) return <Card><p className="text-slate-600">Votre espace n'est pas encore relié à un site.</p></Card>;
  if (!messages) return <Spinner />;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/orgs/${currentOrg.id}/messages`, { body: body.trim() });
      setBody('');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "L'envoi a échoué", 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
        <p className="text-base text-slate-500">Une question ? Écrivez ici, Zenix vous répond directement.</p>
      </div>

      <Card className="!p-0">
        <div className="flex h-[26rem] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {messages.length === 0 && (
              <p className="py-10 text-center text-base text-slate-400">
                Pas encore de message. Écrivez le premier 👇
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'client' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-base ${
                  m.sender === 'client'
                    ? 'rounded-br-md bg-blue-600 text-white'
                    : 'rounded-bl-md bg-slate-100 text-slate-800'
                }`}>
                  {m.sender === 'admin' && <p className="mb-0.5 text-xs font-bold text-blue-600">Zenix</p>}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-right text-[11px] ${m.sender === 'client' ? 'text-blue-200' : 'text-slate-400'}`}>
                    {new Date(m.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-4">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Votre message…"
              maxLength={2000}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-blue-500 focus:outline-none"
            />
            <button type="submit" disabled={busy || !body.trim()}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-40">
              <Send className="h-5 w-5" /> Envoyer
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
