import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Avatar,
  Button,
  Chip,
  Icon,
  InProgressBlock,
  ListRow,
  ScreenHeader,
  SectionCard,
  Skeleton,
  Text,
  colors,
  control,
  layout,
  space,
} from '@/design-system';
import { errorText } from '@/services/api/error-text';
import { queryClient } from '@/services/api/query-client';
import { useMyZones } from '@/services/api/zone-reads';
import { displayName } from '@/services/auth/claims';
import { signOut } from '@/services/auth/session';
import { useTokenClaims } from '@/services/auth/use-token-claims';
import { useCapabilities } from '@/services/config/capabilities';
import { humanizeCode } from '@/services/config/labels';
import { currentPushPermission, enablePushFromSettings, pushEnv, type PushPermission } from '@/services/push';

/*
 * Profile, `198:3469`.
 *
 *   Name, username, email   the access token's claims (Keycloak `profile`, `email`)
 *   Roles                   GET /api/icms/me/capabilities
 *   Zone assignment         GET /api/icms/zones — scoped server-side to this officer
 *   Designation, employee ID, supervisor, joined
 *                           in progress: no endpoint a surveyor can call holds them
 *   Notifications           the OS push permission; "Turn on" runs services/push enablePushFromSettings
 *   Logout                  services/auth signOut, then the in-memory cache is dropped
 */
const IN_PROGRESS_ROWS = ['Designation', 'Employee ID', 'Supervisor', 'Joined'] as const;

const PUSH_STATE_LABEL: Record<PushPermission, string> = {
  granted: 'On',
  denied: 'Off',
  undetermined: 'Off',
};

const pushAvailable = (Platform.OS === 'android' || Platform.OS === 'ios') && pushEnv.notifyBaseUrl !== null;

// The OS push permission, re-read whenever the app returns from system settings.
function usePushPermission(): [PushPermission | null, () => void] {
  const [status, setStatus] = useState<PushPermission | null>(null);
  const read = useCallback(() => {
    if (!pushAvailable) return;
    void currentPushPermission()
      .then((current) => setStatus(current.status))
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => subscription.remove();
  }, [read]);
  return [status, read];
}

// A skeleton row the height of a ListRow.
function RowSkeleton() {
  return <Skeleton height={layout.touchMin} />;
}

export function ProfileScreen() {
  const claims = useTokenClaims();
  const capabilities = useCapabilities();
  const zones = useMyZones();
  const [signingOut, setSigningOut] = useState(false);
  const [push, rereadPush] = usePushPermission();
  const [enabling, setEnabling] = useState(false);

  // Asks for push (or opens system settings), then shows the state the OS reports.
  const onEnablePush = async () => {
    setEnabling(true);
    try {
      await enablePushFromSettings();
    } finally {
      setEnabling(false);
      rereadPush();
    }
  };

  const ready = claims.status === 'ready' ? claims.claims : null;
  const name = ready === null ? null : displayName(ready);

  // Ends the session through the auth service and drops every cached read with it.
  const onLogout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      queryClient.clear();
    } finally {
      setSigningOut(false);
    }
  };

  // Refetches the two server reads; the claims are local.
  const onRefresh = () => {
    void capabilities.refetch();
    void zones.refetch();
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScreenHeader title="Profile" />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={capabilities.isRefetching || zones.isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface1}
          />
        }
      >
        <View style={styles.identity}>
          {name === null ? (
            <Skeleton width={layout.touchMin * 2} height={layout.touchMin * 2} shape="pill" />
          ) : (
            <Avatar name={name} size="lg" ringed />
          )}
          {claims.status === 'loading' ? (
            <Skeleton height={space[6]} width="50%" />
          ) : name !== null ? (
            <Text variant="heading" align="center">
              {name}
            </Text>
          ) : null}
        </View>

        <SectionCard title="Account">
          {claims.status === 'loading' ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : ready === null ? (
            <Text variant="body" color="ink2">
              The signed-in account could not be read from this device.
            </Text>
          ) : (
            <>
              {name ? <ListRow label="Name" value={name} showDivider /> : null}
              {ready.preferred_username ? (
                <ListRow
                  label="Username"
                  value={ready.preferred_username}
                  monospaceValue
                  showDivider
                />
              ) : null}
              {ready.email ? <ListRow label="Email" value={ready.email} monospaceValue /> : null}
            </>
          )}
        </SectionCard>

        <SectionCard title="Roles">
          {capabilities.isPending ? (
            <RowSkeleton />
          ) : capabilities.error !== null && capabilities.data === undefined ? (
            <Text variant="body" color="ink1" accessibilityRole="alert">
              {errorText(capabilities.error).message}
            </Text>
          ) : (capabilities.data?.roles.length ?? 0) === 0 ? (
            <Text variant="body" color="ink2">
              No ICMS role is assigned to this account.
            </Text>
          ) : (
            <View style={styles.chips}>
              {capabilities.data?.roles.map((role) => (
                <Chip key={role} label={humanizeCode(role)} tone="brand" />
              ))}
            </View>
          )}
        </SectionCard>

        <SectionCard title="Zone assignment">
          {zones.isPending ? (
            <RowSkeleton />
          ) : zones.error !== null && zones.data === undefined ? (
            <Text variant="body" color="ink1" accessibilityRole="alert">
              {errorText(zones.error).message}
            </Text>
          ) : (zones.data?.items.length ?? 0) === 0 ? (
            <Text variant="body" color="ink2">
              No zone is assigned to this account.
            </Text>
          ) : (
            zones.data?.items.map((zone, index, all) => (
              <ListRow
                key={zone.zone_cd}
                label={zone.name}
                value={zone.zone_cd}
                monospaceValue
                showDivider={index < all.length - 1}
              />
            ))
          )}
        </SectionCard>

        <SectionCard title="Notifications">
          {!pushAvailable ? (
            <ListRow label="Push notifications" value="Not available on this device" />
          ) : push === null ? (
            <RowSkeleton />
          ) : (
            <>
              <ListRow label="Push notifications" value={PUSH_STATE_LABEL[push]} />
              {push === 'granted' ? null : (
                <Button
                  label="Turn on"
                  onPress={() => void onEnablePush()}
                  loading={enabling}
                  variant="secondary"
                  size="sm"
                  accessibilityHint="Asks for permission, or opens system settings if it was refused"
                />
              )}
            </>
          )}
        </SectionCard>

        <View style={styles.inProgress}>
          {IN_PROGRESS_ROWS.map((title) => (
            <InProgressBlock key={title} title={title} />
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Logout"
          variant="destructive"
          onPress={() => void onLogout()}
          loading={signingOut}
          leadingIcon={<Icon name="logout" size="md" color="statusOverdue" />}
          accessibilityHint="Signs you out. Drafts and captures on this device are kept."
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  body: { padding: space[4], gap: space[5], paddingBottom: space[8] },
  identity: { alignItems: 'center', gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  inProgress: { gap: space[3] },
  footer: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[4],
    borderTopWidth: control.hairline,
    borderTopColor: colors.line2,
    backgroundColor: colors.surface1,
  },
});
