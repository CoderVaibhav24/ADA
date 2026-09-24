import { casesEn } from './messages/cases.en';
import { shellEn } from './messages/shell.en';
import { wizardEn } from './messages/wizard.en';
/**
 * English strings. The source of truth for keys: `hi.ts` must carry every key here.
 * Naming is `area.section.item`; placeholders are `{name}`. docs/Agents-Mobile/i18n.md.
 * Plain words only: the reader is a field surveyor, not an engineer.
 */
export const en = {
  ...casesEn,
  ...shellEn,
  ...wizardEn,
  // Shared words
  'common.loading': 'Loading…',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.goBack': 'Go back',
  'common.next': 'Next',
  'common.retry': 'Try again',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.select': 'Select',
  'common.search': 'Search',
  'common.clearSearch': 'Clear search',
  'common.inProgress': 'This feature is in progress.',
  'common.unread': 'Unread',
  'common.photoCount.one': '{count} photo',
  'common.photoCount.other': '{count} photos',

  // Language choice and toggle
  'language.choose.title': 'Choose your language',
  'language.choose.subtitle': 'You can change it later from Profile.',
  'language.hindi': 'हिंदी',
  'language.english': 'English',
  'language.hindiShort': 'हिं',
  'language.englishShort': 'EN',
  'language.hindiInOther': 'Hindi',
  'language.englishInOther': 'English',
  'language.toggle.label': 'Change language',
  'language.toggle.toHindi': 'Show the app in Hindi',
  'language.toggle.toEnglish': 'Show the app in English',

  // Bottom tabs
  'tabs.home': 'Home',
  'tabs.complaints': 'Complaints',
  'tabs.inspections': 'Inspections',
  'tabs.profile': 'Profile',

  // GPS panel
  'gps.state.locked': 'GPS found',
  'gps.state.weak': 'Weak GPS',
  'gps.state.none': 'No GPS',
  'gps.state.searching': 'Finding GPS…',
  'gps.lastKnown': '· last known place',
  'gps.coordinatesUnavailable': 'Location not found yet',
  'gps.accuracyPending': 'Checking accuracy…',
  'gps.accuracy': 'Accuracy ±{meters} m',
  'gps.required': '· needed ±{meters} m',
  'gps.captured': 'Taken {time}',

  // Photo thumbnail
  'photo.source.gallery': 'From gallery',
  'photo.source.geotagged': 'Location saved',
  'photo.source.noLocation': 'No location',
  'photo.a11y': 'Photo, {provenance}',
  'photo.a11yAccuracy': 'Photo, {provenance}, accuracy {meters} metres',
  'photo.remove': 'Remove photo',
  'photo.removeHint': 'Removes this photo from the inspection. Only possible before you submit.',

  // Case status and priority chips
  'status.new': 'New',
  'status.scheduled': 'Scheduled',
  'status.inProgress': 'In progress',
  'status.completed': 'Completed',
  'status.overdue': 'Late',
  'priority.high': 'HIGH',
  'priority.medium': 'MEDIUM',
  'priority.low': 'LOW',
  'priority.a11y': 'Priority {level}',

  // Notification row
  'notification.unreadPrefix': 'Unread.',
  'notification.hint.openCase': 'Opens the case and loads it again',
  'notification.hint.markRead': 'Marks it as read',

  // Inspection wizard shell
  'stepper.progress': 'Step {current} of {total}',
  'stepper.a11y': 'Step {current} of {total}: {name}',
  'wizard.exit': 'Exit',
  'wizard.exitA11y': 'Leave the inspection',
  'wizard.exitHint': 'Your work stays saved',
  'wizard.backHint': 'Keeps everything you have filled in',

  // Errors any screen can show: what happened, then what to do next
  'error.offline': 'No internet. Move to a place with signal and try again.',
  'error.timeout': 'The server is taking too long. Try again in a few minutes.',
  'error.server': 'Server problem. Try again in a few minutes.',
  'error.busy': 'Too many tries. Wait one minute and try again.',
  'error.loggedOut': 'You were logged out. Log in again.',
  'error.forbidden': 'You cannot open this. If this is wrong, call support.',
  'error.notFound': 'This is not available any more. Go back and open the list again.',
  'error.update': 'Update the app to carry on.',
  'error.refused': 'The office could not accept this. Check it and try again. If it keeps happening, call support.',
  'error.unknown': 'Something went wrong. Try again. If it keeps happening, call support.',

  // Relative time
  'time.justNow': 'just now',
  'time.minutesAgo': '{count} min ago',
  'time.hoursAgo': '{count} hr ago',
  'time.daysAgo.one': '{count} day ago',
  'time.daysAgo.other': '{count} days ago',

  // Distance on a complaint card
  'distance.meters': '{value} m',
  'distance.km': '{value} km',
  'distance.minutes': '{count} min',
  'distance.approx': 'approx. {value}',
  'distance.lastKnown': '· last known',
  'distance.lastKnownA11y': '{text}, from your last known place',
  'tabs.badgeA11y': '{count} unread in {label}',

  // Sync
  'sync.pendingCount.one': '{count} photo waiting to upload',
  'sync.pendingCount.other': '{count} photos waiting to upload',

  // Server-driven screens
  'sdui.actionFailed': 'That did not go through',
  'sdui.blockFailed': 'This part could not be shown.',
  'sdui.blockNotAllowed': 'This part cannot be shown in the app.',
  'sdui.unreadableScreen': 'The app could not read this screen. Update the app.',
  'sdui.needsNewerApp': 'This screen needs a newer version of the app. Update the app.',
  'sdui.savedCopyUpdate': 'Showing the copy saved on this phone. Update the app to see the newest one.',
  'sdui.savedCopy': 'Showing the copy saved on this phone. {reason}',
  'sdui.failure.update': 'Update the app to open this screen',
  'sdui.failure.forbidden': 'This screen is not for your account',
  'sdui.failure.generic': 'This screen could not be opened',

  // Login: brand and card (web login, Figma 147:900)
  'login.brandShort': 'ICMS-',
  'login.brandRest': 'Illegal Construction Monitoring System',
  'login.title': 'Login',
  'login.username.label': 'Email ID / Mobile number',
  'login.username.placeholder': 'Enter here',
  'login.username.digits': '{count}/10 digits',
  'login.password.label': 'Password',
  'login.password.placeholder': '••••••••',
  'login.password.show': 'Show password',
  'login.password.hide': 'Hide password',
  'login.remember': 'Remember me',
  'login.rememberHint': 'Keeps your email ID or mobile number on this phone. Never the password.',
  'login.forgot': 'Forgot password ?',
  'login.cta': 'Login',
  'login.ctaBusy': 'Logging in…',
  'login.support.prefix': 'Facing issues? Contact support at',
  'login.support.callA11y': 'Call support on {number}',
  'login.support.noNumber': 'Facing issues? Call your office.',
  'login.version': 'Version {version}',
  'login.offline': 'No internet. Move to a place with signal and try again.',

  // Login: step two, the authenticator code
  'login.otp.title': "Verify it's you",
  'login.otp.body': 'Open your authenticator app and type the 6-digit code it shows for ICMS now.',
  'login.otp.label': 'Authenticator code',
  'login.otp.placeholder': '6-digit code',
  'login.otp.digits': '{count}/6 digits',
  'login.otp.cta': 'Verify',
  'login.otp.ctaBusy': 'Checking…',
  'login.otp.account': 'Logging in as',
  'login.otp.back': 'Back to password',
  'login.otp.wrongPassword': 'No code app? Your password may be wrong — go back and check it.',
  'login.otp.noApp': 'No authenticator app yet? Set it up once on the ADA web portal, or call support.',

  // Login: notices above the form
  'login.notice.signedOut': 'You have logged out.',
  'login.notice.expired': 'You were logged out. Log in again to carry on.',

  // Login: problems, one per reason the sign-in service gives
  'login.error.heading': 'Could not log in',
  'login.error.badCredentials':
    'The password or the code is wrong. The app cannot tell which one. A code works for about 30 seconds and only once, so wait for the next code and type it quickly. If the password may be wrong, go back and type it again.',
  'login.error.badOtp':
    'That 6-digit code did not work. A code works for about 30 seconds and only once. Wait for the next code and type it quickly.',
  'login.error.accountIncomplete':
    'Your account setup is not finished. Log in once on the ADA web portal to finish it, then try again here.',
  'login.error.accountDisabled': 'This account is switched off. Call support to switch it on again.',
  'login.error.lockedOut':
    'Too many wrong tries, so this account is locked for about 15 minutes. Wait, then try again, or call support.',
  'login.error.appSetup': 'App setup problem. Call support.',
  'login.error.rateLimited': 'Too many tries from this network. Wait one minute and try again.',
  'login.error.network': 'Could not connect. Move to a place with signal and try again.',
  'login.error.unknown': 'Login did not work. Try again in a little while. If it keeps happening, call support.',
  'login.error.notSurveyor': 'This app is for field surveyors only. Use the ADA web portal.',

  // Login: checks before anything is sent
  'login.validation.usernameMissing': 'Enter your email ID or mobile number.',
  'login.validation.mobileLength': 'A mobile number has 10 digits.',
  'login.validation.mobileStart': 'A mobile number starts with 6, 7, 8 or 9.',
  'login.validation.usernameLength': 'Too short or too long. Use 3 to 64 letters or numbers.',
  'login.validation.usernameChars': 'Use only English letters, numbers and . _ - @',
  'login.validation.passwordMissing': 'Enter your password.',
  'login.validation.otpMissing': 'Enter the 6-digit code from your authenticator app.',
  'login.validation.otpLength': 'The code has 6 digits.',

  // Login: phone clock out of step (codes are made from the clock)
  'login.skew.title': 'Your phone clock is wrong.',
  'login.skew.body':
    'Codes are made from the clock, so they will not work until it is fixed. Turn on automatic date and time in phone settings, then log in.',
  'login.skew.ahead': 'Your phone is about {seconds} seconds ahead.',
  'login.skew.behind': 'Your phone is about {seconds} seconds behind.',

  // Login: forgot password sheet
  'login.forgotSheet.title': 'Forgot password?',
  'login.forgotSheet.body': 'Only the office can reset your password. Call support.',
  'login.forgotSheet.call': 'Call {number}',
  'login.forgotSheet.noNumber': 'Ask your office to reset your password.',

  // Login: footer (Figma 163:27)
  'login.footer.copyright': '© Government Cadastral & Land Records Authority',
  'login.footer.security': 'Security Policy',
  'login.footer.gis': 'GIS Portal',
  'login.footer.terms': 'Terms of Service',
} as const;

export type MessageKey = keyof typeof en;
