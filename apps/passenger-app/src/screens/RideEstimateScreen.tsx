import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Coordinate } from '@rideshare/maps';
import type { FareEstimate } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, getFareEstimate } from '../lib/apiClient';
import { formatCents, formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideEstimate'>;

/**
 * Shows the route (distance/duration) computed in Phase 3 plus a
 * server-generated fare estimate (Phase 4). The fare shown here always
 * comes from POST /pricing/estimate — apps/api's PricingEngine — never
 * computed on-device, per the server-authoritative principle (section 3).
 */
export function RideEstimateScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { pickup, destination, route } = useRideDraft();
  const [fareEstimate, setFareEstimate] = useState<FareEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pickup || !destination || !accessToken) return;

    let cancelled = false;

    async function loadFareEstimate(token: string, origin: Coordinate, dest: Coordinate) {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const estimate = await getFareEstimate(token, { origin, destination: dest });
        if (!cancelled) setFareEstimate(estimate);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load a fare estimate.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadFareEstimate(accessToken, pickup.coordinate, destination.coordinate);

    return () => {
      cancelled = true;
    };
  }, [accessToken, pickup, destination]);

  if (!pickup || !destination || !route) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Preview a route first.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.routeLabel}>
        {pickup.label} → {destination.label}
      </Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Distance</Text>
          <Text style={styles.rowValue}>{formatDistanceMiles(route.distanceMeters)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Estimated duration</Text>
          <Text style={styles.rowValue}>{formatDurationMinutes(route.durationSeconds)}</Text>
        </View>

        {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {fareEstimate && !isLoading && (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Base fare</Text>
              <Text style={styles.rowValue}>{formatCents(fareEstimate.baseFareCents)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Distance</Text>
              <Text style={styles.rowValue}>{formatCents(fareEstimate.distanceFareCents)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Time</Text>
              <Text style={styles.rowValue}>{formatCents(fareEstimate.timeFareCents)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Booking fee</Text>
              <Text style={styles.rowValue}>{formatCents(fareEstimate.bookingFeeCents)}</Text>
            </View>
            {fareEstimate.minimumFareApplied && (
              <View style={styles.row}>
                <Text style={styles.rowLabelMuted}>Minimum fare applied</Text>
                <Text style={styles.rowValueMuted}>{formatCents(fareEstimate.minimumFareCents)}</Text>
              </View>
            )}
            <View style={[styles.row, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCents(fareEstimate.totalCents)}</Text>
            </View>
          </>
        )}
      </View>

      <Pressable
        style={[
          styles.requestButton,
          (!fareEstimate || isLoading) && styles.requestButtonDisabled,
        ]}
        disabled={!fareEstimate || isLoading}
        onPress={() => navigation.navigate('RequestRide')}
        testID="request-ride-button"
      >
        <Text style={styles.requestButtonText}>Request Ride</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  routeLabel: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 20 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  totalRow: { borderBottomWidth: 0, paddingTop: 14 },
  rowLabel: { color: '#94a3b8', fontSize: 14 },
  rowValue: { color: '#f8fafc', fontSize: 14, fontWeight: '600' },
  rowLabelMuted: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  rowValueMuted: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  totalLabel: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  totalValue: { color: '#fbbf24', fontSize: 18, fontWeight: '700' },
  spinner: { marginVertical: 8 },
  requestButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  requestButtonDisabled: { opacity: 0.5 },
  requestButtonText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171', marginBottom: 8 },
});
