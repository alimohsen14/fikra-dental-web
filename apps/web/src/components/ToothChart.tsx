import { useId } from 'react'
import type { KeyboardEvent } from 'react'
import { archFor } from '../lib/arch.ts'
import type { ArchSet, ToothGeom } from '../lib/arch.ts'
import { toothLabel, toothName } from '../lib/teeth.ts'
import type { ToothSet } from '../lib/teeth.ts'

/** What a tooth looks like when it already has a treatment: open (amber) or finished (green). */
export type ToothMark = 'OPEN' | 'CLOSED'

type Look = 'plain' | 'selected' | 'open' | 'closed'

const STROKE: Record<Look, { color: string; width: number }> = {
  plain: { color: '#d8c7ab', width: 1.2 },
  selected: { color: 'var(--brand-dark)', width: 2.6 },
  open: { color: '#c98a00', width: 2 },
  closed: { color: '#1f9d55', width: 2 },
}

/** Gradient stops (light spot at the top-left, like the first app's teeth). */
function Gradients({ id }: { id: string }) {
  const g = (name: Look, stops: [string, string, string]) => (
    <radialGradient id={`${id}-${name}`} cx="0.325" cy="0.275" r="1.1">
      <stop offset="0" style={{ stopColor: stops[0] }} />
      <stop offset="0.55" style={{ stopColor: stops[1] }} />
      <stop offset="1" style={{ stopColor: stops[2] }} />
    </radialGradient>
  )
  return (
    <defs>
      {g('plain', ['#fffefb', '#f6ecdc', '#e3d3ba'])}
      {g('selected', ['#ffffff', 'var(--brand-tint)', 'var(--brand)'])}
      {g('open', ['#fffbeb', '#fcd34d', '#f59e0b'])}
      {g('closed', ['#ecfdf5', '#86efac', '#22c55e'])}
    </defs>
  )
}

/** The crown's grooves and shine, by tooth type (incisor/canine, premolar, molar). */
function Details({ type, w, d, selected }: { type: number; w: number; d: number; selected: boolean }) {
  const line = { fill: 'none', stroke: selected ? 'rgba(255,255,255,.82)' : '#c9b493', strokeWidth: 1.5, strokeLinecap: 'round' as const }
  const light = 'rgba(255,255,255,.5)'
  if (type >= 6) {
    return (
      <>
        <path d={`M${-w * 0.32} 0Q0 ${-d * 0.12} ${w * 0.32} 0M0 ${-d * 0.32}Q${w * 0.06} 0 0 ${d * 0.32}`} {...line} />
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
          <ellipse key={`${sx}${sy}`} cx={sx! * w * 0.2} cy={sy! * d * 0.2} rx={w * 0.15} ry={d * 0.14} fill={light} />
        ))}
      </>
    )
  }
  if (type >= 4) {
    return (
      <>
        <path d={`M${-w * 0.3} 0Q0 ${d * 0.1} ${w * 0.3} 0`} {...line} />
        {[-1, 1].map((sx) => (
          <ellipse key={sx} cx={sx * w * 0.18} cy={0} rx={w * 0.16} ry={d * 0.24} fill={light} />
        ))}
      </>
    )
  }
  return (
    <>
      <ellipse cx={-w * 0.1} cy={-d * 0.12} rx={w * 0.24} ry={d * 0.18} fill={light} />
      <path d={`M${-w * 0.3} ${d * 0.3}Q0 ${d * 0.38} ${w * 0.3} ${d * 0.3}`} {...line} />
    </>
  )
}

function Tooth({ t, look, gradientId }: { t: ToothGeom; look: Look; gradientId: string }) {
  const radius = t.type >= 6 ? t.w * 0.3 : t.type >= 4 ? t.w * 0.36 : t.w * 0.42
  const stroke = STROKE[look]
  const selected = look === 'selected'
  return (
    <g
      data-visual={t.code}
      transform={`translate(${t.cx} ${t.cy}) rotate(${t.angle})`}
      style={{ filter: selected ? 'drop-shadow(0 0 5px var(--brand))' : 'drop-shadow(0 1px 1.5px rgba(127,29,29,.3))', pointerEvents: 'none' }}
    >
      <rect x={-t.w / 2} y={-t.d / 2} width={t.w} height={t.d} rx={radius} fill={`url(#${gradientId}-${look})`} stroke={stroke.color} strokeWidth={stroke.width} />
      <Details type={t.type} w={t.w} d={t.d} selected={selected} />
    </g>
  )
}

