import { useCallback, useEffect, useState } from 'react'
import { ApiError } from './api.ts'

/** Loads data when the page opens (and when deps change). `reload()` fetches again after a change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let stale = false
    setState((s) => ({ ...s, loading: true }))
    fn().then(
      (data) => !stale && setState({ data, error: null, loading: false }),
      (e: unknown) => !stale && setState((s) => ({ data: s.data, error: e instanceof ApiError ? e.message : 'صار خطأ غير متوقع، جرب مرة ثانية', loading: false })),
    )
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
