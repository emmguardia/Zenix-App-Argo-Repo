import { useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Check, Clock, FileSignature, LogOut, Upload } from 'lucide-react';
import { api, type Document, type OnboardingState } from '../api';
import { useAuth } from '../auth';
import SignModal from '../components/SignModal';
import { Card, Spinner, useToast } from '../ui';

const STEPS = [
  { key: 'infos',    label: 'Vos informations' },
  { key: 'plan',     label: 'Votre offre' },
  { key: 'review',   label: 'Validation' },
  { key: 'contract', label: 'Contrat' },
  { key: 'payment',  label: 'Paiement' },
];

interface PlanCard { key: string; name: string; desc: string; highlight?: boolean }

const PLANS: PlanCard[] = [
  { key: 'start', name: 'Zenix Start', desc: 'Hébergement sécurisé, sauvegardes quotidiennes, 2 modifications par mois.' },
  { key: 'relax', name: 'Zenix Relax', desc: 'Tout Zenix Start + 6 modifications par mois et suivi renforcé.', highlight: true },
  { key: 'pro',   name: 'Zenix Pro',   desc: 'Tout Zenix Relax + rapport mensuel et priorité maximale.' },
];

const PRICING: Record<'standard' | 'asso', Record<string, string>> = {
  standard: { start: '39€', relax: '69€', pro: '149€' },
  asso:     { essentiel: '15€', start: '20€', relax: '45€', pro: '80€' },
};

// Asso uniquement : hébergement seul, aucune modification incluse
const ESSENTIEL: PlanCard = {
  key: 'essentiel',
  name: 'Zenix Essentiel',
  desc: 'Hébergement, sécurité et sauvegardes — sans modification incluse. Besoin ponctuel ? Passage à Start Asso ou crédits à l\'unité.',
};

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
        {step === 'payment'  && <StepPayment orgId={state.organization?.id} plan={state.organization?.plan} tier={state.organization?.pricing_tier} onNext={setStep} />}
      </div>
    </div>
  );
}

