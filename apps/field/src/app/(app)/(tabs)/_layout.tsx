import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { CommonActions } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarInsetContext, sceneBackground, shell } from '@/design-system';
import { BottomTabBar, type BottomTabKey } from '@/design-system/organisms/BottomTabBar';

/*
 * Four tabs — Home, Complaints, Inspection, Profile — on the floating notched glass bar.
 * Complaints and Inspection are groups, each a stack, so a complaint and the wizard
 * open inside their section with the bar still showing and the right tab marked.
 * The groups add nothing to a URL: /complaints, /complaint/{ref}, /inspection/{ref}/…
 * and /inspections are the paths they always were.
 */
const KEY_OF_ROUTE: Record<string, BottomTabKey> = {
  home: 'home',
  '(complaints)': 'complaints',
  '(inspections)': 'inspection',
  profile: 'profile',
};

// The list each stacked tab opens on (the groups' `unstable_settings.anchor`).
const ANCHOR_OF_ROUTE: Record<string, string | undefined> = {
  '(complaints)': 'complaints',
  '(inspections)': 'inspections',
};

type NestedState = { key?: string; routes?: readonly { name: string }[] } | undefined;

const ROUTE_OF_KEY: Record<BottomTabKey, string> = {
  home: 'home',
  complaints: '(complaints)',
  inspection: '(inspections)',
  profile: 'profile',
};

// Maps the navigator's state onto the bar; the navigator owns which tab is active.
function FieldTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const focused = state.routes[state.index];
  const active = KEY_OF_ROUTE[focused?.name ?? 'home'] ?? 'home';
  return (
    <BottomTabBar
      active={active}
      bottomInset={insets.bottom}
      onSelect={(key) => {
        const route = state.routes.find((candidate) => candidate.name === ROUTE_OF_KEY[key]);
        if (route === undefined) return;
        const isFocused = focused?.key === route.key;
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (event.defaultPrevented) return;
        if (!isFocused) {
          navigation.navigate(route.name, route.params);
          return;
        }
        /*
         * A second tap returns to the tab's list. The stack pops to its top on
         * `tabPress` by itself; a stack opened straight onto a complaint (a push
         * notification, a server-driven link) has no list under it, so it is reset.
         */
        const nested = route.state as NestedState;
        const anchor = ANCHOR_OF_ROUTE[route.name];
        if (anchor !== undefined && nested?.key !== undefined && nested.routes?.[0]?.name !== anchor) {
          navigation.dispatch({ ...CommonActions.reset({ index: 0, routes: [{ name: anchor }] }), target: nested.key });
        }
      }}
    />
  );
}

// Each scene ends above the bar, so content stops there instead of scrolling under the glass.
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const barSpace = shell.tabBarHeight + shell.tabBarGap + insets.bottom;
  return (
    <TabBarInsetContext.Provider value={0}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: [sceneBackground, { paddingBottom: barSpace }] }}
        tabBar={(props) => <FieldTabBar {...props} />}
      >
        <Tabs.Screen name="home" />
        <Tabs.Screen name="(complaints)" />
        <Tabs.Screen name="(inspections)" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </TabBarInsetContext.Provider>
  );
}
