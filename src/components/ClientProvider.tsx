'use client';

import { createContext, useContext } from 'react';
import { CLIENTS, type ClientProfile } from '@/src/lib/client';

// The root layout (a server component) resolves the active client from env
// and hands the profile to every client component through this context.
const ClientContext = createContext<ClientProfile>(CLIENTS.kaileep);

export function ClientProvider({ profile, children }: { profile: ClientProfile; children: React.ReactNode }) {
  return <ClientContext.Provider value={profile}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientProfile {
  return useContext(ClientContext);
}
