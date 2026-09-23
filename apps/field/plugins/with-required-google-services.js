const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/*
 * Fails an Android prebuild that has no google-services.json.
 *
 * Without it the binary builds, installs and runs — and never receives a push,
 * because FirebaseApp is not initialised and there is no FCM token to register.
 * That is the worst kind of failure: silent, and discovered on a handset in the
 * field. So it is loud here instead, at the one moment the file is consumed.
 *
 * ADA_ALLOW_NO_PUSH=1 is the explicit escape hatch for a build that does not need
 * push (a UI smoke build without Firebase access). It is never set for a build
 * that goes to a surveyor.
 */
const withRequiredGoogleServices = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const configured = cfg.android?.googleServicesFile;
      const projectRoot = cfg.modRequest.projectRoot;
      const resolved = configured ? path.resolve(projectRoot, configured) : null;

      if (resolved !== null && fs.existsSync(resolved)) {
        return cfg;
      }

      if (process.env.ADA_ALLOW_NO_PUSH === '1') {
        console.warn(
          '[with-required-google-services] ADA_ALLOW_NO_PUSH=1: building WITHOUT ' +
            'google-services.json. This binary cannot receive push notifications.',
        );
        return cfg;
      }

      const where =
        resolved === null
          ? 'ADA_GOOGLE_SERVICES_JSON is not set.'
          : `ADA_GOOGLE_SERVICES_JSON points at ${resolved}, which does not exist.`;
      throw new Error(
        `google-services.json is required for Android push. ${where}\n` +
          'Download it from the Firebase console (Project settings → Your apps → the ' +
          `Android app whose package is ${cfg.android?.package ?? '(unset)'}), keep it ` +
          'outside the repository, and run:\n' +
          '  ADA_GOOGLE_SERVICES_JSON=/path/to/google-services.json npx expo prebuild\n' +
          'To build deliberately without push, set ADA_ALLOW_NO_PUSH=1.',
      );
    },
  ]);

module.exports = withRequiredGoogleServices;
