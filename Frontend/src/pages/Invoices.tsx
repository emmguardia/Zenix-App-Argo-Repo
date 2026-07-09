import { useEffect, useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { api, type Document, type Invoice } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, fmtMoney, Spinner } from '../ui';

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  paid:          { label: 'Payée',      cls: 'bg-emerald-100 text-emerald-800' },
  open:          { label: 'En attente', cls: 'bg-amber-100 text-amber-800' },
  void:          { label: 'Annulée',    cls: 'bg-slate-200 text-slate-600' },
  uncollectible: { label: 'Impayée',    cls: 'bg-red-100 text-red-700' },
  draft:         { label: 'En préparation', cls: 'bg-slate-200 text-slate-600' },
};

export default function Invoices() {
  const { currentOrg } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [manual, setManual] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get<{ invoices: Invoice[] }>(`/orgs/${currentOrg.id}/invoices`),
      api.get<{ documents: Document[] }>(`/orgs/${currentOrg.id}/documents`),
    ])
      .then(([inv, docs]) => {
        setInvoices(inv.invoices);
        setManual(docs.documents.filter((d) => d.type === 'facture'));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  const openManual = async (docId: string) => {
    const { url } = await api.get<{ url: string }>(`/orgs/${currentOrg!.id}/documents/${docId}/download`);
    window.open(url, '_blank', 'noreferrer');
  };

  if (!currentOrg) {
    return <Card><p className="text-slate-600">Votre espace n'est pas encore relié à un site.</p></Card>;
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Mes factures</h1>
      <Card>
        {invoices.length === 0 && manual.length === 0 ? (
          <div className="py-6 text-center">
            <Receipt className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm text-slate-400">
              Vos factures apparaîtront ici après votre premier prélèvement.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {manual.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div>
                  <p className="font-semibold text-slate-900">{doc.filename}</p>
                  <p className="text-sm text-slate-500">{fmtDate(doc.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge label="Facture" cls="bg-slate-100 text-slate-600" />
                  <button onClick={() => openManual(doc.id)}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                    <Download className="h-4 w-4" /> PDF
                  </button>
                </div>
              </li>
            ))}
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div>
                  <p className="font-semibold text-slate-900">{fmtMoney(inv.amount, inv.currency)}</p>
                  <p className="text-sm text-slate-500">
                    {fmtDate(inv.date)}{inv.number ? ` · n° ${inv.number}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge {...(INVOICE_STATUS[inv.status] ?? { label: inv.status, cls: 'bg-slate-200 text-slate-600' })} />
                  {inv.pdf && (
                    <a
                      href={inv.pdf}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <Download className="h-4 w-4" /> PDF
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
