import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AssignedRideDriverInfo } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { DriverAvatarPlaceholder } from '../components/DriverAvatarPlaceholder';
import { StarRatingDisplay } from '../components/StarRatingDisplay';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, cancelRide, getAssignedDriver } from '../lib/apiClient';
import { formatCents, formatDurationMinutes } from '../lib/format';
import { computeRegionForTwoPoints } from '../lib/mapRegion';
import { useRidePolling } from '../lib/useRidePolling';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DriverAssigned'>;

const DRIVER_POLL_INTERVAL_MS = 4000;

const STATUS_COPY: Partial<Record<string, string>> = {
  DRIVER_ASSIGNED: 'Your driver is getting ready',
  DRIVER_EN_ROUTE: 'Your driver is on the way',
  DRIVER_ARRIVED: 'Your driver has arrived',
};

/**
 * Section 10: "display assigned driver. Show: driver first name, driver
 * photo placeholder/test photo, vehicle, vehicle color, license plate
 * test data, driver location, estimated arrival." Two independent polls
 * feed this screen — `useRidePolling` (ride status, shared with the
 * other tracking screens) and a local one for `GET /rides/:id/driver`
 * (driver name/vehicle/location/ETA, which has no reason to change as
 * often as ride status but is refetched on the same cadence for
 * simplicity). Navigates to RideTrackingScreen the moment the ride
 * status shows the passenger onboard.
 */
export function DriverAssignedScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { pickup, ride: draftRide, reset } = useRideDraft();
  const [driverInfo, setDriverInfo] = useState<AssignedRideDriverInfo | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { ride: polledRide } = useRidePolling(accessToken, draftRide?.id ?? null);
  const ride = polledRide ?? draftRide;

  useEffect(() => {
    if (!accessToken || !ride) return undefined;

    let cancelled = false;

    async function poll(token: string, rideId: string) {
      try {
        const info = await getAssignedDriver(token, rideId);
        if (!cancelled) setDriverInfo(info);
      } catch {
        // A missed tick just means this screen's driver card is briefly
        // stale — the next tick tries again, same self-healing reasoning
        // as every other poll loop in these apps.
      }
    }

    void poll(accessToken, ride.id);
    const interval = setInterval(() => void poll(accessToken, ride.id), DRIVER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [accessToken, ride]);

  useEffect(() => {
    if (!ride) return;

    if (ride.status === 'PASSENGER_ONBOARD' || ride.status === 'IN_PROGRESS') {
      navigation.navigate('RideTracking');
      return;
    }
    // Section 17: "if appropriate, driver cancellation can return ride
    // to matching" — the default policy. The ride never reaches a
    // CANCELLED_* status in that case; it goes back to SEARCHING_DRIVER
    // instead, which this screen (unlike SearchingDriverScreen) has no
    // other reason to see mid-flight.
    if (ride.status === 'SEARCHING_DRIVER') {
      Alert.alert('Driver unavailable', "Your driver had to cancel — we're finding you a new one.");
      navigation.navigate('SearchingDriver');
      return;
    }
    if (ride.status.startsWith('CANCELLED')) {
      Alert.alert('Ride cancelled', 'Your driver cancelled this ride.');
      reset();
      navigation.navigate('HomeMap');
    }
  }, [ride, navigation, reset]);

  const handleCancel = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsCancelling(true);
    try {
      const cancelled = await cancelRide(accessToken, ride.id);
      reset();
      // Section 17: "record potential TEST fee" — a driver was already
      // dispatched at this point in the flow, so a passenger-initiated
      // cancel here (unlike from SearchingDriverScreen) can carry one.
      if (cancelled.cancellationFeeCents) {
        Alert.alert(
          'Ride cancelled',
          `A cancellation fee of ${formatCents(cancelled.cancellationFeeCents)} applies since your driver was already on the way.`,
        );
      }
      navigation.navigate('HomeMap');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not cancel this ride.',
      );
      setIsCancelling(false);
    }
  }, [accessToken, ride, reset, navigation]);

  if (!ride || !pickup) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" size="large" />
      </View>
    );
  }

  const region =
    driverInfo?.location && !driverInfo.location.isStale
      ? computeRegionForTwoPoints(driverInfo.location, pickup.coordinate)
      : null;

  return (
    <View style={styles.container}>
      {region && driverInfo?.location && (
        <MapView style={styles.map} region={region}>
          <Marker coordinate={driverInfo.location} title="Your driver" pinColor="#fbbf24" />
          <Marker coordinate={pickup.coordinate} title="Pickup" pinColor="#4ade80" />
          <Polyline
            coordinates={[driverInfo.location, pickup.coordinate]}
            strokeColor="#fbbf24"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        </MapView>
      )}

      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.statusLabel}>{STATUS_COPY[ride.status] ?? ride.status}</Text>

        {driverInfo ? (
          <View style={styles.card}>
            <View style={styles.driverRow}>
              <DriverAvatarPlaceholder firstName={driverInfo.firstName} />
              <View style={styles.driverInfo}>
                <View style={styles.driverNameRow}>
                  <Text style={styles.driverName}>{driverInfo.firstName}</Text>
                  <StarRatingDisplay averageRating={driverInfo.averageRating} />
                </View>
                {driverInfo.vehicle && (
                  <Text style={styles.vehicleLine}>
                    {driverInfo.vehicle.color} {driverInfo.vehicle.make} {driverInfo.vehicle.model}
                  </Text>
                )}
                {driverInfo.vehicle && (
                  <Text style={styles.plateLine}>{driverInfo.vehicle.licensePlate}</Text>
                )}
              </View>
              {driverInfo.estimatedArrivalSeconds !== null && (
                <View style={styles.etaBadge}>
                  <Text style={styles.etaValue}>
                    {formatDurationMinutes(driverInfo.estimatedArrivalSeconds)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <ActivityIndicator color="#fbbf24" />
          </View>
        )}

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 20 },
  centered: { flex: 1, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  statusLabel: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
  },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, marginTop: 16 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverInfo: { flex: 1 },
  driverNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  driverName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  vehicleLine: { color: '#cbd5e1', fontSize: 13, marginTop: 2 },
  plateLine: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  etaBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  etaValue: { color: '#fbbf24', fontSize: 14, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 12 },
  cancelButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f87171',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelButtonText: { color: '#f87171', fontSize: 15, fontWeight: '700' },
});
