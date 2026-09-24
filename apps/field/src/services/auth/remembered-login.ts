import { prefsStore } from '@/services/storage/kv';

/*
 * Remember me: the username or mobile number only, in the preferences store so it
 * survives sign-out. Never the password — that is not stored anywhere.
 */
const USERNAME_KEY = 'login.rememberedUsername';
const REMEMBER_KEY = 'login.remember';

// Whether Remember me is ticked. Unticked until chosen: the username is often a mobile number, on a shared phone.
export function readRememberChoice(): boolean {
  return prefsStore.getBoolean(REMEMBER_KEY) ?? false;
}

export function readRememberedUsername(): string {
  return prefsStore.getString(USERNAME_KEY) ?? '';
}

// Saves the choice, and the username only when the box is ticked; unticking forgets it.
export function saveRememberedLogin(remember: boolean, username: string): void {
  prefsStore.set(REMEMBER_KEY, remember);
  if (remember && username !== '') prefsStore.set(USERNAME_KEY, username);
  else prefsStore.remove(USERNAME_KEY);
}
