import { Suspense } from 'react';
import InsightsContent from './InsightsContent';

export default function InsightsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 bg-gray-50 rounded-2xl" />}>
      <InsightsContent />
    </Suspense>
  );
}
