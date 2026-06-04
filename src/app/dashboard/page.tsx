import { Suspense } from 'react';
import OverviewContent from './OverviewContent';

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <OverviewContent />
    </Suspense>
  );
}
