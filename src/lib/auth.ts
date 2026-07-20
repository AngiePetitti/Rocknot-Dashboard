import type { NextAuthOptions } from 'next-auth';
import Google from 'next-auth/providers/google';
import { roleFor } from '@/src/lib/users';

export type Role = 'admin' | 'team';

// Auth only enforces once the Google credentials + secret exist — so shipping
// this code never locks out the live site before it's configured.
export function authConfigured(): boolean {
  return Boolean(
    (process.env.NEXTAUTH_SECRET || '').trim() &&
    (process.env.GOOGLE_CLIENT_ID || '').trim() &&
    (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  );
}

export const authOptions: NextAuthOptions = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      // Always show Google's account chooser so people can pick which account
      // to sign in with, instead of being forced into the currently-active one.
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  // 30-day sessions so devices stay signed in. Safe because the jwt callback
  // re-validates the role every 15 minutes (below) and the middleware rejects
  // tokens whose role has been revoked — a removed user loses access within
  // minutes of active use, not after 30 days.
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only allow-listed emails may sign in.
    async signIn({ user }) {
      return (await roleFor(user.email)) !== null;
    },
    async jwt({ token }) {
      // Re-validate the role at most every 15 minutes. If the lookup fails
      // (Sheets hiccup), keep the last known role rather than locking out.
      const now = Math.floor(Date.now() / 1000);
      const checkedAt = (token.roleCheckedAt as number | undefined) ?? 0;
      if (token.role === undefined || now - checkedAt > 900) {
        try {
          token.role = (await roleFor(token.email as string | undefined)) ?? null;
          token.roleCheckedAt = now;
        } catch { /* transient lookup failure — keep existing role */ }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = (token.role as Role | null | undefined) ?? undefined;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
