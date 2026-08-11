import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, cancelRideAsDriver, markArrived, markEnRoute } from '../lib/apiClient';
import { getLocationProvider, type LocationSample } from '../lib/locationProvider';
import { computeRegionForTwoPoints } from '../lib/mapRegion';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PickupNavigation'>;

/**
 * Section 9's DRIVER_ASSIGNED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED leg,
 * from the driver's side. The first transition fires automatically on
 * mount — "accepted the ride" and "started heading to pickup" are the
 * same moment for a driver, so there's no separate button for it — while
 * the second ("Arrived") is an explicit action, since only the driver
 * knows when they've actually reached the pickup point.
 *
 * Section 10's "show passenger pickup, navigation route": the map here
 * draws a straight line from the driver's current position to the
 * pickup point — an honest depiction of what the MOCK RouteProvider
 * actually knows (distance/duration only, no real path; see
 * docs/maps.md), not a turn-by-turn route. This screen's own location
 * subscription is for *drawing the marker only* — DriverHomeMapScreen,
 * still mounted underneath, is what actually reports position to the
 * server (see its own doc comment for why that keeps running through an
 * active ride now, not just while ONLINE).
 */
export function PickupNavigationScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, setRide, clear } = useActiveRide();
  const [driverSample, setDriverSample] = useState<LocationSample | null>(null);
  const [isMarkingArrived, setIsMarkingArrived] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = getLocationProvider();

    void provider.getCurrentLocation().then((result) => {
      if (!cancelled) setDriverSample(result.sample);
    });
    const unsubscribe = provider.watchLocation((next) => {
      if (!cancelled) setDriverSample(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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

  const pickupCoordinate = ride.pickup.coordinate;
  const region = driverSample ? computeRegionForTwoPoints(driverSample, pickupCoordinate) : null;

  return (
    <View style={styles.container}>
      {region && (
        <MapView style={styles.map} region={region}>
          <Marker coordinate={driverSample!} title="You" pinColor="#fbbf24" />
          <Marker coordinate={pickupCoordinate} title="Pickup" pinColor="#4ade80" />
          <Polyline
            coordinates={[driverSample!, pickupCoordinate]}
            strokeColor="#fbbf24"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        </MapView>
      )}

      <View style={styles.overlay} pointerEvents="box-none">
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917' },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
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
