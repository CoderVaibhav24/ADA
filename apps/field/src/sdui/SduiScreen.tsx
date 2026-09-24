import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton, StateMessage, Text, colors, layout, space } from '@/design-system';
import { AdaApiError } from '@/services/api/errors';
import { errorText } from '@/services/api/error-text';
import { hasPermission, useCapabilities } from '@/services/config';
import { localIsoDay } from '@/services/format/datetime';
import { t, useT } from '@/services/i18n';

import { refreshBindings } from './bindings';
import { useLabeller } from './labels';
import { SduiNodeView } from './Renderer';
import { SduiRuntimeContext, type SduiRuntime } from './runtime-context';
import { sduiKeys, useScreenDefinition } from './screen-api';
import { labelDomains, type Scope } from './template';
import { asNode, type ScreenEnvelope } from './types';

/*
 * One server-driven screen: fetch (or recall) the definition, then render it.
 * Leading `screen_header` nodes stay fixed above the scrolling body, the way the
 * coded templates hold their header. Pull to refresh revalidates the definition
 * and every data block on it.
 */

export type SduiScreenProps = {
  readonly screenId: string;
  /** Route params, readable in templates as `{{params.name}}`. */
  readonly params?: Readonly<Record<string, string>>;
};

const NO_PARAMS: Readonly<Record<string, string>> = {};

// How many body nodes at the top are screen headers; those render outside the scroll.
function headerCount(envelope: ScreenEnvelope | null): number {
  const body = envelope?.definition.body ?? [];
  let count = 0;
  while (count < body.length && asNode(body[count])?.type === 'screen_header') count += 1;
  return count;
}

// True when the definition draws its own header, so the navigator's should be hidden.
export function hasOwnHeader(envelope: ScreenEnvelope | null): boolean {
  return headerCount(envelope) > 0;
}

function savedCopyNotice(error: Error | null): string {
  if (error instanceof AdaApiError && error.code === 'app_update_required') {
    return t('sdui.savedCopyUpdate');
  }
  return t('sdui.savedCopy', { reason: errorText(error).message });
}

function Failure({ error, onRetry }: { readonly error: Error | null; readonly onRetry: () => void }) {
  const t = useT();
  const detail = errorText(error);
  const code = error instanceof AdaApiError ? error.code : null;
  const title =
    code === 'app_update_required'
      ? t('sdui.failure.update')
      : code === 'role_not_permitted'
        ? t('sdui.failure.forbidden')
        : t('sdui.failure.generic');
  return (
    <StateMessage
      tone={detail.offline ? 'offline' : 'error'}
      title={title}
      message={detail.message}
      reference={detail.requestId}
      actionLabel={t('common.retry')}
      onAction={onRetry}
    />
  );
}

export function SduiScreen({ screenId, params = NO_PARAMS }: SduiScreenProps) {
  const client = useQueryClient();
  const screen = useScreenDefinition(screenId);
  const capabilities = useCapabilities();
  const envelope = screen.envelope;
  const definition = envelope?.definition;

  const domains = useMemo(() => labelDomains(definition), [definition]);
  const labeller = useLabeller(domains);
  const [refreshing, setRefreshing] = useState(false);
  const { refetch } = screen;

  const refresh = useCallback(() => {
    refetch();
    void refreshBindings(client);
  }, [client, refetch]);

  const onPull = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled([
      client.refetchQueries({ queryKey: sduiKeys.screen(screenId) }),
      refreshBindings(client),
    ]).finally(() => setRefreshing(false));
  }, [client, screenId]);

  const can = useCallback(
    (permission: string) => hasPermission(capabilities.data, permission),
    [capabilities.data],
  );
  const runtime = useMemo<SduiRuntime>(
    () => ({ screenId, labeller, can, refresh }),
    [screenId, labeller, can, refresh],
  );
  const scope = useMemo<Scope>(() => ({ params, today: localIsoDay() }), [params]);

  const headers = headerCount(envelope);

  if (envelope === null || definition === undefined) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        {screen.isPending ? (
          <View style={styles.body}>
            <Skeleton height={layout.headerHeight} shape="md" />
            <Skeleton height={layout.touchMin * 2} shape="md" />
            <Skeleton height={layout.touchMin * 3} shape="md" />
          </View>
        ) : (
          <Failure error={screen.error} onRetry={screen.refetch} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SduiRuntimeContext.Provider value={runtime}>
      <SafeAreaView edges={headers > 0 ? ['top'] : []} style={styles.screen}>
        {definition.body.slice(0, headers).map((node, index) => (
          <SduiNodeView key={`header-${index}`} node={node} scope={scope} />
        ))}
        {screen.showingSavedCopy ? (
          <Text variant="caption" color="ink3" style={styles.notice}>
            {savedCopyNotice(screen.error)}
          </Text>
        ) : null}
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPull}
              tintColor={colors.brand}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface1}
            />
          }
        >
          {definition.body.slice(headers).map((node, index) => (
            <SduiNodeView key={`body-${index}`} node={node} scope={scope} />
          ))}
        </ScrollView>
      </SafeAreaView>
    </SduiRuntimeContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  body: { padding: space[4], gap: space[5], paddingBottom: space[8] },
  notice: { paddingHorizontal: space[4], paddingBottom: space[2] },
});
