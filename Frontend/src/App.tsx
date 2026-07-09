import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { api, type OnboardingState } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import Invoices from './pages/Invoices';
import Documents from './pages/Documents';
import Messages from './pages/Messages';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminOrgs from './pages/admin/AdminOrgs';
import AdminTickets from './pages/admin/AdminTickets';
import AdminMessages from './pages/admin/AdminMessages';
import { Spinner, ToastProvider } from './ui';

/* Admin : interface 100% admin, aucune page client */
function AdminApp() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<AdminDashboard />} />
        <Route path="/clients" element={<AdminOrgs />} />
        <Route path="/demandes" element={<AdminTickets />} />
        <Route path="/messages" element={<AdminMessages />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/* Client : onboarding obligatoire tant que le parcours n'est pas terminé */
function ClientApp() {
  const { refresh } = useAuth();
  const [state, setState] = useState<OnboardingState | null>(null);

  const load = useCallback(() => {
    api.get<OnboardingState>('/onboarding/state').then(setState).catch(() => setState(null));
  }, []);

  useEffect(load, [load]);

  if (!state) return <div className="flex h-screen items-center justify-center bg-slate-50"><Spinner /></div>;

  if (state.step !== 'done') {
    return <Onboarding state={state} onDone={() => { refresh(); load(); }} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/modifications" element={<Tickets />} />
        <Route path="/factures" element={<Invoices />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Routed() {
  const { me, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Spinner />
      </div>
    );
  }

  if (!me) return <Login />;
  return me.user.admin ? <AdminApp /> : <ClientApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routed />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
