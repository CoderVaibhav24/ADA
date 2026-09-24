import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/*
 * Whether the handset is online, as the query layer already tracks it
 * (`services/api/query-client.ts` feeds onlineManager from expo-network).
 * One source, so a banner and the queries never disagree.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
