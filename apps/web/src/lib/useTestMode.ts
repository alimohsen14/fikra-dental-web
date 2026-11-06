import { useEffect, useState } from 'react'
import { getWhatsappStatus } from './appointments.ts'

// One request for the whole page, however many cards there are.
let whatsappStatus: Promise<{ testMode: boolean }> | null = null
export function useTestMode(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    whatsappStatus ??= getWhatsappStatus().catch(() => {
      whatsappStatus = null
      return { testMode: false }
    })
    let live = true
    void whatsappStatus.then((s) => live && setOn(s.testMode))
    return () => {
      live = false
    }
  }, [])
  return on
}
