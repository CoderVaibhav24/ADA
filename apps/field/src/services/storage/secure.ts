import * as SecureStore from 'expo-secure-store';

/*
 * The Keychain / Keystore wrapper. Tokens live here and nowhere else —
 * Architecture.md §5, code-standards.md rule 7. MMKV and AsyncStorage are plain
 * text on a rooted handset, and a surveyor's handset is government issue, shared,
 * and occasionally rooted.
 *
 * AFTER_FIRST_UNLOCK so a refresh can run when the app wakes without the user
 * having unlocked the device again.
 *
 * SecureStore warns above 2048 bytes per value. A Keycloak access token with a
 * long role list gets close, so each token has its own key rather than sharing
 * one JSON blob.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export type SecureKey =
  | 'ada.auth.accessToken'
  | 'ada.auth.refreshToken'
  | 'ada.auth.tokenMeta'
  | 'ada.auth.profile';

// Reads one secret; a missing key and an unreadable keystore both answer null.
export async function readSecret(key: SecureKey): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch {
    return null;
  }
}

// Writes one secret, replacing whatever was there.
export async function writeSecret(key: SecureKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

// Deletes one secret. Used on sign-out; never on a failed refresh.
export async function deleteSecret(key: SecureKey): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, OPTIONS);
  } catch {
    // A key that cannot be deleted is already unreadable; nothing to recover.
  }
}
