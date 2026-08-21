import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Payment, RideRatings } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StarRatingInput } from '../components/StarRatingInput';
import { useAuth } from '../context/AuthContext';
import { useRideDraft } from '../context/RideDraftContext';
import {
  ApiClientError,
  getRidePayment,
  getRideRatings,
  retryRidePayment,
  submitDriverRating,
} from '../lib/apiClient';
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
 * retry. Below that, section 13's "Passenger rates Driver": 1-5 stars,
 * optional comment, POST /rides/:id/rating — replaced with a read-only
 * confirmation once GET /rides/:id/ratings shows a PASSENGER_TO_DRIVER
 * row already exists (submitted from an earlier visit to this screen,
 * or after the app was closed and reopened).
 */
export function RideCompleteScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { ride, reset } = useRideDraft();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [ratings, setRatings] = useState<RideRatings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedStars, setSelectedStars] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

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

    async function loadRatings(token: string, rideId: string) {
      try {
        const result = await getRideRatings(token, rideId);
        if (!cancelled) setRatings(result);
      } catch {
        // Non-fatal: the rating form just stays in its default
        // (unsubmitted) state — same self-healing reasoning as every
        // other poll/fetch in these apps.
      }
    }

    void loadPayment(accessToken, ride.id);
    void loadRatings(accessToken, ride.id);

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

  const handleSubmitRating = useCallback(async () => {
    if (!accessToken || !ride || selectedStars === 0) return;
    setRatingError(null);
    setIsSubmittingRating(true);
    try {
      const rating = await submitDriverRating(accessToken, ride.id, {
        stars: selectedStars,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setRatings((prev) => ({
        passengerToDriver: rating,
        driverToPassenger: prev?.driverToPassenger ?? null,
      }));
    } catch (error) {
      setRatingError(
        error instanceof ApiClientError ? error.message : 'Could not submit your rating.',
      );
    } finally {
      setIsSubmittingRating(false);
    }
  }, [accessToken, ride, selectedStars, comment]);

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

        {errorMessage && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {errorMessage}
          </Text>
        )}

        {payment?.status === 'FAILED' && (
          <Pressable
            style={[styles.retryButton, isRetrying && styles.buttonDisabled]}
            disabled={isRetrying}
            onPress={() => void handleRetry()}
            accessibilityRole="button"
            accessibilityLabel="Retry payment"
            accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
          >
            {isRetrying ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.retryButtonText}>Retry payment</Text>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.rateTitle}>Rate your driver</Text>

        {ratings?.passengerToDriver ? (
          <View>
            <StarRatingInput value={ratings.passengerToDriver.stars} onChange={() => undefined} disabled />
            {ratings.passengerToDriver.comment && (
              <Text style={styles.submittedComment}>&ldquo;{ratings.passengerToDriver.comment}&rdquo;</Text>
            )}
            <Text style={styles.thanksText}>Thanks for rating this ride.</Text>
          </View>
        ) : (
          <View>
            <StarRatingInput
              value={selectedStars}
              onChange={setSelectedStars}
              disabled={isSubmittingRating}
            />
            <TextInput
              style={styles.commentInput}
              placeholder="Add a comment (optional)"
              placeholderTextColor="#64748b"
              value={comment}
              onChangeText={setComment}
              multiline
              editable={!isSubmittingRating}
              testID="rating-comment-input"
              accessibilityLabel="Comment (optional)"
            />
            {ratingError && (
              <Text style={styles.errorText} accessibilityRole="alert">
                {ratingError}
              </Text>
            )}
            <Pressable
              style={[
                styles.submitRatingButton,
                (selectedStars === 0 || isSubmittingRating) && styles.buttonDisabled,
              ]}
              disabled={selectedStars === 0 || isSubmittingRating}
              onPress={() => void handleSubmitRating()}
              testID="submit-rating-button"
              accessibilityRole="button"
              accessibilityLabel="Submit rating"
              accessibilityState={{
                disabled: selectedStars === 0 || isSubmittingRating,
                busy: isSubmittingRating,
              }}
            >
              {isSubmittingRating ? (
                <ActivityIndicator color="#0f172a" />
              ) : (
                <Text style={styles.submitRatingButtonText}>Submit rating</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>

      <Pressable
        style={styles.doneButton}
        onPress={handleDone}
        accessibilityRole="button"
        accessibilityLabel="Done"
      >
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
  rateTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  commentInput: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    color: '#f8fafc',
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitRatingButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  submitRatingButtonText: { color: '#0f172a', fontSize: 14, fontWeight: '700' },
  submittedComment: { color: '#94a3b8', fontSize: 13, fontStyle: 'italic', marginTop: 10 },
  thanksText: { color: '#4ade80', fontSize: 13, marginTop: 10 },
});
