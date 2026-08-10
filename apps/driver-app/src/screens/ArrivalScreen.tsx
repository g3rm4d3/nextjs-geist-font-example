import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import {
  ApiClientError,
  cancelRideAsDriver,
  markPassengerOnboard,
  startTrip,
} from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Arrival'>;

/**
 * DRIVER_ARRIVED, waiting for the passenger. One button covers two
 * distinct backend transitions — DRIVER_ARRIVED -> PASSENGER_ONBOARD,
 * then immediately PASSENGER_ONBOARD -> IN_PROGRESS — because "the
 * passenger got in" and "the trip starts" are the same real-world moment
 * for a driver; splitting it into two taps would add a confirmation step
 * nothing in section 9 asks for. Both transitions still happen as two
 * distinct, separately-logged ride_events server-side (see
 * docs/ride-lifecycle.md) — this is a UI simplification, not a backend
 * one.
 */
export function ArrivalScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, setRide, clear } = useActiveRide();
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleStartTrip = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsStarting(true);
    try {
      await markPassengerOnboard(accessToken, ride.id);
      const started = await startTrip(accessToken, ride.id);
      setRide(started);
      navigation.navigate('Ride');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not start the trip.',
      );
      setIsStarting(false);
    }
  }, [accessToken, ride, setRide, navigation]);

  const handleCancel = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsCancelling(true);
    try {
      await cancelRideAsDriver(accessToken, ride.id);
      clear();
      navigation.navigate('DriverHomeMap');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not cancel this ride.',
      );
      setIsCancelling(false);
    }
  }, [accessToken, ride, clear, navigation]);

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
        <Text style={styles.statusLabel}>You&apos;ve arrived</Text>
        <Text style={styles.addressLabel}>{ride.pickup.label}</Text>
        <Text style={styles.subtitle}>Waiting for the passenger.</Text>
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.cancelButton, isCancelling && styles.buttonDisabled]}
          onPress={handleCancel}
          disabled={isCancelling || isStarting}
          testID="cancel-ride-button"
        >
          <Text style={styles.cancelButtonText}>Cancel ride</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.primaryButton, isStarting && styles.buttonDisabled]}
          onPress={handleStartTrip}
          disabled={isStarting || isCancelling}
          testID="start-trip-button"
        >
          {isStarting ? (
            <ActivityIndicator color="#1c1917" />
          ) : (
            <Text style={styles.primaryButtonText}>Confirm pickup &amp; start trip</Text>
          )}
        </Pressable>
      </View>
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
  statusLabel: { color: '#4ade80', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  addressLabel: { color: '#fafaf9', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#a8a29e', fontSize: 13 },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  button: { flex: 1, borderRadius: 8, paddingVertical: 16, alignItems: 'center' },
  cancelButton: { backgroundColor: '#292524', borderWidth: 1, borderColor: '#57534e' },
  cancelButtonText: { color: '#f87171', fontSize: 15, fontWeight: '700' },
  primaryButton: { backgroundColor: '#4ade80' },
  primaryButtonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
