import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { DateText } from './admin-ui.tsx'
import { Modal } from './Modal.tsx'
import { Alert, Button } from './ui.tsx'
import { ApiError } from '../lib/api.ts'
import { deleteXray, fetchXrayImage, sizeLabel } from '../lib/xrays.ts'
import type { Xray } from '../lib/xrays.ts'

/** An X-ray picture, loaded with the login and shown from memory. */
function Picture({ id, className, alt }: { id: string; className?: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    let cancelled = false
    fetchXrayImage(id)
      .then((b) => {
        if (cancelled) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [id])
  if (failed) return <span className={`flex items-center justify-center bg-page text-sm text-muted ${className ?? ''}`}>تعذّر فتح الصورة</span>
  if (!url) return <span className={`block animate-pulse bg-page ${className ?? ''}`} />
  return <img src={url} alt={alt} className={className} />
}

function Viewer({ x, canDelete, showTreatment, onClose, onDeleted }: { x: Xray; canDelete: boolean; showTreatment: boolean; onClose: () => void; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteXray(x.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'حدث خطأ غير متوقع، حاول مرة أخرى')
      setBusy(false)
    }
  }
  return (
    <Modal title="صورة أشعة" onClose={onClose}>
      <Picture id={x.id} alt={x.note ?? 'أشعة'} className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
      <div className="flex flex-col gap-1 text-sm">
        <span>
          أُضيفت بتاريخ <DateText value={x.createdAt} /> · {x.uploadedBy.fullName} · {sizeLabel(x.size)}
        </span>
        {x.note && <span className="font-semibold">{x.note}</span>}
        {showTreatment && (
          <Link to={`/treatments/${x.treatmentId}`} className="font-bold text-brand-dark underline">
            فتح العلاج{x.treatment.description ? `: ${x.treatment.description}` : ''}
          </Link>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {canDelete &&
        (asking ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">هل تريد حذف الصورة نهائياً؟</span>
            <Button variant="danger" size="sm" busy={busy} onClick={remove}>
              نعم، احذف
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
              لا
            </Button>
          </div>
        ) : (
          <button type="button" className="w-fit cursor-pointer text-sm text-[#b42318] underline" onClick={() => setAsking(true)}>
            حذف الصورة
          </button>
        ))}
    </Modal>
  )
}

/** Thumbnails newest first, each with the day it was added. `canDelete` decides per picture (the owner, or whoever added it). */
export function XrayGallery({ items, canDelete, showTreatment = false, onChanged }: { items: Xray[]; canDelete: (x: Xray) => boolean; showTreatment?: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState<Xray | null>(null)
  if (items.length === 0) return <p className="text-muted">لا توجد صور أشعة.</p>
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="xray-list">
        {items.map((x) => (
          <li key={x.id}>
            <button type="button" data-xray={x.id} onClick={() => setOpen(x)} className="flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-line bg-white p-2 text-start">
              <Picture id={x.id} alt={x.note ?? 'أشعة'} className="aspect-square w-full rounded-lg bg-black object-cover" />
              <span className="text-sm font-semibold">
                <DateText value={x.createdAt} />
              </span>
              {x.note && <span className="truncate text-xs text-muted">{x.note}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Viewer
          x={open}
          canDelete={canDelete(open)}
          showTreatment={showTreatment}
          onClose={() => setOpen(null)}
          onDeleted={() => {
            setOpen(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}
