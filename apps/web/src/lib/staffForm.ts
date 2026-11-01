import type { CreateStaffInput, StaffMember, UpdateStaffInput } from './staff.ts'

const USERNAME = /^[a-z0-9_.-]{3,32}$/

/** Checks the "new team member" form. Returns an Arabic problem, or the request body. */
export function buildStaffInput(f: { role: 'DOCTOR' | 'SECRETARY'; fullName: string; username: string; phone: string; specialty: string; canManagePayments: boolean }): { error: string } | { input: CreateStaffInput } {
  const fullName = f.fullName.trim()
  const username = f.username.trim().toLowerCase()
  const phone = f.phone.trim()
  const specialty = f.specialty.trim()
  if (fullName.length < 2) return { error: 'اكتب اسم الموظف' }
  if (!USERNAME.test(username)) return { error: 'اسم المستخدم: من 3 إلى 32 خانة، أحرف إنجليزية صغيرة وأرقام و _ . - فقط' }
  if (phone && phone.length < 5) return { error: 'رقم الجوال قصير' }
  if (f.role === 'DOCTOR' && specialty && specialty.length < 2) return { error: 'التخصص قصير' }
  return {
    input: {
      username,
      fullName,
      role: f.role,
      ...(phone ? { phone } : {}),
      ...(f.role === 'DOCTOR' && specialty ? { specialty } : {}),
      ...(f.canManagePayments ? { canManagePayments: true } : {}),
    },
  }
}

/** Only what really changed is sent. Returns an Arabic problem, "nothing changed", or the request body. */
export function buildStaffUpdate(
  member: StaffMember,
  f: { fullName: string; phone: string; specialty: string; canManagePayments: boolean },
): { error: string } | { input: UpdateStaffInput } {
  const fullName = f.fullName.trim()
  const phone = f.phone.trim()
  const specialty = f.specialty.trim()
  if (fullName.length < 2) return { error: 'اكتب اسم الموظف' }
  if (phone && phone.length < 5) return { error: 'رقم الجوال قصير' }
  if (member.doctor && specialty && specialty.length < 2) return { error: 'التخصص قصير' }
  const input: UpdateStaffInput = {}
  if (fullName !== member.fullName) input.fullName = fullName
  if (phone !== (member.phone ?? '')) input.phone = phone || null
  if (member.doctor && specialty !== (member.doctor.specialty ?? '')) input.specialty = specialty || null
  if (f.canManagePayments !== member.canManagePayments) input.canManagePayments = f.canManagePayments
  return Object.keys(input).length === 0 ? { error: 'ما غيّرت أي شي' } : { input }
}
