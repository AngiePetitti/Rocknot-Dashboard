import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';

export const dynamic = 'force-dynamic';

// Admin-only. Enforced server-side (not just hidden in the nav) so the P&L data
// that will live here can never be fetched by a non-admin.
export default async function FinancialsPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = !authConfigured() || session?.user?.role === 'admin';

  if (!isAdmin) {
    return (
      <div>
        <Header title="Financials" subtitle="Restricted" />
        <Card accentColor="#fca5a5">
          <p className="text-sm text-gray-600 py-6 text-center">
            🔒 This section is restricted to admins. If you need access to the P&amp;L, ask an admin to update your role.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Header title="Financials" subtitle="P&L · admin only" />
      <Card accentColor="#86efac">
        <p className="text-sm text-gray-500 py-6 text-center">
          Your P&amp;L will live here — visible only to admins. Tell me how you want it structured
          (revenue, COGS, ad spend, opex, net) and where the numbers come from, and I&apos;ll build it out.
        </p>
      </Card>
    </div>
  );
}
