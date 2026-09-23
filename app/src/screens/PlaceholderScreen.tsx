import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/*
 * A screen body that exists so the navigation tree can be walked before the
 * design system lands.
 *
 * Deliberately styleless: colour, spacing and type live in
 * `src/design-system/tokens/`, which another agent owns, and a literal here would
 * be the first breach of the rule the whole structure exists to enforce
 * (code-standards.md rule 2). Every one of these is replaced by the real screen
 * from `ui-registry.md` §1.
 */
export type PlaceholderScreenProps = {
  readonly title: string;
  readonly figmaNode: string;
  readonly note?: string;
};

export function PlaceholderScreen({ title, figmaNode, note }: PlaceholderScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text>{`Figma ${figmaNode} — not built yet.`}</Text>
        {note === undefined ? null : <Text>{note}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  title: { fontWeight: '600' },
});
