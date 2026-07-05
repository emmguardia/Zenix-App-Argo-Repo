import { useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Check, Clock, Download, FileSignature, LogOut, Upload } from 'lucide-react';
import { api, type Document, type OnboardingState } from '../api';
import { useAuth } from '../auth';
import { Card, Spinner, useToast } from '../ui';

const STEPS = [
  { key: 'infos',    label: 'Vos informations' },
  { key: 'plan',     label: 'Votre offre' },
  { key: 'review',   label: 'Validation' },
  { key: 'contract', label: 'Contrat' },
  { key: 'payment',  label: 'Paiement' },
];

const PLANS = [
  { key: 'start', name: 'Zenix Start', price: '39€', desc: 'Hébergement sécurisé, sauvegardes quotidiennes, 2 modifications par mois.' },
  { key: 'relax', name: 'Zenix Relax', price: '69€', desc: 'Tout Zenix Start + 6 modifications par mois et suivi renforcé.', highlight: true },
  { key: 'pro',   name: 'Zenix Pro',   price: '149€', desc: 'Tout Zenix Relax + rapport mensuel et priorité maximale.' },
];

export default function Onboarding({ state, onDone }: { state: OnboardingState; onDone: () => void }) {
  const { logout } = useAuth();
  const [step, setStep] = useState(state.step);
  const currentIdx = STEPS.findIndex((s) => s.key === step);

  useEffect(() => { if (step === 'done') onDone(); }, [step, onDone]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-blue-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-xl font-bold text-slate-900">Zenix<span className="text-blue-600">.</span></span>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <LogOut className="h-4 w-4" /> Quitter
          </button>
        </div>

        {/* Barre d'étapes */}
        <div className="mb-8 flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < currentIdx ? 'bg-emerald-500 text-white'
                : i === currentIdx ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-500'
              }`}>
                {i < currentIdx ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`hidden text-center text-[11px] sm:block ${i === currentIdx ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {step === 'infos'    && <StepInfos onNext={setStep} />}
        {step === 'plan'     && <StepPlan onNext={setStep} />}
        {step === 'review'   && <StepReview />}
        {step === 'contract' && <StepContract orgId={state.organization?.id} onNext={setStep} />}
        {step === 'payment'  && <StepPayment orgId={state.organization?.id} plan={state.organization?.plan} onNext={setStep} />}
      </div>
    </div>
  );
}

/* ── Étape 1 : informations ────────────────────────────────────────────── */
function StepInfos({ onNext }: { onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', address: '', siret: '' });
  const [busy, setBusy] = useState(false);
  const inputCls = 'w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ step: OnboardingState['step'] }>('/onboarding/profile', {
        ...f, siret: f.siret.replace(/\s/g, ''),
      });
      onNext(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  return (
    <Card title="Bienvenue ! Faisons connaissance">
      <p className="mb-4 -mt-2 text-sm text-slate-500">Ces informations serviront pour votre contrat et vos factures.</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input className={inputCls} placeholder="Prénom" required value={f.first_name}
            onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          <input className={inputCls} placeholder="Nom" required value={f.last_name}
            onChange={(e) => setF({ ...f, last_name: e.target.value })} />
        </div>
        <input className={inputCls} placeholder="Téléphone" type="tel" required value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className={inputCls} placeholder="Adresse complète (rue, code postal, ville)" required value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })} />
        <input className={inputCls} placeholder="SIRET (14 chiffres — laissez vide si particulier)" value={f.siret}
          onChange={(e) => setF({ ...f, siret: e.target.value })} />
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Enregistrement…' : 'Continuer'}
        </button>
      </form>
    </Card>
  );
}

