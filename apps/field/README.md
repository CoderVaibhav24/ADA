# ADA ICMS — Field Survey App

The capture end of the ICMS enforcement workflow: a Field Surveyor receives an assigned
complaint, proves arrival with a GPS check-in, photographs the parcel, records findings,
recommends an action and submits.

Why it exists and what it must do: `docs/Agents-Mobile/project-overview.md`.
How it is put together: `docs/Agents-Mobile/Architecture.md`.
What the screens are: `docs/Agents-Mobile/ui-registry.md`.

This README covers the three things a person needs from the repository itself: how to run
it, how to ship a change, and what the identity provider has to be told.

---

## Layout

```
app/
  app.config.ts            build-time configuration; there is no app.json
  certs/                   OTA code-signing certificate (public half; the key is in infra/secrets/ota/)
  plugins/                 config plugins (per-ABI APK splits, google-services guard)
  scripts/                 API type generation, OTA publish/rollback
  src/
    app/                   expo-router route tree — thin files, one export each
    screens/               screen bodies (ui-registry.md §1)
    design-system/         tokens, atoms, molecules, organisms, templates
    services/
      api/                 the only place fetch is called; generated types; uploads
      auth/                OIDC, secure storage, offline-tolerant refresh
      config/              server-driven configuration
      push/                notification permission, device registration with ada-notify, tap routing
      storage/             secure store, MMKV, drafts, capture records
    store/                 zustand slices
```

The import rules between those directories are linted, not merely documented —
`eslint.config.js`, from `docs/Agents-Mobile/code-standards.md` §3.

## Running it

```bash
npm install            # at the monorepo root, not in app/
npm run api:types      # regenerate the typed client from the running API
npm run typecheck
npm run lint
npm run android        # builds and installs a dev client
```

This app cannot run in Expo Go: `react-native-mmkv` and `expo-secure-store` are native
modules. Use a development build.

`ADA_API_URL` points `npm run api:types` at the OpenAPI document; it defaults to the
active env's API (for `local`, `127.0.0.1` on the ada-api port in `ada.config.ts`).

### Switching environment

**To switch between localhost, dev and prod, edit one line in `apps/field/ada.config.ts`:
`export const ACTIVE_ENV: AdaEnvName = 'local';` (`'local'`, `'dev'` or `'prod'`), then
rebuild.** That file holds every host and port the app uses (ada-api, ada-notify, the OTA
server, the Keycloak client), and no other file may hard-code one. CI can set
`EXPO_PUBLIC_ADA_ENV` instead of editing the file.

- `local` reaches the compose stack through `LAN_HOST`: `10.0.2.2` on the Android
  emulator, `localhost` on the iOS simulator, the Mac's LAN IP on a physical device
  (ada-api and ada-notify are published on 127.0.0.1 only, so on an Android device over
  USB keep `localhost` and `adb reverse tcp:8010 tcp:8010`, and the same for 8011 and 8020).
- `dev` and `prod` are placeholders (`https://…REPLACE-ME`) until the deployments exist. A
  production build (`APP_VARIANT=production`) whose URLs are not `https://`, or still
  contain `REPLACE-ME`, fails at config time with the list of offending values.
- **OTA warning.** The runtime version is a fingerprint of the resolved app config, so
  switching `ACTIVE_ENV` produces a different fingerprint. Publish updates with the same
  env the binary was built with, or the update is never offered to it.

## Shipping a change

There is **no Expo account** and nothing in the flow uses EAS Build, EAS Update or the Expo
Push Service. Builds are local, updates come from `infra/ota/`, and push goes straight to
FCM and APNs from `ada-notify`.

Two paths, and they must not be confused.

### Build environment

Every build and every update for it is made with the same environment. The runtime
version is a fingerprint of the resolved app config and native project, so a different
value for any of these gives a different fingerprint, and the update is never offered to
the binary (measured: setting `ADA_GOOGLE_SERVICES_JSON` alone changes it).

