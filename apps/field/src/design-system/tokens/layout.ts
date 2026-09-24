/**
 * Layout tokens. docs/Agents-Mobile/ui-tokens.md §5, plus control sizing derived here.
 * Designs are drawn at 412x917; 360 is the real floor on mid-range government handsets.
 */

export const layout = {
  headerHeight: 64, // back, search, notification bell
  tabbarHeight: 72, // four items plus the raised hexagon
  touchMin: 48, // minimum target, everywhere, no exceptions (48dp: Android's floor, gap-audit Global)
  footerActions: 64, // wizard Back / Next row
  designWidth: 412,
  minWidth: 360,
} as const;

// Derived: ui-tokens.md fixes touch.min but not control heights. Every value is >= touchMin.
export const control = {
  heightSm: 48,
  heightMd: 48,
  heightLg: 56,
  textAreaMinHeight: 112,
  borderWidth: 1,
  borderWidthFocused: 2,
  hairline: 1,
  // Geometry for the tick drawn from React Native views, so Checkbox needs no icon import.
  checkmark: { width: 6, height: 11, stroke: 2 },
  // Geometry for the caret drawn from React Native views, so Select needs no icon import.
  caret: { size: 8, stroke: 1.5 },
} as const;

// Derived: icon sizes are not in ui-tokens.md; three steps cover every frame read so far.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type IconSizeToken = keyof typeof iconSize;

// Derived: avatar sizes are not in ui-tokens.md. sm is the header, lg is the profile screen.
export const avatarSize = {
  sm: 36,
  md: 44,
  lg: 88,
} as const;

export type AvatarSizeToken = keyof typeof avatarSize;

// Derived: the wizard progress segment and the notification dot.
export const indicator = {
  progressHeight: 6,
  badgeDot: 10,
  badgeCount: 18,
  hexagon: 56,
} as const;

// Derived: submitted-evidence tiles on a detail screen. Square; above touchMin so a tile is a target.
export const media = {
  thumbnail: 96,
} as const;

/*
 * Web login, Figma 147:900 (apps/web/src/routes/Login.tsx), at the web's narrow-screen values.
 * Fractions are Figma's: the card was drawn at 1.318x. Controls are raised to 48 for touch.
 */
export const loginMetrics = {
  contentMaxWidth: 525.76,
  topMin: 32, // pt max(2rem, min(111px, 14vh))
  topMax: 111,
  topRatio: 0.14,
  sidePad: 16,
  bottomPad: 32,
  wordmarkGap: 20,
  cardRadius: 12.139,
  cardBorder: 0.759,
  cardPadX: 20,
  cardPadTop: 25.759,
  cardPadBottom: 31.106,
  cardGap: 24,
  formGap: 18.208,
  fieldGap: 6.069,
  controlRadius: 9.104,
  controlBorder: 1,
  controlHeight: 48,
  controlPadX: 12.898,
  checkbox: 18,
  checkboxRadius: 3.035,
  checkboxGap: 9.104,
  submitTopPad: 12.139,
  buttonPadY: 12.139,
  buttonGap: 20,
  buttonMinHeight: 52,
  noticePadY: 10,
  noticeGap: 7,
  noticeIcon: 14,
  supportPadTop: 18.967,
  supportGap: 9.104,
  footerGap: 4,
  footerPadY: 8,
  footerItemGap: 12,
  toggleInset: 8,
  // 163:27 draws the frame 934 tall; below that the top padding shrinks with the screen.
  designHeight: 934,
} as const;

// Derived: the first-launch language buttons are the largest targets in the app.
export const languageChoice = {
  buttonMinHeight: 112,
  glyph: 64,
  maxWidth: 420,
} as const;

/*
 * The app shell from the mobile frames: header TOPCONTROLL 163:1011 (and its title,
 * search and compact variants) and the tab bar 170:4087. Figma draws the header under
 * a 50pt status bar; the app adds the real safe-area inset instead.
 */
