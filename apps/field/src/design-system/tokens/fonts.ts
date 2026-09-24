/**
 * Font faces and the files behind them. The key is the family name React Native uses,
 * so the name in a style and the file that registers it cannot drift apart.
 * Loaded once at the root (src/app/_layout.tsx) with expo-font's useFonts.
 */

import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { LeagueSpartan_600SemiBold } from '@expo-google-fonts/league-spartan/600SemiBold';
import { LeagueSpartan_700Bold } from '@expo-google-fonts/league-spartan/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { NotoSansDevanagari_400Regular } from '@expo-google-fonts/noto-sans-devanagari/400Regular';
import { NotoSansDevanagari_500Medium } from '@expo-google-fonts/noto-sans-devanagari/500Medium';
import { NotoSansDevanagari_600SemiBold } from '@expo-google-fonts/noto-sans-devanagari/600SemiBold';
import { NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari/700Bold';
// The package has no per-weight entry, and its index would bundle the two unused faces.
import OpenSansCondensed_700Bold from '@expo-google-fonts/open-sans-condensed/OpenSansCondensed_700Bold.ttf';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { Siemreap_400Regular } from '@expo-google-fonts/siemreap/400Regular';

export const fontAssets = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  NotoSansDevanagari_400Regular,
  NotoSansDevanagari_500Medium,
  NotoSansDevanagari_600SemiBold,
  NotoSansDevanagari_700Bold,
  LeagueSpartan_700Bold,
  // The mobile frames (mobile-designs INDEX.md §4): Poppins for text, JetBrains Mono for
  // counts, League Spartan SemiBold for the header search placeholder (Figma "Spartan").
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  LeagueSpartan_600SemiBold,
  // The web login's faces (apps/web/index.html): wordmark, card heading, button.
  OpenSansCondensed_700Bold,
  Siemreap_400Regular,
  Manrope_800ExtraBold,
} as const;

export type FontFace = keyof typeof fontAssets;
