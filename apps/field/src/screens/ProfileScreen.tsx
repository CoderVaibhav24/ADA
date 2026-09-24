import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  Avatar,
  Button,
  ConfirmDialog,
  Glyph,
  LanguageToggle,
  ProfileRow,
  ScreenHeader,
  Skeleton,
  Text,
  colors,
  control,
  figCard,
  radius,
  shell,
  space,
  useTabBarInset,
} from '@/design-system';
import { errorText } from '@/services/api/error-text';
import { queryClient } from '@/services/api/query-client';
import { useMyZones, type Zone } from '@/services/api/zone-reads';
import { displayName } from '@/services/auth/claims';
import { signOut } from '@/services/auth/session';
import { useTokenClaims } from '@/services/auth/use-token-claims';
import { appIdentity } from '@/services/config/app-identity';
import { readOutbox, useOutbox } from '@/services/inspection/outbox';
import { forgetSubmitsOnSignOut, isRoundGone } from '@/services/inspection/submit';
import { useLocale, useT, useTPlural, type Locale } from '@/services/i18n';
import { currentPushPermission, enablePushFromSettings, pushEnv, type PushPermission } from '@/services/push';

/*
 * Profile, `198:3469`.
 *
 *   Name, login ID, email   the access token's claims (Keycloak `profile`, `email`)
 *   Zone assignment         GET /api/icms/zones — scoped server-side to this officer
 *   Supervisor, contact, joined
 *                           not shown: no endpoint a surveyor can call holds them, and
 *                           a row that says "in progress" is noise to a field worker
 *   Waiting to upload       the capture and check-in records on this phone
 *   Notifications           the OS push permission; "Turn on" runs enablePushFromSettings
 *   Logout                  asks first, warning in plain words about unsent work and that
 *                           held submits must be sent again; then those submits go,
 *                           services/auth signOut runs and the in-memory cache is dropped.
 *                           The root guard moves the app to Login (the prototype's link
 *                           to 193:1534 is a wiring slip, INDEX.md §5).
 */
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

// A zone's name in the app's language, when the Hindi name is seeded.
function zoneName(zone: Zone, locale: Locale): string {
  return locale === 'hi' && zone.name_hi ? zone.name_hi : zone.name;
}

// The 204:4227 accent: a 2pt line fading in and out of `#C87820` along the card's top.
function AccentLine() {
  return (
    <Svg width="100%" height={figCard.identityAccent} style={styles.accent} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="profile-accent" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={colors.figAccent} stopOpacity={0} />
          <Stop offset="0.5" stopColor={colors.figAccent} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.figAccent} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={figCard.identityAccent} fill="url(#profile-accent)" />
    </Svg>
  );
}

