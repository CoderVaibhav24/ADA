/**
 * Case-screen tokens: Complaints (02 170:4173), Complaint Detail (03 174:4991, 10 195:2657,
 * 11 202:3867) and Inspection (09 195:1961). Moved here from organisms/cases/palette.ts,
 * which re-exports them. Sizes below 12 in Figma are raised to 12, body text to 14.
 */

export const casePalette = {
  screen: '#463E2F', // every frame background
  title: '#FFFFFF',
  tabActive: '#CE862E', // 195:2353 selected tab and underline
  tabIdle: '#B0BEC5',
  cardLight: 'rgba(232,212,168,0.54)', // complaint card, attribute cards
  cardLightBorder: 'rgba(192,72,48,0.3)', // complaint card border
  cardAttrBorder: 'rgba(167,157,149,0.5)', // 174:5571
  cardInspection: '#9D8E71', // 195:2487 inspection card, 195:3137 findings card
  cardInspectionBorder: 'rgba(232,212,168,0.54)',
  findingsBorder: '#1B263B',
  refInk: '#3A2810', // card ID line
  ageInk: '#1F1201',
  metaDivider: '#1B1004',
  footerLine: 'rgba(255,255,255,0.18)',
  footerLineInspection: 'rgba(245,236,215,0.5)',
  footerTint: 'rgba(200,120,32,0.03)',
  distance: '#0AFF35', // c65a9.svg target glyph
  open: '#CE862E',
  viewInk: '#E8D4A8',
  rowLabel: '#2D261E', // 03 attribute label
  rowLabelDone: '#2A1A08', // 10 attribute label
  findingsLabel: '#583D1F',
  rowDivider: '#7E725F',
  findingsDivider: 'rgba(255,255,255,0.08)',
  typeCaption: '#E8D4A8',
  recommendationPill: '#D7D3CB',
  primary: '#C87820', // Start Ground Inspection
  secondary: '#2D261E', // Back buttons
  secondaryBorder: 'rgba(232,212,168,0.2)',
  secondaryInk: '#EBE4D4',
  mapCard: '#7A6040',
  mapCardBorder: '#1B2B3E',
  mapGrid: '#2D261E', // placeholder grid lines = figSecondary
  mapCell: '#382F22', // placeholder cells = figPanel
  mapTarget: 'rgba(200,120,32,0.16)', // figAccent @ 16%
  mapTargetBorder: '#C87820', // figAccent
  mapPin: '#C87820', // figAccent: the case-location dot
  mapPinBorder: '#E8D4A8', // figBeige ring around the dot
  mapPinHalo: 'rgba(200,120,32,0.28)', // figAccent @ 28%, soft halo under the dot
  mapBackdrop: '#30281F', // figTile: behind the tiles while loading or offline
  mapTint: '#463E2F', // figScreen: warm wash drawn over the raster
  mapAttributionFill: 'rgba(45,38,30,0.72)', // figSecondary @ 72%
  mapAttributionInk: '#E8D4A8', // figBeige
  mapPanel: '#2D261E',
  mapPanelBorder: '#182637',
  muted: '#94A3B8',
  evidenceTile: '#080402',
  evidenceBorder: '#00A080',
  scrim: 'rgba(0,0,0,0.92)',
  bannerOffline: 'rgba(216,90,56,0.18)',
  bannerOfflineBorder: 'rgba(216,90,56,0.6)',
  bannerPending: 'rgba(229,169,60,0.16)',
  bannerPendingBorder: 'rgba(229,169,60,0.6)',
  bannerInk: '#F6F6F6',
  skeleton: 'rgba(232,212,168,0.18)',
  shadow: 'rgba(0,0,0,0.1)',
  // Status (dot/icon + word): 02 card style, 10 "Completed".
  statusScheduled: '#5BF4FF',
  statusProgress: '#2CFF51',
  statusNew: '#742294',
  statusDone: '#25CE42',
  statusSentBack: '#D85A38',
  statusOther: '#E8D4A8',
  // Priority badge, 02.
  highInk: '#C04830',
  highFill: 'rgba(192,72,48,0.09)',
  highBorder: 'rgba(192,72,48,0.31)',
  mediumInk: '#C87820',
  mediumFill: 'rgba(255,255,255,0.41)',
  mediumBorder: 'rgba(94,91,86,0.31)',
  lowInk: '#3BFB5D',
  lowFill: 'rgba(88,245,116,0.27)',
  lowBorder: 'rgba(74,154,88,0.31)',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

export type CaseColor = keyof typeof casePalette;

// Figma sets the case screens in Poppins; the roles marked `face: 'inter'` are Inter, `mono` JetBrains Mono.
export const caseFonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

// Inter, for the filter tabs (195:2353), card ID, age, area, distance and the HIGH badge (02).
export const caseInter = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

export const caseDevanagari = {
  regular: 'NotoSansDevanagari_400Regular',
  medium: 'NotoSansDevanagari_500Medium',
  semibold: 'NotoSansDevanagari_600SemiBold',
  bold: 'NotoSansDevanagari_700Bold',
  mono: 'NotoSansDevanagari_400Regular',
} as const;

export type CaseWeight = keyof typeof caseFonts;

export type CaseFace = 'poppins' | 'inter';

// Type roles. Figma size first; the raised value is what ships.
export const caseType = {
  screenTitle: { weight: 'bold', size: 18, line: 24.75, track: 0.45 }, // 18/24.75
  tab: { weight: 'semibold', size: 14, line: 20, face: 'inter' },
  cardRef: { weight: 'regular', size: 12, line: 16, track: 0.5, face: 'inter' }, // Figma 10
  cardTitle: { weight: 'bold', size: 14, line: 18, track: 0 }, // Figma 13.5
  cardStatus: { weight: 'medium', size: 12, line: 16 }, // Figma 11
  cardMeta: { weight: 'semibold', size: 14, line: 18 }, // Figma 12
  cardMetaSmall: { weight: 'semibold', size: 12, line: 16.5, face: 'inter' }, // Figma 11
  cardFoot: { weight: 'regular', size: 12, line: 16, face: 'inter' }, // Figma 11
  pillLabel: { weight: 'medium', size: 12, line: 16.5, track: 0.44 }, // OPEN, Figma 11
  priority: { weight: 'bold', size: 12, line: 14, track: 0.63, face: 'inter' }, // Figma 9
  inspTitle: { weight: 'bold', size: 16, line: 24 },
  inspLine: { weight: 'regular', size: 12, line: 18 },
  viewLabel: { weight: 'bold', size: 12, line: 16.5, track: 0.44 }, // Figma 11
  panelTitle: { weight: 'bold', size: 15, line: 22.5, track: -0.375 },
  panelStatus: { weight: 'medium', size: 12, line: 16 },
  panelSub: { weight: 'regular', size: 12, line: 16 },
  sectionHead: { weight: 'bold', size: 12, line: 16 },
  rowLabel: { weight: 'regular', size: 12, line: 16 },
  rowValue: { weight: 'bold', size: 14, line: 18 }, // Figma 12
  rowCaption: { weight: 'bold', size: 12, line: 14 }, // "(RCC)", Figma 11
  body: { weight: 'regular', size: 14, line: 20 }, // Figma 12
  button: { weight: 'bold', size: 14, line: 20, track: 0.3 }, // Figma 12 on the CTA
  buttonBack: { weight: 'bold', size: 14, line: 20 },
  banner: { weight: 'semibold', size: 14, line: 18 },
  mono: { weight: 'mono', size: 14, line: 18 },
} as const satisfies Record<
  string,
  { weight: CaseWeight; size: number; line: number; track?: number; face?: CaseFace }
>;

export type CaseTypeRole = keyof typeof caseType;

// Spacing and shapes read off the frames.
export const caseMetrics = {
  gutter: 18, // content column x=18
  sectionPad: 16, // 03 content px 16
  sectionGap: 14,
  headingGap: 7,
  cardGap: 10,
  cardRadius: 12,
  bigRadius: 16,
  cardPadX: 14,
  cardPadTop: 11,
  attrPad: 17,
  rowGap: 14,
  statusDot: 8,
  pinSize: 14,
  pinBorder: 2,
  pinHalo: 34,
  mapZoom: 17,
  mapHeight: 176,
  mapCols: 5,
  mapRows: 3,
  mapGap: 1.5,
  evidenceHeight: 80,
  evidenceGap: 10,
  evidenceRadius: 4,
  tabGap: 28.611,
  tabUnderline: 4.578,
  tabUnderlineGap: 5.722,
  openRadius: 7,
  primaryRadius: 7,
  buttonRadius: 12,
  pillRadius: 20,
  touch: 48, // field-app floor; Figma controls are smaller
  primaryHeight: 56,
  secondaryHeight: 48, // Figma 44
  glyph: 14,
  glyphSm: 13,
  hairline: 1,
  bannerPad: 12,
} as const;
