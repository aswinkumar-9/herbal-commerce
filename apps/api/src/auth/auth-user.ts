// Who is calling, according to a verified access token.
export interface AuthUser {
  // The user's ID (the token's subject).
  id: string;
  // The session (one sign-in on one device) the token belongs to.
  sessionId: string;
}
