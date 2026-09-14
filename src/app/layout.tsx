import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import { getClient } from '@/src/lib/client';

// Resolve the client profile per request (from env) rather than baking it
// into prerendered HTML at build time — a build without CLIENT set must
// never brand a deployment as the wrong client.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const c = getClient();
  return {
    title: `${c.name} Dashboard`,
    description: `${c.name} eCommerce Analytics Dashboard`,
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = getClient();
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased"><Providers profile={profile}>{children}</Providers></body>
    </html>
  );
}
