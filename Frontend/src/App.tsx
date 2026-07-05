import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tickets from './pages/Tickets';
import Invoices from './pages/Invoices';
import Documents from './pages/Documents';
import AdminOrgs from './pages/admin/AdminOrgs';
import AdminTickets from './pages/admin/AdminTickets';
import { Spinner, ToastProvider } from './ui';

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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/modifications" element={<Tickets />} />
        <Route path="/factures" element={<Invoices />} />
        <Route path="/documents" element={<Documents />} />
        {me.user.admin && (
          <>
            <Route path="/admin/clients" element={<AdminOrgs />} />
            <Route path="/admin/demandes" element={<AdminTickets />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
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
