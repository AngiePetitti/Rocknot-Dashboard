'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { TIMEFRAMES } from '@/src/lib/utils';

export default function TimeframeSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get('tf') || '30d';

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tf', value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {TIMEFRAMES.map(tf => (
        <button
          key={tf.value}
          onClick={() => handleChange(tf.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            current === tf.value
              ? 'bg-violet-400 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
