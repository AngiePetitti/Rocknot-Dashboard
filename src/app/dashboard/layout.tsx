import { Suspense } from 'react';
import Sidebar from '@/src/components/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Suspense fallback={<div className="w-60 bg-white border-r border-gray-100" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
