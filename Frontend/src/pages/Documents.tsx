import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, FolderOpen, PenLine } from 'lucide-react';
import { api, type Document } from '../api';
import { useAuth } from '../auth';
import SignModal from '../components/SignModal';
import { Card, ErrorNote, fmtDate, Spinner, useToast } from '../ui';

const DOC_TYPES: Record<string, string> = {
  contrat:          'Contrat',
  contrat_signe:    'Contrat signé',
  cgv:              'Conditions Générales de Vente',
  devis:            'Devis',
  zip_offboarding:  'Export de vos fichiers',
  autre:            'Document',
};

export default function Documents() {
  const { currentOrg } = useAuth();
  const toast = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [signing, setSigning] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!currentOrg) { setLoading(false); return; }
    api.get<{ documents: Document[] }>(`/orgs/${currentOrg.id}/documents`)
      // Les factures déposées vivent dans "Mes factures", pas ici
      .then((r) => setDocuments(r.documents.filter((d) => d.type !== 'facture')))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  useEffect(load, [load]);

  if (!currentOrg) {
    return <Card><p className="text-slate-600">Votre espace n'est pas encore relié à un site.</p></Card>;
  }
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const download = async (docId: string) => {
    try {
      const { url } = await api.get<{ url: string }>(`/orgs/${currentOrg.id}/documents/${docId}/download`);
      window.open(url, '_blank', 'noreferrer');
    } catch {
      toast('Le téléchargement a échoué, réessayez', 'error');
    }
  };

  const toSign = documents.filter((d) => d.requires_signature && !d.signed_at);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Mes documents</h1>

      {toSign.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-blue-300 bg-blue-50 p-5">
          <div className="min-w-0">
            <p className="font-semibold text-blue-900">Signature attendue : {d.filename}</p>
            <p className="text-sm text-blue-800">Lisez le document puis signez-le en ligne — c'est instantané.</p>
          </div>
          <button onClick={() => setSigning(d)}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <PenLine className="h-4 w-4" /> Lire et signer
          </button>
        </div>
      ))}

      <Card>
        {documents.length === 0 ? (
          <div className="py-6 text-center">
            <FolderOpen className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-2 text-sm text-slate-400">
              Vos contrats et devis apparaîtront ici dès que Zenix les aura déposés.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-xl bg-blue-50 p-2.5">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{doc.filename}</p>
                    <p className="text-sm text-slate-500">
                      {DOC_TYPES[doc.type]} · {fmtDate(doc.created_at)}
                      {doc.signed_at && <span className="ml-1 font-medium text-emerald-700">· Signé le {fmtDate(doc.signed_at)}</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => download(doc.id)}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" /> Télécharger
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {currentOrg && (
        <SignModal orgId={currentOrg.id} doc={signing} open={!!signing}
          onClose={() => setSigning(null)} onSigned={() => load()} />
      )}
    </div>
  );
}
