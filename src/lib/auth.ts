import type { NextAuthOptions } from 'next-auth';
import Google from 'next-auth/providers/google';
import { roleFor } from '@/src/lib/users';

import type { Role } from '@/src/lib/access';
export type { Role };

// Auth only enforces once the Google credentials + secret exist — so shipping
// this code never locks out the live site before it's configured.
export function authConfigured(): boolean {
  return Boolean(
    (process.env.NEXTAUTH_SECRET || '').trim() &&
    (process.env.GOOGLE_CLIENT_ID || '').trim() &&
    (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  );
}

// Hard limit: everyone signs in again 30 days after their last Google sign-in,
// however active they are. (NextAuth's maxAge alone slides forward with use.)
export const SIGN_IN_MAX_AGE_S = 60 * 60 * 24 * 30;
export const signInExpired = (signedInAt: unknown, now = Math.floor(Date.now() / 1000)) =>
  typeof signedInAt === 'number' && now - signedInAt > SIGN_IN_MAX_AGE_S;

export const authOptions: NextAuthOptions = {
  providers: [
    Google({
      // Trimmed: a pasted value with a stray space or line break makes Google
      // answer 'OAuth client was not found'.
      clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
      // Always show Google's account chooser so people can pick which account
      // to sign in with, instead of being forced into the currently-active one.
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  // 30-day sessions so devices stay signed in. Safe because the jwt callback
  // re-validates the role every 15 minutes (below) and the middleware rejects
  // tokens whose role has been revoked — a removed user loses access within
  // minutes of active use, not after 30 days.
  session: { strategy: 'jwt', maxAge: SIGN_IN_MAX_AGE_S },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only allow-listed emails may sign in.
    async signIn({ user }) {
      return (await roleFor(user.email)) !== null;
    },
    async jwt({ token, user }) {
      const now = Math.floor(Date.now() / 1000);
      // Start the 30-day clock at sign-in (sessions from before this rule
      // start it at their next request). Past it, the session is dead: the
      // middleware sends them back to the sign-in page.
      if (user || typeof token.signedInAt !== 'number') token.signedInAt = now;
      // A fresh sign-in always re-checks the role (clears an expired session's lock-out).
      if (user) token.roleCheckedAt = 0;
      if (signInExpired(token.signedInAt, now)) { token.role = null; return token; }
      // Re-validate the role at most every 15 minutes. If the lookup fails
      // (Sheets hiccup), keep the last known role rather than locking out.
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
