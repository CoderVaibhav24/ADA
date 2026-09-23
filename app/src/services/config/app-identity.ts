import Constants from 'expo-constants';

/*
 * The app's own name and version, from `app.config.ts`. The login brand and the
 * footer read these rather than a string of their own, so a rename is one edit.
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
