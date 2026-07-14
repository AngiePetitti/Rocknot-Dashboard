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
  // 8-hour sessions so role changes / removals take effect within a workday
  // (or immediately on sign-out) without a per-request lookup.
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only allow-listed emails may sign in.
    async signIn({ user }) {
      return (await roleFor(user.email)) !== null;
    },
    async jwt({ token }) {
      token.role = (await roleFor(token.email as string | undefined)) ?? undefined;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = (token.role as Role | undefined);
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
