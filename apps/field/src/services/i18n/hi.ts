import type { MessageKey } from './en';
import { casesHi } from './messages/cases.hi';
import { shellHi } from './messages/shell.hi';
import { wizardHi } from './messages/wizard.hi';

/**
 * Hindi strings: everyday Hindi a field worker in UP speaks, not officialese.
 * Typed against `en`, so a missing or extra key fails typecheck. Glossary: docs/Agents-Mobile/i18n.md.
 */
export const hi: Record<MessageKey, string> = {
  ...casesHi,
  ...shellHi,
  ...wizardHi,
  // Shared words
  'common.loading': 'लोड हो रहा है…',
  'common.close': 'बंद करें',
  'common.back': 'पीछे',
  'common.goBack': 'पीछे जाएं',
  'common.next': 'आगे',
  'common.retry': 'दोबारा कोशिश करें',
  'common.confirm': 'पक्का करें',
  'common.cancel': 'रद्द करें',
  'common.yes': 'हाँ',
  'common.no': 'नहीं',
  'common.select': 'चुनें',
  'common.search': 'खोजें',
  'common.clearSearch': 'खोज मिटाएं',
  'common.inProgress': 'यह सुविधा अभी बन रही है।',
  'common.unread': 'नहीं पढ़ा',
  'common.photoCount.one': '{count} फोटो',
  'common.photoCount.other': '{count} फोटो',

  // Language choice and toggle
  'language.choose.title': 'अपनी भाषा चुनें',
  'language.choose.subtitle': 'इसे बाद में प्रोफ़ाइल से बदल सकते हैं।',
  'language.hindi': 'हिंदी',
  'language.english': 'English',
  'language.hindiShort': 'हिं',
  'language.englishShort': 'EN',
  'language.hindiInOther': 'हिंदी',
  'language.englishInOther': 'अंग्रेज़ी',
  'language.toggle.label': 'भाषा बदलें',
  'language.toggle.toHindi': 'ऐप हिंदी में दिखाएं',
  'language.toggle.toEnglish': 'ऐप अंग्रेज़ी में दिखाएं',

  // Bottom tabs
  'tabs.home': 'होम',
  'tabs.complaints': 'शिकायतें',
  'tabs.inspections': 'निरीक्षण',
  'tabs.profile': 'प्रोफ़ाइल',

  // GPS panel
  'gps.state.locked': 'GPS मिल गया',
  'gps.state.weak': 'GPS कमज़ोर है',
  'gps.state.none': 'GPS नहीं मिल रहा',
  'gps.state.searching': 'GPS ढूंढ रहे हैं…',
  'gps.lastKnown': '· आखिरी पता चली जगह',
  'gps.coordinatesUnavailable': 'जगह अभी पता नहीं चली',
  'gps.accuracyPending': 'सटीकता जाँच रहे हैं…',
  'gps.accuracy': 'सटीकता ±{meters} मीटर',
  'gps.required': '· चाहिए ±{meters} मीटर',
  'gps.captured': 'लिया गया {time}',

  // Photo thumbnail
  'photo.source.gallery': 'गैलरी से',
  'photo.source.geotagged': 'जगह दर्ज है',
  'photo.source.noLocation': 'जगह दर्ज नहीं',
  'photo.a11y': 'फोटो, {provenance}',
  'photo.a11yAccuracy': 'फोटो, {provenance}, सटीकता {meters} मीटर',
  'photo.remove': 'फोटो हटाएं',
  'photo.removeHint': 'यह फोटो निरीक्षण से हट जाएगी। जमा करने से पहले ही हटा सकते हैं।',

  // Case status and priority chips
  'status.new': 'नई',
  'status.scheduled': 'तय है',
  'status.inProgress': 'चल रहा है',
  'status.completed': 'पूरा हुआ',
  'status.overdue': 'देर हो गई',
  'priority.high': 'ज़्यादा',
  'priority.medium': 'मध्यम',
  'priority.low': 'कम',
  'priority.a11y': 'प्राथमिकता {level}',

  // Notification row
  'notification.unreadPrefix': 'नहीं पढ़ा।',
  'notification.hint.openCase': 'केस खुलेगा और फिर से लोड होगा',
  'notification.hint.markRead': 'इसे पढ़ा हुआ मान लेगा',

  // Inspection wizard shell
  'stepper.progress': 'चरण {current} / {total}',
  'stepper.a11y': 'चरण {current} / {total}: {name}',
  'wizard.exit': 'बाहर निकलें',
  'wizard.exitA11y': 'निरीक्षण से बाहर निकलें',
  'wizard.exitHint': 'आपका काम सेव रहेगा',
  'wizard.backHint': 'भरी हुई सारी जानकारी बनी रहेगी',

  // Errors any screen can show
  'error.offline': 'इंटरनेट नहीं है। सिग्नल वाली जगह पर जाकर दोबारा कोशिश करें।',
  'error.timeout': 'सर्वर जवाब देने में बहुत देर लगा रहा है। कुछ मिनट बाद दोबारा कोशिश करें।',
  'error.server': 'सर्वर में दिक्कत है। कुछ मिनट बाद दोबारा कोशिश करें।',
  'error.busy': 'बहुत बार कोशिश हुई। एक मिनट रुकें और दोबारा कोशिश करें।',
  'error.loggedOut': 'आप लॉग आउट हो गए हैं। दोबारा लॉग इन करें।',
  'error.forbidden': 'आप इसे नहीं खोल सकते। अगर यह गलत है तो सहायता पर कॉल करें।',
  'error.notFound': 'यह अब उपलब्ध नहीं है। पीछे जाकर सूची फिर से खोलें।',
  'error.update': 'आगे करने के लिए ऐप अपडेट करें।',
  'error.refused': 'ऑफिस ने इसे नहीं लिया। जांच कर दोबारा कोशिश करें। बार-बार हो तो सहायता पर कॉल करें।',
  'error.unknown': 'कुछ गड़बड़ हुई। दोबारा कोशिश करें। बार-बार हो तो सहायता पर कॉल करें।',

  // Relative time
  'time.justNow': 'अभी',
  'time.minutesAgo': '{count} मिनट पहले',
  'time.hoursAgo': '{count} घंटे पहले',
  'time.daysAgo.one': '{count} दिन पहले',
  'time.daysAgo.other': '{count} दिन पहले',

  // Distance on a complaint card
  'distance.meters': '{value} मीटर',
  'distance.km': '{value} किमी',
  'distance.minutes': '{count} मिनट',
  'distance.approx': 'लगभग {value}',
  'distance.lastKnown': '· आखिरी जगह से',
  'distance.lastKnownA11y': '{text}, आपकी आखिरी पता चली जगह से',
  'tabs.badgeA11y': '{label} में {count} नहीं पढ़े',

  // Sync
  'sync.pendingCount.one': '{count} फोटो अपलोड होनी बाकी है',
  'sync.pendingCount.other': '{count} फोटो अपलोड होनी बाकी हैं',

  // Server-driven screens
  'sdui.actionFailed': 'यह काम नहीं हो पाया',
  'sdui.blockFailed': 'यह हिस्सा नहीं दिख सका।',
  'sdui.blockNotAllowed': 'यह हिस्सा ऐप में नहीं दिख सकता।',
  'sdui.unreadableScreen': 'ऐप यह स्क्रीन नहीं पढ़ सका। ऐप अपडेट करें।',
  'sdui.needsNewerApp': 'इस स्क्रीन के लिए ऐप का नया वर्ज़न चाहिए। ऐप अपडेट करें।',
  'sdui.savedCopyUpdate': 'इस फ़ोन में सेव कॉपी दिख रही है। नई कॉपी देखने के लिए ऐप अपडेट करें।',
  'sdui.savedCopy': 'इस फ़ोन में सेव कॉपी दिख रही है। {reason}',
  'sdui.failure.update': 'यह स्क्रीन खोलने के लिए ऐप अपडेट करें',
  'sdui.failure.forbidden': 'यह स्क्रीन आपके खाते के लिए नहीं है',
  'sdui.failure.generic': 'यह स्क्रीन नहीं खुल सकी',

  // Login: brand and card (web login, Figma 147:900)
  'login.brandShort': 'ICMS-',
  'login.brandRest': 'अवैध निर्माण निगरानी सिस्टम',
  'login.title': 'लॉग इन',
  'login.username.label': 'ईमेल आईडी / मोबाइल नंबर',
  'login.username.placeholder': 'यहाँ लिखें',
  'login.username.digits': '{count}/10 अंक',
  'login.password.label': 'पासवर्ड',
  'login.password.placeholder': '••••••••',
  'login.password.show': 'पासवर्ड दिखाएं',
  'login.password.hide': 'पासवर्ड छिपाएं',
  'login.remember': 'मुझे याद रखें',
  'login.rememberHint': 'आपकी ईमेल आईडी या मोबाइल नंबर इस फ़ोन में सेव रहेगा। पासवर्ड कभी नहीं।',
  'login.forgot': 'पासवर्ड भूल गए?',
  'login.cta': 'लॉग इन करें',
  'login.ctaBusy': 'लॉग इन हो रहा है…',
  'login.support.prefix': 'कोई दिक्कत? सहायता के लिए कॉल करें',
  'login.support.callA11y': 'सहायता नंबर {number} पर कॉल करें',
  'login.support.noNumber': 'कोई दिक्कत? अपने ऑफिस को कॉल करें।',
  'login.version': 'वर्ज़न {version}',
  'login.offline': 'इंटरनेट नहीं है। सिग्नल वाली जगह पर जाकर दोबारा कोशिश करें।',

  // Login: step two, the authenticator code
  'login.otp.title': 'पहचान पक्की करें',
  'login.otp.body': 'अपना ऑथेंटिकेटर ऐप खोलें और उसमें ICMS का अभी दिख रहा 6 अंकों का कोड लिखें।',
  'login.otp.label': 'ऑथेंटिकेटर कोड',
  'login.otp.placeholder': '6 अंकों का कोड',
  'login.otp.digits': '{count}/6 अंक',
  'login.otp.cta': 'पक्का करें',
  'login.otp.ctaBusy': 'जाँच हो रही है…',
  'login.otp.account': 'इस खाते से लॉग इन',
  'login.otp.back': 'पासवर्ड पर वापस जाएं',
  'login.otp.wrongPassword': 'कोड वाला ऐप नहीं है? हो सकता है पासवर्ड गलत हो — वापस जाकर पासवर्ड जाँचें।',
  'login.otp.noApp': 'ऑथेंटिकेटर ऐप नहीं है? एक बार ADA वेब पोर्टल पर सेट करें, या सहायता पर कॉल करें।',

  // Login: notices above the form
  'login.notice.signedOut': 'आप लॉग आउट हो गए हैं।',
  'login.notice.expired': 'आप लॉग आउट हो गए थे। काम जारी रखने के लिए फिर से लॉग इन करें।',

  // Login: problems, one per reason the sign-in service gives
  'login.error.heading': 'लॉग इन नहीं हो पाया',
  'login.error.badCredentials':
    'पासवर्ड या कोड गलत है। ऐप यह नहीं बता सकता कि कौन सा। कोड लगभग 30 सेकंड चलता है और एक ही बार काम करता है, इसलिए अगला कोड आने दें और तुरंत लिखें। अगर पासवर्ड गलत हो सकता है, तो पीछे जाकर दोबारा लिखें।',
  'login.error.badOtp':
    'यह 6 अंकों का कोड नहीं चला। कोड लगभग 30 सेकंड चलता है और एक ही बार काम करता है। अगला कोड आने दें और तुरंत लिखें।',
  'login.error.accountIncomplete':
    'आपके खाते की सेटिंग अधूरी है। एक बार ADA वेब पोर्टल पर लॉग इन करके इसे पूरा करें, फिर यहाँ दोबारा कोशिश करें।',
  'login.error.accountDisabled': 'यह खाता बंद है। चालू करवाने के लिए सहायता पर कॉल करें।',
  'login.error.lockedOut':
    'बहुत बार गलत कोशिश हुई, इसलिए खाता लगभग 15 मिनट के लिए बंद है। थोड़ा रुकें, फिर कोशिश करें, या सहायता पर कॉल करें।',
  'login.error.appSetup': 'ऐप की सेटिंग में दिक्कत है। सहायता पर कॉल करें।',
  'login.error.rateLimited': 'इस नेटवर्क से बहुत बार कोशिश हुई। एक मिनट रुकें और दोबारा कोशिश करें।',
  'login.error.network': 'कनेक्ट नहीं हो पाया। सिग्नल वाली जगह पर जाकर दोबारा कोशिश करें।',
  'login.error.unknown': 'लॉग इन नहीं हो पाया। थोड़ी देर बाद दोबारा कोशिश करें। बार-बार हो तो सहायता पर कॉल करें।',
  'login.error.notSurveyor': 'यह ऐप सिर्फ़ फील्ड सर्वेयर के लिए है। ADA वेब पोर्टल इस्तेमाल करें।',

  // Login: checks before anything is sent
  'login.validation.usernameMissing': 'अपनी ईमेल आईडी या मोबाइल नंबर लिखें।',
  'login.validation.mobileLength': 'मोबाइल नंबर 10 अंकों का होता है।',
  'login.validation.mobileStart': 'मोबाइल नंबर 6, 7, 8 या 9 से शुरू होता है।',
  'login.validation.usernameLength': 'बहुत छोटा या बहुत लंबा है। 3 से 64 अक्षर या अंक लिखें।',
  'login.validation.usernameChars': 'सिर्फ़ अंग्रेज़ी अक्षर, अंक और . _ - @ लिखें।',
  'login.validation.passwordMissing': 'अपना पासवर्ड लिखें।',
  'login.validation.otpMissing': 'ऑथेंटिकेटर ऐप से 6 अंकों का कोड लिखें।',
  'login.validation.otpLength': 'कोड 6 अंकों का होता है।',

  // Login: phone clock out of step (codes are made from the clock)
  'login.skew.title': 'आपके फ़ोन की घड़ी गलत है।',
  'login.skew.body':
    'कोड घड़ी से बनते हैं, इसलिए घड़ी ठीक होने तक कोड नहीं चलेंगे। फ़ोन की सेटिंग में अपने-आप तारीख और समय वाला विकल्प चालू करें, फिर लॉग इन करें।',
  'login.skew.ahead': 'आपका फ़ोन लगभग {seconds} सेकंड आगे चल रहा है।',
  'login.skew.behind': 'आपका फ़ोन लगभग {seconds} सेकंड पीछे चल रहा है।',

  // Login: forgot password sheet
  'login.forgotSheet.title': 'पासवर्ड भूल गए?',
  'login.forgotSheet.body': 'पासवर्ड सिर्फ़ ऑफिस से बदला जा सकता है। सहायता पर कॉल करें।',
  'login.forgotSheet.call': '{number} पर कॉल करें',
  'login.forgotSheet.noNumber': 'पासवर्ड बदलवाने के लिए अपने ऑफिस से बात करें।',

  // Login: footer (Figma 163:27)
  'login.footer.copyright': '© सरकारी भू-नक्शा और भूमि रिकॉर्ड प्राधिकरण',
  'login.footer.security': 'सुरक्षा नीति',
  'login.footer.gis': 'GIS पोर्टल',
  'login.footer.terms': 'सेवा की शर्तें',
};
