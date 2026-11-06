// Central place to read secrets/settings. Fails fast at startup instead of at the first login.
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Check apps/api/.env');
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (secret.length < 32 || secret.startsWith('change-me'))) {
    throw new Error('JWT_SECRET is too weak for production (need 32+ random chars).');
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

// Comma-separated list of allowed web origins, e.g. "https://app.example.com".
export function getCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

// 32 random bytes (base64) used to encrypt two-factor secrets in the database.
// Generate one with: openssl rand -base64 32
export function getTotpKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('TOTP_ENCRYPTION_KEY is not set. Check apps/api/.env');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)');
  }
  return key;
}

// Where uploaded files (clinic logos) are stored. Must be a persistent disk/volume in production.
export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? './uploads';
}

// How long before an appointment the WhatsApp confirmation goes out. An appointment booked with LESS than this
// left is confirmed straight away; one booked earlier waits as PENDING until the message is sent and answered.
// 0 turns the whole rule off (used by tests).
export function getConfirmWindowHours(): number {
  const raw = process.env.AUTO_CONFIRM_WINDOW_HOURS;
  if (raw === undefined || raw.trim() === '') return 48;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error('AUTO_CONFIRM_WINDOW_HOURS must be a number of hours (0 turns it off)');
  return n;
}

// "dummy" records messages without sending anything. "meta" (WhatsApp Cloud API) comes with the real connection.
export function getWhatsappProvider(): string {
  return process.env.WHATSAPP_PROVIDER ?? 'dummy';
}

// The background sender runs once a minute. Tests switch it off and call it directly.
export function isMessageSchedulerOn(): boolean {
  return (process.env.MESSAGE_SCHEDULER ?? 'on') !== 'off';
}

/** Where the booking page lives; the WhatsApp reply links to it. */
export function getPublicWebUrl(): string {
  return (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}
