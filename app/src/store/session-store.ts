import { create } from 'zustand';

import { getSession, subscribeToSession, type SessionSnapshot } from '@/services/auth/session';

/*
 * The session, as the UI reads it.
 *
 * `services/auth/session.ts` owns the state machine; this is a mirror so screens
 * can subscribe without importing the service's emitter. One direction only —
 * nothing here writes back. Sign-in and sign-out are service calls.
 */
export const useSessionStore = create<SessionSnapshot>(() => getSession());

subscribeToSession((next) => useSessionStore.setState(next));

// True once the app knows who is signed in — `stale` counts: the surveyor keeps working.
export function useIsSignedIn(): boolean {
  return useSessionStore((state) => state.status === 'signedIn' || state.status === 'stale');
}

export function useSessionStatus(): SessionSnapshot['status'] {
  return useSessionStore((state) => state.status);
}