export function ProfileScreen() {
  const router = useRouter();
  const t = useT();
  const tp = useTPlural();
  const locale = useLocale();
  const tabInset = useTabBarInset();
  const claims = useTokenClaims();
  const zones = useMyZones();
  const outbox = useOutbox();
  const [push, rereadPush] = usePushPermission();
  const [enabling, setEnabling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);

  const ready = claims.status === 'ready' ? claims.claims : null;
  const name = ready === null ? null : displayName(ready);
  const zoneNames = (zones.data?.items ?? []).map((zone) => zoneName(zone, locale));
  const version = appIdentity().version;
  const waiting = outbox.uploads.length + outbox.submits.length;

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

  // Reads the unsent work from disk at the moment of asking, so the warning is current.
  const askLogout = () => {
    const now = readOutbox();
    const parts = [
      now.photos > 0 ? tp('shell.profile.unsent.photos', now.photos) : null,
      now.checkIns > 0 ? tp('shell.profile.unsent.checkIns', now.checkIns) : null,
      now.submits.length > 0 ? tp('shell.profile.unsent.submits', now.submits.length) : null,
      now.rounds.length > 0 ? tp('shell.profile.unsent.inspections', now.rounds.length) : null,
    ].filter((part): part is string => part !== null);
    const gone = now.submits.filter(isRoundGone).length;
    const lines = [
      parts.length === 0 ? null : t('shell.profile.logoutUnsent', { summary: parts.join(', ') }),
      now.submits.length > gone ? t('shell.profile.logoutSubmits') : null,
      gone > 0 ? t('shell.profile.logoutGone') : null,
    ].filter((line): line is string => line !== null);
    setUnsent(lines.length === 0 ? null : lines.join(' '));
    setConfirming(true);
  };

  // Ends the session and drops every cached read; the root guard then shows Login. Held submits go, as warned.
  const onLogout = async () => {
    setSigningOut(true);
    try {
      forgetSubmitsOnSignOut();
      await signOut();
      queryClient.clear();
    } finally {
      setSigningOut(false);
      setConfirming(false);
    }
  };

  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate('/home');
  };

  const zonesFailed = zones.error !== null && zones.data === undefined;
  // Several zones collapse to a count; tapping the row lists them.
  const manyZones = !zones.isPending && !zonesFailed && zoneNames.length > 1;
  let zoneValue: string;
  if (zones.isPending) zoneValue = t('common.loading');
  else if (zonesFailed) zoneValue = t(errorText(zones.error).offline ? 'shell.error.offline' : 'shell.error.generic');
  else if (manyZones) zoneValue = tp('shell.profile.zoneCount', zoneNames.length);
  else zoneValue = zoneNames.length === 0 ? t('shell.profile.noZone') : zoneNames[0];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('shell.profile.title')} onBack={onBack} />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: space[6] + tabInset }]}
        refreshControl={
          <RefreshControl
            refreshing={zones.isRefetching}
            onRefresh={() => void zones.refetch()}
            tintColor={colors.figAccent}
            colors={[colors.figAccent]}
            progressBackgroundColor={colors.figPanel}
          />
        }
      >
        <View style={styles.identity} testID="profile-identity">
          <AccentLine />
          <Avatar name={name ?? t('shell.profile.role')} appearance="framed" />
          {claims.status === 'loading' ? (
            <Skeleton height={space[6]} width="50%" tone="figSandPressed" style={styles.nameGap} />
          ) : (
            <Text variant="figName" color="white" align="center" style={styles.nameGap}>
              {name ?? t('shell.profile.role')}
            </Text>
          )}
          <Text variant="figRole" color="figScreen" align="center" style={styles.roleGap}>
            {zoneNames.length > 1
              ? tp('shell.profile.roleZoneCount', zoneNames.length)
              : zoneNames.length === 1
                ? t('shell.profile.roleZones', { zones: zoneNames[0] })
                : t('shell.profile.role')}
          </Text>
          {ready?.preferred_username ? (
            <Text variant="figCode" color="white" align="center" selectable style={styles.codeGap}>
              {ready.preferred_username}
            </Text>
          ) : null}
        </View>

        {claims.status === 'missing' ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Text variant="figBody" color="white">
              {t('shell.profile.accountUnread')}
            </Text>
          </View>
        ) : null}

        {ready?.preferred_username ? (
          <ProfileRow icon="user" label={t('shell.profile.loginId')} value={ready.preferred_username} />
        ) : null}
        {manyZones ? (
          <View style={styles.zoneGroup}>
            <ProfileRow
              icon="map"
              label={t('shell.profile.zone')}
              value={zoneValue}
              onPress={() => setZonesOpen((open) => !open)}
              expanded={zonesOpen}
              accessibilityHint={t(zonesOpen ? 'shell.profile.zoneHideHint' : 'shell.profile.zoneShowHint')}
              testID="profile-zone"
            />
            {zonesOpen ? (
              <View style={styles.zoneList}>
                {zoneNames.map((zone, index) => (
                  <Text key={`${index}-${zone}`} variant="figRowValue" color="figSandValue" selectable testID="profile-zone-item">
                    {zone}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <ProfileRow icon="map" label={t('shell.profile.zone')} value={zoneValue} testID="profile-zone" />
        )}
        {ready?.email ? <ProfileRow icon="document" label={t('shell.profile.email')} value={ready.email} /> : null}
        <ProfileRow
          icon="upload"
          label={t('shell.profile.pending')}
          value={waiting === 0 ? t('shell.profile.pendingNone') : tp('shell.banner.waiting', waiting)}
          onPress={() => router.push('/pending-uploads')}
          accessibilityHint={t('shell.profile.pendingHint')}
          testID="profile-pending"
        />
        <ProfileRow icon="language" label={t('shell.profile.language')} trailing={<LanguageToggle tone="surface" />} />
        {pushAvailable ? (
          <ProfileRow
            icon="bell"
            label={t('shell.profile.push')}
            value={push === null ? undefined : push === 'granted' ? t('shell.profile.pushOn') : t('shell.profile.pushOff')}
            trailing={
              push !== null && push !== 'granted' ? (
                <Button
                  label={t('shell.profile.pushTurnOn')}
                  onPress={() => void onEnablePush()}
                  loading={enabling}
                  variant="figPrimary"
                  size="sm"
                  fullWidth={false}
                  accessibilityHint={t('shell.profile.pushTurnOnHint')}
                />
              ) : undefined
            }
          />
        ) : null}
        {version ? <ProfileRow icon="info" label={t('shell.profile.version')} value={version} /> : null}

        <Button
          testID="profile-logout"
          label={t('shell.profile.logout')}
          variant="figPrimary"
          onPress={askLogout}
          accessibilityHint={t('shell.profile.logoutHint')}
          leadingIcon={<Glyph name="logout" width={figCard.logoutGlyph} color="white" />}
        />
      </ScrollView>

      <ConfirmDialog
        testID="logout-dialog"
        visible={confirming}
        icon="logout"
        title={t('shell.profile.logoutTitle')}
        body={t('shell.profile.logoutBody')}
        warning={unsent}
        confirmLabel={t('shell.profile.logoutConfirm')}
        confirmIcon={<Glyph name="logout" width={figCard.logoutGlyph} color="white" />}
        cancelLabel={t('shell.profile.logoutStay')}
        onConfirm={() => void onLogout()}
        onCancel={() => setConfirming(false)}
        busy={signingOut}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  // 204:4216: x 18, y 167, gap 12.
  body: { paddingHorizontal: shell.gutter, paddingTop: shell.contentTopTitled, gap: space[3] },
  identity: {
    alignItems: 'center',
    paddingHorizontal: figCard.identityPadX,
    paddingVertical: figCard.identityPadY,
    borderRadius: radius.lg,
    borderWidth: control.hairline,
    borderColor: colors.figSandBorder,
    backgroundColor: colors.figSand,
    overflow: 'hidden',
  },
  accent: { position: 'absolute', top: 0, left: 0, opacity: 0.5 },
  nameGap: { paddingTop: space[3] },
  roleGap: { paddingTop: figCard.roleGap },
  codeGap: { paddingTop: space[1] },
  zoneGroup: { gap: space[2] },
  zoneList: {
    gap: space[2],
    paddingHorizontal: figCard.rowPadX,
    paddingVertical: figCard.rowPadY,
    borderRadius: radius.figRow,
    borderWidth: control.hairline,
    borderColor: colors.figSandBorder,
    backgroundColor: colors.figSand,
  },
  notice: {
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.figPanelCard,
  },
});
