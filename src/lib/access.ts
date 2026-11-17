// Who may open what. Kept dependency-free so the edge middleware can import it.
//
//   admin   — everything, including Financials and Team & Access.
//   team    — everything except the admin-only tabs.
//   partner — an outside vendor (e.g. the ads agency): a read-only slice that
//             shows how the ads perform against the company's goals and
//             nothing else. Enforced server-side: pages AND the API routes
//             behind them, so hidden tabs' data is never sent to the browser.
//   sales   — an outside wholesale sales team (e.g. a showroom): only the
//             Showroom tabs (their own orders and pending drafts). Enforced
//             server-side the same way as partner.
export type Role = 'admin' | 'team' | 'partner' | 'sales';

export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', team: 'Team', partner: 'Partner (agency)', sales: 'Sales (showroom)' };
export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including Financials and Team & Access.',
  team: 'Every tab except Financials and Team & Access.',
  sales: 'Showroom tabs only: their orders and pending draft orders. No store sales, ads, customers, financials or AI.',
  partner: 'Overview (ads view), Ad Performance, Attribution and Traffic only. No customers, retention, products, inventory, returns, financials, goals, tasks, AI or marketplace tabs.',
};

/** Pages a partner may open (exact match after trailing-slash trim). */
export const PARTNER_PAGES = ['/', '/dashboard', '/dashboard/ads', '/dashboard/attribution', '/dashboard/traffic'];

/** API routes a partner's pages need (exact match). Everything else is 403. */
export const PARTNER_APIS = [
  '/api/windsor',             // Overview totals (sanitised for partners, see /api/windsor)
  '/api/windsor/ads',         // Ad Performance platforms
  '/api/windsor/creatives',   // Ad Performance creatives table
  '/api/windsor/reconcile',   // ad-data health banner
  '/api/windsor/attribution', // Attribution tab
  '/api/traffic',             // Traffic tab
];

export function partnerCanOpen(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p.startsWith('/api/auth') || p.startsWith('/login')) return true;
  if (p.startsWith('/api/')) return PARTNER_APIS.includes(p);
  return PARTNER_PAGES.includes(p);
}

export function isPartner(role: string | null | undefined): boolean {
  return role === 'partner';
}

/** Pages and API routes a sales (showroom) login may open: the Showroom tabs and nothing else. */
export function salesCanOpen(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p.startsWith('/api/auth') || p.startsWith('/login')) return true;
  return p.startsWith('/dashboard/showroom/') || p.startsWith('/api/showroom/');
}

/** Any stored or submitted role string → a Role (unknown values are 'team'). */
export function normalizeRole(raw: string | null | undefined): Role {
  const r = (raw || '').toLowerCase().trim();
  return r === 'admin' ? 'admin' : r === 'partner' ? 'partner' : r === 'sales' ? 'sales' : 'team';
}

/** True for logins that see a fixed slice of the dashboard (no Cleo, tasks or alerts). */
export function isRestricted(role: string | null | undefined): boolean {
  return role === 'partner' || role === 'sales';
}
