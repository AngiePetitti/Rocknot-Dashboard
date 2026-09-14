'use client';
import { SessionProvider } from 'next-auth/react';
import { ClientProvider } from '@/src/components/ClientProvider';
import type { ClientProfile } from '@/src/lib/client';

export default function Providers({ profile, children }: { profile: ClientProfile; children: React.ReactNode }) {
  return (
    <ClientProvider profile={profile}>
      <SessionProvider>{children}</SessionProvider>
    </ClientProvider>
  );
}
