import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

/* ── Formatage ─────────────────────────────────────────────────────────── */

export const fmtDate = (d: string | number | Date) =>
  new Date(typeof d === 'number' ? d * 1000 : d).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

export const fmtMoney = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);

/* ── Libellés — langage client, pas jargon ─────────────────────────────── */

export const PLAN_LABELS: Record<string, string> = {
  start: 'Zenix Start',
  relax: 'Zenix Relax',
  pro:   'Zenix Pro',
};

// Côté client : des phrases, pas des statuts techniques
export const ORG_STATUS: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Mise en place en cours', cls: 'bg-amber-100 text-amber-800' },
  active:   { label: 'En ligne',               cls: 'bg-emerald-100 text-emerald-800' },
  past_due: { label: 'Problème de paiement',   cls: 'bg-red-100 text-red-700' },
  canceled: { label: 'Abonnement terminé',     cls: 'bg-slate-200 text-slate-600' },
};

// Statuts de demande vus par le CLIENT
export const TICKET_STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  en_attente:  { label: 'Reçue',                    cls: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  valide:      { label: 'En cours de réalisation',  cls: 'bg-amber-100 text-amber-800',     dot: 'bg-amber-500' },
  reporte:     { label: 'Prévue le mois prochain',  cls: 'bg-violet-100 text-violet-700',   dot: 'bg-violet-500' },
  a_confirmer: { label: 'À reconfirmer',            cls: 'bg-orange-100 text-orange-700',   dot: 'bg-orange-500' },
  refuse:      { label: 'Non retenue',              cls: 'bg-slate-200 text-slate-600',     dot: 'bg-slate-400' },
  annule:      { label: 'Annulée',                  cls: 'bg-slate-200 text-slate-600',     dot: 'bg-slate-400' },
  termine:     { label: 'Terminée',                 cls: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
};

// Statuts vus par l'ADMIN (vocabulaire de travail)
export const ADMIN_TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  en_attente:  { label: 'À décider',      cls: 'bg-blue-100 text-blue-700' },
  valide:      { label: 'À faire',        cls: 'bg-amber-100 text-amber-800' },
  reporte:     { label: 'Reporté',        cls: 'bg-violet-100 text-violet-700' },
  a_confirmer: { label: 'Chez le client', cls: 'bg-orange-100 text-orange-700' },
  refuse:      { label: 'Refusé',         cls: 'bg-slate-200 text-slate-600' },
  annule:      { label: 'Annulé (client)', cls: 'bg-slate-200 text-slate-600' },
  termine:     { label: 'Terminé',        cls: 'bg-emerald-100 text-emerald-800' },
};

export const GRANT_SOURCE: Record<string, string> = {
  forfait:          'Incluses dans votre abonnement',
  pack:             'Achetées en supplément',
  geste_commercial: 'Offertes par Zenix',
};

/* ── Petits composants ─────────────────────────────────────────────────── */

export function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 font-semibold text-slate-900">{title}</h2>}
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-b-2 border-blue-600" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}

/* ── Modale ────────────────────────────────────────────────────────────── */

export function Modal({ open, title, children, onClose }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

interface Toast { id: number; message: string; type: 'success' | 'error' }

const ToastContext = createContext<{ toast: (message: string, type?: Toast['type']) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => {
      // Pas de doublon du même message, max 3 toasts à l'écran
      if (t.some((x) => x.message === message)) return t;
      return [...t.slice(-2), { id, message, type }];
    });
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
              t.type === 'success' ? 'bg-slate-900' : 'bg-red-600'
            }`}
          >
            {t.type === 'success'
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              : <XCircle className="h-5 w-5 shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>');
  return ctx.toast;
}
