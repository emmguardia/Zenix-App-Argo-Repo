import type { ReactNode } from 'react';

/* ── Formatage ─────────────────────────────────────────────────────────── */

export const fmtDate = (d: string | number | Date) =>
  new Date(typeof d === 'number' ? d * 1000 : d).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

export const fmtMoney = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);

/* ── Libellés ──────────────────────────────────────────────────────────── */

export const PLAN_LABELS: Record<string, string> = {
  start: 'Zenix Start',
  relax: 'Zenix Relax',
  pro:   'Zenix Pro',
};

export const ORG_STATUS: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'En attente d’activation', cls: 'bg-amber-100 text-amber-800' },
  active:   { label: 'Actif',                   cls: 'bg-green-100 text-green-800' },
  past_due: { label: 'Paiement en échec',       cls: 'bg-red-100 text-red-800' },
  canceled: { label: 'Résilié',                 cls: 'bg-slate-200 text-slate-600' },
};

export const TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  en_attente: { label: 'En attente',        cls: 'bg-amber-100 text-amber-800' },
  valide:     { label: 'Validé',            cls: 'bg-blue-100 text-blue-800' },
  refuse:     { label: 'Refusé',            cls: 'bg-red-100 text-red-800' },
  reporte:    { label: 'Reporté',           cls: 'bg-purple-100 text-purple-800' },
  termine:    { label: 'Terminé',           cls: 'bg-green-100 text-green-800' },
};

export const GRANT_SOURCE: Record<string, string> = {
  forfait:          'Forfait mensuel',
  pack:             'Pack',
  geste_commercial: 'Geste commercial',
};

/* ── Petits composants ─────────────────────────────────────────────────── */

export function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {title && <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
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
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  );
}
