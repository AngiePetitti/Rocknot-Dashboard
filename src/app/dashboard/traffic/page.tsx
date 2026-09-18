import { Suspense } from 'react';
import TrafficContent from './TrafficContent';

export default function TrafficPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <TrafficContent />
    </Suspense>
  );
}
