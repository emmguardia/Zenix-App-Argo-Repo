import { useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { api, type Document } from '../api';
import { useAuth } from '../auth';
import { Card, ErrorNote, fmtDate, Spinner } from '../ui';

const DOC_TYPES: Record<string, string> = {
  contrat:          'Contrat',
  devis:            'Devis',
  zip_offboarding:  'Export de fin de contrat',
  autre:            'Document',
};

export default function Documents() {
  const { currentOrg } = useAuth();
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

  if (!currentOrg) return <Card><p className="text-slate-600">Aucune organisation liée.</p></Card>;
  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;

  const download = async (docId: string) => {
    const { url } = await api.get<{ url: string }>(`/orgs/${currentOrg.id}/documents/${docId}/download`);
    window.open(url, '_blank', 'noreferrer');
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Mes documents</h1>
      <Card>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun document pour l'instant.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-6 w-6 text-blue-600" />
                  <div>
                    <p className="font-medium text-slate-900">{doc.filename}</p>
                    <p className="text-xs text-slate-400">
                      {DOC_TYPES[doc.type]} — ajouté le {fmtDate(doc.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => download(doc.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
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
