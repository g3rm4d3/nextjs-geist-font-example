import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Coordinate } from '@rideshare/maps';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, previewRoute } from '../lib/apiClient';
import { formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RoutePreview'>;

/**
 * Calls the backend's POST /routes/preview (apps/api, backed by
 * @rideshare/maps) rather than computing distance/duration on-device —
 * the route is server-authoritative from the start, since it's an input
 * to fare calculation later (Phase 4).
 */
export function RoutePreviewScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { pickup, destination, route, setRoute } = useRideDraft();
  const [isLoading, setIsLoading] = useState(!route);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pickup || !destination || !accessToken || route) return;

    let cancelled = false;

    async function loadRoutePreview(token: string, origin: Coordinate, dest: Coordinate) {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const preview = await previewRoute(token, { origin, destination: dest });
        if (!cancelled) setRoute(preview);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load a route preview.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadRoutePreview(accessToken, pickup.coordinate, destination.coordinate);

    return () => {
      cancelled = true;
    };
  }, [accessToken, pickup, destination, route, setRoute]);

  if (!pickup || !destination) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Set a pickup and destination first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: (pickup.coordinate.latitude + destination.coordinate.latitude) / 2,
          longitude: (pickup.coordinate.longitude + destination.coordinate.longitude) / 2,
          latitudeDelta: Math.max(
            0.05,
            Math.abs(pickup.coordinate.latitude - destination.coordinate.latitude) * 2,
          ),
          longitudeDelta: Math.max(
            0.05,
            Math.abs(pickup.coordinate.longitude - destination.coordinate.longitude) * 2,
          ),
        }}
      >
        <Marker coordinate={pickup.coordinate} title="Pickup" pinColor="#22c55e" />
        <Marker coordinate={destination.coordinate} title="Destination" pinColor="#ef4444" />
        {/* Straight line between the two points — a visual approximation,
            matching the haversine-based estimate, not a real road path. */}
        <Polyline
          coordinates={[pickup.coordinate, destination.coordinate]}
          strokeColor="#fbbf24"
          strokeWidth={3}
        />
      </MapView>

      <View style={styles.summary}>
        <Text style={styles.routeLabel}>
          {pickup.label} → {destination.label}
        </Text>

        {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {route && !isLoading && (
          <View style={styles.stats}>
            <Text style={styles.statValue}>{formatDistanceMiles(route.distanceMeters)}</Text>
            <Text style={styles.statDivider}>·</Text>
            <Text style={styles.statValue}>{formatDurationMinutes(route.durationSeconds)}</Text>
          </View>
        )}

        <Pressable
          style={[styles.continueButton, (!route || isLoading) && styles.continueButtonDisabled]}
          disabled={!route || isLoading}
          onPress={() => navigation.navigate('RideEstimate')}
          testID="continue-to-estimate-button"
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  map: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  summary: {
    padding: 20,
    backgroundColor: '#1e293b',
  },
  routeLabel: { color: '#f8fafc', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  spinner: { marginVertical: 8 },
  stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statValue: { color: '#fbbf24', fontSize: 20, fontWeight: '700' },
  statDivider: { color: '#64748b', marginHorizontal: 10, fontSize: 20 },
  errorText: { color: '#f87171', marginBottom: 12 },
  continueButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  continueButtonDisabled: { opacity: 0.5 },
  continueButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
});
