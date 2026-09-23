import { createContext, useContext } from 'react';

import type { Labeller } from './template';

/*
 * What every node on one screen shares: which screen it is, how to label a code,
 * whether the officer holds a capability, and how to refresh. Provided once by
 * SduiScreen; a node rendered outside one gets the inert default and hides
 * anything behind a capability.
 */
export type SduiRuntime = {
  readonly screenId: string;
  readonly labeller: Labeller;
  /** Advisory, from `/api/icms/me/capabilities`. The server decides again on every request. */
  readonly can: (permission: string) => boolean;
  readonly refresh: () => void;
};

const inert: SduiRuntime = {
  screenId: '',
  labeller: (_domain, code) => code,
  can: () => false,
  refresh: () => undefined,
};

export const SduiRuntimeContext = createContext<SduiRuntime>(inert);

export function useSduiRuntime(): SduiRuntime {
  return useContext(SduiRuntimeContext);
}