/* ── Étape 1 : informations (champs verrouillés + autocomplétion) ──────── */
function StepInfos({ onNext }: { onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', address: '', siret: '', vat_number: '', website: '', billing_email: '' });
  const [sameEmail, setSameEmail] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const accountEmail = me?.user.email ?? '';
  const inputCls = 'w-full rounded-xl border border-slate-300 px-4 py-3.5 text-base focus:border-blue-500 focus:outline-none';

  // Autocomplétion via la Base Adresse Nationale (data.gouv.fr, gratuite)
  const onAddress = (value: string) => {
    setF((p) => ({ ...p, address: value }));
    if (value.trim().length >= 5) {
      fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value)}&limit=5`)
        .then((r) => r.json())
        .then((d: { features?: { properties: { label: string } }[] }) =>
          setSuggestions(d.features?.map((x) => x.properties.label) ?? []))
        .catch(() => setSuggestions([]));
    } else setSuggestions([]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ step: OnboardingState['step'] }>('/onboarding/profile', {
        ...f, billing_email: sameEmail ? accountEmail : f.billing_email,
      });
      onNext(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-900">Bienvenue chez Zenix 👋</h2>
        <p className="mx-auto mt-2 max-w-md text-base text-slate-600">
          Cet espace, c'est <strong>tout pour votre site au même endroit</strong> :
          vos demandes de modification, vos factures et vos documents.
        </p>
        <p className="mt-2 text-base font-semibold text-slate-700">
          On commence ? 2 minutes, promis.
        </p>
      </div>
    <Card title="Vos informations">
      <p className="mb-4 -mt-2 text-base text-slate-500">Elles serviront pour votre contrat et vos factures.</p>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <input className={inputCls} placeholder="Prénom" required maxLength={20} value={f.first_name}
            onChange={(e) => setF({ ...f, first_name: e.target.value.replace(/\d/g, '').slice(0, 20) })} />
          <input className={inputCls} placeholder="Nom" required maxLength={30} value={f.last_name}
            onChange={(e) => setF({ ...f, last_name: e.target.value.replace(/\d/g, '').slice(0, 30) })} />
        </div>
        <input className={inputCls} placeholder="Téléphone (10 chiffres)" type="tel" inputMode="numeric"
          required pattern="\d{10}" title="10 chiffres, sans espaces" value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
        <div className="relative">
          <input className={inputCls} placeholder="Adresse complète (rue, code postal, ville)" required minLength={5}
            value={f.address} onChange={(e) => onAddress(e.target.value)} autoComplete="off" />
          {suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button"
                    onClick={() => { setF((p) => ({ ...p, address: s })); setSuggestions([]); }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-blue-50">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input className={inputCls} placeholder="SIRET (14 chiffres — laissez vide si particulier)"
          inputMode="numeric" pattern="\d{14}" title="14 chiffres, sans espaces" value={f.siret}
          onChange={(e) => setF({ ...f, siret: e.target.value.replace(/\D/g, '').slice(0, 14) })} />
        <input className={inputCls} placeholder="N° TVA intracommunautaire (FRXX123456789 — optionnel)"
          pattern="FR[0-9A-Za-z]{2}[0-9]{9}" title="Format : FRXX123456789" maxLength={13} value={f.vat_number}
          onChange={(e) => setF({ ...f, vat_number: e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 13) })} />
        <div className="rounded-xl border border-slate-200 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={sameEmail} onChange={(e) => setSameEmail(e.target.checked)} className="h-4 w-4" />
            Utiliser <span className="font-medium text-slate-800">{accountEmail}</span> pour la facturation
          </label>
          {!sameEmail && (
            <input className={`${inputCls} mt-3`} type="email" placeholder="Email de facturation" required
              value={f.billing_email} onChange={(e) => setF({ ...f, billing_email: e.target.value.trim() })} />
          )}
        </div>
        <div className="flex items-stretch">
          <span className="flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm text-slate-500">
            https://
          </span>
          <input className={`${inputCls} !rounded-l-none`} placeholder="votre-site.fr (optionnel — laissez vide si pas encore de site)"
            value={f.website}
            onChange={(e) => setF({ ...f, website: e.target.value.replace(/^https?:\/\//i, '').replace(/\s/g, '') })} />
        </div>
        <button type="submit" disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-4 py-4 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? 'Enregistrement…' : 'Continuer →'}
        </button>
      </form>
    </Card>
    </div>
  );
}

/* ── Étape 2 : choix de l'offre (mensuel ou engagement 1 an) ───────────── */
function StepPlan({ onNext }: { onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [tier, setTier] = useState<'standard' | 'asso'>('standard');

  const choose = async (plan: string) => {
    setBusy(plan);
    try {
      const r = await api.post<{ step: OnboardingState['step'] }>('/onboarding/plan', { plan, interval, tier });
      onNext(r.step);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error');
      setBusy(null);
    }
  };

  const optionCls = (active: boolean) =>
    `flex-1 rounded-2xl border-2 px-4 py-4 text-center text-base font-bold transition-all ${
      active
        ? 'border-blue-600 bg-blue-600 text-white shadow-md'
        : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
    }`;

  return (
    <div className="space-y-4">
      <h2 className="text-center text-2xl font-bold text-slate-900">Choisissez votre offre</h2>
      <p className="-mt-2 text-center text-base text-slate-500">Hébergement, sécurité et sauvegardes toujours inclus.</p>

      <div>
        <p className="mb-2 text-center text-sm font-bold uppercase tracking-wide text-slate-400">Vous êtes… (cliquez)</p>
        <div className="flex gap-3">
          <button onClick={() => setTier('standard')} className={optionCls(tier === 'standard')}>
            Entreprise<span className="block text-sm font-normal opacity-80">ou indépendant</span>
          </button>
          <button onClick={() => setTier('asso')} className={optionCls(tier === 'asso')}>
            Association<span className="block text-sm font-normal opacity-80">tarif réduit ✓</span>
          </button>
        </div>
        {tier === 'asso' && (
          <p className="mt-2 text-center text-sm text-slate-500">
            Grille solidaire réservée aux associations — Zenix vérifiera votre statut à la validation.
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 text-center text-sm font-bold uppercase tracking-wide text-slate-400">Votre formule de paiement (cliquez)</p>
        <div className="flex gap-3">
          <button onClick={() => setInterval('monthly')} className={optionCls(interval === 'monthly')}>
            Mensuel<span className="block text-sm font-normal opacity-80">sans engagement</span>
          </button>
          <button onClick={() => setInterval('annual')} className={optionCls(interval === 'annual')}>
            Engagement 1 an<span className="block text-sm font-normal opacity-80">1 mois offert 🎁</span>
          </button>
        </div>
        {interval === 'annual' && (
          <p className="mt-2 text-center text-sm text-slate-500">
            Vous restez prélevé <strong>mois par mois</strong> (rien à avancer) — et le <strong>12ᵉ mois est offert</strong> (0 €).
          </p>
        )}
      </div>

      <p className="pt-1 text-center text-sm font-bold uppercase tracking-wide text-slate-400">Puis choisissez votre offre (cliquez)</p>

      {(tier === 'asso' ? [ESSENTIEL, ...PLANS] : PLANS).map((p) => (
        <button key={p.key} onClick={() => choose(p.key)} disabled={!!busy}
          className={`w-full rounded-2xl border-2 bg-white p-5 text-left transition-all hover:border-blue-500 hover:shadow-md disabled:opacity-60 ${
            p.highlight ? 'border-blue-400' : 'border-slate-200'
          }`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-900">{p.name}{tier === 'asso' ? ' Asso' : ''}</span>
              {p.highlight && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Le plus choisi</span>}
            </div>
            <span className="text-xl font-bold text-blue-600">{PRICING[tier][p.key]}<span className="text-sm font-normal text-slate-400">/mois</span></span>
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

/* ── Étape 4 : documents à signer (CGV d'abord, puis contrat) ──────────── */
const SIGN_DOC_LABELS: Record<string, string> = {
  cgv: 'Conditions Générales de Vente',
  contrat: "Contrat d'hébergement",
  devis: 'Devis',
  autre: 'Document',
};

function StepContract({ orgId, onNext }: { orgId?: string; onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [signing, setSigning] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!orgId) return;
    api.get<{ documents: Document[] }>(`/orgs/${orgId}/documents`)
      .then((r) => setDocs(r.documents))
      .catch(() => setDocs([]));
  };
  useEffect(load, [orgId]);

  if (!docs) return <Spinner />;

  // CGV d'abord, puis contrat, puis le reste
  const order: Record<string, number> = { cgv: 0, contrat: 1 };
  const toSign = docs
    .filter((d) => d.requires_signature)
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
  const contract = toSign.find((d) => d.type === 'contrat' && !d.signed_at);

  const uploadSigned = async (file: File) => {
    if (!orgId) return;
    setBusy(true);
    try {
      const r = await api.upload<{ step: OnboardingState['step'] }>(`/orgs/${orgId}/documents/signed-contract`, file);
      toast('Contrat signé bien reçu !');
      if (r.step === 'payment') onNext('payment'); else load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "L'envoi a échoué", 'error');
    } finally { setBusy(false); }
  };

  return (
    <Card title="Vos documents à signer">
      {toSign.length === 0 ? (
        <p className="text-sm text-slate-500">
          Zenix prépare vos documents (CGV et contrat d'hébergement) — ils apparaîtront
          ici très bientôt. Revenez un peu plus tard.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="-mt-2 mb-1 text-sm text-slate-500">
            Signez chaque document en ligne — c'est instantané et ça a valeur de signature.
          </p>
          {toSign.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{SIGN_DOC_LABELS[d.type] ?? d.filename}</p>
                <p className="truncate text-xs text-slate-400">{d.filename}</p>
              </div>
              {d.signed_at ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                  <Check className="h-3.5 w-3.5" /> Signé
                </span>
              ) : (
                <button onClick={() => setSigning(d)}
                  className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  Lire et signer
                </button>
              )}
            </div>
          ))}

          {contract && (
            <details className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              <summary className="cursor-pointer font-medium text-slate-600">
                Vous préférez signer sur papier ?
              </summary>
              <p className="mt-2">
                Téléchargez le contrat (bouton "Lire et signer" → lecture), imprimez-le,
                signez-le puis redéposez-le ici en PDF :
              </p>
              <label className={`mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-100 ${busy ? 'opacity-50' : ''}`}>
                <Upload className="h-4 w-4" /> {busy ? 'Envoi…' : 'Déposer le contrat signé (PDF)'}
                <input type="file" accept="application/pdf" className="hidden" disabled={busy}
                  onChange={(e) => e.target.files?.[0] && uploadSigned(e.target.files[0])} />
              </label>
            </details>
          )}
        </div>
      )}

      {orgId && (
        <SignModal
          orgId={orgId}
          doc={signing}
          open={!!signing}
          onClose={() => setSigning(null)}
          onSigned={(step) => { if (step === 'payment') onNext('payment'); else load(); }}
        />
      )}
    </Card>
  );
}

/* ── Étape 5 : paiement (Stripe Elements) ──────────────────────────────── */
function StepPayment({ orgId, plan, tier, onNext }: { orgId?: string; plan?: string | null; tier?: 'standard' | 'asso'; onNext: (s: OnboardingState['step']) => void }) {
  const toast = useToast();
  const [accepted, setAccepted] = useState(false);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState('');
  const planInfo = PLANS.find((p) => p.key === plan);
  const price = plan ? PRICING[tier ?? 'standard'][plan] : '';

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
          {planInfo.name}{tier === 'asso' ? ' Asso' : ''} — <span className="font-semibold text-slate-700">{price}/mois</span>.{' '}
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
        className="w-full rounded-xl bg-blue-600 px-4 py-4 text-lg font-bold text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Traitement…' : "S'abonner — 0 € aujourd'hui"}
      </button>
      <p className="text-center text-xs text-slate-400">
        Commande avec obligation de paiement à la mise en ligne · Carte sécurisée par Stripe
      </p>
    </form>
  );
}
