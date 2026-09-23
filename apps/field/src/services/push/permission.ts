import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

import { PUSH_CHANNEL_ID } from './constants';
import { readPrimingAnswer, writePrimingAnswer } from './storage';

/*
 * Notification permission, asked once, after sign-in, behind a priming dialog
 * (push-and-permissions.md §7). The rules:
 *
 *   - The OS prompt is never the first thing a surveyor sees. The priming dialog
 *     says why, and "Not now" there costs nothing: the OS prompt is still unspent.
 *   - Denial is final for the app. After "Not now", or an OS denial, nothing here
 *     asks again. Only the surveyor can reopen it, from Profile, through
 *     `enablePushFromSettings`.
 *   - Refusal degrades to a fully working app. Assignments are in the list on open.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

// Android 13 shows the OS prompt only once a channel exists, so this runs at startup.
export async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: 'Case updates',
    description: 'New assignments, inspection reminders and decisions on your findings.',
    importance: Notifications.AndroidImportance.HIGH,
    // A case reference only, but the lock screen is still not the place for it.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    showBadge: true,
  });
}

// Current OS permission, without prompting.
export async function currentPushPermission(): Promise<{
  readonly status: PushPermission;
  readonly canAskAgain: boolean;
}> {
  const settings = await Notifications.getPermissionsAsync();
  const provisional =
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
  let status: PushPermission = 'undetermined';
  if (settings.granted || provisional) status = 'granted';
  else if (settings.status === Notifications.PermissionStatus.DENIED) status = 'denied';
  return { status, canAskAgain: settings.canAskAgain };
}

// The priming dialog. Resolves true when the surveyor chose to continue to the OS prompt.
function showPrimingDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Get notified of new assignments?',
      'ADA ICMS can tell you when a complaint is assigned to you, when an inspection is ' +
        'due, and when your findings are accepted. A notification shows only the case ' +
        'number. Everything is still in the Complaints list if you say no.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function requestFromOs(): Promise<boolean> {
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return result.granted;
}

/*
 * Primes and asks, at most once per install. Answers whether push is granted now.
 * Called after an interactive sign-in, never on launch.
 */
export async function primeAndRequestPushPermission(): Promise<boolean> {
  const { status, canAskAgain } = await currentPushPermission();
  if (status === 'granted') return true;
  if (status === 'denied' || !canAskAgain) return false;
  if (readPrimingAnswer() === 'declined') return false;

  const proceed = await showPrimingDialog();
  if (!proceed) {
    writePrimingAnswer('declined');
    return false;
  }
  writePrimingAnswer('accepted');
  return requestFromOs();
}

/*
 * For a "Notifications" switch on Profile: the surveyor asked, so this may prompt.
 * If the OS will not prompt again, it opens the app's system settings instead.
 */
export async function enablePushFromSettings(): Promise<boolean> {
  const { status, canAskAgain } = await currentPushPermission();
  if (status === 'granted') return true;
  writePrimingAnswer('accepted');
  if (canAskAgain) return requestFromOs();
  await Linking.openSettings();
  return false;
}
