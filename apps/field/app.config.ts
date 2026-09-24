import type { ConfigContext, ExpoConfig } from 'expo/config';

import { appContactFor, resolveAdaConfig } from './ada.config.ts';

/*
 * Build-time configuration. `app.json` was removed in favour of this file. Which
 * deployment the app talks to is decided in one place, `ada.config.ts` (ACTIVE_ENV);
 * no host or port may be written here or anywhere else.
 *
 * There is no Expo account. Nothing here may point at EAS or Expo Push: builds are
 * local (Gradle, Xcode), updates come from `infra/ota/`, push goes device ⇄ FCM/APNs
 * with `ada-notify` as the sender. See apps/field/README.md §Shipping a change.
 *
 * Everything under `extra.ada` is build-time and baked into the binary. Everything
 * the workflow can change — statuses, option lists, thresholds, enabled actions —
 * is fetched at runtime by `src/services/config/`.
 */

/*
 * Hosts, ports, OIDC client and variant all come from `ada.config.ts`: change
 * ACTIVE_ENV there to switch the whole app. `resolveAdaConfig` throws here, at config
 * time, if a production build would ship an http:// or REPLACE-ME URL.
 *
 * APP_VARIANT (`development` or `production`, from the preset unless the build
 * environment sets it) decides the APNs environment the binary is signed for and the
 * default update channel, so a build and its updates must use the same value.
 */
const ADA = resolveAdaConfig();
const APP_VARIANT = ADA.appVariant;

// Public half of the OTA signing key. The private half lives in infra/secrets/ota/, never here.
const OTA_CODE_SIGNING_CERTIFICATE = './certs/ota-code-signing.crt';

/*
 * PLACEHOLDER, blocked on progress-tracker §5 B3 (distribution route). Changing an
 * application id after release orphans every installed app, so it is decided once,
 * with the distribution route, and not revisited.
 */
const ANDROID_PACKAGE = 'com.adaicms.field';
const IOS_BUNDLE_ID = 'com.adaicms.field';

// Build-time environment variable, or the fallback when unset or empty.
function or(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== '' ? value : fallback;
}

const UPDATE_CHANNEL = or(process.env.ADA_UPDATE_CHANNEL, APP_VARIANT);
const APNS_ENVIRONMENT = APP_VARIANT === 'production' ? 'production' : 'development';

/*
 * google-services.json is not committed: it names the Firebase project. The path
 * comes from the environment and `plugins/with-required-google-services.js` fails
 * the prebuild with instructions when it is missing.
 */
