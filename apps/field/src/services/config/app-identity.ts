import Constants from 'expo-constants';

/*
 * The app's own name and version, from `app.config.ts`, and who to call for help.
 * The login brand and footer read these rather than a string of their own.
 */
export type AppIdentity = {
  readonly name: string | null;
  readonly version: string | null;
};

export function appIdentity(): AppIdentity {
  const config = Constants.expoConfig ?? null;
  return {
    name: typeof config?.name === 'string' && config.name !== '' ? config.name : null,
    version: typeof config?.version === 'string' && config.version !== '' ? config.version : null,
  };
}

export type AppContact = {
  readonly supportPhone: string | null;
  readonly securityPolicyUrl: string | null;
  readonly gisPortalUrl: string | null;
  readonly termsOfServiceUrl: string | null;
};

// A non-empty string, or null.
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// An https:// or http:// link, or null; anything else is not offered as a link.
function link(value: unknown): string | null {
  const url = text(value);
  return url !== null && /^https?:\/\//.test(url) ? url : null;
}

// Support number and login footer links, from ada.config.ts via extra.ada.contact.
export function appContact(): AppContact {
  const extra: unknown = Constants.expoConfig?.extra;
  const ada: unknown = extra !== null && typeof extra === 'object' ? (extra as Record<string, unknown>).ada : null;
  const contact: unknown = ada !== null && typeof ada === 'object' ? (ada as Record<string, unknown>).contact : null;
  const bag = contact !== null && typeof contact === 'object' ? (contact as Record<string, unknown>) : {};
  return {
    supportPhone: text(bag.supportPhone),
    securityPolicyUrl: link(bag.securityPolicyUrl),
    gisPortalUrl: link(bag.gisPortalUrl),
    termsOfServiceUrl: link(bag.termsOfServiceUrl),
  };
}

// The number as the dialler wants it: digits and a leading plus only.
export function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}