export const shell = {
  // Header 163:1011: 412x137 with a 50pt status bar, so 87 below the inset (72 - 50 = 22 compact, 193:1623).
  headerBody: 87,
  compactBody: 22,
  headerRowTop: 16.38, // row top 66.38 - 50
  headerRadius: 22.889,
  headerGap: 19,
  homeRowLeft: 24.03, // 170:3707
  homeRowRight: 21.5, // 412 - 24.03 - 45.78 - 19 - 231.18 - 19 - 51.5
  searchRowLeft: 26.9, // 02/09: a 360.68 row centred on 50% + 1.26
  searchRowRight: 24.4,
  titleRowLeft: 23.76, // 12/13: a 367 row centred on 50% + 1.26
  titleRowRight: 21.24,
  control: 45.778, // avatar, search pill height, bell circle
  avatarRing: 4.578,
  bellGroup: 51.5, // 45.78 circle at margin-left 5.72
  bellInset: 5.72,
  bellGlyphWidth: 33.149,
  bellGlyphHeight: 30.967,
  bellGlyphOffset: 6.87,
  bellDotWidth: 7.956,
  bellDotHeight: 7.432,
  bellDotTop: 9.35, // 8% of the glyph box + its offset
  bellDotLeft: 26.76, // 60% of the glyph box + its offset
  searchMaxWidth: 231.178,
  searchTextLeft: 24.03,
  searchIconRight: 16.6,
  searchIconWidth: 22.889,
  searchIconHeight: 23.413,
  back: 40, // 195:2349
  backRadius: 12,
  backGlyph: 20,
  navGap: 12, // back to title
  // Floating glass tab bar with a notch; the active glyph rides a glass circle in the notch.
  tabBarHeight: 84, // body 64 + circle overhang 20: what screens pad by, above tabBarGap and the inset
  tabBarBody: 64,
  tabBarGap: 14, // bar to the system bar, whatever the nav mode
  tabBarMarginX: 20,
  tabBarRadius: 24,
  tabCircle: 56,
  tabCircleOverhang: 20, // circle top above the bar's top edge
  tabNotchRadius: 34, // circle radius 28 + 6 gap; the dip is this arc about the circle's centre, 42 deep
  tabNotchShoulder: 8, // fillet radius easing the top edge into the dip
  tabCircleLift: 1.1, // circle scale at the top of its hop on a tab change
  tabHighlightWidth: 1.5, // top-edge light line
  tabSheenEnd: 0.55, // glass gradient: the sheen is gone by here
  tabSheenOpacity: 0.14, // glass gradient: sheen alpha at the top edge
  tabShadeStart: 0.7, // glass gradient: the dark band starts here
  tabShadeOpacity: 0.18, // glass gradient: shade alpha at the bottom edge
  tabCircleSheenOpacity: 0.22, // circle radial sheen alpha at its centre
  tabPressScale: 0.92,
  tabLabelRise: 4, // the label slides up this far as it fades in
  tabCount: 4,
  tabGlyphFile: 30, // boxicons:file-report
  tabGlyphInspection: 27, // wpf:inspection
  tabGlyphHome: 24, // house
  tabGlyphPerson: 22, // person
  tabBlur: 50,
  // Content: Home 170:3828 sits at x 18, 25 below the header; titled screens at y 167.
  gutter: 18,
  contentTop: 25,
  detailGap: 14, // 03 content column gap
  detailPadX: 34, // 03–07: a px-16 column inside the x-18 frame
  detailTop: 33, // 03–07: content top 170 on the 137 header
  contentTopTitled: 30,
  pageTitle: 56, // 02 and 09: the page title box under a search header
} as const;

// The Figma cards and tiles on Home (158:3829), Profile (198:3469) and Notifications (204:4317).
export const figCard = {
  metricRowHeight: 91,
  metricTileHeight: 80,
  metricPad: 11,
  metricGap: 8,
  metricRowPadBottom: 7, // row h 91 = pt 4 + tile 80 + 7
  metricSkeleton: 30, // the number's line height
  labelGap: 3, // metric label padding-top
  sectionGap: 24,
  headingGap: 8,
  recentGap: 10, // 173:4666
  cardPad: 17, // NEXT UP 173:4645
  cardGap: 6,
  cardRadius: 16,
  pillPadX: 11,
  pillPadY: 3,
  pillDot: 6,
  pinWidth: 8.25,
  pinTop: 3, // centres the pin on the first 16pt meta line
  metaPadBottom: 10, // 173:4645 location row padding-bottom
  pinHeight: 10.98,
  chevronWidth: 5,
  chevronHeight: 8.75,
  ctaHeight: 36, // raised to touchMin in the app
  panelPad: 15, // RECENT NOTIFICATIONS 173:4670
  panelGap: 12,
  rowPadBottom: 13,
  noteIconBox: 36,
  noteIconTop: 2,
  noteTextGap: 3,
  noteListGap: 22, // 204:4659
  identityPadX: 18, // 204:4217
  identityPadY: 20,
  identityAccent: 2,
  roleGap: 3,
  rowRadius: 10, // 204:4228
  rowPadX: 16,
  rowPadY: 12,
  logoutGlyph: 24,
} as const;
