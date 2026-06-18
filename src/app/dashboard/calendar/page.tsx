import { Suspense } from 'react';
import CalendarContent from './CalendarContent';

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="animate-pulse h-96 bg-gray-50 rounded-2xl" />}>
      <CalendarContent />
    </Suspense>
  );
}
