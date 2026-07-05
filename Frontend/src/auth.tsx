import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type Me, type OrgSummary } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  currentOrg: OrgSummary | null;
  setCurrentOrgId: (id: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ORG_KEY = 'zenix.currentOrg';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(() => localStorage.getItem(ORG_KEY));

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    localStorage.removeItem(ORG_KEY);
    setMe(null);
  }, []);

  const setCurrentOrgId = useCallback((id: string) => {
    localStorage.setItem(ORG_KEY, id);
    setOrgId(id);
  }, []);

  const currentOrg = useMemo(() => {
    const orgs = me?.organizations ?? [];
    return orgs.find((o) => o.id === orgId) ?? orgs[0] ?? null;
  }, [me, orgId]);

  const value = useMemo(
    () => ({ me, loading, currentOrg, setCurrentOrgId, refresh, logout }),
    [me, loading, currentOrg, setCurrentOrgId, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
