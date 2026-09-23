import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { StyleSheet, View } from 'react-native';

import { TabBarItem, colors, elevation, layout, space, type IconName } from '@/design-system';

/*
 * Four tabs — Home, Complaints, Inspections, Profile (`ui-registry.md` §2). The
 * Reports tab the registry draws has no design (§5) and is left out rather than
 * built on a guess.
 *
 * The bar is the design system's TabBarItem: one component with a state, the raised
 * hexagon marking the active tab.
 */
const ICONS: Record<string, IconName> = {
  home: 'home',
  complaints: 'complaints',
  inspections: 'inspections',
  profile: 'profile',
};

// Renders the navigator's routes as TabBarItems; the navigator owns the state.
function FieldTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]}>
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options;
        const label = typeof options?.title === 'string' ? options.title : route.name;
        const active = state.index === index;
        return (
          <TabBarItem
            key={route.key}
            icon={ICONS[route.name] ?? 'home'}
            label={label}
            active={active}
            testID={`tab-${route.name}`}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!active && !event.defaultPrevented) navigation.navigate(route.name);
            }}
          />
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FieldTabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="complaints" options={{ title: 'Complaints' }} />
      <Tabs.Screen name="inspections" options={{ title: 'Inspections' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.tabbarHeight,
    paddingTop: space[2],
    paddingHorizontal: space[2],
    backgroundColor: colors.surface1,
    ...elevation.tabbar,
  },
});
