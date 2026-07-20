import { CheckCircle2, LogIn } from 'lucide-react';

const ERRORS: Record<string, string> = {
  'session-expiree':        'La connexion a pris trop de temps, réessayez.',
  'auth-echec':             'La connexion a échoué, réessayez.',
  'auth-indisponible':      'Le service de connexion est momentanément indisponible, réessayez dans quelques minutes.',
  'email-manquant':         "Votre compte n'a pas d'adresse email. Contactez-nous.",
};

export default function Login() {
  const error = new URLSearchParams(window.location.search).get('error');

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            Zenix<span className="text-blue-600">.</span>
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Votre espace client</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tout ce qui concerne votre site, au même endroit.
          </p>

          <ul className="mt-5 space-y-2.5">
            {[
              'Demander une modification de votre site',
              'Suivre l’avancement de vos demandes',
              'Retrouver vos factures et documents',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {ERRORS[error] ?? 'Une erreur est survenue, réessayez.'}
            </div>
          )}

          <a
            href="/api/auth/login"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <LogIn className="h-5 w-5" /> Me connecter
          </a>

          <p className="mt-4 text-center text-xs text-slate-400">
            Connexion sécurisée — vos identifiants vous ont été envoyés par Zenix
          </p>
        </div>
      </div>
    </div>
  );
}
