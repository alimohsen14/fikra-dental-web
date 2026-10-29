import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies', async () => {
    const hash = await svc.hash('S0me-Strong-Pass');
    expect(hash).not.toContain('S0me-Strong-Pass');
    expect(await svc.verify('S0me-Strong-Pass', hash)).toBe(true);
    expect(await svc.verify('wrong', hash)).toBe(false);
  });

  it('rejects weak passwords', () => {
    expect(svc.validatePolicy('short', 'ali')).not.toBeNull();
    expect(svc.validatePolicy('password1', 'ali')).not.toBeNull();
    expect(svc.validatePolicy('aaaaaaaaaaaa', 'ali')).not.toBeNull();
    expect(svc.validatePolicy('mohsen-ali-2026', 'mohsen-ali-2026')).not.toBeNull();
  });

  it('accepts a reasonable password', () => {
    expect(svc.validatePolicy('Tr1cky-Horse-9', 'ali')).toBeNull();
  });

  it('generates random temporary passwords that satisfy the policy', () => {
    const a = svc.generateTemporary();
    const b = svc.generateTemporary();
    expect(a).toHaveLength(14);
    expect(a).not.toBe(b);
    expect(svc.validatePolicy(a, 'ali')).toBeNull();
  });
});
