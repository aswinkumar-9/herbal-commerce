// What the account forms check before asking the API (part 14B, ADR 0041),
// and how they say it. The API checks everything again; these spare the
// customer a trip and say it beside the field, in the shop's words.
import { text } from './text/en.ts';

const words = text.forms;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A token from an email link, as the API makes them (43 characters of
// base64url in practice).
const EMAILED_TOKEN = /^[\w-]{20,200}$/;

// What a field holds: always a string, never a file.
export function given(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function emailProblem(email: string): string | undefined {
  if (!email) {
    return words.emailMissing;
  }
  return email.length > 254 || !EMAIL.test(email)
    ? words.emailWrong
    : undefined;
}

// A password being chosen: the rules for signing up and for a reset.
export function newPasswordProblem(password: string): string | undefined {
  if (!password) {
    return words.newPasswordMissing;
  }
  if (password.length < 10) {
    return words.newPasswordShort;
  }
  return password.length > 128 ? words.passwordLong : undefined;
}

export function nameProblem(name: string): string | undefined {
  if (!name) {
    return words.nameMissing;
  }
  return name.length > 100 ? words.nameLong : undefined;
}

export function looksLikeEmailedToken(token: unknown): token is string {
  return typeof token === 'string' && EMAILED_TOKEN.test(token);
}

// "Please wait 5 minutes": the API's own figure when it gave one.
export function tooMany(retryAfter: number | undefined): string {
  return words.tooMany(waitFor(retryAfter ?? 60));
}

export function waitFor(seconds: number): string {
  return seconds >= 120
    ? words.minutes(Math.ceil(seconds / 60))
    : words.seconds(Math.max(1, seconds));
}