/* ── Étape 2 : choix de l'offre (mensuel ou engagement 1 an) ───────────── */
function StepPlan({ onNext }: { onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');

  const choose = async (plan: string) => {
    setBusy(plan);
    try {
      const r = await api.post<{ step: OnboardingState['step'] }>('/onboarding/plan', { plan, interval });
      onNext(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-center text-lg font-bold text-slate-900">Choisissez votre offre</h2>
      <p className="-mt-1 text-center text-sm text-slate-500">Hébergement, sécurité et sauvegardes toujours inclus.</p>

      <div className="mx-auto flex w-fit rounded-xl bg-slate-200 p-1">
        <button onClick={() => setInterval('monthly')}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium ${interval === 'monthly' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Mensuel, sans engagement
        </button>
        <button onClick={() => setInterval('annual')}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium ${interval === 'annual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
          Engagement 1 an <span className="font-bold text-emerald-600">· 1 mois offert</span>
        </button>
      </div>
      {interval === 'annual' && (
        <p className="text-center text-xs text-slate-500">
          Vous restez prélevé mois par mois (rien à avancer) — et le 12ᵉ mois est offert (0 €).
        </p>
      )}

      {PLANS.map((p) => (
        <button key={p.key} onClick={() => choose(p.key)} disabled={!!busy}
          className={`w-full rounded-2xl border-2 bg-white p-5 text-left transition-all hover:border-blue-500 hover:shadow-md disabled:opacity-60 ${
            p.highlight ? 'border-blue-400' : 'border-slate-200'
          }`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-900">{p.name}</span>
              {p.highlight && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Le plus choisi</span>}
            </div>
            <span className="text-xl font-bold text-blue-600">{p.price}<span className="text-sm font-normal text-slate-400">/mois</span></span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{p.desc}</p>
        </button>
      ))}
    </div>
  );
}

/* ── Étape 3 : en attente de validation ────────────────────────────────── */
function StepReview() {
  return (
    <Card>
      <div className="py-6 text-center">
        <Clock className="mx-auto h-12 w-12 text-amber-500" />
        <h2 className="mt-3 text-lg font-bold text-slate-900">C'est noté !</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          Zenix vérifie vos informations et prépare votre contrat d'hébergement.
          Vous recevrez la suite ici même — revenez d'ici peu, aucune action n'est
          nécessaire de votre côté pour l'instant.
        </p>
      </div>
    </Card>
  );
}

/* ── Étape 4 : contrat à signer ────────────────────────────────────────── */
function StepContract({ orgId, onNext }: { orgId?: string; onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [contract, setContract] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    api.get<{ documents: Document[] }>(`/orgs/${orgId}/documents`)
      .then((r) => setContract(r.documents.find((d) => d.type === 'contrat') ?? null))
      .finally(() => setLoading(false));
  }, [orgId]);

  const download = async () => {
    if (!orgId || !contract) return;
    const { url } = await api.get<{ url: string }>(`/orgs/${orgId}/documents/${contract.id}/download`);
    window.open(url, '_blank', 'noreferrer');
  };

  const uploadSigned = async (file: File) => {
    if (!orgId) return;
    setBusy(true);
    try {
      const r = await api.upload<{ step: OnboardingState['step'] }>(`/orgs/${orgId}/documents/signed-contract`, file);
      toast('Contrat signé bien reçu !');
      onNext(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : "L'envoi a échoué", 'error');
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <Card title="Votre contrat d'hébergement">
      {!contract ? (
        <p className="text-sm text-slate-500">
          Zenix prépare votre contrat — il apparaîtra ici très bientôt. Revenez un peu plus tard.
        </p>
      ) : (
        <div className="space-y-4">
          <ol className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-2"><span className="font-bold text-blue-600">1.</span> Téléchargez et lisez votre contrat.</li>
            <li className="flex gap-2"><span className="font-bold text-blue-600">2.</span> Imprimez-le ou signez-le électroniquement.</li>
            <li className="flex gap-2"><span className="font-bold text-blue-600">3.</span> Redéposez la version signée (PDF) ci-dessous.</li>
          </ol>
          <button onClick={download}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Télécharger mon contrat
          </button>
          <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 ${busy ? 'opacity-50' : ''}`}>
            <Upload className="h-4 w-4" /> {busy ? 'Envoi…' : 'Déposer le contrat signé (PDF)'}
            <input type="file" accept="application/pdf" className="hidden" disabled={busy}
              onChange={(e) => e.target.files?.[0] && uploadSigned(e.target.files[0])} />
          </label>
        </div>
      )}
    </Card>
  );
}

/* ── Étape 5 : paiement (Stripe Elements) ──────────────────────────────── */
function StepPayment({ orgId, plan, onNext }: { orgId?: string; plan?: string | null; onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [accepted, setAccepted] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const planInfo = PLANS.find((p) => p.key === plan);

  const start = async () => {
    if (!orgId) return;
    try {
      await api.post(`/orgs/${orgId}/payment/accept-terms`, { accepted: true });
      const cfg = await api.get<{ publishableKey: string }>(`/orgs/${orgId}/payment/config`);
      const si = await api.post<{ clientSecret: string }>(`/orgs/${orgId}/payment/setup-intent`);
      setStripePromise(loadStripe(cfg.publishableKey));
      setClientSecret(si.clientSecret);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
    }
  };

  return (
    <Card title="Dernière étape : votre moyen de paiement">
      {planInfo && (
        <p className="mb-4 -mt-2 text-sm text-slate-500">
          {planInfo.name} — <span className="font-semibold text-slate-700">{planInfo.price}/mois</span>.{' '}
          <span className="font-semibold text-emerald-700">Aucun prélèvement aujourd'hui</span> :
          votre carte est simplement enregistrée de façon sécurisée. Le premier prélèvement
          n'aura lieu qu'à la mise en ligne de votre site.
        </p>
      )}

      {!clientSecret ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 h-4 w-4" />
            <span className="text-sm text-slate-600">
              J'ai pris connaissance de mon <strong>contrat d'hébergement</strong> (signé et déposé) et des{' '}
              <a href="https://www.zenixweb.fr/conditions-vente" target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline">
                Conditions Générales de Vente
              </a>, et je les accepte.
            </span>
          </label>
          <button onClick={start} disabled={!accepted}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
            <FileSignature className="h-4 w-4" /> Continuer vers le paiement
          </button>
        </div>
      ) : (
        stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret, locale: 'fr' }}>
            <PaymentForm orgId={orgId!} onNext={onNext} />
          </Elements>
        )
      )}
    </Card>
  );
}

function PaymentForm({ orgId, onNext }: { orgId: string; onNext: (s: OnboardingState['step']) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const result = await stripe.confirmSetup({ elements, redirect: 'if_required' });
      if (result.error) {
        toast(result.error.message || 'La carte a été refusée', 'error');
        return;
      }
      await api.post(`/orgs/${orgId}/payment/card-saved`);
      toast('Carte enregistrée — bienvenue chez Zenix ! 🎉');
      onNext('done');
    } catch (err) {
      toast(err instanceof Error ? err.message : "L'enregistrement a échoué", 'error');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement />
      <button type="submit" disabled={busy || !stripe}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Traitement…' : "S'abonner — 0 € aujourd'hui"}
      </button>
      <p className="text-center text-xs text-slate-400">
        Commande avec obligation de paiement à la mise en ligne · Carte sécurisée par Stripe
      </p>
    </form>
  );
}
