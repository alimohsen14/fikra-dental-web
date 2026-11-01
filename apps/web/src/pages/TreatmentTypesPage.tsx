import { useState } from 'react'
import { useAuth } from '../auth/AuthContext.tsx'
import { Badge, Card, Loading } from '../components/admin-ui.tsx'
import { ClinicBanner } from '../components/clinic-ui.tsx'
import { Alert, Button, TextField } from '../components/ui.tsx'
import { ApiError } from '../lib/api.ts'
import { createTreatmentType, DEFAULT_TYPES, listTreatmentTypes, typeTree, updateTreatmentType } from '../lib/treatments.ts'
import type { TreatmentType } from '../lib/treatments.ts'
import { useLoad } from '../lib/useLoad.ts'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')

/** Small inline form: one name, one button. */
function AddForm({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError('الاسم لازم حرفين على الأقل')
    setBusy(true)
    setError(null)
    try {
      await onAdd(name.trim())
      setName('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 basis-56">
          <TextField label={label} value={name} placeholder={placeholder} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" size="sm" busy={busy} className="mb-1.5">
          إضافة
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  )
}

/** One type or sub-type: name, state, and (owner only) rename / stop. */
function TypeRow({ t, canEdit, onChanged, strong }: { t: TreatmentType; canEdit: boolean; onChanged: () => void; strong?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(t.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(body: { name?: string; isActive?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      await updateTreatmentType(t.id, body)
      setEditing(false)
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`type-${t.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {editing ? (
          <div className="flex flex-1 basis-56 items-end gap-2">
            <div className="flex-1">
              <TextField label="الاسم" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button size="sm" busy={busy} className="mb-1.5" onClick={() => void save({ name: name.trim() })}>
              حفظ
            </Button>
            <Button size="sm" variant="secondary" className="mb-1.5" onClick={() => { setEditing(false); setName(t.name); setError(null) }}>
              رجوع
            </Button>
          </div>
        ) : (
          <span className={`flex flex-wrap items-center gap-2 ${strong ? 'text-[17px] font-bold' : 'font-semibold'} ${t.isActive ? '' : 'text-muted line-through'}`}>
            {t.name}
            {!t.isActive && <Badge label="موقوف" bg="#eceff3" fg="#4a5a70" />}
          </span>
        )}
        {canEdit && !editing && (
          <span className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
              تعديل الاسم
            </Button>
            <Button size="sm" variant="secondary" busy={busy} onClick={() => void save({ isActive: !t.isActive })}>
              {t.isActive ? 'إيقاف' : 'تفعيل'}
            </Button>
          </span>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  )
}

export default function TreatmentTypesPage() {
  const { session } = useAuth()
  const isOwner = session?.user.role === 'OWNER'
  const { data, error, reload } = useLoad(listTreatmentTypes, [])
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  async function seed() {
    setSeeding(true)
    setSeedError(null)
    try {
      for (const d of DEFAULT_TYPES) {
        const existing = (data ?? []).find((t) => t.parentId === null && t.name === d.name)
        const parent = existing ?? (await createTreatmentType(d.name))
        for (const c of d.children) {
          if (!(data ?? []).some((t) => t.parentId === parent.id && t.name === c)) await createTreatmentType(c, parent.id)
        }
      }
    } catch (e) {
      setSeedError(messageOf(e))
    } finally {
      setSeeding(false)
      reload()
    }
  }

  return (
    <>
      <ClinicBanner title="أنواع العلاج" subtitle="نوع رئيسي (مثل تلبيسة) وتحته أنواع فرعية (زركون، بورسلان...). الدكتور بيختار النوع الفرعي لما يسجل علاج." />
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-5">
          <Card title="نوع جديد">
            <AddForm label="اسم النوع" placeholder="مثال: حشوة" onAdd={async (name) => { await createTreatmentType(name); reload() }} />
          </Card>
          {data.length === 0 && (
            <Card title="لسا ما في أنواع" hint="بتقدر تضيف الأنواع بنفسك، أو تبدأ بقائمة جاهزة (تجريبية) وتعدلها لما الدكتور يعطيك القائمة الحقيقية.">
              {seedError && <Alert tone="error">{seedError}</Alert>}
              <Button variant="secondary" size="sm" busy={seeding} className="self-start" onClick={() => void seed()}>
                إضافة القائمة الجاهزة
              </Button>
            </Card>
          )}
          {typeTree(data).map(({ type, children }) => (
            <Card key={type.id}>
              <TypeRow t={type} canEdit={isOwner} onChanged={reload} strong />
              {children.length > 0 && (
                <ul className="flex flex-col gap-3 border-s-2 border-line ps-4">
                  {children.map((c) => (
                    <li key={c.id}>
                      <TypeRow t={c} canEdit={isOwner} onChanged={reload} />
                    </li>
                  ))}
                </ul>
              )}
              <AddForm label="نوع فرعي جديد" placeholder={`مثال: تحت ${type.name}`} onAdd={async (name) => { await createTreatmentType(name, type.id); reload() }} />
            </Card>
          ))}
          {!isOwner && data.length > 0 && <p className="text-sm text-muted">تعديل الأسماء وإيقاف الأنواع للمالك فقط.</p>}
        </div>
      )}
    </>
  )
}
