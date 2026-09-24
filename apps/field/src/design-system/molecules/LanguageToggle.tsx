/**
 * LanguageToggle — हिं / EN. The compact switch on Login and, later, Profile.
 * It is the i18n control, so it reads and sets the locale itself rather than taking props.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { setLocale, useLocale, useT, type Locale, type MessageKey } from '@/services/i18n';

import { Icon, Text } from '../atoms';
import { colors, control, fontScaleMax, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type LanguageToggleProps = {
  /** `overlay` sits on imagery (Login); `surface` sits on a card (Profile). */
  tone?: 'surface' | 'overlay';
  testID?: string;
  style?: LayoutStyle;
};

type Skin = { fill: ColorToken; border: ColorToken; active: ColorToken; activeInk: ColorToken; ink: ColorToken };

const skins: Record<'surface' | 'overlay', Skin> = {
  surface: { fill: 'surface1', border: 'line1', active: 'brand', activeInk: 'inkOnMuted', ink: 'ink1' },
  overlay: {
    fill: 'loginInputFill',
    border: 'loginInputBorder',
    active: 'loginAccent',
    activeInk: 'loginAccentText',
    ink: 'loginInputText',
  },
};

const options = [
  { locale: 'hi', short: 'language.hindiShort', a11y: 'language.toggle.toHindi' },
  { locale: 'en', short: 'language.englishShort', a11y: 'language.toggle.toEnglish' },
] as const satisfies readonly { locale: Locale; short: MessageKey; a11y: MessageKey }[];

// Two segments, each a full 48dp target; the active one is filled.
export function LanguageToggle({ tone = 'surface', testID, style }: LanguageToggleProps) {
  const t = useT();
  const locale = useLocale();
  const skin = skins[tone];
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('language.toggle.label')}
      style={[styles.frame, { backgroundColor: colors[skin.fill], borderColor: colors[skin.border] }, style]}
    >
      <View style={styles.icon}>
        <Icon name="language" size="sm" color={skin.ink} />
      </View>
      {options.map((option) => {
        const active = option.locale === locale;
        return (
          <Pressable
            key={option.locale}
            onPress={() => setLocale(option.locale)}
            accessibilityRole="radio"
            accessibilityLabel={t(option.a11y)}
            accessibilityState={{ checked: active, selected: active }}
            testID={testID ? `${testID}-${option.locale}` : undefined}
            style={[styles.segment, active ? { backgroundColor: colors[skin.active] } : null]}
          >
            <Text variant="subheading" color={active ? skin.activeInk : skin.ink} maxFontSizeMultiplier={fontScaleMax}>
              {t(option.short)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space[1] / 2,
    borderRadius: radius.pill,
    borderWidth: control.borderWidth,
  },
  icon: { paddingHorizontal: space[2] },
  segment: {
    minWidth: control.heightMd,
    minHeight: control.heightMd,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
