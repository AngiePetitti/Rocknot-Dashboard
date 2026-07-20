import type { Role } from '@/src/lib/auth';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: Role;
    };
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    // null = allowlist re-check found the user removed (middleware rejects);
    // undefined = not yet checked.
    role?: Role | null;
    roleCheckedAt?: number;
  }
}
