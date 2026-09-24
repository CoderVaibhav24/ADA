/**
 * Inspection wizard tokens: Figma page "Mobile", frames 04–08 (179:5884, 179:6402, 179:7242,
 * 187:875, 193:1534) and the open option lists 14–17 (179:7445, 179:7478, 179:7499, 179:7524).
 * Values are Figma's; each deviation for the field-use minimums (48dp targets, 14 body, 12 captions,
 * 16 inputs) is marked "raised". Imported directly (not through the barrel) by the wizard organisms.
 */

import type { TextStyle } from 'react-native';

import { fontAssets } from './fonts';

export const wizardColors = {
  screen: '#463E2F', // frame fill
  progressDone: '#C87820', // 179:6356
  progressTodo: '#3A2810', // 179:6357
  accent: '#C87820', // STEP n OF 4, primary buttons; #D97724 on 179:6366 folded into it (spec)
  accentPressed: '#B06A1C', // derived
  white: '#FFFFFF',
  stepBodyCheckIn: '#DEECFE', // 179:6370
  stepBodyPhotos: '#E6E6E6', // 179:7163 body
  stepBody: '#F6F6F6', // 179:7242 / 187:884 body
  // Location card 179:6372
  card: '#2D261E',
  cardBorder: 'rgba(122,96,64,0.5)',
  pulse: 'rgba(232,212,168,0.72)',
  pinDisc: 'rgba(255,227,166,0.78)',
  pinDiscBorder: 'rgba(217,119,36,0.3)',
  gpsLocked: '#22C55E', // 179:6383
  gpsWeak: '#E5A93C', // palette warning; not drawn in 04
  gpsNone: '#FF8A70', // not drawn; lifted from #D85A38 so it reads on #2D261E
  timestamp: '#94A3B8', // raised from #64748B (3.2:1 on the card) for outdoor reading
  // Buttons 253:640 / 179:7212
  secondary: '#2D261E',
  secondaryBorder: 'rgba(232,212,168,0.2)',
  secondaryInkDone: '#FFF6E3', // 193:1610
  // Photos 179:7171
  tile: '#2D3032',
  tileInner: '#080402',
  addTile: 'rgba(16,31,53,0.45)',
  addTileBorder: 'rgba(243,226,188,0.37)',
  remove: '#E80C00', // 899f0.svg
  beige: '#E8D4A8', // counter, field labels, (RCC) sub-value
  // Form fields 179:7368
  inputFill: 'rgba(232,212,168,0.54)',
  inputBorder: '#745F3F',
  inputBorderError: '#FF8A70',
  inputBorderFocus: '#C87820',
  placeholder: 'rgba(255,255,255,0.78)', // Figma draws placeholders pure white; dimmed so an empty field reads empty
  unit: '#423525',
  grip: 'rgba(255,255,255,0.3)', // 5422c.svg
  chevron: 'rgba(255,255,255,0.7)', // 39fbd.svg
  // Open option list 179:7445
  list: '#9D8E71',
  listRowBorder: 'rgba(45,38,30,0.21)',
  listInk: '#E2E8F0',
  listSelected: '#2D1C0C', // derived: selected row tint and tick
  listSelectedFill: 'rgba(45,28,12,0.18)',
  scrim: 'rgba(0,0,0,0.55)',
  // Review summary 187:1281
  summary: '#9D8E71',
  summaryBorder: '#A1A1A1',
  summaryLabel: '#3A2810',
  summaryDivider: 'rgba(255,255,255,0.08)',
  missing: '#5A1A0C', // derived: "not saved" value on the summary card
  // Submitted 193:1534
  successDisc: 'rgba(232,212,168,0.77)',
  doneBody: '#94A3B8',
  doneBold: '#E2E8F0',
  doneCardBorder: 'rgba(167,157,149,0.5)',
  doneLabel: '#2D1C0C',
  doneDivider: '#74624A',
  pill: '#D7D3CB',
  // States not drawn in Figma
  error: '#FFB4A2', // inline field errors on #463E2F (7:1)
  warn: '#F2C46D', // offline / pending notes on #463E2F
  ok: '#7EE2A0',
  noticeFill: 'rgba(45,38,30,0.85)',
  noticeBorderWarn: 'rgba(242,196,109,0.55)',
  noticeBorderError: 'rgba(255,180,162,0.55)',
  noticeBorderOk: 'rgba(126,226,160,0.5)',
  noticeBorderInfo: 'rgba(232,212,168,0.35)',
  shadow: 'rgba(0,0,0,0.1)',
} as const;

export type WizardColor = keyof typeof wizardColors;

