import { NavLink, Outlet } from 'react-router-dom';
import { Building2, FileText, LayoutDashboard, LogOut, Receipt, Shield, Ticket as TicketIcon, Users } from 'lucide-react';
import { useAuth } from '../auth';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

export default function Layout() {
  const { me, currentOrg, setCurrentOrgId, logout } = useAuth();
  const orgs = me?.organizations ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold text-slate-900">
              Zenix<span className="text-blue-600"> · Espace Client</span>
            </span>
            {orgs.length > 1 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-400" />
                <select
                  value={currentOrg?.id ?? ''}
                  onChange={(e) => setCurrentOrgId(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:block">{me?.user.name || me?.user.email}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4" /> Déconnexion
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4 pb-3">
          <NavLink to="/" end className={linkCls}>
            <LayoutDashboard className="h-4 w-4" /> Tableau de bord
          </NavLink>
          <NavLink to="/tickets" className={linkCls}>
            <TicketIcon className="h-4 w-4" /> Tickets
          </NavLink>
          <NavLink to="/factures" className={linkCls}>
            <Receipt className="h-4 w-4" /> Factures
          </NavLink>
          <NavLink to="/documents" className={linkCls}>
            <FileText className="h-4 w-4" /> Documents
          </NavLink>
          {me?.user.admin && (
            <>
              <span className="mx-2 self-center text-slate-300">|</span>
              <NavLink to="/admin/clients" className={linkCls}>
                <Users className="h-4 w-4" /> Clients
              </NavLink>
              <NavLink to="/admin/tickets" className={linkCls}>
                <Shield className="h-4 w-4" /> Tickets (admin)
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
