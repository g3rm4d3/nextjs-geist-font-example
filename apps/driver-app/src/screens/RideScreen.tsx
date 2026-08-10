import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, completeRide } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Ride'>;

/**
 * IN_PROGRESS. No cancel action here on purpose — DRIVER_CANCELLABLE_
 * STATUSES (rideLifecycleService) stops at DRIVER_ARRIVED; once the trip
 * has started, a plain cancel no longer applies to either side (section 9),
 * so this screen only ever has one way forward. Live route/ETA display is
 * Phase 10's "realtime ride experience," not this one's.
 */
export function RideScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, setRide } = useActiveRide();
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleComplete = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsCompleting(true);
    try {
      const completed = await completeRide(accessToken, ride.id);
      setRide(completed);
      navigation.navigate('RideComplete');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not complete this ride.',
      );
      setIsCompleting(false);
    }
  }, [accessToken, ride, setRide, navigation]);

  if (!ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>No active ride</Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('DriverHomeMap')}
        >
          <Text style={styles.secondaryButtonText}>Back to map</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.statusLabel}>Trip in progress</Text>
        <Text style={styles.addressLabel}>{ride.destination.label}</Text>
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <Pressable
        style={[styles.button, isCompleting && styles.buttonDisabled]}
        onPress={handleComplete}
        disabled={isCompleting}
        testID="complete-ride-button"
      >
        {isCompleting ? (
          <ActivityIndicator color="#1c1917" />
        ) : (
          <Text style={styles.buttonText}>Complete ride</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20, justifyContent: 'space-between' },
  centered: {
    flex: 1,
    backgroundColor: '#1c1917',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fafaf9', fontSize: 18, fontWeight: '700', marginBottom: 16 },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#57534e',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: '#fafaf9', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#292524', borderRadius: 12, padding: 20, marginTop: 24 },
  statusLabel: { color: '#60a5fa', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  addressLabel: { color: '#fafaf9', fontSize: 18, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 16 },
  button: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#4ade80',
    marginBottom: 8,
  },
  buttonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
