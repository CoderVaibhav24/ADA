/**
 * PendingBanner — OfflineBanner fed from the device: offline state from the query
 * layer and the unsent-work counts from the capture and check-in records on disk. A
 * tap opens Pending uploads. Placed in every list template's banner slot.
 */

import { useRouter } from 'expo-router';

import { useOutbox } from '@/services/inspection/outbox';
import { useIsOnline } from '@/services/net/connectivity';

import { OfflineBanner } from '../molecules';
import type { LayoutStyle } from '../tokens';

export type PendingBannerProps = {
  style?: LayoutStyle;
};

// Nothing to say, nothing drawn.
export function PendingBanner({ style }: PendingBannerProps) {
  const router = useRouter();
  const online = useIsOnline();
  const outbox = useOutbox();
  return (
    <OfflineBanner
      testID="pending-banner"
      offline={!online || !outbox.online}
      waiting={outbox.uploads.length + outbox.submits.length}
      failed={outbox.failed + outbox.submits.filter((record) => record.state === 'refused').length}
      sending={outbox.sending}
      onPress={() => router.push('/pending-uploads')}
      style={style}
    />
  );
}
