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
