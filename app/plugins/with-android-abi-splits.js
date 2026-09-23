const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

/*
 * Per-ABI APKs instead of one universal APK.
 *
 * A universal APK carries every architecture's native libraries, and native
 * libraries are most of this binary: React Native, Hermes, the camera and the
 * MMKV core all ship a .so per ABI. Splitting them means a handset downloads
 * one architecture, which is close to half the universal size.
 *
 * `universalApk false` is the load-bearing line. Turning it back on for
 * convenience re-adds everything this plugin exists to remove.
 */
const SPLITS_BLOCK = `
    // Added by plugins/with-android-abi-splits.js — see app/README.md.
    //
    // Splits are off while building an App Bundle: AGP refuses a bundle built from
    // multiple shrunk resource sets (issuetracker 402800800), and a bundle already
    // splits by ABI at delivery, so nothing is lost by turning them off there.
    def adaBuildingBundle = gradle.startParameter.taskNames.any {
        it.toLowerCase().contains("bundle")
    }
    splits {
        abi {
            enable !adaBuildingBundle
            reset()
            include "armeabi-v7a", "arm64-v8a", "x86_64"
            universalApk false
        }
    }
`;

/*
 * Play refuses two APKs with the same versionCode, so each ABI gets its own
 * offset. Harmless for direct APK distribution; required if B3 resolves to Play.
 */
const VERSION_CODES_BLOCK = `
// Added by plugins/with-android-abi-splits.js.
def adaAbiVersionCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 3]
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abi = output.getFilter(com.android.build.OutputFile.ABI)
        if (abi != null) {
            def base = android.defaultConfig.versionCode ?: 1
            output.versionCodeOverride = adaAbiVersionCodes.get(abi) * 1000000 + base
        }
    }
}
`;

const ABIS = 'armeabi-v7a,arm64-v8a,x86_64';

/*
 * The template compiles four architectures and this packages three. Compiling an
 * ABI nothing ships is minutes of NDK time per build and nothing else.
 */
const withMatchingArchitectures = (config) =>
  withGradleProperties(config, (cfg) => {
    const properties = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    properties.push({ type: 'property', key: 'reactNativeArchitectures', value: ABIS });
    cfg.modResults = properties;
    return cfg;
  });

const withSplitsGradle = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    if (contents.includes('with-android-abi-splits')) {
      return cfg;
    }

    const androidBlock = contents.match(/^android \{$/m);
    if (!androidBlock) {
      throw new Error(
        'with-android-abi-splits: no `android {` block in app/build.gradle. The ' +
          'template changed shape; fix the plugin rather than dropping the splits.',
      );
    }

    contents = contents.replace(/^android \{$/m, `android {\n${SPLITS_BLOCK}`);
    cfg.modResults.contents = `${contents}\n${VERSION_CODES_BLOCK}`;
    return cfg;
  });

// Both halves: what gets compiled, and what gets packaged.
const withAndroidAbiSplits = (config) => withMatchingArchitectures(withSplitsGradle(config));

module.exports = withAndroidAbiSplits;
