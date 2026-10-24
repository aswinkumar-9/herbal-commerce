import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// Argon2id (the library default) with the OWASP minimum settings:
// 19 MiB of memory, 2 passes, 1 lane.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  // A real hash of a random value, made on first use and then reused.
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      // A malformed stored hash is treated as a mismatch, never as an error.
      return false;
    }
  }

  // Does the same work as verify() and always answers false. Used when there
  // is no account to check, so unknown emails take as long as real ones.
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
