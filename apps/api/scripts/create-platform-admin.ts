// Creates the platform admin (you). Run once on the server:
//   pnpm --filter api admin:create <username> ["Full Name"]
// It shows a QR code to scan with an authenticator app (Google Authenticator, Authy, ...), asks for
// the first 6-digit code to prove the scan worked, and only then saves the account.
// Everything secret (temporary password, recovery codes) is shown ONCE on this screen.
import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import QRCode from 'qrcode';
import { PasswordService } from '../src/auth/password.service.js';
import { TotpService } from '../src/auth/totp.service.js';
import { TEMP_PASSWORD_TTL_DAYS } from '../src/auth/auth.constants.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const username = (process.argv[2] ?? '').trim().toLowerCase();
const fullName = (process.argv[3] ?? 'Platform Admin').trim();

if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
  console.error('Usage: pnpm --filter api admin:create <username> ["Full Name"]');
  console.error('Username: 3-32 characters, lowercase letters, digits, _ . -');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const passwords = new PasswordService();
const totp = new TotpService();

async function main() {
  if (await prisma.user.findUnique({ where: { username } })) {
    throw new Error(`The username "${username}" already exists.`);
  }

  const secret = totp.newSecret();
  console.log('\n1) Open your authenticator app and scan this QR code:\n');
  console.log(await QRCode.toString(totp.uri(secret, username), { type: 'terminal', small: true }));
  console.log(`   Can't scan? Enter this key manually: ${secret}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let confirmed = false;
  for (let attempt = 1; attempt <= 3 && !confirmed; attempt++) {
    const code = (await rl.question('2) Enter the 6-digit code shown in the app: ')).trim();
    confirmed = totp.verify(secret, code) !== null;
    if (!confirmed) console.log('   That code is not right. Try again.');
  }
  rl.close();
  if (!confirmed) throw new Error('Could not confirm the code. Nothing was saved.');

  const temporaryPassword = passwords.generateTemporary();
  const recoveryCodes = totp.newRecoveryCodes();
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        username,
        fullName,
        role: 'PLATFORM_ADMIN',
        passwordHash: await passwords.hash(temporaryPassword),
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000),
        totpSecret: totp.encrypt(secret),
        totpEnabledAt: new Date(),
      },
    });
    await tx.recoveryCode.createMany({
      data: recoveryCodes.map((c) => ({ userId: u.id, codeHash: totp.hashRecoveryCode(c) })),
    });
    await tx.auditLog.create({
      data: { actorUserId: u.id, action: 'PLATFORM_ADMIN_CREATED', entityType: 'User', entityId: u.id },
    });
    return u;
  });

  console.log(`\nDone. Platform admin "${user.username}" created.\n`);
  console.log(`  Temporary password (change it at first login, valid ${TEMP_PASSWORD_TTL_DAYS} days):`);
  console.log(`    ${temporaryPassword}\n`);
  console.log('  Recovery codes (each works once, use them if you lose your phone).');
  console.log('  Save them somewhere safe NOW, they are never shown again:');
  for (const c of recoveryCodes) console.log(`    ${c}`);
  console.log('');
}

main()
  .catch((e: unknown) => {
    console.error('\n' + (e instanceof Error ? e.message : String(e)));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
