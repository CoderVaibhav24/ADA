/**
 * Type tokens. docs/Agents-Mobile/ui-tokens.md §2.
 * Minimum rendered body size is 14; nothing carrying meaning is below 12.
 * Every face is a loaded file (fonts.ts), chosen per weight, because Android does not
 * synthesise weights for a custom family. Devanagari text switches to Noto Sans Devanagari.
 */

import { Platform, type TextStyle } from 'react-native';

import { colors, type ColorToken } from './colors';
import type { FontFace } from './fonts';

const systemMono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** The writing system of a string. Mirrors `Script` in services/i18n; tokens import nothing from the app. */
export type Script = 'latin' | 'devanagari';

type Weight = 400 | 500 | 600 | 700 | 800;

/** A face role. `sans` is the app's text face; the rest serve one purpose each. */
type Face = 'sans' | 'mono' | 'display' | 'wordmark' | 'heading' | 'action' | 'poppins' | 'figmaMono' | 'spartan';

const interByWeight: Record<Weight, FontFace> = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
  800: 'Inter_700Bold',
};

// The mobile frames' text face (mobile-designs INDEX.md §4). 800 is not loaded; it lands on Bold.
const poppinsByWeight: Record<Weight, FontFace> = {
  400: 'Poppins_400Regular',
  500: 'Poppins_500Medium',
  600: 'Poppins_600SemiBold',
  700: 'Poppins_700Bold',
  800: 'Poppins_700Bold',
};

const devanagariByWeight: Record<Weight, FontFace> = {
  400: 'NotoSansDevanagari_400Regular',
  500: 'NotoSansDevanagari_500Medium',
  600: 'NotoSansDevanagari_600SemiBold',
  700: 'NotoSansDevanagari_700Bold',
  800: 'NotoSansDevanagari_700Bold',
};

// Latin face for a role and weight. Mono stays the platform face in both scripts.
function latinFace(face: Face, weight: Weight): string {
  switch (face) {
    case 'mono':
      return systemMono;
    case 'display':
      return 'LeagueSpartan_700Bold';
    case 'wordmark':
      return 'OpenSansCondensed_700Bold';
    case 'heading':
      return 'Siemreap_400Regular';
    case 'action':
      return 'Manrope_800ExtraBold';
    case 'poppins':
      return poppinsByWeight[weight];
    case 'figmaMono':
      return weight >= 700 ? 'JetBrainsMono_700Bold' : 'JetBrainsMono_500Medium';
    case 'spartan':
      return 'LeagueSpartan_600SemiBold';
    default:
      return interByWeight[weight];
  }
}

