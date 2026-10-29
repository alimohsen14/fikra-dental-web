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
