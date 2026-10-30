import type { UserRole } from '../generated/prisma/client';

// Who an access token says is calling. Only IDs: anyone holding the token can
// read it, so no email, name or role goes in.
export interface TokenSubject {
  // The user's ID (the token's subject).
  id: string;
  // The session (one sign-in on one device) the token belongs to.
  sessionId: string;
}

// The signed-in caller, as the access-token guard attaches it to the request.
// The role is read from the database on every request, never from the token,
// so a role change takes effect at once.
export interface AuthUser extends TokenSubject {
  role: UserRole;
}