export const fontFamily = {
  display: interByWeight[700],
  body: interByWeight[400],
  mono: systemMono,
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

type TypeSpec = {
  readonly face: Face;
  readonly weight: Weight;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly textTransform?: 'uppercase';
};

const scale = {
  title: { face: 'sans', weight: 700, fontSize: 26, lineHeight: 32 },
  heading: { face: 'sans', weight: 700, fontSize: 20, lineHeight: 26 },
  subheading: { face: 'sans', weight: 600, fontSize: 16, lineHeight: 22 },
  label: { face: 'sans', weight: 600, fontSize: 12, lineHeight: 16, letterSpacing: 0.72, textTransform: 'uppercase' },
  body: { face: 'sans', weight: 400, fontSize: 14, lineHeight: 20 },
  caption: { face: 'sans', weight: 400, fontSize: 12, lineHeight: 16 },
  mono: { face: 'mono', weight: 400, fontSize: 13, lineHeight: 18 },
  // Figma 163:27 display line (League Spartan Bold 30/40).
  display: { face: 'display', weight: 700, fontSize: 30, lineHeight: 40, letterSpacing: -0.5 },

  // Web login, Figma 147:900 (apps/web/src/routes/Login.tsx), at its narrow-screen sizes.
  // Sizes below 12 on the web are raised to 12, and inputs to 16, for reading outdoors.
  wordmark: { face: 'wordmark', weight: 700, fontSize: 20, lineHeight: 22 },
  cardHeading: { face: 'heading', weight: 400, fontSize: 32, lineHeight: 36 },
  fieldLabel: { face: 'sans', weight: 600, fontSize: 13, lineHeight: 16, letterSpacing: 0.4552, textTransform: 'uppercase' },
  fieldLabelLg: { face: 'sans', weight: 600, fontSize: 14, lineHeight: 16, letterSpacing: 0.4552, textTransform: 'uppercase' },
  fieldInput: { face: 'sans', weight: 400, fontSize: 16, lineHeight: 20 },
  codeInput: { face: 'sans', weight: 600, fontSize: 22, lineHeight: 26, letterSpacing: 3 },
  note: { face: 'sans', weight: 400, fontSize: 12, lineHeight: 17 },
  noteStrong: { face: 'sans', weight: 600, fontSize: 12, lineHeight: 17 },
  smallCaps: { face: 'sans', weight: 600, fontSize: 12, lineHeight: 16, letterSpacing: -0.3793, textTransform: 'uppercase' },
  action: { face: 'action', weight: 800, fontSize: 20, lineHeight: 24, letterSpacing: 1.2139, textTransform: 'uppercase' },
  legal: { face: 'sans', weight: 400, fontSize: 12, lineHeight: 16 },

  /*
   * The mobile frames (Figma page 141:3189). Sizes are Figma's except where the field
   * minimums raise them (body 14, caption 12); each raised value names the Figma one.
   */
  figHeaderTitle: { face: 'poppins', weight: 700, fontSize: 18, lineHeight: 24.75, letterSpacing: 0.45 }, // 174:5119
  figHeaderSubtitle: { face: 'poppins', weight: 400, fontSize: 12, lineHeight: 16, letterSpacing: 0.3 },
  figSearch: { face: 'spartan', weight: 600, fontSize: 13.733, lineHeight: 16 }, // 163:1026
  figTabLabel: { face: 'poppins', weight: 500, fontSize: 12, lineHeight: 14, letterSpacing: 0.0232 }, // Figma 10
  figMetric: { face: 'figmaMono', weight: 500, fontSize: 20, lineHeight: 30 }, // 170:3830
  figMetricLabel: { face: 'poppins', weight: 600, fontSize: 13, lineHeight: 15, letterSpacing: 0.18 }, // lh 13.5
  figSection: { face: 'poppins', weight: 700, fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textTransform: 'uppercase' }, // 173:4644
  figCardTime: { face: 'poppins', weight: 700, fontSize: 12, lineHeight: 16, letterSpacing: -0.3 },
  figPill: { face: 'poppins', weight: 600, fontSize: 12, lineHeight: 15 }, // Figma 10
  figCardTitle: { face: 'poppins', weight: 700, fontSize: 16, lineHeight: 24, letterSpacing: -0.4 },
  figMeta: { face: 'poppins', weight: 500, fontSize: 12, lineHeight: 16 }, // Figma 11.5
  figButton: { face: 'poppins', weight: 700, fontSize: 14, lineHeight: 20 }, // wizard 187:1328; Logout Figma 12
  figButtonSemi: { face: 'poppins', weight: 600, fontSize: 14, lineHeight: 20 }, // Open Complaint, Figma 12
  figBody: { face: 'poppins', weight: 400, fontSize: 14, lineHeight: 19 }, // notification text, Figma 12/16.5
  figBodyStrong: { face: 'poppins', weight: 700, fontSize: 14, lineHeight: 19 },
  figBodyLg: { face: 'poppins', weight: 400, fontSize: 16, lineHeight: 24 },
  figTime: { face: 'poppins', weight: 500, fontSize: 12, lineHeight: 16 }, // Figma 10.5/15.75
  figName: { face: 'poppins', weight: 700, fontSize: 18, lineHeight: 27 }, // 204:4217
  figRole: { face: 'poppins', weight: 400, fontSize: 14, lineHeight: 20 }, // Figma 13/19.5
  figCode: { face: 'poppins', weight: 400, fontSize: 12, lineHeight: 16, letterSpacing: 0.6 }, // Figma 10
  figRowLabel: { face: 'poppins', weight: 400, fontSize: 14, lineHeight: 20 }, // 204:4228, Figma 13
  figRowValue: { face: 'poppins', weight: 600, fontSize: 14, lineHeight: 20 },
} as const satisfies Record<string, TypeSpec>;

export type TypographyVariant = keyof typeof scale;

// Cap on system font scaling for screens whose layout is fixed by a design (Login). 1.3x still reads large.
export const fontScaleMax = 1.3;

// Noto Sans Devanagari's matras and conjuncts need about 1.6x the size to clear the line box.
const DEVANAGARI_LINE_RATIO = 1.6;

// Resolves a spec to a style for one script. Devanagari gets Noto, room for matras, no tracking.
function resolve(spec: TypeSpec, script: Script): TextStyle {
  if (script === 'devanagari' && spec.face !== 'mono') {
    return {
      fontFamily: devanagariByWeight[spec.weight],
      fontSize: spec.fontSize,
      lineHeight: Math.max(spec.lineHeight, Math.ceil(spec.fontSize * DEVANAGARI_LINE_RATIO)),
      letterSpacing: 0,
    };
  }
  return {
    fontFamily: latinFace(spec.face, spec.weight),
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
    textTransform: spec.textTransform,
  };
}

/** The Latin styles, for anything that reads the scale directly (theme.ts). */
export const typography = Object.fromEntries(
  Object.entries(scale).map(([variant, spec]) => [variant, resolve(spec, 'latin')]),
) as Record<TypographyVariant, TextStyle>;

// The default ink for each variant, so a caller that omits `color` still lands on a token.
const variantColor: Record<TypographyVariant, ColorToken> = {
  title: 'ink0',
  heading: 'ink0',
  subheading: 'ink0',
  label: 'ink2',
  body: 'ink1',
  caption: 'ink2',
  mono: 'ink1',
  display: 'brand',
  wordmark: 'loginCream',
  cardHeading: 'loginCream',
  fieldLabel: 'loginLabel',
  fieldLabelLg: 'loginLabel',
  fieldInput: 'loginInputText',
  codeInput: 'loginInputText',
  note: 'loginInfoText',
  noteStrong: 'loginInputText',
  smallCaps: 'loginLabel',
  action: 'loginAccentText',
  legal: 'loginLabel',
  figHeaderTitle: 'white',
  figHeaderSubtitle: 'figTitleSub',
  figSearch: 'white',
  figTabLabel: 'white',
  figMetric: 'figAccent',
  figMetricLabel: 'figBeige',
  figSection: 'figBeige',
  figCardTime: 'figAccent',
  figPill: 'figPillInk',
  figCardTitle: 'white',
  figMeta: 'figBeige',
  figButton: 'white',
  figButtonSemi: 'white',
  figBody: 'figChevron',
  figBodyStrong: 'white',
  figBodyLg: 'figChevron',
  figTime: 'figMuted',
  figName: 'white',
  figRole: 'figScreen',
  figCode: 'white',
  figRowLabel: 'white',
  figRowValue: 'figSandValue',
};

// Builds a text style from tokens. Every atom uses this rather than restating the scale.
export function textStyle(variant: TypographyVariant, colorToken?: ColorToken, script: Script = 'latin'): TextStyle {
  return { ...resolve(scale[variant], script), color: colors[colorToken ?? variantColor[variant]] };
}
