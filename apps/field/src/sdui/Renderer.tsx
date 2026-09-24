import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, Skeleton, Text, layout, space } from '@/design-system';
import { errorText } from '@/services/api/error-text';
import { useT } from '@/services/i18n';

import { runAction } from './actions';
import { useBinding } from './bindings';
import { componentFor, type ComponentEntry } from './components/registry';
import { useSduiRuntime } from './runtime-context';
import { interpolate, type Scope } from './template';
import { asBinding, asNode, isRecord, type SduiNode } from './types';

/*
 * The renderer. Every node is wrapped in its own error boundary, so one bad node
 * renders nothing and logs; the rest of the screen stands. A `type` this binary
 * does not know renders nothing at all, which is what lets the server publish a
 * screen using a newer component to a mixed fleet (the runtime check keeps that
 * rare; this keeps it harmless).
 *
 * Logs name the node's type and id only — never a prop value, which may be an
 * occupant's name or a coordinate (code-standards.md rule 11).
 */

const reportedTypes = new Set<string>();

function label(node: SduiNode): string {
  return node.id === undefined ? node.type : `${node.type}#${node.id}`;
}

type BoundaryProps = { readonly label: string; readonly resetKey: unknown; readonly children: ReactNode };
type BoundaryState = { readonly failed: boolean };

class NodeBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (__DEV__) console.warn(`[sdui] node ${this.props.label} failed to render (${error.name})`);
  }

  // A new definition gets a fresh attempt; the same broken node stays hidden.
  componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

// Renders any node value. Not a node, an unknown type or a crash: nothing.
export function SduiNodeView({ node, scope }: { readonly node: unknown; readonly scope: Scope }) {
  const parsed = asNode(node);
  if (parsed === null) return null;
  return (
    <NodeBoundary label={label(parsed)} resetKey={node}>
      <NodeGate node={parsed} scope={scope} />
    </NodeBoundary>
  );
}

function renderNode(node: unknown, scope: Scope, key: string): ReactNode {
  return <SduiNodeView key={key} node={node} scope={scope} />;
}

function NodeGate({ node, scope }: { readonly node: SduiNode; readonly scope: Scope }) {
  const runtime = useSduiRuntime();
  const entry = componentFor(node.type);
  if (entry === undefined) {
    if (!reportedTypes.has(node.type)) {
      reportedTypes.add(node.type);
      if (__DEV__) console.warn(`[sdui] unknown component type "${node.type}" skipped`);
    }
    return null;
  }
  if (node.visibleIf !== undefined && !(typeof node.visibleIf === 'string' && runtime.can(node.visibleIf))) {
    return null;
  }
  if (node.data !== undefined) return <BoundNode node={node} entry={entry} scope={scope} />;
  return <NodeBody node={node} entry={entry} scope={scope} />;
}

function BoundNode({
  node,
  entry,
  scope,
}: {
  readonly node: SduiNode;
  readonly entry: ComponentEntry;
  readonly scope: Scope;
}) {
  const binding = asBinding(node.data);
  const state = useBinding(binding, scope);

  if (state.status === 'loading') {
    return <Skeleton height={layout.touchMin} width="auto" shape="md" style={styles.grow} />;
  }
  if (state.status === 'error' || state.status === 'idle') {
    return <BindingError error={state.status === 'error' ? state.error : null} />;
  }
  return <NodeBody node={node} entry={entry} scope={{ ...scope, data: state.value }} />;
}

// The server's own message, small, in place of the block that could not load.
function BindingError({ error }: { readonly error: Error | null }) {
  const t = useT();
  const detail = error === null ? null : errorText(error);
  return (
    <View style={[styles.grow, styles.error]} accessibilityRole="alert">
      <Icon name={detail?.offline ? 'offline' : 'alert'} size="sm" color="ink2" />
      <Text variant="caption" color="ink2" style={styles.errorText}>
        {detail?.message ?? t('sdui.blockFailed')}
      </Text>
    </View>
  );
}

function NodeBody({
  node,
  entry,
  scope,
}: {
  readonly node: SduiNode;
  readonly entry: ComponentEntry;
  readonly scope: Scope;
}) {
  const runtime = useSduiRuntime();

  const props: Record<string, unknown> = {};
  if (isRecord(node.props)) {
    for (const [name, value] of Object.entries(node.props)) {
      props[name] = interpolate(value, scope, runtime.labeller);
    }
  }

  const children = Array.isArray(node.children)
    ? node.children.map((child, index) => renderNode(child, scope, `child-${index}`))
    : null;

  const action = node.action;
  const onPress =
    action === undefined
      ? undefined
      : () =>
          runAction(action, {
            screenId: runtime.screenId,
            nodeId: node.id,
            scope,
            labeller: runtime.labeller,
            refresh: runtime.refresh,
          });

  return (
    <>
      {entry({
        props,
        children,
        node,
        scope,
        onPress,
        testID: node.id === undefined ? undefined : `sdui-${node.id}`,
        renderNode,
      })}
    </>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  error: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  errorText: { flexShrink: 1 },
});
