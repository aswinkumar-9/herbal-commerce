// The key of the email + IP failed-login counter. Login counts and clears it,
// and a password reset clears it too, so both must build it the same way.
export function emailAndIpKey(email: string, ip: string): string {
  return `${ip}|${email}`;
}