function Chart({ set, selected, marks, onPick, label }: { set: ArchSet; selected: number[]; marks: Record<number, ToothMark>; onPick: ((code: number) => void) | undefined; label: string }) {
  const id = useId().replace(/:/g, '')
  const arch = archFor(set)
  const [x, y, w, h] = arch.viewBox
  const lookOf = (code: number): Look => (selected.includes(code) ? 'selected' : marks[code] === 'OPEN' ? 'open' : marks[code] === 'CLOSED' ? 'closed' : 'plain')
  return (
    // On a phone the chart keeps finger-sized teeth and scrolls sideways inside its own box.
    <div className="overflow-x-auto">
      <svg viewBox={`${x} ${y} ${w} ${h}`} role="group" aria-label={label} className="mx-auto h-auto w-full max-w-[540px] select-none" style={{ direction: 'ltr', minWidth: 300 }}>
        <Gradients id={id} />
        <text x={x + 6} y={y + 16} fontSize="14" fill="#4a5a70">
          يمين المريض
        </text>
        <text x={x + w - 6} y={y + 16} fontSize="14" fill="#4a5a70" textAnchor="end">
          يسار المريض
        </text>
        {arch.gums.map((d, i) => (
          <g key={i} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} stroke="#f4a9a9" strokeWidth={arch.gumWidths[0]} />
            <path d={d} stroke="#f9c7c7" strokeWidth={arch.gumWidths[1]} />
          </g>
        ))}
        {arch.guides.map((g, i) => (
          <line key={i} {...g} stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="5 5" />
        ))}
        {arch.jawLabels.map((l) => (
          <text key={l.text} x={l.x} y={l.y} fontSize="20" fontWeight="700" fill="#64748b" textAnchor="middle" style={{ pointerEvents: 'none' }}>
            {l.text}
          </text>
        ))}
        {arch.teeth.map((t) => (
          <Tooth key={t.code} t={t} look={lookOf(t.code)} gradientId={id} />
        ))}
        {arch.teeth.map((t) => {
          const look = lookOf(t.code)
          return (
            <text
              key={t.code}
              x={t.lx}
              y={t.ly + 2}
              textAnchor="middle"
              fontSize={look === 'selected' ? 23 : 19}
              fontWeight={look === 'selected' ? 800 : 600}
              fill={look === 'selected' ? 'var(--brand-dark)' : '#64748b'}
              style={{ pointerEvents: 'none' }}
            >
              {toothLabel(t.code)}
            </text>
          )
        })}
        {arch.teeth.map((t) => {
          const press = () => onPick?.(t.code)
          const key = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              press()
            }
          }
          const look = lookOf(t.code)
          return (
            <circle
              key={t.code}
              data-tooth={t.code}
              data-state={look === 'plain' ? 'none' : look}
              cx={t.hit.cx}
              cy={t.hit.cy}
              r={t.hit.r}
              fill="transparent"
              role={onPick ? 'button' : 'img'}
              aria-label={toothName(t.code)}
              {...(onPick ? { tabIndex: 0, 'aria-pressed': look === 'selected', onClick: press, onKeyDown: key } : {})}
              className={onPick ? 'cursor-pointer outline-none focus-visible:stroke-brand focus-visible:stroke-[3]' : ''}
            />
          )
        })}
      </svg>
    </div>
  )
}

const OPTIONS: [ToothSet, string][] = [
  ['kids', 'أسنان أطفال'],
  ['both', 'مختلطة'],
  ['adult', 'أسنان دائمة'],
]

/** Switch between the baby teeth, both sets (6-12 years), and permanent teeth. */
export function ToothSetToggle({ value, onChange }: { value: ToothSet; onChange: (s: ToothSet) => void }) {
  return (
    <div role="group" aria-label="نوع الأسنان" className="flex flex-wrap gap-2">
      {OPTIONS.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold ${value === v ? 'border-brand bg-brand text-on-brand' : 'border-line bg-white hover:bg-page'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** The interactive tooth chart. `onPick` makes teeth clickable; `marks` colors teeth that already have a treatment. */
export function ToothChart({ set, selected = [], marks = {}, onPick }: { set: ToothSet; selected?: number[]; marks?: Record<number, ToothMark>; onPick?: (code: number) => void }) {
  return (
    <div className="flex flex-col gap-4" data-testid="tooth-chart">
      {set !== 'kids' && <Chart set="adult" label="الأسنان الدائمة" selected={selected} marks={marks} onPick={onPick} />}
      {set !== 'adult' && <Chart set="kids" label="أسنان الأطفال" selected={selected} marks={marks} onPick={onPick} />}
    </div>
  )
}

/** The chosen teeth as removable chips ("the selected tooth box"). */
export function SelectedTeeth({ teeth, onRemove, onClear }: { teeth: number[]; onRemove?: (code: number) => void; onClear?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-page p-4" data-testid="selected-teeth">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">الأسنان المختارة ({teeth.length})</span>
        {onClear && teeth.length > 0 && (
          <button type="button" onClick={onClear} className="cursor-pointer text-sm font-semibold text-brand-dark underline">
            مسح الكل
          </button>
        )}
      </div>
      {teeth.length === 0 ? (
        <p className="text-sm text-muted">اضغط على السن في المخطط لاختياره.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {teeth.map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint py-1 ps-3 pe-1.5 text-sm font-semibold text-brand-dark">
              <span>{toothName(t)}</span>
              {onRemove && (
                <button type="button" aria-label={`إزالة السن ${toothLabel(t)}`} onClick={() => onRemove(t)} className="size-6 cursor-pointer rounded-full text-lg leading-none hover:bg-white">
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
