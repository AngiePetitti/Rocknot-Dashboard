import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { showrooms } from '@/src/lib/client';
import ReleaseContent from './ReleaseContent';

export default function WholesaleReleasePage() {
  if (!showrooms().length) notFound();
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <ReleaseContent />
    </Suspense>
  );
}
