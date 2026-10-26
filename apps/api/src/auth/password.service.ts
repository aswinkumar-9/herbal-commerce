import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ConcurrencyLimit } from '../common/concurrency-limit';

// Argon2id (the library default) with the OWASP minimum settings:
// 19 MiB of memory, 2 passes, 1 lane.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Node runs argon2 on its small pool of worker threads (4 by default). At
// most 2 hashes run at once, so a burst of logins cannot starve the rest of
// the API; up to 50 more wait their turn, beyond that: 503 SERVER_BUSY.
const MAX_HASHING = 2;
const MAX_WAITING = 50;

@Injectable()
export class PasswordService {
  private readonly slots = new ConcurrencyLimit(MAX_HASHING, MAX_WAITING);
  // A real hash of a random value, made on first use and then reused.
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return this.slots.run(() => hash(password, ARGON2_OPTIONS));
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return this.slots.run(async () => {
      try {
        return await verify(passwordHash, password);
      } catch {
        // A malformed stored hash is treated as a mismatch, never as an error.
        // (Inside the task, so "server busy" is never mistaken for a mismatch.)
        return false;
      }
    });
  }

  // Does the same work as verify() and always answers false. Used when there
  // is no account to check, so unknown emails take as long as real ones.
  async verifyDummy(password: string): Promise<false> {
    // If making the dummy hash was refused (server busy), try again next time.
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url')).catch(
      (error: unknown) => {
        this.dummyHash = undefined;
        throw error;
      },
    );
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
