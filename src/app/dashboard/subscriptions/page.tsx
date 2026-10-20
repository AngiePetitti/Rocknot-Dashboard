import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getClient } from '@/src/lib/client';
import SubscriptionsContent from './SubscriptionsContent';

export default function SubscriptionsPage() {
  if (!getClient().subscriptions) notFound();
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <SubscriptionsContent />
    </Suspense>
  );
}
