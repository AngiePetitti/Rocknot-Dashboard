import type { NextAuthOptions } from 'next-auth';
import Google from 'next-auth/providers/google';

export type Role = 'admin' | 'team';

function list(name: string): string[] {
  return (process.env[name] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

// Role from the email allowlist. Admins see everything (incl. financials);
// team members see everything except the Financials/P&L area. Anyone not on
// either list is denied at sign-in.
export function roleFor(email?: string | null): Role | null {
  const e = (email || '').toLowerCase().trim();
  if (!e) return null;
  if (list('AUTH_ADMINS').includes(e)) return 'admin';
  if (list('AUTH_MEMBERS').includes(e)) return 'team';
  return null;
}

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
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    // Only allow-listed emails may sign in.
    async signIn({ user }) {
      return roleFor(user.email) !== null;
    },
    async jwt({ token }) {
      token.role = roleFor(token.email as string | undefined) ?? undefined;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = (token.role as Role | undefined);
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
