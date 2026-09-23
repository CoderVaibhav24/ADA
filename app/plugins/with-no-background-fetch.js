const { withInfoPlist } = require('expo/config-plugins');

/*
 * Removes the iOS `fetch` background mode.
 *
 * expo-task-manager is on prebuild's legacy auto-plugin list, so it is applied
 * whenever the package is installed, listed or not, and it always adds `fetch`.
 * Nothing in this app does background fetch, and App Store review rejects a
 * declared background mode the app does not use. `location` (declared on purpose,
 * see app.config.ts) and `remote-notification` are left alone.
 *
 * Ordering: a mod registered later runs earlier, and auto-plugins are registered
 * after the app's own plugins, so this runs after expo-task-manager has added it.
 */
const withNoBackgroundFetch = (config) =>
  withInfoPlist(config, (cfg) => {
    const modes = cfg.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      cfg.modResults.UIBackgroundModes = modes.filter((mode) => mode !== 'fetch');
    }
    return cfg;
  });

module.exports = withNoBackgroundFetch;
