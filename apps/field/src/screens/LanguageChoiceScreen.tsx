import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Text, colors, control, languageChoice, radius, space } from '@/design-system';
import { DEFAULT_LOCALE, setLocale, translate, type Locale } from '@/services/i18n';

/*
 * First launch, before Login: pick Hindi or English. Shown once — the choice is
 * stored and can be changed later from the toggle on Login or Profile. Every word
 * here is in both languages, because the reader has not chosen yet.
 */

type Choice = {
  readonly locale: Locale;
  /** The big letter drawn in the circle: the first letter of each script. */
  readonly glyph: string;
};

const CHOICES: readonly Choice[] = [
  { locale: 'hi', glyph: 'अ' },
  { locale: 'en', glyph: 'A' },
];

// Stores the language and moves on to Login; the back gesture cannot return here.
function choose(locale: Locale) {
  setLocale(locale);
  router.replace('/login');
}

export function LanguageChoiceScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Icon name="language" size="xl" color="brand" />
            <Text variant="heading" color="ink0" align="center" accessibilityRole="header">
              {translate('hi', 'language.choose.title')}
            </Text>
            <Text variant="subheading" color="ink1" align="center">
              {translate('en', 'language.choose.title')}
            </Text>
          </View>

          {CHOICES.map((choice) => {
            const other: Locale = choice.locale === 'hi' ? 'en' : 'hi';
            const name = translate(choice.locale, choice.locale === 'hi' ? 'language.hindi' : 'language.english');
            const nameInOther = translate(other, choice.locale === 'hi' ? 'language.hindiInOther' : 'language.englishInOther');
            const highlighted = choice.locale === DEFAULT_LOCALE;
            return (
              <Pressable
                key={choice.locale}
                onPress={() => choose(choice.locale)}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityHint={translate(choice.locale, choice.locale === 'hi' ? 'language.toggle.toHindi' : 'language.toggle.toEnglish')}
                testID={`language-${choice.locale}`}
                style={({ pressed }) => [
                  styles.choice,
                  {
                    backgroundColor: colors[pressed ? 'surface2' : 'surface1'],
                    borderColor: colors[highlighted ? 'brand' : 'line1'],
                  },
                ]}
              >
                <View style={styles.glyph}>
                  <Text variant="display" color="brand">
                    {choice.glyph}
                  </Text>
                </View>
                <View style={styles.names}>
                  <Text variant="title" color="ink0">
                    {name}
                  </Text>
                  <Text variant="body" color="ink2">
                    {nameInOther}
                  </Text>
                </View>
                <Icon name="forward" size="lg" color="ink2" />
              </Pressable>
            );
          })}

          <View style={styles.footnote}>
            <Text variant="caption" color="ink2" align="center">
              {translate('hi', 'language.choose.subtitle')}
            </Text>
            <Text variant="caption" color="ink2" align="center">
              {translate('en', 'language.choose.subtitle')}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  content: { flexGrow: 1, justifyContent: 'center', padding: space[4] },
  column: { width: '100%', maxWidth: languageChoice.maxWidth, alignSelf: 'center', gap: space[4] },
  header: { alignItems: 'center', gap: space[2], marginBottom: space[4] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: languageChoice.buttonMinHeight,
    paddingHorizontal: space[4],
    borderRadius: radius.lg,
    borderWidth: control.borderWidthFocused,
  },
  glyph: {
    width: languageChoice.glyph,
    height: languageChoice.glyph,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  names: { flex: 1, gap: space[1] },
  footnote: { gap: space[1], marginTop: space[2] },
});
