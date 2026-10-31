// Turns a clinic's accent color into the set of colors the app uses, and always picks readable
// text (white or dark) for whatever color the clinic chose.

export const FIKRA_BLUE = '#0560c8'
export const DEFAULT_CLINIC_COLOR = '#0b5d57'
const INK = '#152437'

const HEX = /^#[0-9a-fA-F]{6}$/

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const toHex = (c: Rgb) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

const channel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const luminance = (c: Rgb) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

export function contrast(a: string, b: string): number {
  const la = luminance(toRgb(a))
  const lb = luminance(toRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const mix = (c: Rgb, other: Rgb, amount: number): Rgb =>
  c.map((v, i) => v + (other[i]! - v) * amount) as Rgb

export function buildTheme(color: string | null | undefined, fallback = DEFAULT_CLINIC_COLOR) {
  const brand = color && HEX.test(color) ? color.toLowerCase() : fallback
  const rgb = toRgb(brand)
  // White or dark ink; for mid-tone colors where neither reaches 4.5:1, fall back to pure black.
  const best = [ '#ffffff', INK ].sort((x, y) => contrast(y, brand) - contrast(x, brand))[0]!
  const onBrand = contrast(best, brand) >= 4.5 ? best : contrast('#000000', brand) > contrast('#ffffff', brand) ? '#000000' : '#ffffff'
  const [r, g, b] = toRgb(onBrand)
  const light = onBrand === '#ffffff'
  return {
    '--brand': brand,
    '--on-brand': onBrand,
    '--on-brand-soft': `rgba(${r}, ${g}, ${b}, 0.88)`,
    '--on-brand-line': `rgba(${r}, ${g}, ${b}, 0.3)`,
    '--brand-active': `rgba(${r}, ${g}, ${b}, ${light ? 0.2 : 0.14})`,
    '--brand-tint': toHex(mix(rgb, [255, 255, 255], 0.9)),
    '--brand-dark': toHex(mix(rgb, [0, 0, 0], 0.4)),
  } as Record<string, string>
}
