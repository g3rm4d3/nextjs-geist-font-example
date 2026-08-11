import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AssignedRideDriverInfo } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { DriverAvatarPlaceholder } from '../components/DriverAvatarPlaceholder';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { getAssignedDriver } from '../lib/apiClient';
import { formatDurationMinutes } from '../lib/format';
import { computeRegionForTwoPoints } from '../lib/mapRegion';
import { useRidePolling } from '../lib/useRidePolling';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideTracking'>;

const DRIVER_POLL_INTERVAL_MS = 4000;

/**
 * PASSENGER_ONBOARD / IN_PROGRESS — the trip itself. Same driver-info
 * polling as DriverAssignedScreen, but the map's target switches to the
 * destination (rideTrackingService.getAssignedDriverInfo's own ETA
 * target does the same switch server-side, at the same status
 * boundary). No cancel button here on purpose — section 9's
 * CANCELLABLE_STATUSES stops at DRIVER_ARRIVED, before the passenger is
 * ever onboard, so there is nothing this screen could legally cancel.
 * Navigates to RideCompleteScreen (still Phase 11/13's stub) once
 * COMPLETED.
 */
export function RideTrackingScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { destination, ride: draftRide, setRide } = useRideDraft();
  const [driverInfo, setDriverInfo] = useState<AssignedRideDriverInfo | null>(null);

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
        // Same self-healing reasoning as every other poll loop here.
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
    if (ride?.status === 'COMPLETED') {
      setRide(ride);
      navigation.navigate('RideComplete');
    }
  }, [ride, navigation, setRide]);

  if (!ride || !destination) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" size="large" />
      </View>
    );
  }

  const region =
    driverInfo?.location && !driverInfo.location.isStale
      ? computeRegionForTwoPoints(driverInfo.location, destination.coordinate)
      : null;

  return (
    <View style={styles.container}>
      {region && driverInfo?.location && (
        <MapView style={styles.map} region={region}>
          <Marker coordinate={driverInfo.location} title="Your driver" pinColor="#fbbf24" />
          <Marker coordinate={destination.coordinate} title="Destination" pinColor="#60a5fa" />
          <Polyline
            coordinates={[driverInfo.location, destination.coordinate]}
            strokeColor="#60a5fa"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        </MapView>
      )}

      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.statusLabel}>Trip in progress</Text>

        {driverInfo ? (
          <View style={styles.card}>
            <View style={styles.driverRow}>
              <DriverAvatarPlaceholder firstName={driverInfo.firstName} />
              <View style={styles.driverInfo}>
                <Text style={styles.driverName}>{driverInfo.firstName}</Text>
                <Text style={styles.destinationLine}>{destination.label}</Text>
              </View>
              {driverInfo.estimatedArrivalSeconds !== null && (
                <View style={styles.etaBadge}>
                  <Text style={styles.etaLabel}>ETA</Text>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: { flex: 1, justifyContent: 'flex-start', padding: 20 },
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
  driverName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  destinationLine: { color: '#cbd5e1', fontSize: 13, marginTop: 2 },
  etaBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  etaLabel: { color: '#64748b', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  etaValue: { color: '#60a5fa', fontSize: 14, fontWeight: '700' },
});
