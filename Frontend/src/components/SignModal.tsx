import { useState } from 'react';
import { Download, PenLine } from 'lucide-react';
import { api, type Document } from '../api';
import { Modal, useToast } from '../ui';

/**
 * Signature électronique par clic : le client télécharge/lit le document,
 * coche l'acceptation, tape son nom complet et signe. Le backend constitue
 * le dossier de preuve (identité, horodatage, IP, empreinte SHA-256) et
 * tamponne un certificat en dernière page du PDF.
 */
export default function SignModal({ orgId, doc, open, onClose, onSigned }: {
  orgId: string;
  doc: Document | null;
  open: boolean;
  onClose: () => void;
  onSigned: (step?: string) => void;
}) {
  const toast = useToast();
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!doc) return null;

  const download = async () => {
    const { url } = await api.get<{ url: string }>(`/orgs/${orgId}/documents/${doc.id}/download`);
    window.open(url, '_blank', 'noreferrer');
  };

  const sign = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ step?: string }>(`/orgs/${orgId}/documents/${doc.id}/sign`, {
        name: name.trim(), accepted,
      });
      toast('Document signé — un exemplaire horodaté est disponible dans vos documents');
      setName(''); setAccepted(false);
      onClose();
      onSigned(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'La signature a échoué', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} title={`Signer : ${doc.filename}`} onClose={onClose}>
      <form onSubmit={sign} className="space-y-4">
        <button type="button" onClick={download}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 hover:bg-slate-50">
          <Download className="h-4 w-4" /> Lire le document avant de signer
        </button>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4" required />
          <span className="text-sm text-slate-600">
            J'ai lu ce document dans son intégralité, je l'approuve et je le signe électroniquement.
          </span>
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Tapez votre nom complet (vaut signature)
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Prénom NOM"
            required
            minLength={3}
            maxLength={100}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button type="submit" disabled={busy || !accepted || name.trim().length < 3}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
          <PenLine className="h-4 w-4" /> {busy ? 'Signature…' : 'Signer électroniquement'}
        </button>

        <p className="text-center text-xs text-slate-400">
          Signature électronique horodatée (articles 1366-1367 du Code civil, règlement eIDAS).
          Votre identité, l'heure et l'empreinte du document sont enregistrées.
        </p>
      </form>
    </Modal>
  );
}
