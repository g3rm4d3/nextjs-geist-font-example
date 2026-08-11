import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Payment } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import { ApiClientError, getRidePayment, retryRidePayment } from '../lib/apiClient';
import { formatCents } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideComplete'>;

const STATUS_COPY: Record<Payment['status'], string> = {
  PENDING: 'Processing payment…',
  SUCCEEDED: 'Payment successful',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
};

const STATUS_COLOR: Record<Payment['status'], string> = {
  PENDING: '#fbbf24',
  SUCCEEDED: '#4ade80',
  FAILED: '#f87171',
  REFUNDED: '#94a3b8',
};

/**
 * Section 9/11/13: the completed-ride summary. `ride` comes from
 * RideDraftContext (set by RideTrackingScreen right before navigating
 * here) rather than a fresh fetch — same "held only so this screen
 * doesn't need a redundant fetch" reasoning as everywhere else that
 * reads it. Payment is charged automatically server-side the instant the
 * ride reaches COMPLETED (rideLifecycleService.completeRide ->
 * paymentService.chargeRideFare) — there is no "pay" button here, only
 * a read of the resulting payment_records row and, if it FAILED, a
 * retry. The rating prompt this screen's stub also promised is Phase
 * 13's job, not this one's.
 */
export function RideCompleteScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, reset } = useRideDraft();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !ride) return undefined;

    let cancelled = false;

    async function loadPayment(token: string, rideId: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getRidePayment(token, rideId);
        if (!cancelled) setPayment(result);
      } catch (error) {
        if (cancelled) return;
        // A 404 here means the auto-charge attempt hasn't landed a
        // payment_records row yet (or, rarely, never will — see
        // paymentService.chargeRideFare's own try/catch in
        // rideLifecycleService) — not a hard error, just "nothing to
        // show yet". Any other failure gets a visible message.
        if (!(error instanceof ApiClientError && error.code === 'NOT_FOUND')) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load payment status.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadPayment(accessToken, ride.id);

    return () => {
      cancelled = true;
    };
  }, [accessToken, ride]);

  const handleRetry = useCallback(async () => {
    if (!accessToken || !ride) return;
    setErrorMessage(null);
    setIsRetrying(true);
    try {
      const result = await retryRidePayment(accessToken, ride.id);
      setPayment(result);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not retry this payment.',
      );
    } finally {
      setIsRetrying(false);
    }
  }, [accessToken, ride]);

  const handleDone = useCallback(() => {
    reset();
    navigation.navigate('HomeMap');
  }, [reset, navigation]);

  if (!ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No completed ride to show.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ride complete</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Final fare</Text>
          <Text style={styles.fareValue}>
            {ride.finalFareCents !== null ? formatCents(ride.finalFareCents) : '—'}
          </Text>
        </View>

        {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}

        {payment && !isLoading && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Payment</Text>
            <Text style={[styles.statusValue, { color: STATUS_COLOR[payment.status] }]}>
              {STATUS_COPY[payment.status]}
            </Text>
          </View>
        )}

        {payment?.status === 'FAILED' && payment.failureReason && (
          <Text style={styles.failureReason}>{payment.failureReason}</Text>
        )}

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        {payment?.status === 'FAILED' && (
          <Pressable
            style={[styles.retryButton, isRetrying && styles.buttonDisabled]}
            disabled={isRetrying}
            onPress={() => void handleRetry()}
          >
            {isRetrying ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.retryButtonText}>Retry payment</Text>
            )}
          </Pressable>
        )}
      </View>

      <Pressable style={styles.doneButton} onPress={handleDone}>
        <Text style={styles.doneButtonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  rowLabel: { color: '#94a3b8', fontSize: 14 },
  fareValue: { color: '#fbbf24', fontSize: 18, fontWeight: '700' },
  statusValue: { fontSize: 14, fontWeight: '700' },
  failureReason: { color: '#f87171', fontSize: 13, marginTop: 8 },
  errorText: { color: '#f87171', fontSize: 13, marginTop: 8 },
  spinner: { marginVertical: 8 },
  retryButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  retryButtonText: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  doneButton: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneButtonText: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
});
