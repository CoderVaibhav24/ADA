import { Redirect } from 'expo-router';

import { useLocaleChosen } from '@/services/i18n';
import { useSessionStore } from '@/store/session-store';

/*
 * The entry route. It holds no screen — `code-standards.md` §9 — it only decides
 * which half of the tree the app opens into, once the session has been restored.
 * A first launch with no language chosen yet opens on the language choice.
 */
export default function Entry() {
  const status = useSessionStore((state) => state.status);
  const languageChosen = useLocaleChosen();

  if (status === 'restoring') return null;
  if (status !== 'signedOut') return <Redirect href="/home" />;
  return <Redirect href={languageChosen ? '/login' : '/language'} />;
}
