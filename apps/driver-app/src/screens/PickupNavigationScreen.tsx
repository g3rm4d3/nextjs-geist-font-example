import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, cancelRideAsDriver, markArrived, markEnRoute } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PickupNavigation'>;

/**
 * Section 9's DRIVER_ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED leg,
 * from the driver's side. The first transition fires automatically on
 * mount — "accepted the ride" and "started heading to pickup" are the
 * same moment for a driver, so there's no separate button for it — while
 * the second ("Arrived") is an explicit action, since only the driver
 * knows when they've actually reached the pickup point. Real turn-by-
 * turn navigation is Phase 10's "realtime ride experience," not this
 * screen's job — see docs/maps.md for why there's no live route drawn
 * here either.
 */
export function PickupNavigationScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, setRide, clear } = useActiveRide();
  const [isMarkingArrived, setIsMarkingArrived] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards the mount-time en-route call against firing twice (React
  // Strict Mode double-invokes effects) and against re-firing if this
  // screen is ever revisited while already past DRIVER_ASSIGNED.
  const hasStartedEnRouteRef = useRef(false);

  useEffect(() => {
    if (
      !accessToken ||
      !ride ||
      ride.status !== 'DRIVER_ASSIGNED' ||
      hasStartedEnRouteRef.current
    ) {
      return;
    }
    hasStartedEnRouteRef.current = true;

    markEnRoute(accessToken, ride.id)
      .then(setRide)
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not start navigation to pickup.',
        );
      });
  }, [accessToken, ride, setRide]);

  const handleArrived = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsMarkingArrived(true);
    try {
      const updated = await markArrived(accessToken, ride.id);
      setRide(updated);
      navigation.navigate('Arrival');
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not mark arrival.');
    } finally {
      setIsMarkingArrived(false);
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
        <Text style={styles.statusLabel}>
          {ride.status === 'DRIVER_ASSIGNED' ? 'Starting…' : 'Heading to pickup'}
        </Text>
        <Text style={styles.addressLabel}>{ride.pickup.label}</Text>
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.cancelButton, isCancelling && styles.buttonDisabled]}
          onPress={handleCancel}
          disabled={isCancelling || isMarkingArrived}
          testID="cancel-ride-button"
        >
          <Text style={styles.cancelButtonText}>Cancel ride</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.primaryButton, isMarkingArrived && styles.buttonDisabled]}
          onPress={handleArrived}
          disabled={isMarkingArrived || isCancelling}
          testID="arrived-button"
        >
          {isMarkingArrived ? (
            <ActivityIndicator color="#1c1917" />
          ) : (
            <Text style={styles.primaryButtonText}>I&apos;ve arrived</Text>
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
  statusLabel: { color: '#fbbf24', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  addressLabel: { color: '#fafaf9', fontSize: 18, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  button: { flex: 1, borderRadius: 8, paddingVertical: 16, alignItems: 'center' },
  cancelButton: { backgroundColor: '#292524', borderWidth: 1, borderColor: '#57534e' },
  cancelButtonText: { color: '#f87171', fontSize: 15, fontWeight: '700' },
  primaryButton: { backgroundColor: '#fbbf24' },
  primaryButtonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
