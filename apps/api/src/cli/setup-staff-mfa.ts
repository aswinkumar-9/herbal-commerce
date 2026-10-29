import { createInterface } from 'node:readline/promises';
import { NestFactory } from '@nestjs/core';
import { email as emailRule } from '../auth/auth.schemas';
import { StaffMfaService } from '../staff/staff-mfa.service';
import { CliModule } from './cli.module';

const MAX_TRIES = 3;

// Groups a key in fours, so it is easier to type into an app.
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

// Sets up, or replaces, MFA for a staff member (ADR 0013). It shows a new key
// once, and saves it only when the authenticator app shows a valid code.
// Reads STAFF_EMAIL from the environment.
async function main(): Promise<void> {
  const parsed = emailRule.safeParse(process.env.STAFF_EMAIL);
  if (!parsed.success) {
    console.error("Set STAFF_EMAIL to the staff member's email address first (see README).");
    process.exitCode = 1;
    return;
  }
  const email = parsed.data;

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn'],
  });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const mfa = app.get(StaffMfaService);
    const { userId, secret, uri } = await mfa.beginSetup(email);

    console.log('\nIn the authenticator app, add an account and enter this key by hand:');
    console.log(`  Account: Herbal Commerce (${email})`);
    console.log(`  Key:     ${grouped(secret)}`);
    console.log('  Type:    time based (6 digits, every 30 seconds)');
    console.log(`\nThe same as a link, for apps that accept one:\n  ${uri}\n`);

    for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
      const answer = await prompt.question('Enter the 6-digit code the app shows now: ');
      if (await mfa.confirmSetup(userId, secret, answer.replace(/\s/g, ''))) {
        console.log(`\nMFA is set up for ${email}. Their sessions were ended.`);
        console.log('Now clear this window (Clear-Host): the key must not stay on screen.');
        return;
      }
      console.error(
        attempt < MAX_TRIES ? 'That code is not valid. Try the next one.' : 'That code is not valid.',
      );
    }
    console.error("Nothing was saved. Check that the phone's time is set automatically, then run the command again.");
    process.exitCode = 1;
  } finally {
    prompt.close();
    await app.close();
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Could not set up MFA: ${reason}`);
  process.exitCode = 1;
});
