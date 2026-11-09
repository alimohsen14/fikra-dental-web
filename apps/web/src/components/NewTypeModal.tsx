import { useState } from 'react'
import { Modal } from './Modal.tsx'
import { Alert, Button, SelectField, TextField } from './ui.tsx'
import { ApiError } from '../lib/api.ts'
import { buildNewType, createTreatmentType, typeTree } from '../lib/treatments.ts'
import type { TreatmentType } from '../lib/treatments.ts'

/** Adds a treatment type (with its sub-types) without leaving the page. */
export function NewTypeModal({ types, onClose, onCreated }: { types: TreatmentType[]; onClose: () => void; onCreated: () => void }) {
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState('')
  const [subs, setSubs] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mains = typeTree(types).filter((n) => n.type.isActive)

  async function submit() {
    const plan = buildNewType({ parentId, name, subs })
    if ('error' in plan) return setError(plan.error)
    setBusy(true)
    setError(null)
    let created = false
    try {
      const main = await createTreatmentType(plan.name, plan.parentId ?? undefined)
      created = true
      for (const s of plan.subs) await createTreatmentType(s, main.id)
      onCreated()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية')
      setBusy(false)
      if (created) onCreated() // the main type is already saved: it shows in the list
    }
  }

  return (
    <Modal title="إضافة نوع علاج" onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {mains.length > 0 && (
          <SelectField label="النوع" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">نوع رئيسي جديد</option>
            {mains.map((n) => (
              <option key={n.type.id} value={n.type.id}>
                نوع فرعي تحت: {n.type.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField label={parentId ? 'اسم النوع الفرعي' : 'اسم النوع'} value={name} maxLength={80} placeholder={parentId ? 'مثال: زركون' : 'مثال: تلبيسة'} onChange={(e) => setName(e.target.value)} autoFocus />
        {!parentId && (
          <div className="flex flex-col gap-3" data-testid="new-subtypes">
            <span className="text-sm font-semibold">أنواع فرعية (اختياري)</span>
            {subs.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <TextField label={`نوع فرعي ${i + 1}`} value={s} maxLength={80} onChange={(e) => setSubs(subs.map((x, j) => (j === i ? e.target.value : x)))} />
                </div>
                {subs.length > 1 && (
                  <button type="button" aria-label={`حذف النوع الفرعي ${i + 1}`} onClick={() => setSubs(subs.filter((_, j) => j !== i))} className="mt-7 size-9 cursor-pointer rounded-lg text-xl text-muted hover:bg-page">
                    ×
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setSubs([...subs, ''])} className="cursor-pointer self-start text-sm font-semibold text-brand-dark underline">
              + نوع فرعي ثاني
            </button>
          </div>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" busy={busy}>
            إضافة
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            رجوع
          </Button>
        </div>
      </form>
    </Modal>
  )
}
