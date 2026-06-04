import { Suspense } from 'react';
import ReturnsContent from './ReturnsContent';

export default function ReturnsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <ReturnsContent />
    </Suspense>
  );
}
