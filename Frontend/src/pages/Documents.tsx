import { useEffect, useState } from 'react';
import { Download, FileText, FolderOpen } from 'lucide-react';
import { api, type Document } from '../api';
import { useAuth } from '../auth';
import { Card, ErrorNote, fmtDate, Spinner, useToast } from '../ui';

const DOC_TYPES: Record<string, string> = {
  contrat:          'Contrat',
  devis:            'Devis',
  zip_offboarding:  'Export de vos fichiers',
  autre:            'Document',
};

export default function Documents() {
  const { currentOrg } = useAuth();
  const toast = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    api.get<{ documents: Document[] }>(`/orgs/${currentOrg.id}/documents`)
      .then((r) => setDocuments(r.documents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

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

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">Mes documents</h1>
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
    </div>
  );
}
