import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, Building2, FileText, Home, Inbox, LogOut, MessageCircle, Pencil, Receipt, Users } from 'lucide-react';
import { useAuth } from '../auth';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:shadow-sm'
  }`;

export default function Layout() {
  const { me, currentOrg, setCurrentOrgId, logout } = useAuth();
  const isAdmin = !!me?.user.admin;
  const orgs = me?.organizations ?? [];
  const firstName = (me?.user.name || me?.user.email || '').split(' ')[0].split('@')[0];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <span className="text-xl font-bold tracking-tight text-slate-900">
            Zenix<span className="text-blue-600">.</span>
            {isAdmin && <span className="ml-2 rounded-md bg-slate-900 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">Admin</span>}
          </span>

          <div className="flex items-center gap-3">
            {!isAdmin && orgs.length > 1 && (
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
        {/* Mobile : la barre défile horizontalement au lieu de s'empiler */}
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 [-webkit-overflow-scrolling:touch]">
          {isAdmin ? (
            <>
              <NavLink to="/" end className={linkCls}>
                <BarChart3 className="h-4 w-4" /> Tableau de bord
              </NavLink>
              <NavLink to="/clients" className={linkCls}>
                <Users className="h-4 w-4" /> Clients
              </NavLink>
              <NavLink to="/demandes" className={linkCls}>
                <Inbox className="h-4 w-4" /> Demandes
              </NavLink>
              <NavLink to="/messages" className={linkCls}>
                <MessageCircle className="h-4 w-4" /> Messages
              </NavLink>
            </>
          ) : (
            <>
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
              <NavLink to="/messages" className={linkCls}>
                <MessageCircle className="h-4 w-4" /> Messages
              </NavLink>
            </>
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>

      {!isAdmin && (
        <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-slate-400">
          Un problème, une question ? Écrivez-nous : contact@zenixweb.fr
        </footer>
      )}
    </div>
  );
}