| Variable | Build | Publish | Purpose |
| :-- | :-- | :-- | :-- |
| `ACTIVE_ENV` in `ada.config.ts` (or `EXPO_PUBLIC_ADA_ENV`) | `local`, `dev` or `prod` | same | Every host, port and the OIDC client; see §Switching environment |
| `APP_VARIANT` | optional; defaults to the env preset (`prod` → `production`, else `development`) | same | APNs environment (`aps-environment`) and default update channel |
| `ADA_OTA_URL` | optional override of the preset's `otaUrl`; must be `https://` for `production` | same | Manifest URL of the update server. Release builds refuse cleartext, so the `local` preset's `http://` URL only works in debug builds |
| `ADA_UPDATE_CHANNEL` | optional | same | Overrides the channel (defaults to `APP_VARIANT`) |
| `ADA_GOOGLE_SERVICES_JSON` | required for Android | same | Path to `google-services.json`, kept outside the repository |
| `EXPO_PUBLIC_ADA_API_URL`, `EXPO_PUBLIC_ADA_NOTIFY_URL`, `EXPO_PUBLIC_ADA_AUTH_*` | optional | same | One-off overrides of the preset's values, resolved in `ada.config.ts` into `extra.ada` |

The Android prebuild **fails** without `google-services.json`, with instructions
(`plugins/with-required-google-services.js`). A binary without it builds, installs and
never receives a push. `ADA_ALLOW_NO_PUSH=1` builds without it deliberately; never ship
that binary to a surveyor.

### A new build: anything native

This includes adding a native module, changing a permission, the icon, the splash screen
or `app.config.ts`. If `npx expo prebuild` would produce a different `android/` or `ios/`
directory, it is a build.

**Android: per-ABI release APKs.** `plugins/with-gradle-memory.js` raises the Gradle
daemon to 4 GiB heap and 1 GiB Metaspace. With the template's 512 MiB, R8 runs out once
Firebase Messaging is in the dex. If a build dies with `OutOfMemoryError: Metaspace`, the
daemon is wedged: run `./gradlew --stop` before retrying.

```bash
# ACTIVE_ENV = 'prod' in ada.config.ts (with real URLs), or EXPO_PUBLIC_ADA_ENV=prod
export APP_VARIANT=production
export ADA_GOOGLE_SERVICES_JSON=/secure/path/google-services.json
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease \
  -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease
ls -l app/build/outputs/apk/release/      # app-<abi>-release.apk
```

Release signing: the template signs `release` with the debug keystore. Before a build
leaves the team, generate an upload keystore (`keytool -genkeypair -v -keystore
ada-release.jks -alias ada -keyalg RSA -keysize 2048 -validity 10000`), keep it outside
the repository (`*.jks` is gitignored), and point `android/app/build.gradle`'s
`signingConfigs.release` at it through `~/.gradle/gradle.properties`. Every later APK must
be signed with the same key, or it will not install over the previous one.

**iOS: Xcode archive, signed with the Apple team.**

```bash
export APP_VARIANT=production   # with ACTIVE_ENV = 'prod', as for Android
npx expo prebuild --platform ios --clean
open ios/*.xcworkspace
```

In Xcode, select the app target, go to Signing & Capabilities, choose the Apple Developer
team and keep "Automatically manage signing". Check that Push Notifications is listed
(the `aps-environment` entitlement comes from `expo-notifications`). Then choose Product,
Archive, and in the Organizer choose Distribute App, App Store Connect, Upload.

`APP_VARIANT` decides the `aps-environment` written at prebuild and the APNs environment
the app reports with its token. At export, Xcode signs with the environment of the
distribution profile. So `APP_VARIANT` must match the route the build takes, or
`ada-notify` sends the token to the wrong gateway:

| Build | `APP_VARIANT` | `aps-environment` | Token works against |
| :-- | :-- | :-- | :-- |
| Development build run from Xcode | `development` | `development` | APNs **sandbox** |
| TestFlight, App Store, ad hoc, custom app | `production` | `production` | APNs **production** |

