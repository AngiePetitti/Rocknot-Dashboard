import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { marketplaceByKey } from '@/src/lib/client';
import ChannelContent from './ChannelContent';

export default function ChannelPage({ params }: { params: { key: string } }) {
  const channel = marketplaceByKey(params.key);
  if (!channel) notFound();
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <ChannelContent channelKey={params.key} />
    </Suspense>
  );
}
