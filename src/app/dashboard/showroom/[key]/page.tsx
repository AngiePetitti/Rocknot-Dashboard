import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { showroomByKey } from '@/src/lib/client';
import ShowroomContent from './ShowroomContent';

export default function ShowroomPage({ params }: { params: { key: string } }) {
  if (!showroomByKey(params.key)) notFound();
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <ShowroomContent showroomKey={params.key} />
    </Suspense>
  );
}
