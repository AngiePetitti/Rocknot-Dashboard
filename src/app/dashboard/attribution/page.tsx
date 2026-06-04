import { Suspense } from 'react';
import AttributionContent from './AttributionContent';

export default function AttributionPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <AttributionContent />
    </Suspense>
  );
}
