/**
 * The header's live parts: the bell reads the inbox's unread count, the search pill
 * opens Search, the avatar opens Profile. They sit in organisms because they read
 * services and navigate; ScreenHeader places them, so every screen gets them wired.
 */

import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { inboxConfigured, useInbox } from '@/services/api/notification-reads';
import { displayName } from '@/services/auth/claims';
import { useTokenClaims } from '@/services/auth/use-token-claims';
import { useT } from '@/services/i18n';

import { Avatar } from '../atoms';
import { HeaderBellButton, HeaderSearchPill } from '../molecules';
import { layout, shell, type LayoutStyle } from '../tokens';

export type ShellBellProps = {
  /** `static` on the Notifications screen, where the bell is not a link (204:4317). */
  mode?: 'linked' | 'static';
  /** Replaces the default: open Notifications. */
  onPress?: () => void;
  style?: LayoutStyle;
};

// The bell with the inbox's own unread count; no dot when the inbox is not configured.
export function ShellBell({ mode = 'linked', onPress, style }: ShellBellProps) {
  const router = useRouter();
  const t = useT();
  const inbox = useInbox();
  const unread = inboxConfigured ? (inbox.data?.pages[0]?.unread_count ?? 0) : 0;
  return (
    <HeaderBellButton
      testID="header-bell"
      unread={unread}
      onPress={mode === 'static' ? undefined : (onPress ?? (() => router.push('/notifications')))}
      accessibilityLabel={unread > 0 ? t('shell.header.bellUnread', { count: unread }) : t('shell.header.bell')}
      style={style}
    />
  );
}

export type ShellSearchProps = {
  label?: string;
  /** Replaces the default: open Search. */
  onPress?: () => void;
  style?: LayoutStyle;
};

// The pill opens the Search screen, which searches what this phone already holds.
export function ShellSearch({ label, onPress, style }: ShellSearchProps) {
  const router = useRouter();
  const t = useT();
  return (
    <HeaderSearchPill
      testID="header-search"
      label={label ?? t('shell.header.search')}
      onPress={onPress ?? (() => router.push('/search'))}
      accessibilityLabel={t('shell.header.searchA11y')}
      style={style}
    />
  );
}

export type ShellAvatarProps = {
  onPress?: () => void;
  style?: LayoutStyle;
};

const slop = (layout.touchMin - shell.control) / 2;

// The signed-in surveyor's avatar; a tap opens Profile.
export function ShellAvatar({ onPress, style }: ShellAvatarProps) {
  const router = useRouter();
  const t = useT();
  const claims = useTokenClaims();
  const name = claims.status === 'ready' ? displayName(claims.claims) : t('shell.profile.role');
  return (
    <Pressable
      testID="header-avatar"
      onPress={onPress ?? (() => router.navigate('/profile'))}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${t('shell.header.avatar')}`}
      style={style}
    >
      <Avatar name={name} appearance="framed" />
    </Pressable>
  );
}
