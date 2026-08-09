import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, createRideRequest } from '../lib/apiClient';
import { generateIdempotencyKey } from '../lib/idempotencyKey';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RequestRide'>;

/**
 * Section 7: submits the ride request RideEstimateScreen's "Request
 * Ride" button led to. There's no separate confirmation step here —
 * that already happened when the passenger tapped through from the fare
 * breakdown — so this screen's only job is to actually call POST /rides
 * and report what happened, auto-submitting on mount rather than
 * waiting for another tap.
 *
 * The idempotency key is generated once per mount (lazy useState
 * initializer) and reused for every retry of *this* attempt — including
 * a double-tap on "Try again" — so a repeat call always resolves to the
 * same ride instead of risking a second one. See
 * docs/ride-requests.md and lib/idempotencyKey.ts.
 */
export function RequestRideScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { pickup, destination, route, ride, setRide } = useRideDraft();
  const [idempotencyKey] = useState(() => generateIdempotencyKey());
  const [isSubmitting, setIsSubmitting] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accessToken || !pickup || !destination) return;

    let cancelled = false;

    async function submitRideRequest(
      token: string,
      pickupPoint: NonNullable<typeof pickup>,
      destinationPoint: NonNullable<typeof destination>,
    ) {
      setIsSubmitting(true);
      setErrorMessage(null);

      try {
        const created = await createRideRequest(token, {
          pickup: pickupPoint,
          destination: destinationPoint,
          idempotencyKey,
        });
        if (cancelled) return;
        setRide(created);
        navigation.replace('SearchingDriver');
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not request a ride.',
        );
      } finally {
        if (!cancelled) setIsSubmitting(false);
      }
    }

    void submitRideRequest(accessToken, pickup, destination);

    return () => {
      cancelled = true;
    };
    // `attempt` is a deliberate re-run trigger for the "Try again" button
    // below — everything else in the dependency list is what the request
    // actually needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, pickup, destination, idempotencyKey, attempt]);

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

      {isSubmitting && (
        <View style={styles.centered}>
          <ActivityIndicator color="#fbbf24" size="large" />
          <Text style={styles.statusText}>Requesting your ride…</Text>
        </View>
      )}

      {errorMessage && !isSubmitting && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => setAttempt((n) => n + 1)}
            testID="retry-request-button"
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {!isSubmitting && !errorMessage && ride && (
        <Text style={styles.statusText}>Ride requested — {ride.status}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  routeLabel: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 20 },
  statusText: { color: '#94a3b8', fontSize: 14, marginTop: 12, textAlign: 'center' },
  errorText: { color: '#f87171', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  retryButtonText: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
});
