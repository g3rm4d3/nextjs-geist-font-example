import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { env } from './src/config/env';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>STAGE 1 — DEVELOPMENT BUILD</Text>
      <Text style={styles.title}>Rideshare Driver</Text>
      <Text style={styles.subtitle}>
        Foundation scaffold. Onboarding, availability, and ride screens are built out in later
        phases.
      </Text>
      <Text style={styles.meta}>API: {env.apiUrl}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1c1917',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  badge: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  title: {
    color: '#fafaf9',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#a8a29e',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 320,
  },
  meta: {
    color: '#78716c',
    fontSize: 12,
    marginTop: 24,
  },
});
