import { DarkTheme, type Theme as NavigationTheme } from 'expo-router';

import { colors } from './tokens';

// The dark screen every navigator paints behind a scene, so a transition never flashes white.
export const sceneBackground = { backgroundColor: colors.figScreen } as const;

// React Navigation's dark theme with the app's screen colour as background and card.
export const navigationTheme: NavigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.figScreen, card: colors.figScreen },
};
