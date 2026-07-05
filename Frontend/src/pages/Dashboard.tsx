import { useEffect, useState } from 'react';
import { CreditCard, Globe, Package, Ticket } from 'lucide-react';
import { api, type CreditGrant, type Organization } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, ErrorNote, fmtDate, GRANT_SOURCE, ORG_STATUS, PLAN_LABELS, Spinner } from '../ui';

export default function Dashboard() {
  const { currentOrg } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [balance, setBalance] = useState(0);
  const [grants, setGrants] = useState<CreditGrant[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
          Aucune organisation n'est encore liée à votre compte. Contactez Zenix pour finaliser votre accès.
        </p>
      </Card>
    );
  }

  const status = ORG_STATUS[org.status];
  const activeGrants = grants.filter((g) => new Date(g.expires_at) > new Date() && g.used < g.quantity);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{org.name}</h1>
        <Badge {...status} />
      </div>

      {org.status === 'pending' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Configuration de votre hébergement en cours par Zenix. Le premier prélèvement n'aura lieu
          qu'à la mise en ligne de votre site.
        </div>
      )}
      {org.status === 'past_due' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Votre dernier prélèvement a échoué. Mettez à jour votre moyen de paiement pour continuer
          à bénéficier de vos crédits de modification.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="flex items-center gap-3">
            <Package className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">Formule</p>
              <p className="font-semibold text-slate-900">{org.plan ? PLAN_LABELS[org.plan] : '—'}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Ticket className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">Modifications restantes</p>
              <p className="font-semibold text-slate-900">{balance}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Globe className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">Site</p>
              <p className="font-semibold text-slate-900">{org.linked_domain ?? '—'}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <CreditCard className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-xs text-slate-500">Statut</p>
              <p className="font-semibold text-slate-900">{status.label}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Vos crédits de modification">
        {activeGrants.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun crédit disponible actuellement.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="pb-2">Origine</th>
                <th className="pb-2">Restants</th>
                <th className="pb-2">Expire le</th>
              </tr>
            </thead>
            <tbody>
              {activeGrants.map((g) => (
                <tr key={g.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">{GRANT_SOURCE[g.source]}</td>
                  <td className="py-2 font-medium">{g.quantity - g.used} / {g.quantity}</td>
                  <td className="py-2 text-slate-500">{fmtDate(g.expires_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
