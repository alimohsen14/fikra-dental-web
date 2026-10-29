import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lastValueFrom, defer } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { getTenantClinicId } from './tenant-context.js';
import { TenantInterceptor } from './tenant.interceptor.js';
import { scopeArgs, TENANT_MODELS } from './tenant-scope.js';

const A = 'clinic-a';

describe('scopeArgs', () => {
  it('adds the clinic to list queries, keeping the caller filter', () => {
    const out = scopeArgs('findMany', { where: { fullName: 'x' } }, A);
    expect(out.where).toEqual({ AND: [{ fullName: 'x' }, { clinicId: A }] });
    expect(scopeArgs('findMany', undefined, A).where).toEqual({ AND: [{}, { clinicId: A }] });
  });

  it('cannot be bypassed by a clinicId in the caller filter', () => {
    const out = scopeArgs('findMany', { where: { clinicId: 'clinic-b' } }, A);
    expect(out.where).toEqual({ AND: [{ clinicId: 'clinic-b' }, { clinicId: A }] }); // matches nothing
  });

  it('pins unique lookups, updates and deletes to the clinic', () => {
    for (const op of ['findUnique', 'findUniqueOrThrow', 'update', 'delete']) {
      const out = scopeArgs(op, { where: { id: '1', clinicId: 'clinic-b' }, data: {} }, A);
      expect(out.where).toEqual({ id: '1', clinicId: A });
    }
  });

  it('forces clinicId on create, overwriting what the caller sent', () => {
    const out = scopeArgs('create', { data: { fullName: 'x', clinicId: 'clinic-b' } }, A);
    expect(out.data).toEqual({ fullName: 'x', clinicId: A });
  });

  it('handles createMany with an array', () => {
    const out = scopeArgs('createMany', { data: [{ n: 1 }, { n: 2, clinicId: 'clinic-b' }] }, A);
    expect(out.data).toEqual([{ n: 1, clinicId: A }, { n: 2, clinicId: A }]);
  });

  it('handles upsert', () => {
    const out = scopeArgs('upsert', { where: { id: '1' }, create: { n: 1 }, update: { n: 2 } }, A);
    expect(out.where).toEqual({ id: '1', clinicId: A });
    expect(out.create).toEqual({ n: 1, clinicId: A });
  });

  it('refuses to move rows to another clinic on update', () => {
    expect(() => scopeArgs('update', { where: { id: '1' }, data: { clinicId: 'b' } }, A)).toThrow();
    expect(() => scopeArgs('updateMany', { data: { clinic: { connect: { id: 'b' } } } }, A)).toThrow();
    expect(() => scopeArgs('upsert', { where: {}, create: {}, update: { clinicId: 'b' } }, A)).toThrow();
  });

  it('refuses relation-style clinic on create', () => {
    expect(() => scopeArgs('create', { data: { clinic: { connect: { id: 'b' } } } }, A)).toThrow();
  });

  it('refuses unknown operations (fail closed)', () => {
    expect(() => scopeArgs('somethingNew', {}, A)).toThrow();
  });

  it('does not mutate the caller args', () => {
    const args = { where: { id: '1' } };
    scopeArgs('findMany', args, A);
    expect(args).toEqual({ where: { id: '1' } });
  });
});

describe('TENANT_MODELS', () => {
  it('matches exactly the models in schema.prisma that have a clinicId column', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
      'utf8',
    );
    const withClinicId = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter((m) => /^\s*clinicId\s+String/m.test(m[2] ?? ''))
      .map((m) => m[1]);
    expect([...TENANT_MODELS].sort()).toEqual(withClinicId.sort());
  });
});

describe('TenantInterceptor', () => {
  const interceptor = new TenantInterceptor();
  const ctx = (user?: object) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
  // Reads the clinic AFTER an await, like a real async handler does.
  const handler = { handle: () => defer(async () => { await Promise.resolve(); return getTenantClinicId(); }) };

  it('keeps the clinic available inside async handlers', async () => {
    expect(await lastValueFrom(interceptor.intercept(ctx({ clinicId: 'c1' }), handler))).toBe('c1');
  });

  it('gives null for platform admin / public routes', async () => {
    expect(await lastValueFrom(interceptor.intercept(ctx({ clinicId: null }), handler))).toBeNull();
    expect(await lastValueFrom(interceptor.intercept(ctx(), handler))).toBeNull();
  });

  it('does not leak between concurrent requests', async () => {
    const slow = { handle: () => defer(async () => { await new Promise((r) => setTimeout(r, 5)); return getTenantClinicId(); }) };
    const [x, y] = await Promise.all([
      lastValueFrom(interceptor.intercept(ctx({ clinicId: 'c1' }), slow)),
      lastValueFrom(interceptor.intercept(ctx({ clinicId: 'c2' }), slow)),
    ]);
    expect([x, y]).toEqual(['c1', 'c2']);
    expect(getTenantClinicId()).toBeNull();
  });
});
