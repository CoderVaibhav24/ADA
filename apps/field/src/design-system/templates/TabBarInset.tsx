/**
 * Extra bottom space a screen needs to clear the tab bar. The tabs layout now pads each
 * scene above the bar itself, so this is 0 everywhere; templates still add it so a bar
 * that overlaps content again only needs the provider value changed.
 */

import { createContext, useContext } from 'react';

export const TabBarInsetContext = createContext(0);

// The bottom padding a screen needs to clear the tab bar; 0 outside the tabs.
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext);
}