A sandbox token sent to production APNs fails, and vice versa
(`push-and-permissions.md` §8). If push works in the dev build and dies in TestFlight,
check `APP_VARIANT` first.

**TestFlight for testers.** Once the upload has processed in App Store Connect, add the
build to an internal testing group (up to 100 team members, no review). External testers
need one Beta App Review pass. The longer-term path to the authority's handsets is an
Apple Business Manager custom app.

### Over the air: anything JavaScript

A screen, a fix, a copy change. No reinstall, no store review. Updates come from our own
server, `infra/ota/`.

```bash
# The server (opt-in compose profile). It serves data/ota-updates/ read-only.
docker compose -f infra/compose/docker-compose.yml --profile ota up -d ada-ota

# Publish: export, sign, copy into data/ota-updates/<platform>/<runtime>/<channel>/, go live.
npm run update:publish -- --platform android --message "fix label on check-in"
npm run update:publish -- --platform all --channel production --message "…"

# What is live, and what can be rolled back to.
npm run update:list -- --platform android

# Roll back: re-publish the previous release (or --to <releaseId>) as a new update.
npm run update:rollback -- --platform android
npm run update:rollback -- --platform android --to 20260922T232323Z-b33c571-4f72

# Roll back to the JS the binary was installed with.
npm run update:rollback -- --platform android --embedded
```

A rollback is published as a **new** update with a new id and timestamp. A handset
running the bad update only accepts something newer, so pointing back at the old
manifest as it was would be ignored by exactly the handsets that need the rollback.

If the server runs on another host, publish locally and copy the tree across
(`rsync -a data/ota-updates/ host:/srv/ada/data/ota-updates/`). Release directories are
immutable, and the one-line `current` file is replaced atomically, so the copy is safe
while the server is running.

**The runtime version policy is `fingerprint`.** An update is published under the
fingerprint of the tree it was exported from, and a binary only asks for its own
fingerprint. An update that needs a native module the installed binary lacks therefore
has a different fingerprint and is never offered to that binary. The server answers
`noUpdateAvailable` and the binary keeps running its own bundle.

**Code signing is on.** `app.config.ts` embeds `certs/ota-code-signing.crt`. The app
rejects any manifest or directive that is not signed by the matching private key,
`infra/secrets/ota/private-key.pem` (gitignored). Signing happens in the publish script on
the publisher's machine. The update server holds no key, so a compromised update host can
withhold or replay a signed update but cannot ship new code. The publish script refuses
a key that does not match the embedded certificate.

- **Losing the key** means no further updates for every binary that embeds the
  certificate. Back it up offline.
- **Rotating it** is a new build: generate a new pair with
  `npx expo-updates codesigning:generate`, replace the certificate, rebuild and
  redistribute.

### Channels

| Channel | Built with | Who has it |
| :-- | :-- | :-- |
| `development` | `APP_VARIANT=development` (default) | dev builds on our own handsets |
| `production` | `APP_VARIANT=production` | UAT and the authority's handsets |

## Push notifications

The device side is `src/services/push/`, started by one call in the root layout.

- **Token.** `getDevicePushTokenAsync()` returns the native FCM token (Android) or APNs
  token (iOS). It is registered with `ada-notify` at `POST /v1/me/devices` after sign-in
  and on every token change, and unregistered at `POST /v1/me/devices/unregister` before a
  sign-out discards the bearer. Paths are in `src/services/push/constants.ts`; the base URL
  is the active env's `notifyBaseUrl` in `ada.config.ts`.
- **Permission.** A priming dialog appears once, after an interactive sign-in and never at
  launch, before the OS prompt. After "Not now" or an OS denial, the app never asks again.
  `enablePushFromSettings()` is there for a Profile toggle.
- **Tap.** The payload `{ type, case_ref, notification_id }` is a routing hint. A tap
  invalidates the cached case and opens `complaint/[caseRef]`, which refetches from the
  API. It also marks the notification read, fire-and-forget.
