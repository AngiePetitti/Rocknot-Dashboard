import { Suspense } from 'react';
import RetentionContent from './RetentionContent';

export default function RetentionPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <RetentionContent />
    </Suspense>
  );
}
