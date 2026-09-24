/**
 * Colour tokens. Transcribed from docs/Agents-Mobile/ui-tokens.md §1 and nothing else.
 * This file and its siblings in tokens/ are the only place a colour literal may appear.
 * Parity with the portal (docs/Agents/ui-tokens.md) is contractual: change both together.
 */

// Dark is the only theme the tokens define; the app is read outdoors and ships dark-only.
export const colors = {
  // Surfaces — ui-tokens.md §1 Surfaces
  surface0: '#1E1A15', // derived — app background
  surface1: '#2D261E', // Figma `brown 2` — cards, sheets, tab bar
  surface2: '#42382E', // Figma `dark brown` — inputs, raised rows, GPS panel
  surface3: '#4E4236', // derived — pressed state on a raised surface
  surfaceMuted: '#9C8E7C', // derived — light card treatment on complaint cards and findings

  // Ink and line — ui-tokens.md §1 Ink and line
  ink0: '#FFFFFF', // Figma `Earthy` start — titles, card headings, values
  ink1: '#E8E0D6', // derived — body text
  ink2: '#B9AC9C', // derived — labels, secondary meta
  ink3: '#806C5B', // Figma `Earthy` end — placeholders, captions, disabled text
  inkOnMuted: '#2A2018', // derived — text on surfaceMuted, never ink1
  line1: '#564B3E', // derived — input borders, row dividers
  line2: '#3A3128', // derived — hairlines

  // Brand and action — ui-tokens.md §1 Brand and action
  brand: '#CE862E', // Figma `color 1`
  brandPressed: '#B9762A', // derived
  brandTint: '#3A2C1B', // derived — active tab background, selected row
  focus: '#E2A75A', // derived — focus ring under a hardware keyboard

  // Status — ui-tokens.md §1 Status. Same mapping as the portal.
  statusNew: '#9B7BD4',
  statusScheduled: '#4F9CD9',
  statusProgress: '#5FBF6B',
  statusDone: '#5FBF6B',
  statusOverdue: '#E05C4B',

  // Priority — ui-tokens.md §1 Status
  priorityHigh: '#E05C4B',
  priorityMedium: '#E0A030',
  priorityLow: '#5FBF6B',

  // Field signals — ui-tokens.md §1 Signal colours, app only
  gpsLocked: '#5FBF6B',
  gpsWeak: '#E0A030',
  gpsNone: '#E05C4B',
  syncPending: '#E0A030',
  syncFailed: '#E05C4B',
  syncClear: '#5FBF6B',

  // Web login, Figma 147:900 (apps/web/src/routes/Login.tsx). Same values as the portal.
  loginBackdrop: '#1C1610', // under the aerial while it loads
  loginWash: 'rgba(56,56,56,0.2)', // Figma 152:1054, over the aerial
  loginCream: '#E8D4A8', // wordmark tail, card heading
  // The web card is 20% black over a 6px backdrop blur; with no blur on the handset it is darker to stay readable.
  loginCardFill: 'rgba(9,3,0,0.7)',
  loginCardBorder: 'rgba(21,93,252,0.3)',
  loginLabel: '#94A3B8', // field labels, remember me, support line
  loginInputFill: 'rgba(15,23,42,0.5)',
  loginInputBorder: '#334155',
  loginInputText: '#F8FAFC',
  loginPlaceholder: '#64748B', // web #475569 is 2.1:1 on the well; lifted for outdoor reading
  loginAccent: '#D97736', // button, links, focus
  loginAccentPressed: '#E08544',
  loginAccentText: '#150B03', // button text: the web's AA fix for white on ochre
  loginAccentGlow: 'rgba(21,93,252,0.4)',
  loginFocusRing: 'rgba(217,119,54,0.35)',
  loginEye: '#6B7280',
  loginCheckboxFill: '#22252F',
  loginDivider: 'rgba(51,65,85,0.3)',
  loginErrorBorder: 'rgba(220,38,38,0.45)',
  loginErrorFill: 'rgba(69,10,10,0.55)',
  loginErrorTitle: '#FECACA',
  loginErrorText: '#F3C9C9',
  loginErrorDetail: '#E2A3A3',
  loginInfoBorder: 'rgba(217,119,54,0.4)',
  loginInfoFill: 'rgba(15,23,42,0.55)',
  loginInfoText: '#CBD5E1',
  loginInfoIcon: '#F2AE63',
  loginNoticeBorder: 'rgba(51,65,85,0.6)',
  loginWarnBorder: 'rgba(217,119,54,0.5)',
  loginWarnFill: 'rgba(69,39,10,0.55)',
  loginWarnText: '#FBD9B5',
  loginCardShadow: 'rgba(0,0,0,0.25)',
  scrim: 'rgba(0,0,0,0.6)', // behind a bottom sheet

  // Figma mobile palette (file hSyLFWm2yjSU5iZ6Jw0eRa page 141:3189; mobile-designs INDEX.md §4).
  figScreen: '#463E2F', // every mobile frame's background
  figPanel: '#382F22', // TOPCONTROLL 163:1013 header panel
  figControl: '#635540', // avatar ring, search pill, bell circle, back button (163:1032, 497e4, 2dfbb)
  figControlPressed: '#75654D', // derived — pressed header control
  figBackBorder: 'rgba(167,157,149,0.5)', // back button 195:2349 border
  figChevron: '#CBD5E1', // back chevron 14c45 stroke; body text on dark (173:4672)
  figBeige: '#E8D4A8', // bell, magnifier, section headings, metric labels
  figBadge: '#FF921B', // unread dot 27ffa
  figTitleSub: '#94A3B8', // header subtitle (174:5119)
  figAccent: '#C87820', // primary buttons, Assigned count (173:4660, 170:3830)
  figAccentPressed: '#A96418', // derived
  tabGlass: 'rgba(45,38,30,0.55)', // surface1 @ 55%, over the blur
  tabGlassSolid: 'rgba(45,38,30,0.92)', // Android, which has no blur: near-opaque so text under it stays out of the way
  tabCircleGlass: 'rgba(66,56,46,0.6)', // surface2 @ 60%, over the blur: lighter glass than the bar
  tabCircleFill: 'rgba(66,56,46,0.92)', // surface2 @ 92%, Android's circle with no blur
  tabGlassBorder: 'rgba(255,255,255,0.12)',
  tabGlassHighlight: 'rgba(255,255,255,0.28)', // top-edge light line
  tabGlassSheen: '#FFFFFF', // top of the curved-glass gradient; alpha is shell.tabSheenOpacity (SVG stops ignore rgba alpha)
  tabGlassShade: '#000000', // bottom band of the curved-glass gradient; alpha is shell.tabShadeOpacity
  tabGlassInnerShadow: 'rgba(0,0,0,0.35)', // bottom-edge inner line
  tabCircleSheen: '#FFFFFF', // centre of the circle's radial sheen; alpha is shell.tabCircleSheenOpacity
  tabCircleGlow: 'rgba(200,120,32,0.45)', // figAccent @ 45%, soft glow
  tabShadow: 'rgba(0,0,0,0.45)',
  figTile: '#30281F', // metric tile 170:3830
  figTileBorder: 'rgba(255,255,255,0.05)',
  figRule: 'rgba(255,255,255,0.10)', // metric row bottom border 170:3829
  figSuccess: '#4A9A58', // Completed Today count
  figDanger: '#D85A38', // Overdue count
  figCard: 'rgba(48,40,31,0.69)', // NEXT UP card 173:4645
  figCardBorder: 'rgba(176,144,96,0.30)',
  figShadow: 'rgba(0,0,0,0.1)', // card shadow 0 10 15 -3 / 0 4 6 -4
  figPillFill: '#2E200C', // status pill 173:4650
  figPillBorder: 'rgba(113,78,21,0.5)',
  figPillInk: '#E5A93C',
  figPanelCard: 'rgba(56,48,37,0.87)', // RECENT NOTIFICATIONS card 173:4670
  figMuted: '#B09060', // notification time, panel border
  figDivider: 'rgba(232,212,168,0.2)', // row divider inside the notifications card
  figAlertFill: '#2D1616', // notification kinds (173:4672)
  figAlertBorder: '#522424',
  figAlertInk: '#E56A54',
  figReminderFill: '#2D2312',
  figReminderBorder: '#533F19',
  figReminderInk: '#E5AA3D',
  figAcceptFill: '#0D241C',
  figAcceptBorder: '#1A4F3B',
  figAcceptInk: '#3ED598',
  figNoteCard: '#A18E6D', // notification card 204:4437
  figNoteInk: '#3A2810', // text on light cards (204:4437, 195:2487)
  figNoteStrong: '#FFF8E8',
  figSand: '#9D8E71', // profile identity card and rows 204:4217
  figSandBorder: 'rgba(232,212,168,0.39)',
  figSandValue: '#504029', // profile row value
  figSandPressed: '#8D7E62', // derived
  figGlowClear: 'rgba(200,120,32,0)', // profile card top accent gradient ends 204:4227
  figSecondary: '#2D261E', // secondary button 253:632
  figSecondaryBorder: 'rgba(232,212,168,0.2)',
  white: '#FFFFFF', // `Label Color/Dark/Primary`

  // Non-colour, needed where React Native demands a value
  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;

// Resolves a colour token to its literal. The only sanctioned way out of the token set.
export function color(token: ColorToken): string {
  return colors[token];
}
