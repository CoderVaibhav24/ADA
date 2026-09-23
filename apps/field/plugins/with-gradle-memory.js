const { withGradleProperties } = require('expo/config-plugins');

/*
 * Gradle daemon memory for release builds.
 *
 * The template's `-Xmx2048m -XX:MaxMetaspaceSize=512m` ran out of Metaspace in
 * R8 (`minifyReleaseWithR8`) once expo-notifications brought Firebase Messaging
 * into the dex, and it already ran out in lint on expo-modules-core. A wedged
 * daemon then fails every later build until it is killed.
 */
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

const withGradleMemory = (config) =>
  withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'org.gradle.jvmargs'),
    );
    cfg.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    return cfg;
  });

module.exports = withGradleMemory;
