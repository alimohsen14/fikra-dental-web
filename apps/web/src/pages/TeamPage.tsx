import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext.tsx'
import { Badge, Loading, SecretBox } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Icon } from '../components/icons.tsx'
import { Modal } from '../components/Modal.tsx'
import { Alert, Button, SelectField, TextField } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { activateStaff, createStaff, deactivateStaff, listStaff, resetStaffPassword, STAFF_ROLE_LABELS, updateStaff } from '../lib/staff.ts'
import type { StaffMember, StaffSecret } from '../lib/staff.ts'
import { buildStaffInput, buildStaffUpdate } from '../lib/staffForm.ts'
import { useLoad } from '../lib/useLoad.ts'

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

function AddDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: StaffSecret) => void }) {
  const [role, setRole] = useState<'DOCTOR' | 'SECRETARY'>('DOCTOR')
  const [f, setF] = useState({ fullName: '', username: '', phone: '', specialty: '', canManagePayments: false })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildStaffInput({ role, ...f })
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      onCreated(await createStaff(r.input))
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }
  return (
    <Modal title="موظف جديد" onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SelectField label="الوظيفة" value={role} onChange={(e) => setRole(e.target.value as 'DOCTOR' | 'SECRETARY')}>
          <option value="DOCTOR">دكتور</option>
          <option value="SECRETARY">سكرتارية</option>
        </SelectField>
        <TextField label="الاسم الكامل" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <TextField label="اسم المستخدم" dir="ltr" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} hint="أحرف إنجليزية صغيرة وأرقام، مثال: dr.samir" />
        <TextField label="الجوال (اختياري)" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        {role === 'DOCTOR' && <TextField label="التخصص (اختياري)" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.canManagePayments} onChange={(e) => setF({ ...f, canManagePayments: e.target.checked })} />
          يقدر يتعامل مع الدفعات
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" busy={busy}>
            إضافة
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function EditDialog({ member, onClose, onSaved }: { member: StaffMember; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ fullName: member.fullName, phone: member.phone ?? '', specialty: member.doctor?.specialty ?? '', canManagePayments: member.canManagePayments })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const r = buildStaffUpdate(member, f)
    if ('error' in r) return setError(r.error)
    setBusy(true)
    setError(null)
    try {
      await updateStaff(member.id, r.input)
      onSaved()
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }
  return (
    <Modal title={`تعديل ${member.fullName}`} onClose={onClose}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="الاسم الكامل" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        <TextField label="الجوال" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        {member.doctor && <TextField label="التخصص" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.canManagePayments} onChange={(e) => setF({ ...f, canManagePayments: e.target.checked })} />
          يقدر يتعامل مع الدفعات
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" busy={busy}>
            حفظ
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  )
}

type Confirm = { kind: 'stop' | 'start' | 'reset'; member: StaffMember }