// Sizes from the frames; every touch target is raised to 48.
export const wizardMetrics = {
  padX: 16, // content px 16 inside an 18 inset (179:5886); 412 − 2×16 = 380 at the frame
  padTop: 8,
  padBottom: 27,
  gap: 14,
  progressHeight: 3.5,
  progressGap: 6,
  progressBottom: 24,
  titleGap: 4,
  fieldGap: 16,
  labelGap: 6,
  control: 48, // raised from 44 (179:7368) to the 48dp minimum
  controlRadius: 12,
  controlPadLeft: 15,
  controlPadRight: 41,
  unitRight: 14,
  textArea: 96, // ≈84 in 179:7368, raised for 16px text
  buttonGap: 14,
  cardRadius: 16,
  locationCard: 219.25,
  locationCardTop: 60, // 179:6371's net offset below the step text
  marker: 80,
  markerDisc: 56,
  photoTile: 96,
  photoInnerW: 82,
  photoInnerH: 81,
  photoInnerRadius: 10,
  photoGap: 12,
  removeHit: 48, // the 14px remove glyph gets a 48dp target
  removeGlyph: 18, // raised from 14
  optionRow: 52, // raised from 45 ("large rows")
  optionPadLeft: 13,
  optionIcon: 22,
  summaryPad: 17,
  summaryGap: 10,
  doneDisc: 80,
  doneTick: 40,
  doneBodyMax: 280, // 260 in 193:1536, widened for Hindi
  hairline: 1,
  pillDot: 6,
  sheetRadius: 16,
  sheetMaxWidth: 420,
} as const;

type Weight = 400 | 500 | 600 | 700;

// Poppins is the design's face; until it is registered in fonts.ts the app's Inter stands in.
function latinFace(weight: Weight): string {
  const poppins = {
    400: 'Poppins_400Regular',
    500: 'Poppins_500Medium',
    600: 'Poppins_600SemiBold',
    700: 'Poppins_700Bold',
  }[weight];
  if (Object.prototype.hasOwnProperty.call(fontAssets, poppins)) return poppins;
  return { 400: 'Inter_400Regular', 500: 'Inter_500Medium', 600: 'Inter_600SemiBold', 700: 'Inter_700Bold' }[weight];
}

const devanagariFace: Record<Weight, string> = {
  400: 'NotoSansDevanagari_400Regular',
  500: 'NotoSansDevanagari_500Medium',
  600: 'NotoSansDevanagari_600SemiBold',
  700: 'NotoSansDevanagari_700Bold',
};

type Spec = {
  readonly weight: Weight;
  readonly size: number;
  readonly line: number;
  readonly tracking?: number;
  readonly upper?: boolean;
};

const specs = {
  stepLabel: { weight: 700, size: 12, line: 16.5, tracking: 0.55, upper: true }, // 11 raised
  stepTitle: { weight: 700, size: 20, line: 28, tracking: -0.5 },
  stepBody: { weight: 400, size: 14, line: 22 }, // 13 / 12.5 raised
  coords: { weight: 700, size: 18, line: 28 },
  lock: { weight: 700, size: 13, line: 18 }, // 12 raised
  timestamp: { weight: 400, size: 12, line: 17.25, tracking: 0.288 }, // 11.5 raised
  button: { weight: 700, size: 14, line: 20, tracking: 0.35 },
  addPhoto: { weight: 400, size: 12, line: 18 },
  counter: { weight: 400, size: 12, line: 16 },
  fieldLabel: { weight: 700, size: 12, line: 16 },
  input: { weight: 400, size: 16, line: 20 }, // 14 raised
  unit: { weight: 400, size: 12, line: 16 },
  option: { weight: 400, size: 16, line: 22 }, // 14 raised
  summaryLabel: { weight: 400, size: 12, line: 16 },
  summaryValue: { weight: 700, size: 12, line: 16 },
  summarySub: { weight: 700, size: 12, line: 15 }, // 11 raised
  doneTitle: { weight: 700, size: 24, line: 32, tracking: -0.6 },
  doneBody: { weight: 400, size: 14, line: 21 }, // 12 raised
  doneBodyBold: { weight: 700, size: 14, line: 21 },
  pill: { weight: 700, size: 12, line: 16.5 }, // 11 raised
  note: { weight: 400, size: 14, line: 20 },
  noteBold: { weight: 700, size: 14, line: 20 },
  error: { weight: 400, size: 14, line: 20 },
  caption: { weight: 400, size: 12, line: 16 },
  sheetTitle: { weight: 700, size: 18, line: 26 },
} as const satisfies Record<string, Spec>;

export type WizardTextVariant = keyof typeof specs;

// A text style for one variant in one script; Devanagari gets Noto, room for matras, no tracking.
export function wizardText(
  variant: WizardTextVariant,
  color: WizardColor,
  script: 'latin' | 'devanagari' = 'latin',
): TextStyle {
  const spec: Spec = specs[variant];
  if (script === 'devanagari') {
    return {
      fontFamily: devanagariFace[spec.weight],
      fontSize: spec.size,
      lineHeight: Math.max(spec.line, Math.ceil(spec.size * 1.6)),
      letterSpacing: 0,
      color: wizardColors[color],
    };
  }
  return {
    fontFamily: latinFace(spec.weight),
    fontSize: spec.size,
    lineHeight: spec.line,
    letterSpacing: spec.tracking ?? 0,
    textTransform: spec.upper === true ? 'uppercase' : 'none',
    color: wizardColors[color],
  };
}

// Card shadow from 179:6373: 0 10 15 -3 and 0 4 6 -4, 10% black.
export const wizardShadow = {
  boxShadow: `0px 10px 15px -3px ${wizardColors.shadow}, 0px 4px 6px -4px ${wizardColors.shadow}`,
} as const;
