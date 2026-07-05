import { LogIn } from 'lucide-react';

const ERRORS: Record<string, string> = {
  'compte-non-provisionne': "Votre compte n'est pas encore configuré. Contactez Zenix pour finaliser votre accès.",
  'session-expiree':        'La session de connexion a expiré, réessayez.',
  'auth-echec':             'La connexion a échoué, réessayez.',
  'auth-indisponible':      'Le service de connexion est momentanément indisponible.',
  'email-manquant':         'Votre compte ne fournit pas d’adresse email.',
};

export default function Login() {
  const error = new URLSearchParams(window.location.search).get('error');

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">
          Zenix<span className="text-blue-600"> · Espace Client</span>
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Suivez votre abonnement, vos factures et vos demandes de modification.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {ERRORS[error] ?? 'Une erreur est survenue, réessayez.'}
          </div>
        )}

        <a
          href="/api/auth/login"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700"
        >
          <LogIn className="h-4 w-4" /> Se connecter
        </a>

        <p className="mt-4 text-center text-xs text-slate-400">
          Connexion sécurisée via Zenix Access (2FA)
        </p>
      </div>
    </div>
  );
}
