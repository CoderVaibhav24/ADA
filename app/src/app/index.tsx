import { Redirect } from 'expo-router';

import { useSessionStore } from '@/store/session-store';

/*
 * The entry route. It holds no screen — `code-standards.md` §9 — it only decides
 * which half of the tree the app opens into, once the session has been restored.
 */
export default function Entry() {
  const status = useSessionStore((state) => state.status);

  if (status === 'restoring') return null;
  return <Redirect href={status === 'signedOut' ? '/login' : '/home'} />;
}
