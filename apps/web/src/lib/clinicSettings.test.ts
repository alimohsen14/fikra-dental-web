import { describe, expect, it } from 'vitest'
import { checkLogoFile, LOGO_MAX_BYTES } from './clinicSettings.ts'

describe('checkLogoFile', () => {
  it('accepts PNG, JPEG and WebP up to 512 KB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(checkLogoFile({ type, size: 1000 })).toBeNull()
    expect(checkLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull()
  })
  it('rejects other types (SVG can carry scripts), too-big and empty files', () => {
    expect(checkLogoFile({ type: 'image/svg+xml', size: 1000 })).toMatch(/PNG/)
    expect(checkLogoFile({ type: 'application/pdf', size: 1000 })).toMatch(/PNG/)
    expect(checkLogoFile({ type: '', size: 1000 })).toMatch(/PNG/)
    expect(checkLogoFile({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/كبيرة/)
    expect(checkLogoFile({ type: 'image/png', size: 0 })).toMatch(/فاضي/)
  })
})