- **Android channel** `case-updates`, created at startup (before any registration, which
  needs a sign-in), and set as the FCM default channel by the `expo-notifications` plugin.
  `ada-notify` sets it as `android.notification.channel_id`.
- **Turned off in system settings after a grant.** Checked on every return to the
  foreground; the device is unregistered, so `ada-notify` stops sending to it.
- **Failure is silent.** Push unconfigured, refused or unreachable leaves a fully working
  app.

Secrets: `google-services.json` for the build (see above). The APNs `.p8` key and the FCM
service-account JSON belong to `ada-notify` on the server, never to the app.

## APK size

The size budget is a requirement, not an aspiration: government handsets, mixed and
mostly mid-range (`project-overview.md` M6). What holds it:

- **Per-ABI splits, no universal APK** — `plugins/with-android-abi-splits.js`. A handset
  downloads one architecture's native libraries instead of three.
- **R8 with resource shrinking** — `expo-build-properties` in `app.config.ts`.
- **Hermes**, which is the only engine in SDK 57.
- **No native map SDK.** The parcel thumbnail on the complaint detail screen is a static
  raster tile image fetched from the portal's tile service. Adding
  `@maplibre/maplibre-react-native` would add several megabytes per ABI for one picture.
- **No ML Kit.** `barcodeScannerEnabled: false` on the expo-camera plugin, which needs
  `expo.autolinking.buildFromSource: ["expo-camera"]` in `package.json` to take effect —
  SDK 57 ships expo-camera as a prebuilt AAR, and a flag in its `build.gradle` is only
  read when the module is compiled from source. Worth 6.2 MB, measured. The consequence:
  the barcode APIs on `CameraView` throw. Nothing in this workflow scans a barcode.
- **Compressed native libraries** (`useLegacyPackaging: true`): 21.4 MiB against 37.5 MiB
  on arm64. See `docs/Agents-Mobile/progress-tracker.md` §6 for when to reverse it.
- **Template modules removed.** `@expo/ui`, `expo-glass-effect`, `expo-symbols` and
  `expo-device` are gone from `package.json` with the demo screen that used them. Two of
  them return anyway as dependencies of `expo-router`; that finding, and what it costs,
  is in the tracker.

Measured sizes, where they go and the three remaining levers are in
`docs/Agents-Mobile/progress-tracker.md` §4.1. The arm64 split is **21.4 MiB** against a
20 MB target, with no screens in it yet.

To measure locally:

```bash
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
ls -l app/build/outputs/apk/release/
```

Two things about that build worth knowing before it surprises you:

- **Splits turn themselves off for an App Bundle.** AGP refuses a bundle assembled
  from several shrunk resource sets, so `plugins/with-android-abi-splits.js` reads the
  requested task names and disables the split when one of them is a `bundle` task. A
  bundle splits by ABI at delivery anyway. Do not ask for `assembleRelease` and
  `bundleRelease` in one invocation: the splits would be off for both.
- **Android lint runs out of metaspace** on the default `org.gradle.jvmargs`
  (`-Xmx2048m -XX:MaxMetaspaceSize=512m`) while analysing `expo-modules-core`. Lint has
  no bearing on size; pass `-x lintVitalAnalyzeRelease -x lintVitalReportRelease
  -x lintVitalRelease` to measure, and raise the metaspace before relying on lint in CI.

## Keycloak

The app signs in against the **same realm as the portal**, `pcsmcpl`, with its own
login form: the username and password are posted to
`<issuer>/protocol/openid-connect/token` with `grant_type=password` (a direct access
grant), exactly as the portal's form does. There is no browser redirect, no redirect
URI and no post-logout URI. The password is held only for that one request; it is
never logged or stored. Sign-out is local: tokens and cached server data are cleared
and the app returns to its own Login screen.

