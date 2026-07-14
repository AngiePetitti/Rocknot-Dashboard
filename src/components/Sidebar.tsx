'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '📊' },
  { href: '/dashboard/ads', label: 'Ad Performance', icon: '🎯' },
  { href: '/dashboard/creatives', label: 'Creative Analysis', icon: '🎨' },
  { href: '/dashboard/products', label: 'Top Products', icon: '📦' },
  { href: '/dashboard/customers', label: 'Customer Intel', icon: '👥' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: '🏭' },
  { href: '/dashboard/returns', label: 'Returns', icon: '↩️' },
  { href: '/dashboard/attribution', label: 'Attribution', icon: '🔗' },
  { href: '/dashboard/calendar', label: 'Marketing Calendar', icon: '📅' },
  { href: '/dashboard/insights', label: 'AI Insights', icon: '✦' },
  // Admin-only — filtered below by role.
  { href: '/dashboard/financials', label: 'Financials', icon: '💰', adminOnly: true },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tf = searchParams.get('tf') || '30d';
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  // Hide admin-only items unless the user is an admin. When auth isn't wired up
  // (unauthenticated session), show everything so the pre-auth site is intact.
  const visibleNav = navItems.filter(i => !i.adminOnly || isAdmin || status === 'unauthenticated');

  function buildHref(href: string) {
    return `${href}?tf=${tf}`;
  }

  return (
    <aside
      className={`
        fixed md:static inset-y-0 left-0 z-30
        w-60 shrink-0 bg-white border-r border-gray-100 min-h-screen flex flex-col
        transition-transform duration-200 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
    >
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-none">Rocknot</p>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">Dashboard</p>
          </div>
        </div>
        {/* Close button — mobile only */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
            aria-label="Close menu"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visibleNav.map(item => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={buildHref(item.href)}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-violet-50 text-violet-700'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer — signed-in user + sign out (only when authenticated) */}
      {session?.user && (
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">
              {(session.user.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-700 truncate">{session.user.email}</p>
              <p className="text-[10px] text-gray-400 capitalize">{session.user.role || 'team'}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              title="Sign out"
              className="text-[11px] text-gray-400 hover:text-gray-700 font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
      <div className="px-5 py-3 border-t border-gray-100">
        <p className="text-[10px] text-gray-300 leading-relaxed">Rocknot Analytics v1.0 · Windsor.ai</p>
      </div>
    </aside>
  );
}
