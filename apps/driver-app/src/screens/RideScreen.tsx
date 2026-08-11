import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, completeRide } from '../lib/apiClient';
import { getLocationProvider, type LocationSample } from '../lib/locationProvider';
import { computeRegionForTwoPoints } from '../lib/mapRegion';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Ride'>;

/**
 * IN_PROGRESS. No cancel action here on purpose — DRIVER_CANCELLABLE_
 * STATUSES (rideLifecycleService) stops at DRIVER_ARRIVED; once the trip
 * has started, a plain cancel no longer applies to either side (section 9),
 * so this screen only ever has one way forward.
 *
 * Section 10's "destination after appropriate ride stage": the map's
 * target switches from pickup (PickupNavigationScreen) to destination
 * here — the straight line drawn is the same honest MOCK-route depiction
 * as that screen's, not real turn-by-turn navigation. This screen's own
 * location subscription draws the marker only; DriverHomeMapScreen
 * (still mounted underneath) is what actually reports position to the
 * server, which is also what feeds Phase 10's route-sample recording
 * (rideLocationSamples) while this ride is IN_PROGRESS.
 */
export function RideScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, setRide } = useActiveRide();
  const [driverSample, setDriverSample] = useState<LocationSample | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
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

  const destinationCoordinate = ride.destination.coordinate;
  const region = driverSample
    ? computeRegionForTwoPoints(driverSample, destinationCoordinate)
    : null;

  return (
    <View style={styles.container}>
      {region && (
        <MapView style={styles.map} region={region}>
          <Marker coordinate={driverSample!} title="You" pinColor="#fbbf24" />
          <Marker coordinate={destinationCoordinate} title="Destination" pinColor="#60a5fa" />
          <Polyline
            coordinates={[driverSample!, destinationCoordinate]}
            strokeColor="#60a5fa"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        </MapView>
      )}

      <View style={styles.overlay} pointerEvents="box-none">
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
