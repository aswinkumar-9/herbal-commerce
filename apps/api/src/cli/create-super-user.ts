import { NestFactory } from '@nestjs/core';
import { superUserSchema } from '../staff/staff.schemas';
import { SuperUserService } from '../staff/super-user.service';
import { CliModule } from './cli.module';

// Creates a Super User (ADR 0004): developers only, never through the API.
// Reads SUPER_USER_EMAIL, SUPER_USER_NAME and SUPER_USER_PASSWORD from the
// environment, so the password never appears on the command line.
async function main(): Promise<void> {
  const parsed = superUserSchema.safeParse({
    email: process.env.SUPER_USER_EMAIL,
    fullName: process.env.SUPER_USER_NAME,
    password: process.env.SUPER_USER_PASSWORD,
  });
  if (!parsed.success) {
    // Field names and rules only, never the values.
    for (const issue of parsed.error.issues) {
      console.error(`${issue.path.join('.')}: ${issue.message}`);
    }
    console.error(
      'Set SUPER_USER_EMAIL, SUPER_USER_NAME and SUPER_USER_PASSWORD first (see README).',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const { id } = await app.get(SuperUserService).create(parsed.data);
    console.log(`Super User created: ${parsed.data.email} (id ${id}).`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Could not create the Super User: ${reason}`);
  process.exitCode = 1;
});
