/** Client API — même origine (proxy Vite en dev, IngressRoute en prod). */

export interface OrgSummary {
  id: string;
  name: string;
  legal_type: 'entreprise' | 'association' | 'particulier';
  plan: 'start' | 'relax' | 'pro' | null;
  status: 'pending' | 'active' | 'past_due' | 'canceled';
}

export interface Organization extends OrgSummary {
  siret: string | null;
  vat_number: string | null;
  billing_address: string | null;
  linked_domain: string | null;
}

export interface AdminOrganization extends Organization {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  balance: number;
  members: string | null;
  created_at: string;
  onboarding_status: 'infos' | 'plan' | 'review' | 'contract' | 'payment' | 'done';
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_phone: string | null;
  validated_at: string | null;
  billing_interval: 'monthly' | 'annual';
  custom_price_id: string | null;
}

export interface OnboardingState {
  step: 'infos' | 'plan' | 'review' | 'contract' | 'payment' | 'done';
  organization: {
    id: string; name: string; plan: string | null; status: string;
    contact_first_name: string | null; contact_last_name: string | null;
    cgv_accepted_at: string | null;
  } | null;
}

export interface StripeCustomer {
  id: string;
  name: string;
  email: string;
  linkedTo: string | null;
}

export interface AdminStats {
  mrr: number;
  activeSubs: number;
  monthlyRevenue: { month: string; amount: number }[];
  byPlan: { plan: string; count: number }[];
  statuses: { status: string; count: number }[];
  pendingTickets: number;
  lastPayments: { id: string; number: string | null; customer: string; amount: number; status: string; date: number }[];
}

export interface AdminDocument {
  id: string;
  type: string;
  filename: string;
  created_at: string;
  uploaded_by_name: string | null;
}

export interface Me {
  user: { id: string; email: string; name: string; admin: boolean };
  organizations: OrgSummary[];
}

export interface CreditGrant {
  id: string;
  source: 'forfait' | 'pack' | 'geste_commercial';
  quantity: number;
  used: number;
  granted_at: string;
  expires_at: string;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: 'en_attente' | 'valide' | 'refuse' | 'reporte' | 'termine';
  created_at: string;
  decided_at: string | null;
  completed_at: string | null;
  credit_consumed?: number;
  created_by_name?: string | null;
}

export interface AdminTicket extends Ticket {
  organization_id: string;
  org_name: string;
  created_by_email: string | null;
  credit_grant_id: string | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: string;
  amount: number;
  currency: string;
  date: number;
  pdf: string | null;
}

export interface Document {
  id: string;
  type: 'contrat' | 'devis' | 'zip_offboarding' | 'autre';
  filename: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:  <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Upload multipart (le Content-Type est posé par le navigateur) */
  upload: async <T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', file);
    const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  },
};
