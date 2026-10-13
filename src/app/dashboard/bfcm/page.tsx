import { Suspense } from 'react';
import BfcmContent from './BfcmContent';

export default function BfcmPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 bg-gray-50 rounded-2xl" />}>
      <BfcmContent />
    </Suspense>
  );
}
