import { NavLink, Outlet } from 'react-router-dom';
import { Building2, FileText, Home, Inbox, LogOut, Pencil, Receipt, Users } from 'lucide-react';
import { useAuth } from '../auth';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:shadow-sm'
  }`;

export default function Layout() {
  const { me, currentOrg, setCurrentOrgId, logout } = useAuth();
  const orgs = me?.organizations ?? [];
  const firstName = (me?.user.name || me?.user.email || '').split(' ')[0].split('@')[0];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Zenix<span className="text-blue-600">.</span>
          </span>

          <div className="flex items-center gap-3">
            {orgs.length > 1 && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
                <Building2 className="h-4 w-4 text-slate-400" />
                <select
                  value={currentOrg?.id ?? ''}
                  onChange={(e) => setCurrentOrgId(e.target.value)}
                  className="bg-transparent text-sm font-medium text-slate-700 focus:outline-none"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}
            <span className="hidden text-sm text-slate-500 sm:block">{firstName}</span>
            <button
              onClick={logout}
              title="Se déconnecter"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Quitter</span>
            </button>
          </div>
        </div>
      </header>

      <nav className="border-b border-slate-200 bg-slate-100/60">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-1 px-4 py-2">
          <NavLink to="/" end className={linkCls}>
            <Home className="h-4 w-4" /> Accueil
          </NavLink>
          <NavLink to="/modifications" className={linkCls}>
            <Pencil className="h-4 w-4" /> Mes modifications
          </NavLink>
          <NavLink to="/factures" className={linkCls}>
            <Receipt className="h-4 w-4" /> Mes factures
          </NavLink>
          <NavLink to="/documents" className={linkCls}>
            <FileText className="h-4 w-4" /> Mes documents
          </NavLink>
          {me?.user.admin && (
            <>
              <span className="mx-1 hidden self-center rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white sm:inline">
                Admin
              </span>
              <NavLink to="/admin/clients" className={linkCls}>
                <Users className="h-4 w-4" /> Clients
              </NavLink>
              <NavLink to="/admin/demandes" className={linkCls}>
                <Inbox className="h-4 w-4" /> Demandes
              </NavLink>
            </>
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-xs text-slate-400">
        Un problème, une question ? Écrivez-nous : contact@zenixweb.fr
      </footer>
    </div>
  );
}
