import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RideRatings } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { StarRatingInput } from '../components/StarRatingInput';
import { useActiveRide } from '../context/ActiveRideContext';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getRideRatings, submitPassengerRating } from '../lib/apiClient';
import { formatCents, formatDistanceMiles, formatDurationMinutes } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'RideComplete'>;

/**
 * COMPLETED. `finalFareCents`/`actualDistanceMeters`/`actualDurationSeconds`
 * come straight from rideLifecycleService.completeRide's response — see
 * docs/ride-lifecycle.md for what "actual" means with no live route
 * tracking in Stage 1 (duration is genuinely real elapsed time; distance
 * reuses the pre-trip estimate). Earnings live on their own screen
 * (Phase 12); below the fare card here is section 13's "Driver rates
 * Passenger" — 1-5 stars, optional comment, POST
 * /drivers/me/rides/:id/rating — replaced with a read-only confirmation
 * once GET .../ratings shows a DRIVER_TO_PASSENGER row already exists.
 * "Done" clears this ride and returns the driver to the map either way,
 * ready for the next offer — rating is never required to move on.
 */
export function RideCompleteScreen({ navigation }: Props) {
  const { ride, clear } = useActiveRide();
  const { accessToken } = useAuth();
  const [ratings, setRatings] = useState<RideRatings | null>(null);
  const [selectedStars, setSelectedStars] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !ride) return undefined;

    let cancelled = false;

    async function load(token: string, rideId: string) {
      try {
        const result = await getRideRatings(token, rideId);
        if (!cancelled) setRatings(result);
      } catch {
        // Non-fatal: the rating form just stays in its default
        // (unsubmitted) state — same self-healing reasoning as every
        // other poll/fetch in these apps.
      }
    }

    void load(accessToken, ride.id);

    return () => {
      cancelled = true;
    };
  }, [accessToken, ride]);

  const handleSubmitRating = useCallback(async () => {
    if (!accessToken || !ride || selectedStars === 0) return;
    setRatingError(null);
    setIsSubmittingRating(true);
    try {
      const rating = await submitPassengerRating(accessToken, ride.id, {
        stars: selectedStars,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setRatings((prev) => ({
        passengerToDriver: prev?.passengerToDriver ?? null,
        driverToPassenger: rating,
      }));
    } catch (error) {
      setRatingError(
        error instanceof ApiClientError ? error.message : 'Could not submit your rating.',
      );
    } finally {
      setIsSubmittingRating(false);
    }
  }, [accessToken, ride, selectedStars, comment]);

  function handleDone() {
    clear();
    navigation.navigate('DriverHomeMap');
  }

  if (!ride) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>No ride to show</Text>
        <Pressable style={styles.button} onPress={() => navigation.navigate('DriverHomeMap')}>
          <Text style={styles.buttonText}>Back to map</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <Text style={styles.title}>Ride complete</Text>
        <Text style={styles.subtitle}>{ride.destination.label}</Text>
      </View>

      <View style={styles.card}>
        {ride.actualDistanceMeters !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Distance</Text>
            <Text style={styles.rowValue}>{formatDistanceMiles(ride.actualDistanceMeters)}</Text>
          </View>
        )}
        {ride.actualDurationSeconds !== null && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Duration</Text>
            <Text style={styles.rowValue}>{formatDurationMinutes(ride.actualDurationSeconds)}</Text>
          </View>
        )}
        {ride.finalFareCents !== null && (
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Fare</Text>
            <Text style={styles.totalValue}>{formatCents(ride.finalFareCents)}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.rateTitle}>Rate your passenger</Text>

        {ratings?.driverToPassenger ? (
          <View>
            <StarRatingInput value={ratings.driverToPassenger.stars} onChange={() => undefined} disabled />
            {ratings.driverToPassenger.comment && (
              <Text style={styles.submittedComment}>&ldquo;{ratings.driverToPassenger.comment}&rdquo;</Text>
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
              placeholderTextColor="#78716c"
              value={comment}
              onChangeText={setComment}
              multiline
              editable={!isSubmittingRating}
              testID="rating-comment-input"
            />
            {ratingError && <Text style={styles.errorText}>{ratingError}</Text>}
            <Pressable
              style={[
                styles.submitRatingButton,
                (selectedStars === 0 || isSubmittingRating) && styles.buttonDisabled,
              ]}
              disabled={selectedStars === 0 || isSubmittingRating}
              onPress={() => void handleSubmitRating()}
              testID="submit-rating-button"
            >
              {isSubmittingRating ? (
                <ActivityIndicator color="#1c1917" />
              ) : (
                <Text style={styles.buttonText}>Submit rating</Text>
              )}
            </Pressable>
          </View>
        )}
      </View>

      <Pressable style={styles.button} onPress={handleDone} testID="done-button">
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20, justifyContent: 'space-between' },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
  title: { color: '#4ade80', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#a8a29e', fontSize: 14 },
  card: { backgroundColor: '#292524', borderRadius: 12, padding: 20, marginTop: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#44403c',
  },
  totalRow: { borderBottomWidth: 0, paddingTop: 12 },
  rowLabel: { color: '#a8a29e', fontSize: 14 },
  rowValue: { color: '#fafaf9', fontSize: 14, fontWeight: '600' },
  totalLabel: { color: '#fafaf9', fontSize: 16, fontWeight: '700' },
  totalValue: { color: '#4ade80', fontSize: 18, fontWeight: '700' },
  button: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#fbbf24',
    marginTop: 16,
  },
  buttonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
  rateTitle: { color: '#fafaf9', fontSize: 15, fontWeight: '700', marginBottom: 12 },
  commentInput: {
    backgroundColor: '#1c1917',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    color: '#fafaf9',
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
  buttonDisabled: { opacity: 0.5 },
  errorText: { color: '#f87171', fontSize: 13, marginTop: 8 },
  submittedComment: { color: '#a8a29e', fontSize: 13, fontStyle: 'italic', marginTop: 10 },
  thanksText: { color: '#4ade80', fontSize: 13, marginTop: 10 },
});
