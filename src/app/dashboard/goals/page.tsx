import { Suspense } from 'react';
import GoalsContent from './GoalsContent';

export default function GoalsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 bg-gray-50 rounded-2xl" />}>
      <GoalsContent />
    </Suspense>
  );
}
