import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

/** Shown while AuthContext is resolving a possibly-stored session on launch. */
export function SplashScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rideshare Passenger</Text>
      <ActivityIndicator color="#fbbf24" style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
  },
  spinner: {
    marginTop: 20,
  },
});
