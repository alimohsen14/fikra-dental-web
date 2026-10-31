import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { refreshSession } from '../lib/api.ts'
import { getSession, subscribeSession } from '../lib/session.ts'
import type { Session } from '../lib/session.ts'

interface AuthState {
  ready: boolean // false until we know whether a saved login exists
  session: Session | null
}

const AuthContext = createContext<AuthState>({ ready: false, session: null })

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSession)
  const [ready, setReady] = useState(false)

  // After a page reload the session is gone from memory: ask for a new one with the refresh cookie.
  useEffect(() => {
    void refreshSession().finally(() => setReady(true))
  }, [])

  return <AuthContext.Provider value={{ ready, session }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
