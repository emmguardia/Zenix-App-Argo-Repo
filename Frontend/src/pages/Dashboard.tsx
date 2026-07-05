import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Globe, Pencil, Wrench } from 'lucide-react';
import { api, type CreditGrant, type Organization } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, GRANT_SOURCE, ORG_STATUS, PLAN_LABELS, Spinner } from '../ui';

export default function Dashboard() {
  const { me, currentOrg } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [balance, setBalance] = useState(0);
  const [grants, setGrants] = useState<CreditGrant[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const firstName = (me?.user.name || '').split(' ')[0];

  useEffect(() => {
    if (!currentOrg) { setLoading(false); return; }
    setLoading(true);
    setError('');
    Promise.all([
      api.get<{ organization: Organization; balance: number }>(`/orgs/${currentOrg.id}`),
      api.get<{ balance: number; grants: CreditGrant[] }>(`/orgs/${currentOrg.id}/credits`),
    ])
      .then(([detail, credits]) => {
        setOrg(detail.organization);
        setBalance(credits.balance);
        setGrants(credits.grants);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [currentOrg]);

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!currentOrg || !org) {
    return (
      <Card>
        <p className="text-slate-600">
          Votre espace n'est pas encore relié à un site. Écrivez-nous à{' '}
          <a href="mailto:contact@zenixweb.fr" className="font-medium text-blue-600">contact@zenixweb.fr</a>{' '}
          et on s'en occupe.
        </p>
      </Card>
    );
  }

  const status = ORG_STATUS[org.status];
  const activeGrants = grants.filter((g) => new Date(g.expires_at) > new Date() && g.used < g.quantity);
  const nextExpiry = activeGrants[activeGrants.length - 1];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">
        Bonjour{firstName ? ` ${firstName}` : ''} 👋
      </h1>

      {/* Messages d'état en langage humain */}
      {org.status === 'pending' && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900">Votre site est en cours de mise en place</p>
            <p className="mt-1 text-sm text-amber-800">
              L'équipe Zenix s'occupe de tout — vous n'avez rien à faire. Aucun prélèvement
              n'aura lieu avant la mise en ligne. On vous prévient dès que c'est prêt !
            </p>
          </div>
        </div>
      )}
      {org.status === 'past_due' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="font-semibold text-red-800">Le dernier paiement n'a pas pu être effectué</p>
          <p className="mt-1 text-sm text-red-700">
            Pas de panique : vérifiez votre carte bancaire ou contactez-nous à contact@zenixweb.fr,
            on trouve une solution ensemble. Votre site reste en ligne.
          </p>
        </div>
      )}

      {/* Le site + les modifications : les 2 infos qui comptent */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-50 p-2.5">
                <Globe className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Votre site</p>
                {org.linked_domain ? (
                  <a
                    href={`https://${org.linked_domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-slate-900 hover:text-blue-600"
                  >
                    {org.linked_domain}
                  </a>
                ) : (
                  <p className="font-semibold text-slate-900">Bientôt en ligne</p>
                )}
              </div>
            </div>
            <Badge {...status} />
          </div>
          {org.plan && (
            <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
              Abonnement <span className="font-medium text-slate-700">{PLAN_LABELS[org.plan]}</span>
              {' '}— hébergement, sécurité et sauvegardes inclus
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5">
              <Pencil className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Modifications disponibles</p>
              <p className="text-2xl font-bold text-slate-900">{balance}</p>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {balance > 0
              ? `Vous pouvez demander ${balance} modification${balance > 1 ? 's' : ''} de votre site.`
              : 'Vous avez utilisé toutes vos modifications — vous pouvez quand même envoyer une demande.'}
            {nextExpiry && balance > 0 && ` À utiliser avant le ${fmtDate(nextExpiry.expires_at)}.`}
          </p>
          <Link
            to="/modifications"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700"
          >
            Demander une modification <ArrowRight className="h-4 w-4" />
          </Link>
        </Card>
      </div>

      {/* Détail des modifications seulement s'il y a plusieurs origines */}
      {activeGrants.length > 1 && (
        <Card title="D'où viennent vos modifications ?">
          <ul className="space-y-2">
            {activeGrants.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{GRANT_SOURCE[g.source]}</span>
                <span className="text-slate-500">
                  <span className="font-semibold text-slate-900">{g.quantity - g.used}</span>
                  {' '}restante{g.quantity - g.used > 1 ? 's' : ''} · jusqu'au {fmtDate(g.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