export default function TeamPage() {
  const { session } = useAuth()
  const { data, error, reload } = useLoad(listStaff, [])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [secret, setSecret] = useState<{ title: string; who: string; value: StaffSecret } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function runConfirm() {
    if (!confirm) return
    setBusy(true)
    setProblem(null)
    try {
      const { kind, member } = confirm
      if (kind === 'stop') {
        const r = await deactivateStaff(member.id)
        setNotice(r.upcomingAppointments > 0 ? `تم إيقاف ${member.fullName}. عنده ${r.upcomingAppointments} موعد قادم لسا، ما انلغوا: انقلهم أو ألغيهم من المواعيد.` : `تم إيقاف ${member.fullName}.`)
      } else if (kind === 'start') {
        await activateStaff(member.id)
        setNotice(`تم تفعيل ${member.fullName}.`)
      } else {
        setSecret({ title: `كلمة مرور جديدة لـ ${member.fullName}`, who: 'للموظف', value: await resetStaffPassword(member.id) })
        setNotice(null)
      }
      setConfirm(null)
      reload()
    } catch (e) {
      setProblem(message(e))
    } finally {
      setBusy(false)
    }
  }

  const texts: Record<Confirm['kind'], (m: StaffMember) => { title: string; body: string; ok: string }> = {
    stop: (m) => ({ title: 'إيقاف الحساب', body: `${m.fullName} ما رح يقدر يدخل، وبينسحب من الجلسة الحالية فوراً. ${m.doctor ? 'وبيختفي من الحجز. ' : ''}ما بينحذف أي شي وبتقدر ترجّعه.`, ok: 'إيقاف' }),
    start: (m) => ({ title: 'تفعيل الحساب', body: `${m.fullName} بيرجع يقدر يدخل.`, ok: 'تفعيل' }),
    reset: (m) => ({ title: 'إعادة تعيين كلمة المرور', body: `رح تنعمل كلمة مرور مؤقتة جديدة لـ ${m.fullName}، وكلمته الحالية بتتعطل وبينسحب من كل الجلسات.`, ok: 'إعادة تعيين' }),
  }

  return (
    <>
      <ClinicBanner
        title="الفريق"
        subtitle="الدكاترة والسكرتارية اللي بيدخلوا على العيادة."
        action={
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-xl bg-on-brand px-5 font-bold text-brand">
            <Icon name="plus" size={18} strokeWidth={2.4} />
            موظف جديد
          </button>
        }
      />
      {secret && (
        <div className="flex max-w-xl flex-col gap-3">
          <SecretBox title={secret.title} who={secret.who} username={secret.value.staff.username} password={secret.value.temporaryPassword} expiresAt={secret.value.temporaryPasswordExpiresAt} />
          <div className="flex flex-wrap items-center gap-3">
            {secret.value.staff.doctor && (
              <Link to="/hours" className="text-sm font-bold text-brand-dark underline">
                حدد أوقات دوام الدكتور (بدونها ما بينحجز عنده)
              </Link>
            )}
            <Button variant="secondary" size="sm" onClick={() => setSecret(null)}>
              نسختها، إخفاء
            </Button>
          </div>
        </div>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-tint text-brand-dark">
                {['الاسم', 'الوظيفة', 'اسم المستخدم', 'الحالة'].map((h) => (
                  <th key={h} className="px-4 py-3 text-start font-semibold">
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3">
                  <span className="sr-only">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => {
                const manageable = m.role !== 'OWNER' && m.id !== session?.user.id
                return (
                  <tr key={m.id} className="border-t border-[#edf1f6]">
                    <td className="px-4 py-3.5">
                      <span className="font-semibold">{m.fullName}</span>
                      {m.doctor?.specialty && <span className="block text-xs text-muted">{m.doctor.specialty}</span>}
                    </td>
                    <td className="px-4 py-3.5">{STAFF_ROLE_LABELS[m.role]}</td>
                    <td className="px-4 py-3.5">
                      <bdi dir="ltr">{m.username}</bdi>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="flex flex-wrap gap-1.5">
                        {m.isActive ? <Badge label="فعّال" bg="#e3f5ea" fg="#0b4f2c" /> : <Badge label="موقوف" bg="#eceff3" fg="#4a5a70" />}
                        {m.mustChangePassword && <Badge label="ما غيّر كلمة المرور" bg="#fff1d6" fg="#7a4b00" />}
                        {m.canManagePayments && m.role !== 'OWNER' && <Badge label="دفعات" bg="#e3eefb" fg="#033f8c" />}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {manageable && (
                        <span className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                            تعديل
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'reset', member: m })}>
                            كلمة مرور جديدة
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: m.isActive ? 'stop' : 'start', member: m })}>
                            {m.isActive ? 'إيقاف' : 'تفعيل'}
                          </Button>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onCreated={(s) => {
            setAdding(false)
            setNotice(null)
            setSecret({ title: `بيانات دخول ${s.staff.fullName}`, who: 'للموظف', value: s })
            reload()
          }}
        />
      )}
      {editing && (
        <EditDialog
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setNotice('انحفظت التعديلات.')
            reload()
          }}
        />
      )}
      {confirm && (
        <Modal
          title={texts[confirm.kind](confirm.member).title}
          onClose={() => {
            setConfirm(null)
            setProblem(null)
          }}
        >
          <p className="text-[15px] leading-7">{texts[confirm.kind](confirm.member).body}</p>
          {problem && <Alert tone="error">{problem}</Alert>}
          <div className="flex gap-3">
            <Button variant={confirm.kind === 'stop' ? 'danger' : 'primary'} busy={busy} onClick={runConfirm}>
              {texts[confirm.kind](confirm.member).ok}
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              رجوع
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
