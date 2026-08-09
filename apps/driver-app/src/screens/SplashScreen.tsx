import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/** Shown while AuthContext is resolving a possibly-stored session on launch. */
export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.badge}>STAGE 1 — DEVELOPMENT BUILD</Text>
      <Text style={styles.title}>Rideshare Driver</Text>
      <ActivityIndicator color="#fbbf24" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1917',
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
    fontSize: 22,
    fontWeight: '700',
  },
  spinner: {
    marginTop: 20,
  },
});
