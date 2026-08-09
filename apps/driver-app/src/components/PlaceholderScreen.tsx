import { StyleSheet, Text, View } from 'react-native';

interface PlaceholderScreenProps {
  title: string;
  description: string;
}

/**
 * Shared shell for screens that exist in the navigation IA (per the
 * Phase 5 screen list) but have no real functionality yet because the
 * backend capability they depend on isn't built until a later phase —
 * e.g. ride matching (Phase 8), the ride lifecycle (Phase 9/10),
 * documents (Phase 15), earnings (Phase 12), support (Phase 18). Honest
 * placeholder, not a fake feature — same pattern as apps/passenger-app's
 * PlaceholderScreen (Phase 3).
 */
export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#1c1917',
  },
  title: {
    color: '#fafaf9',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    color: '#a8a29e',
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 320,
  },
});
