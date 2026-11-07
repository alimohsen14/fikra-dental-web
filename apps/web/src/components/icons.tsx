// Small outline icons (24x24). Decorative: hidden from screen readers.
const PATHS = {
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  lock: 'M7 11h10a2 2 0 012 2v6a2 2 0 01-2 2H7a2 2 0 01-2-2v-6a2 2 0 012-2zM8 11V8a4 4 0 018 0v3',
  arrow: 'M19 12H5M11 6l-6 6 6 6',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9 12l2 2 4-4',
  check: 'M5 12l5 5 9-10',
  clinics: 'M4 21V8l8-5 8 5v13M9 21v-6h6v6',
  patients:
    'M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-2a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1a7 7 0 00-2-1l-.5-2h-4L10 7a7 7 0 00-2 1L6 7 4 11l2 1v2l-2 1 2 4 2-1a7 7 0 002 1l.5 2h4l.5-2a7 7 0 002-1l2 1 2-4-2-1z',
  plus: 'M12 5v14M5 12h14',
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z',
  calendar: 'M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  team: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 21v-1.5a5 5 0 015-5h4a5 5 0 015 5V21M17 4.5a3.5 3.5 0 010 6.5M22 21v-1.5a5 5 0 00-3.5-4.8',
  tooth: 'M7 3c-2.2 0-4 1.8-4 4.2 0 2 1 3 1.4 5C4.800 15 5.500 21 7.500 21c1.700 0 1.500-4.500 4.500-4.500S14.800 21 16.500 21c2 0 2.700-6 3.100-8.800.400-2 1.400-3 1.400-5C21 4.800 19.200 3 17 3c-2 0-2.500 1-5 1S9 3 7 3z',
  types: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  wallet: 'M4 7a2 2 0 012-2h12v4M4 7v10a2 2 0 002 2h14V9H6a2 2 0 01-2-2zM16 14h2',
  warning: 'M12 3l10 18H2L12 3zM12 10v5M12 18.5v.01',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
