import { Suspense } from 'react';
import CreativesContent from './CreativesContent';

export default function CreativesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <CreativesContent />
    </Suspense>
  );
}