The issuer comes from ada-api's `/api/auth/config` (cached on the device). The client
is **not** `ada-web`; it is the native client below, set in `ada.config.ts`
(`EXPO_PUBLIC_ADA_AUTH_CLIENT_ID` overrides it).

The client the realm needs:

| Setting | Value | Why |
| :-- | :-- | :-- |
| Client ID | `ada-field` | Or whatever is agreed; then set `EXPO_PUBLIC_ADA_AUTH_CLIENT_ID` to match. |
| Client authentication | **Off** (public client) | A mobile binary cannot hold a secret. |
| Direct access grants | **On** | The in-app form posts `grant_type=password`. Off means every sign-in fails with `unauthorized_client`, shown as "not yet allowed to sign people in directly". |
| Standard flow | Off | No browser redirect is used. |
| Valid redirect URIs | *(empty)* | |
| Valid post logout redirect URIs | *(empty)* | Sign-out is local. |
| Web origins | *(empty)* | There is no browser origin; CORS does not apply. |
| Full scope allowed | **On** | Roles must reach the token or `me/capabilities` answers an empty role list. |
| Client scopes | `openid`, `profile`, `email` default; **`offline_access` optional** | The app requests `scope=openid profile email offline_access`, which makes the refresh token an offline token. |

Realm setting:

| Setting | Value | Why |
| :-- | :-- | :-- |
| Sessions → Offline Session Idle | **30 days** | A surveyor inactive for 30 days is signed out; one who uses the app keeps refreshing and stays signed in. Without `offline_access` the refresh token would die with the SSO idle timeout (30 minutes by default), far shorter than a field day. |
| Access token lifespan | Realm default | The app refreshes; a short access token is fine. |

Sign-in refusals are classified the way the portal classifies them (wrong
credentials, account not fully set up, account disabled, brute-force lockout, direct
grants off, unknown client, rate limit, network). A username is never confirmed or
denied. OTP / a second factor is out of scope for ICMS: an account that requires one
is told to call support.

Tokens are stored in the Keychain / Keystore through `expo-secure-store` and nowhere
else. A refresh that fails with no network moves the session to `stale` and keeps
everything on the device; only the provider actively refusing the grant signs anyone out.

## Permissions

Declared (Android merged release manifest): camera, fine and coarse location, background
location with a location foreground service (see below), notifications, and what the
libraries need (network, FCM, wake lock, boot receiver, biometric for secure storage).
`android.blockedPermissions` in `app.config.ts` strips `SYSTEM_ALERT_WINDOW` (RN template),
the Play install-referrer permission (`expo-application`; pointless for a sideloaded APK)
and ShortcutBadger's launcher badge permissions (the app never sets a badge count).

Location is granted per use, and a surveyor who grants **approximate** only (Android 12+
"Approximate", or iOS Precise Location off) is told that precise location is needed and
offered Settings (and, on Android, an in-app upgrade), instead of failing the accuracy
gate with a kilometre-scale number.

### Background location: declared, unused

Added on 2026-09-23 at the user's instruction so that a later OTA update can use it
without a reinstall (native permissions cannot be added over the air): Android
`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`; iOS
`UIBackgroundModes: location`; `expo-task-manager` installed. **Nothing uses it**: no code
requests background permission or starts location updates, and nothing is tracked until a
future release defines a task. (`plugins/with-no-background-fetch.js` removes the `fetch`
mode that expo-task-manager's auto-plugin adds.)

Risk, to be revisited **before any store submission**:

- **Google Play** requires a background-location declaration and review. Direct APK / MDM
  distribution is unaffected.
- **Apple App Store** review rejects a declared `location` background mode the app does
  not visibly use. TestFlight internal testing is unaffected.

## What is deliberately not here

- **No offline write queue.** Dropped for this build on 2026-09-22; see
  `docs/Agents-Mobile/progress-tracker.md` §6 for the decision and what replaced it.
  Findings drafts and capture uploads are the two exceptions that survived.
- **No Reports tab.** It has no design — `ui-registry.md` §5.
