import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Tests the database wall directly, with plain SQL, as the restricted fikra_app role.
// This proves PostgreSQL itself refuses cross-clinic access, whatever the API code does.
describe('Row Level Security (database level)', () => {
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const app = new pg.Pool({ connectionString: process.env.TENANT_DATABASE_URL });
  const tag = randomUUID().slice(0, 8);
  let noor = '';
  let amal = '';
  let noorPatient = '';
  let amalPatient = '';

  // Runs SQL as fikra_app inside a transaction with the clinic set, like the API does.
  async function asClinic<T>(clinicId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      if (clinicId) await c.query(`SELECT set_config('app.clinic_id', $1, true)`, [clinicId]);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    noor = (await owner.query(`INSERT INTO "Clinic"(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`rls-noor-${tag}`])).rows[0].id;
    amal = (await owner.query(`INSERT INTO "Clinic"(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [`rls-amal-${tag}`])).rows[0].id;
    noorPatient = (await owner.query(`INSERT INTO "Patient"(id, "clinicId", "fullName", phone, "updatedAt") VALUES (gen_random_uuid(), $1, 'n', '+970599000001', now()) RETURNING id`, [noor])).rows[0].id;
    amalPatient = (await owner.query(`INSERT INTO "Patient"(id, "clinicId", "fullName", phone, "updatedAt") VALUES (gen_random_uuid(), $1, 'a', '+970599000002', now()) RETURNING id`, [amal])).rows[0].id;
  }, 30_000);

  afterAll(async () => {
    await owner.query(`DELETE FROM "Patient" WHERE "clinicId" = ANY($1)`, [[noor, amal]]);
    await owner.query(`DELETE FROM "Clinic" WHERE id = ANY($1)`, [[noor, amal]]);
    await owner.end();
    await app.end();
  });

  it('sees NOTHING when no clinic is set (fails closed)', async () => {
    const r = await asClinic(null, (c) => c.query(`SELECT id FROM "Patient"`));
    expect(r.rowCount).toBe(0);
  });

  it('sees only its own clinic rows, even with a query that has no WHERE', async () => {
    const r = await asClinic(noor, (c) => c.query(`SELECT id FROM "Patient"`));
    expect(r.rows.map((x) => x.id)).toEqual([noorPatient]);
    const r2 = await asClinic(amal, (c) => c.query(`SELECT id FROM "Patient"`));
    expect(r2.rows.map((x) => x.id)).toEqual([amalPatient]);
  });

  it('cannot read another clinic row even by its exact id', async () => {
    const r = await asClinic(noor, (c) => c.query(`SELECT id FROM "Patient" WHERE id = $1`, [amalPatient]));
    expect(r.rowCount).toBe(0);
  });

  it('cannot update or delete another clinic row', async () => {
    const u = await asClinic(noor, (c) => c.query(`UPDATE "Patient" SET "fullName" = 'hijacked' WHERE id = $1`, [amalPatient]));
    expect(u.rowCount).toBe(0);
    const row = await owner.query(`SELECT "fullName" FROM "Patient" WHERE id = $1`, [amalPatient]);
    expect(row.rows[0].fullName).toBe('a');
  });

  it('cannot insert a row for another clinic', async () => {
    await expect(
      asClinic(noor, (c) =>
        c.query(`INSERT INTO "Patient"(id, "clinicId", "fullName", phone, "updatedAt") VALUES (gen_random_uuid(), $1, 'x', '+970599000003', now())`, [amal]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot move its own row to another clinic', async () => {
    await expect(
      asClinic(noor, (c) => c.query(`UPDATE "Patient" SET "clinicId" = $1 WHERE id = $2`, [amal, noorPatient])),
    ).rejects.toThrow(/row-level security/);
  });

  it('setting does not leak to the next transaction on a reused connection', async () => {
    await asClinic(noor, (c) => c.query(`SELECT 1`));
    const r = await asClinic(null, (c) => c.query(`SELECT id FROM "Patient"`));
    expect(r.rowCount).toBe(0);
  });

  it('cannot hard-delete payments, patients, doctors or users; audit log is append-only', async () => {
    for (const sql of [
      `DELETE FROM "Payment"`,
      `DELETE FROM "Patient"`,
      `DELETE FROM "Doctor"`,
      `DELETE FROM "User"`,
      `UPDATE "AuditLog" SET action = 'x'`,
      `DELETE FROM "AuditLog"`,
    ]) {
      await expect(asClinic(noor, (c) => c.query(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('has no access at all to Clinic and RefreshToken', async () => {
    await expect(asClinic(noor, (c) => c.query(`SELECT * FROM "Clinic"`))).rejects.toThrow(/permission denied/);
    await expect(asClinic(noor, (c) => c.query(`SELECT * FROM "RefreshToken"`))).rejects.toThrow(/permission denied/);
  });

  it('every table with a clinicId column is protected (guards against forgetting RLS on new tables)', async () => {
    const schema = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');
    const tenantTables = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter((m) => /^\s*clinicId\s+String/m.test(m[2] ?? ''))
      .map((m) => m[1]);
    const rows = (await owner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = 'tenant_isolation'
       WHERE c.relrowsecurity AND c.relnamespace = 'public'::regnamespace`,
    )).rows.map((r) => r.relname);
    expect(rows.sort()).toEqual([...tenantTables].sort());
  });
});
