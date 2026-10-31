// Pure functions (no database needed) that rewrite Prisma query arguments so they can only
// touch one clinic's rows. Kept separate so they can be unit-tested.

// Every model that has a clinicId column. A test checks this list against schema.prisma.
export const TENANT_MODELS = new Set([
  'User',
  'ClinicWhatsapp',
  'Doctor',
  'DoctorWorkingPeriod',
  'Patient',
  'Appointment',
  'MessageLog',
  'TreatmentType',
  'Treatment',
  'TreatmentTooth',
  'Session',
  'Payment',
  'AuditLog',
  'SubscriptionPeriod',
  'SubscriptionPayment',
]);

type Args = Record<string, unknown>;

// Operations that take a free-form filter: we AND the clinic condition onto it.
const FILTER_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
// Operations that target one row by a unique key: we add clinicId next to the key.
const UNIQUE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

function forbidMovingRows(data: unknown): void {
  if (data && typeof data === 'object' && ('clinicId' in data || 'clinic' in data)) {
    throw new Error('clinicId cannot be set or changed on update');
  }
}

function forbidRelationStyleCreate(data: unknown): void {
  if (data && typeof data === 'object' && 'clinic' in data) {
    throw new Error('Use scalar ids when creating; the clinic is set automatically');
  }
}

function withClinic(data: unknown, clinicId: string): Args {
  forbidRelationStyleCreate(data);
  // Our clinicId goes last, so a clinicId sent by the caller is always overwritten.
  return { ...(data as Args), clinicId };
}

export function scopeArgs(operation: string, args: Args | undefined, clinicId: string): Args {
  const a: Args = { ...(args ?? {}) };

  if (FILTER_OPS.has(operation)) {
    if (operation.startsWith('update')) forbidMovingRows(a.data);
    a.where = { AND: [(a.where as Args | undefined) ?? {}, { clinicId }] };
    return a;
  }

  if (UNIQUE_OPS.has(operation)) {
    if (operation === 'update') forbidMovingRows(a.data);
    a.where = { ...(a.where as Args | undefined), clinicId };
    return a;
  }

  switch (operation) {
    case 'create':
      a.data = withClinic(a.data, clinicId);
      return a;
    case 'createMany':
    case 'createManyAndReturn':
      a.data = Array.isArray(a.data)
        ? a.data.map((row) => withClinic(row, clinicId))
        : withClinic(a.data, clinicId);
      return a;
    case 'upsert':
      forbidMovingRows(a.update);
      a.where = { ...(a.where as Args | undefined), clinicId };
      a.create = withClinic(a.create, clinicId);
      return a;
    default:
      // Unknown operation: refuse instead of letting it through unfiltered.
      throw new Error(`Operation "${operation}" is not allowed on the tenant client`);
  }
}
