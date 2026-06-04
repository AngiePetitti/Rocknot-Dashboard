import { Suspense } from 'react';
import AdsContent from './AdsContent';

export default function AdsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <AdsContent />
    </Suspense>
  );
}
