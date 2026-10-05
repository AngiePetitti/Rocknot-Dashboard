import { Suspense } from 'react';
import OrganicContent from './OrganicContent';

export default function OrganicPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <OrganicContent />
    </Suspense>
  );
}
