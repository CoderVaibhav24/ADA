/**
 * The shape Keycloak hands the theme for each page.
 *
 * `ExtendKcContext` is where a realm's own additions would be declared — a
 * custom user attribute, an authenticator's extra field. ADA adds none yet, so
 * this is the stock context and the type exists to be imported by name rather
 * than reached for through keycloakify's internals.
 */
import type { ExtendKcContext } from "keycloakify/login";

export type KcContextExtension = {
  // Intentionally empty. Add realm-specific properties here when the login
  // flow starts carrying them.
};

export type KcContextExtensionPerPage = {};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;
