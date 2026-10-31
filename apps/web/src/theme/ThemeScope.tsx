import type { CSSProperties, ReactNode } from 'react'
import { buildTheme, FIKRA_BLUE } from './color.ts'

/**
 * Everything inside uses this color through bg-brand, text-on-brand... (see index.css).
 * platform: Fikra's own blue (login, platform admin). Otherwise the clinic's color.
 */
export function ThemeScope({ platform, color, children }: { platform?: boolean; color?: string | null; children: ReactNode }) {
  const vars = buildTheme(platform ? FIKRA_BLUE : color)
  return (
    <div style={vars as CSSProperties} className="min-h-screen">
      {children}
    </div>
  )
}
