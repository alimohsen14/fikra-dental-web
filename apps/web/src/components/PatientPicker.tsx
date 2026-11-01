import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listPatients } from '../lib/patients.ts'
import type { Patient } from '../lib/patients.ts'
import { useLoad } from '../lib/useLoad.ts'
import { TextField } from './ui.tsx'

export type PatientPick = Pick<Patient, 'id' | 'fullName' | 'phone'> & { birthDate?: string | null }

export function PatientPicker({ value, onChange }: { value: PatientPick | null; onChange: (p: PatientPick | null) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useLoad(() => (debounced.length >= 2 ? listPatients({ q: debounced, page: 1, archived: false }) : Promise.resolve(null)), [debounced])

  if (value)
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">المريض</span>
        <div className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-brand bg-brand-tint px-4 py-3">
          <span className="font-bold">{value.fullName}</span>
          <button type="button" onClick={() => onChange(null)} className="cursor-pointer text-sm font-semibold text-brand-dark underline">
            تغيير
          </button>
        </div>
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <TextField label="المريض" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الهاتف" hint="اكتب حرفين على الأقل" />
      {data && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-line">
          {data.items.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-start hover:bg-page">
                <span className="font-semibold">{p.fullName}</span>
                <bdi dir="ltr" className="text-sm text-muted">
                  {p.phone}
                </bdi>
              </button>
            </li>
          ))}
          {data.items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">
              ما في مريض بهالبحث. <Link to="/patients/new" className="font-bold text-brand-dark underline">أضف مريض جديد</Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
