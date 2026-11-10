import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { flashOf } from '../lib/flash.ts'
import type { Flash as FlashValue } from '../lib/flash.ts'
import { Alert } from './ui.tsx'

/** Shows the "saved" message the previous page left, once (a refresh does not bring it back). */
export function Flash() {
  const { state, pathname, search } = useLocation()
  const navigate = useNavigate()
  const [flash] = useState<FlashValue | null>(() => flashOf(state))
  useEffect(() => {
    if (flash) navigate(pathname + search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return flash ? (
    <div data-testid="flash">
      <Alert tone={flash.tone}>{flash.message}</Alert>
    </div>
  ) : null
}
