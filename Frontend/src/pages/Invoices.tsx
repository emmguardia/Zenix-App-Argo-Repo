import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, type Invoice } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, fmtMoney, Spinner } from '../ui';

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  paid:          { label: 'Payée',     cls: 'bg-green-100 text-green-800' },
  open:          { label: 'En cours',  cls: 'bg-amber-100 text-amber-800' },
  void:          { label: 'Annulée',   cls: 'bg-slate-200 text-slate-600' },
  uncollectible: { label: 'Impayée',   cls: 'bg-red-100 text-red-800' },
  draft:         { label: 'Brouillon', cls: 'bg-slate-200 text-slate-600' },
};

export default function Invoices() {
  const { currentOrg } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    api.get<{ invoices: Invoice[] }>(`/orgs/${currentOrg.id}/invoices`)
      .then((r) => setInvoices(r.invoices))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  if (!currentOrg) return <Card><p className="text-slate-600">Aucune organisation liée.</p></Card>;
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Factures</h1>
      <Card>
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune facture pour l'instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="pb-2">Numéro</th>
                <th className="pb-2">Date</th>
                <th className="pb-2">Montant</th>
                <th className="pb-2">Statut</th>
                <th className="pb-2 text-right">PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 font-medium text-slate-900">{inv.number ?? '—'}</td>
                  <td className="py-2.5 text-slate-500">{fmtDate(inv.date)}</td>
                  <td className="py-2.5">{fmtMoney(inv.amount, inv.currency)}</td>
                  <td className="py-2.5">
                    <Badge {...(INVOICE_STATUS[inv.status] ?? { label: inv.status, cls: 'bg-slate-200 text-slate-600' })} />
                  </td>
                  <td className="py-2.5 text-right">
                    {inv.pdf && (
                      <a
                        href={inv.pdf}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <Download className="h-4 w-4" /> Télécharger
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
