import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, Send } from 'lucide-react';
import { api, type Conversation, type Message } from '../../api';
import { Card, Spinner, useToast } from '../../ui';

/** Messagerie admin — accusé de lecture visible ("Vu") côté admin uniquement. */
export default function AdminMessages() {
  const toast = useToast();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [clientReadAt, setClientReadAt] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => {
    api.get<{ conversations: Conversation[] }>('/admin/messages')
      .then((r) => setConversations(r.conversations))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const loadThread = useCallback((orgId: string) => {
    api.get<{ messages: Message[]; client_last_read_at: string | null }>(`/admin/messages/${orgId}`)
      .then((r) => { setMessages(r.messages); setClientReadAt(r.client_last_read_at); })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      setSelected((s) => { if (s) loadThread(s.id); return s; });
    }, 20000);
    return () => clearInterval(t);
  }, [loadList, loadThread]);

  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [messages.length]);

  if (!conversations) return <Spinner />;

  const open = (c: Conversation) => { setSelected(c); setMessages([]); loadThread(c.id); };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/messages/${selected.id}`, { body: body.trim() });
      setBody('');
      loadThread(selected.id);
      loadList();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  // "Vu" sous ton dernier message si le client a ouvert la conversation après
  const lastAdminMsg = [...messages].reverse().find((m) => m.sender === 'admin');
  const lastSeen = !!(lastAdminMsg && clientReadAt && new Date(clientReadAt) >= new Date(lastAdminMsg.created_at));

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => { setSelected(null); loadList(); }}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Toutes les conversations
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{selected.name}</h1>
        <Card className="!p-0">
          <div className="flex h-[26rem] flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Aucun message — écris le premier.</p>}
              {messages.map((m, i) => {
                const isLastAdmin = m.id === lastAdminMsg?.id && i === messages.length - 1;
                return (
                  <div key={m.id} className={`flex flex-col ${m.sender === 'admin' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      m.sender === 'admin' ? 'rounded-br-md bg-slate-900 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className={`mt-1 text-right text-[11px] ${m.sender === 'admin' ? 'text-slate-400' : 'text-slate-400'}`}>
                        {new Date(m.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {isLastAdmin && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                        {lastSeen
                          ? <><CheckCheck className="h-3.5 w-3.5 text-blue-500" /> Vu par le client</>
                          : <><Check className="h-3.5 w-3.5" /> Envoyé</>}
                      </p>
                    )}
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-4">
              <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Répondre…" maxLength={2000}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none" />
              <button type="submit" disabled={busy || !body.trim()}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                <Send className="h-4 w-4" /> Envoyer
              </button>
            </form>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
      <div className="space-y-2">
        {conversations.map((c) => (
          <button key={c.id} onClick={() => open(c)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md">
            <div className="min-w-0">
              <p className="font-bold text-slate-900">{c.name}</p>
              <p className="truncate text-sm text-slate-500">
                {c.last_body
                  ? <>{c.last_sender === 'admin' && <span className="text-slate-400">Toi : </span>}{c.last_body}</>
                  : <span className="italic text-slate-400">Aucun message</span>}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {c.last_at && (
                <span className="text-xs text-slate-400">
                  {new Date(c.last_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
              )}
              {c.unread > 0 && (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{c.unread}</span>
              )}
              {c.unread === 0 && c.last_sender === 'admin' && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  {c.seen ? <><CheckCheck className="h-3.5 w-3.5 text-blue-500" /> Vu</> : <><Check className="h-3.5 w-3.5" /> Envoyé</>}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
