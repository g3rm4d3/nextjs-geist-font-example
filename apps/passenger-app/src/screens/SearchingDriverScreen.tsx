import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, cancelRide } from '../lib/apiClient';
import { formatCents, formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import { useRidePolling } from '../lib/useRidePolling';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchingDriver'>;

/**
 * Section 9's "implement cancellation pathways" (a Cancel button, wired
 * to the real `POST /rides/:id/cancel`) plus, as of Phase 10, the
 * `useRidePolling` loop that actually watches this ride move past
 * `SEARCHING_DRIVER` — the "display assigned driver" flow starts the
 * moment that poll sees `DRIVER_ASSIGNED` (or later) and navigates to
 * `DriverAssignedScreen`, which owns everything from there. A
 * driver/system cancellation reaching this screen (rare here — no driver
 * is even assigned yet — but possible via `cancelRideBySystem`) resets
 * the draft and returns to the map with a brief native alert.
 */
export function SearchingDriverScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { pickup, destination, ride: draftRide, reset } = useRideDraft();
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { ride: polledRide } = useRidePolling(accessToken, draftRide?.id ?? null);
  const ride = polledRide ?? draftRide;

  useEffect(() => {
    if (!ride) return;

    if (
      ride.status === 'DRIVER_ASSIGNED' ||
      ride.status === 'DRIVER_EN_ROUTE' ||
      ride.status === 'DRIVER_ARRIVED'
    ) {
      navigation.navigate('DriverAssigned');
      return;
    }
    if (ride.status === 'PASSENGER_ONBOARD' || ride.status === 'IN_PROGRESS') {
      navigation.navigate('RideTracking');
      return;
    }
    if (ride.status.startsWith('CANCELLED')) {
      Alert.alert('Ride cancelled', 'This ride was cancelled.');
      reset();
      navigation.navigate('HomeMap');
    }
  }, [ride, navigation, reset]);

  const handleCancel = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsCancelling(true);
    try {
      await cancelRide(accessToken, ride.id);
      reset();
      navigation.navigate('HomeMap');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not cancel this ride.',
      );
      setIsCancelling(false);
    }
  }, [accessToken, ride, reset, navigation]);

  if (!ride || !pickup || !destination) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No active ride request.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" size="large" style={styles.spinner} />
        <Text style={styles.title}>Searching for a driver…</Text>
        <Text style={styles.subtitle}>
          We&apos;ll bring you straight to your driver once one accepts.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.routeLabel}>
          {pickup.label} → {destination.label}
        </Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Status</Text>
          <Text style={styles.rowValue}>{ride.status}</Text>
        </View>
        {ride.estimatedDistanceMeters !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Distance</Text>
            <Text style={styles.rowValue}>{formatDistanceMiles(ride.estimatedDistanceMeters)}</Text>
          </View>
        )}
        {ride.estimatedDurationSeconds !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Estimated duration</Text>
            <Text style={styles.rowValue}>
              {formatDurationMinutes(ride.estimatedDurationSeconds)}
            </Text>
          </View>
        )}
        {ride.estimatedFareCents !== null && (
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Estimated fare</Text>
            <Text style={styles.totalValue}>{formatCents(ride.estimatedFareCents)}</Text>
          </View>
        )}
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <Pressable
        style={[styles.cancelButton, isCancelling && styles.cancelButtonDisabled]}
        onPress={handleCancel}
        disabled={isCancelling}
        testID="cancel-ride-button"
      >
        {isCancelling ? (
          <ActivityIndicator color="#f87171" />
        ) : (
          <Text style={styles.cancelButtonText}>Cancel ride</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20, justifyContent: 'space-between' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  spinner: { marginBottom: 16 },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: { color: '#94a3b8', fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 18 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
  },
  routeLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  totalRow: { borderBottomWidth: 0, paddingTop: 12 },
  rowLabel: { color: '#94a3b8', fontSize: 14 },
  rowValue: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  totalLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  totalValue: { color: '#fbbf24', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 12 },
  cancelButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f87171',
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelButtonText: { color: '#f87171', fontSize: 15, fontWeight: '700' },
});
