/**
 * ScreenHeader — TOPCONTROLL (163:1011) and the variants the frames draw:
 *   home     avatar, search pill, bell                     (01 Home)
 *   search   back, search pill, bell                       (02 Complaints, 09 Inspection)
 *   title    back, title over subtitle, bell               (03–07, 10–13)
 *   compact  the 72pt strip, nothing in it                 (08 Submitted)
 * The panel runs up under the status bar, so do not wrap it in a top SafeAreaView.
 * The bell, search pill and avatar are live organisms: they read the inbox and navigate.
 */

import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/services/i18n';

import { Text } from '../atoms';
import { HeaderBackButton } from '../molecules';
import { ShellAvatar, ShellBell, ShellSearch } from '../organisms/ShellHeaderParts';
import { colors, radius, shell, space, type LayoutStyle } from '../tokens';

export type ScreenHeaderVariant = 'home' | 'search' | 'title' | 'compact';

export type ScreenHeaderProps = {
  /** The title (title variant); spoken as the screen's name in the others. */
  title: string;
  /** Passed by the screen; a template never imports navigation. */
  onBack?: () => void;
  backAccessibilityLabel?: string;
  /** Extra controls, placed before the bell. */
  actions?: React.ReactNode;
  /** Under the title: a case reference string (drawn `#94A3B8`), or any node. */
  subtitle?: React.ReactNode;
  style?: LayoutStyle;
  /** Default `title`. */
  variant?: ScreenHeaderVariant;
  /** `linked` (default) opens Notifications; `static` draws it without a link (204:4317); `none` hides it. */
  bell?: 'linked' | 'static' | 'none';
  /** Replaces the search pill's default action (open Search). */
  onSearchPress?: () => void;
  /** Replaces the pill's "Search" word. */
  searchLabel?: string;
  /** Replaces the avatar's default action (open Profile). */
  onAvatarPress?: () => void;
  /** Default true: the panel pads itself by the status-bar inset. */
  insetTop?: boolean;
  testID?: string;
};

// The header panel; the row sits 16.38 below the inset, as 66.38 sits below Figma's 50pt status bar.
export function ScreenHeader({
  title,
  onBack,
  backAccessibilityLabel,
  actions,
  subtitle,
  style,
  variant = 'title',
  bell = 'linked',
  onSearchPress,
  searchLabel,
  onAvatarPress,
  insetTop = true,
  testID,
}: ScreenHeaderProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const top = insetTop ? insets.top : 0;

  if (variant === 'compact') {
    return (
      <View
        testID={testID}
        accessibilityRole="header"
        accessibilityLabel={title}
        style={[styles.panel, { height: top + shell.compactBody }, style]}
      />
    );
  }

  const back = onBack ? (
    <HeaderBackButton
      testID="header-back"
      onPress={onBack}
      accessibilityLabel={backAccessibilityLabel ?? t('shell.header.back')}
    />
  ) : null;
  const bellNode = bell === 'none' ? null : <ShellBell mode={bell} />;

  let row: React.ReactNode;
  let padding: { paddingLeft: number; paddingRight: number };
  if (variant === 'home' || variant === 'search') {
    padding =
      variant === 'home'
        ? { paddingLeft: shell.homeRowLeft, paddingRight: shell.homeRowRight }
        : { paddingLeft: shell.searchRowLeft, paddingRight: shell.searchRowRight };
    row = (
      <View style={styles.row} accessibilityRole="header" accessibilityLabel={title}>
        {variant === 'home' ? <ShellAvatar onPress={onAvatarPress} /> : back}
        <ShellSearch label={searchLabel} onPress={onSearchPress} />
        {actions}
        {bellNode}
      </View>
    );
  } else {
    padding = { paddingLeft: shell.titleRowLeft, paddingRight: shell.titleRowRight };
    row = (
      <View style={styles.row}>
        <View style={styles.nav}>
          {back}
          <View style={styles.titleBlock}>
            <Text variant="figHeaderTitle" color="white" numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            {typeof subtitle === 'string' ? (
              <Text variant="figHeaderSubtitle" color="figTitleSub" numberOfLines={1} selectable>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )}
          </View>
        </View>
        {actions}
        {bellNode}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.panel, { minHeight: top + shell.headerBody, paddingTop: top + shell.headerRowTop }, padding, style]}
    >
      {row}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.figPanel,
    borderBottomLeftRadius: radius.figHeader,
    borderBottomRightRadius: radius.figHeader,
    paddingBottom: space[4],
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: shell.headerGap },
  nav: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: shell.navGap, minHeight: shell.back },
  titleBlock: { flex: 1 },
});