const GOOGLE_SERVICES_FILE = process.env.ADA_GOOGLE_SERVICES_JSON;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ADA ICMS',
  slug: 'ada-icms-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'adaicms',
  userInterfaceStyle: 'automatic',
  // The native window behind React: colors.figScreen, so no white shows before the first frame.
  backgroundColor: '#463E2F',

  /*
   * Over-the-air updates from our own server (`infra/ota/`), not EAS Update.
   *
   * The fingerprint policy hashes the native project into the runtime version. An
   * update is published under the fingerprint of the tree it was exported from,
   * and a binary only asks for its own fingerprint — so a bundle that needs a
   * native module the installed binary lacks is never offered to it.
   *
   * The fingerprint also covers this resolved config, so switching ACTIVE_ENV in
   * `ada.config.ts` changes it: publish updates with the env the binary was built with.
   *
   * Code signing is the security floor: the binary trusts only manifests signed by
   * the key in infra/secrets/ota/, so whoever controls the update host still
   * cannot push arbitrary JavaScript to handsets.
   */
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    url: ADA.otaUrl,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    // A surveyor opening the app at a gate must not wait on a tile-less connection.
    fallbackToCacheTimeout: 3000,
    requestHeaders: { 'expo-channel-name': UPDATE_CHANNEL },
    codeSigningCertificate: OTA_CODE_SIGNING_CERTIFICATE,
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  },

  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    icon: './assets/expo.icon',
    supportsTablet: false,
  },

  android: {
    package: ANDROID_PACKAGE,
    ...(GOOGLE_SERVICES_FILE !== undefined && GOOGLE_SERVICES_FILE !== ''
      ? { googleServicesFile: GOOGLE_SERVICES_FILE }
      : {}),
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    /*
     * The build-time superset (code-standards.md §10). Adding one later is a new
     * APK, not an update, so the list is decided deliberately.
     *
     * Background location was deliberately absent until 2026-09-23, when it was added
     * at the user's instruction: ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE and
     * FOREGROUND_SERVICE_LOCATION (plus UIBackgroundModes `location` on iOS, via the
     * expo-location plugin below). It is UNUSED: no code requests background permission
     * or starts location updates, so nothing is tracked until a future release defines a
     * task. It is declared now only so an OTA update can use it without a reinstall.
     * RISK, to revisit before any store submission:
     *   - Google Play requires a background-location declaration form and review.
     *     Direct APK / MDM distribution is unaffected.
     *   - App Store review rejects a declared `location` background mode the app does
     *     not visibly use. TestFlight internal testing is unaffected.
     */
    permissions: [
      'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
    /*
     * Stripped from the merged release manifest (tools:node="remove"), whatever
     * library declares them. Each one is unused by this app:
     *   - SYSTEM_ALERT_WINDOW: RN template's dev-menu overlay; the app never draws over others.
     *   - BIND_GET_INSTALL_REFERRER_SERVICE: Play install referrer, from expo-application
     *     (pulled in by expo-notifications). Nothing calls
     *     getInstallReferrerAsync, and a sideloaded APK has no Play referrer anyway.
     *   - Launcher badge permissions: ShortcutBadger, from expo-notifications. Used only by
     *     setBadgeCountAsync, which the app never calls (the handler sets shouldSetBadge:
     *     false); Android 8+ notification dots come from the channel and need none of them.
     * Kept on purpose: USE_BIOMETRIC/USE_FINGERPRINT (expo-secure-store; normal
     * permissions, no prompt, needed if `requireAuthentication` is ever turned on over
     * the air) and RECEIVE_BOOT_COMPLETED (expo-notifications, expo-task-manager).
     */
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
      'com.android.launcher.permission.READ_SETTINGS',
      'com.android.launcher.permission.WRITE_SETTINGS',
      'com.android.launcher.permission.INSTALL_SHORTCUT',
      'com.android.launcher.permission.UNINSTALL_SHORTCUT',
      'com.sec.android.provider.badge.permission.READ',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.htc.launcher.permission.READ_SETTINGS',
      'com.htc.launcher.permission.UPDATE_SHORTCUT',
      'com.sonyericsson.home.permission.BROADCAST_BADGE',
      'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
      'com.anddoes.launcher.permission.UPDATE_COUNT',
      'com.majeur.launcher.permission.UPDATE_BADGE',
      'com.huawei.android.launcher.permission.CHANGE_BADGE',
      'com.huawei.android.launcher.permission.READ_SETTINGS',
      'com.huawei.android.launcher.permission.WRITE_SETTINGS',
      'android.permission.READ_APP_BADGE',
      'com.oppo.launcher.permission.READ_SETTINGS',
      'com.oppo.launcher.permission.WRITE_SETTINGS',
      'me.everything.badger.permission.BADGE_COUNT_READ',
      'me.everything.badger.permission.BADGE_COUNT_WRITE',
    ],
  },

  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-secure-store',
    'expo-updates',
    // Case-location map preview; required on iOS (Podfile post_install), no-op on Android.
    '@maplibre/maplibre-react-native',
    [
      'expo-camera',
      {
        cameraPermission:
          'ADA ICMS uses the camera to photograph the parcel you are inspecting. ' +
          'Every photograph is stamped with its location and time.',
        recordAudioAndroid: false,
        // Photos only: no NSMicrophoneUsageDescription, so iOS never shows a microphone prompt.
        microphonePermission: false,
        /*
         * Nothing in the ICMS workflow scans a barcode, and the scanner is not
         * free: leaving it on packages ML Kit — `libbarhopper_v3.so` at 4.7 MB,
         * the TensorFlow Lite barcode models, and the Play Services and Firebase
         * classes they pull into the dex. Measured on the arm64 release APK, this
         * one option is the largest single saving available to this app.
         */
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-location',
      {
        // The prompt the app actually makes today (requestForegroundPermissionsAsync).
        locationWhenInUsePermission:
          'ADA ICMS records your position when you check in at a property and stamps it ' +
          'on each inspection photograph, so the office can verify where the inspection ' +
          'was done. Precise location is needed: the check-in must be accurate to tens of metres.',
        // Shown only if a future release asks for "Always". Nothing asks today.
        locationAlwaysAndWhenInUsePermission:
          'ADA ICMS records your position when you check in and stamps it on inspection ' +
          'photographs. If allowed "Always", a future version may also record location ' +
          'during an active inspection while the app is in the background.',
        locationAlwaysPermission:
          'ADA ICMS records your position when you check in and stamps it on inspection ' +
          'photographs. If allowed "Always", a future version may also record location ' +
          'during an active inspection while the app is in the background.',
        // No motion-activity API is called: no NSMotionUsageDescription placeholder prompt on iOS.
        motionUsagePermission: false,
        // Declared 2026-09-23 for future use, unused. See the android.permissions comment.
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // R8 plus resource shrinking. The pair is what the size budget rests on.
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          /*
           * Compressed native libraries in the APK. Measured on this build:
           * arm64 21.4 MiB compressed against 37.5 MiB uncompressed, because the
           * .so files are 23.7 MiB of it and they compress to about 7 MiB.
           *
           * It is a trade, not a free win: the installer extracts them, so the
           * on-device footprint is larger. It is set this way because the artefact
           * that actually moves — sideloaded to a government handset over whatever
           * connection is available — is the APK file. If B3 resolves to Play
           * distribution, set this back to `false`: an App Bundle is compressed in
           * transit regardless, and uncompressed libraries then cost nothing.
           */
          useLegacyPackaging: true,
          /*
           * The other half of `barcodeScannerEnabled: false`. With ML Kit dropped to
           * `compileOnly`, expo-camera's compiled barcode analyser still names those
           * classes, and R8 refuses to finish on a missing reference it was not told
           * about. These rules say "that code is unreachable, carry on" — which it is:
           * nothing in this app calls a barcode API, and a call that somehow did would
           * throw NoClassDefFoundError rather than scan anything.
           */
          extraProguardRules: [
            '-dontwarn com.google.mlkit.**',
            '-dontwarn com.google.android.gms.internal.mlkit_**',
            '-dontwarn androidx.camera.mlkit.**',
          ].join('\n'),
        },
        ios: {
          useFrameworks: 'static',
        },
      },
    ],
    [
      'expo-notifications',
      {
        // Monochrome: Android renders the small icon as a silhouette in the status bar.
        icon: './assets/images/android-icon-monochrome.png',
        color: '#208AEF',
        // Must match PUSH_CHANNEL_ID in src/services/push/constants.ts and ada-notify's FCM payload.
        defaultChannel: 'case-updates',
        // Sandbox for development builds, production for TestFlight and release. Never mix.
        mode: APNS_ENVIRONMENT,
      },
    ],
    './plugins/with-required-google-services',
    './plugins/with-android-abi-splits',
    './plugins/with-gradle-memory',
    // expo-task-manager (installed for a future background-location task) auto-adds iOS `fetch`; unused, so removed.
    './plugins/with-no-background-fetch',
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    router: {},
    ada: {
      // Every value below is resolved from ada.config.ts; see that file to switch env.
      env: ADA.env,
      appVariant: APP_VARIANT,
      // Reported with the device token: a sandbox token sent to production APNs fails.
      apnsEnvironment: APNS_ENVIRONMENT,
      notifyBaseUrl: ADA.notifyBaseUrl,
      apiBaseUrl: ADA.apiBaseUrl,
      authClientId: ADA.authClientId,
      // Normally empty: the issuer is read from the API's /api/auth/config, the
      // same source the portal uses, so one deployment cannot drift from the other.
      authIssuerOverride: ADA.authIssuer ?? '',
      // Support number and login footer links (ada.config.ts appContactFor).
      contact: appContactFor(ADA.env),
    },
  },
});
