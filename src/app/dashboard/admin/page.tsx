import { getServerSession } from 'next-auth';
import { authOptions, authConfigured } from '@/src/lib/auth';
import Header from '@/src/components/Header';
import Card from '@/src/components/ui/Card';
import AdminUsers from './AdminUsers';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = !authConfigured() || session?.user?.role === 'admin';

  if (!isAdmin) {
    return (
      <div>
        <Header title="Team & Access" subtitle="Restricted" />
        <Card accentColor="#fca5a5">
          <p className="text-sm text-gray-600 py-6 text-center">🔒 Only admins can manage access.</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Header title="Team & Access" subtitle="Who can sign in and what they can see" />
      <AdminUsers currentEmail={session?.user?.email ?? ''} />
    </div>
  );
}
