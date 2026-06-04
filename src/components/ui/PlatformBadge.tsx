import React from 'react';

const PLATFORM_COLORS: Record<string, string> = {
  Meta: '#1877F2',
  TikTok: '#000000',
  Google: '#4285F4',
  CTV: '#FF6B35',
  Shopify: '#96BF48',
  'Direct / Shopify': '#96BF48',
  'Email / SMS': '#c4b5fd',
};

interface PlatformBadgeProps {
  platform: string;
  size?: 'sm' | 'md';
}

export default function PlatformBadge({ platform, size = 'sm' }: PlatformBadgeProps) {
  const color = PLATFORM_COLORS[platform] || '#6b7280';
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${padding} text-white`}
      style={{ backgroundColor: color }}
    >
      {platform}
    </span>
  );
}
