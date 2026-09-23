/*
 * Server-driven configuration.
 *
 * The app hard-codes no status, option list, threshold or enabled action. Four
 * sources, all cached so they answer offline:
 *
 *   useCapabilities()         roles, permissions, zones and the actions this
 *                             officer holds — /api/icms/me/capabilities
 *   useCodeValues(domain)     every option list — /api/icms/code-values
 *   useWorkflowTransitions()  the whole state machine, when the role may read it
 *   useAppConfig()            thresholds and counts, with defaults until the
 *                             endpoint exists
 */
export { DEFAULT_APP_CONFIG, cacheAppConfig, currentAppConfig, type AppConfig } from './app-config';
export {
  actionFor,
  capabilitiesQueryKey,
  fetchCapabilities,
  hasPermission,
  useCapabilities,
} from './capabilities';
export { codeValuesQueryKey, fetchCodeValues, useCodeValues } from './code-values';
export { env, type AdaEnv } from './env';
export { fetchTransitions, transitionsQueryKey, useWorkflowTransitions } from './transitions';
export { appConfigQueryKey, fetchAppConfig, useAppConfig } from './use-app-config';
