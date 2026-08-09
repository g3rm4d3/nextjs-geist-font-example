import { StyleSheet, Text, View } from 'react-native';

interface PlaceholderScreenProps {
  title: string;
  description: string;
}

/**
 * Shared shell for screens that exist in the navigation IA (per the
 * Phase 3 screen list) but have no real functionality yet because the
 * backend capability they depend on isn't built until a later phase —
 * e.g. ride matching (Phase 7/8), payments (Phase 11), support tickets
 * (Phase 18). Honest placeholder, not a fake feature.
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
    backgroundColor: '#0f172a',
  },
  title: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 320,
  },
});
