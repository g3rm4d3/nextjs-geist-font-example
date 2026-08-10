import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RideOffer } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { acceptOffer, ApiClientError, declineOffer, getCurrentOffer } from '../lib/apiClient';
import { formatCents, formatDistanceMiles } from '../lib/format';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'IncomingRequest'>;

/**
 * Section 8's offer flow, from the driver's side: DriverHomeMapScreen
 * polls GET /drivers/me/offer while ONLINE and navigates here the moment
 * one exists; this screen re-fetches it independently on mount (rather
 * than trusting route params) for the same reason ProfileScreen re-fetches
 * from context instead of being handed data — one source of truth, and
 * this screen is reachable from more than just that poll (e.g. a driver
 * navigating back to it).
 *
 * The countdown is a local approximation of the server's own response
 * timer (MATCHING_OFFER_TIMEOUT_SECONDS / matchingService.sweepExpiredOffers)
 * — a visual cue for the driver, not a second source of truth. Accept and
 * decline both go through the real atomic endpoints; nothing here decides
 * who wins a race, the server does (see docs/matching-engine.md).
 */
export function IncomingRequestScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [offer, setOffer] = useState<RideOffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [isResponding, setIsResponding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!accessToken) return;
      try {
        const current = await getCurrentOffer(accessToken);
        if (!cancelled) setOffer(current);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load this ride request.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!offer) return undefined;

    function tick() {
      const remainingMs = new Date(offer!.expiresAt).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [offer]);

  useEffect(() => {
    // The real expiry is enforced server-side; this is just the driver
    // no longer having anything to respond to once the local countdown
    // clearly runs out — go back rather than leave a dead screen up.
    if (secondsLeft === 0) {
      navigation.navigate('DriverHomeMap');
    }
  }, [secondsLeft, navigation]);

  const handleAccept = useCallback(async () => {
    if (!accessToken || !offer) return;
    setErrorMessage(null);
    setIsResponding(true);
    try {
      await acceptOffer(accessToken, offer.id);
      navigation.navigate('PickupNavigation');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError
          ? error.message
          : 'Could not accept this ride — it may have already gone to another driver.',
      );
      setIsResponding(false);
    }
  }, [accessToken, offer, navigation]);

  const handleDecline = useCallback(async () => {
    if (!accessToken || !offer) return;
    setErrorMessage(null);
    setIsResponding(true);
    try {
      await declineOffer(accessToken, offer.id);
      navigation.navigate('DriverHomeMap');
    } catch (error) {
      setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not decline this ride.');
      setIsResponding(false);
    }
  }, [accessToken, offer, navigation]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" size="large" />
      </View>
    );
  }

  if (!offer) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>No ride request right now</Text>
        <Text style={styles.subtitle}>
          The next one will bring you straight here as soon as the matching engine offers you a ride.
        </Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('DriverHomeMap')}
          testID="back-to-map-button"
        >
          <Text style={styles.secondaryButtonText}>Back to map</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.timerRow}>
          <Text style={styles.timerLabel}>Respond in</Text>
          <Text style={styles.timerValue} testID="offer-countdown">
            {secondsLeft ?? '--'}s
          </Text>
        </View>

        <View style={styles.routeBlock}>
          <Text style={styles.routeLabel}>{offer.ride.pickup.label}</Text>
          <Text style={styles.routeArrow}>↓</Text>
          <Text style={styles.routeLabel}>{offer.ride.destination.label}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Distance</Text>
          <Text style={styles.rowValue}>
            {offer.ride.estimatedDistanceMeters !== null
              ? formatDistanceMiles(offer.ride.estimatedDistanceMeters)
              : '—'}
          </Text>
        </View>
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel}>Estimated fare</Text>
          <Text style={styles.totalValue}>
            {offer.ride.estimatedFareCents !== null ? formatCents(offer.ride.estimatedFareCents) : '—'}
          </Text>
        </View>
      </View>

      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.declineButton, isResponding && styles.buttonDisabled]}
          onPress={handleDecline}
          disabled={isResponding}
          testID="decline-button"
        >
          <Text style={styles.declineButtonText}>Decline</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.acceptButton, isResponding && styles.buttonDisabled]}
          onPress={handleAccept}
          disabled={isResponding}
          testID="accept-button"
        >
          {isResponding ? (
            <ActivityIndicator color="#1c1917" />
          ) : (
            <Text style={styles.acceptButtonText}>Accept</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20, justifyContent: 'space-between' },
  centered: {
    flex: 1,
    backgroundColor: '#1c1917',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fafaf9', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: {
    color: '#a8a29e',
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 18,
    marginBottom: 20,
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#57534e',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  secondaryButtonText: { color: '#fafaf9', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#292524', borderRadius: 12, padding: 20, marginTop: 24 },
  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  timerLabel: { color: '#a8a29e', fontSize: 13 },
  timerValue: { color: '#fbbf24', fontSize: 20, fontWeight: '700' },
  routeBlock: { alignItems: 'center', marginBottom: 16 },
  routeLabel: { color: '#fafaf9', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  routeArrow: { color: '#a8a29e', fontSize: 16, marginVertical: 4 },
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
  totalLabel: { color: '#fafaf9', fontSize: 15, fontWeight: '700' },
  totalValue: { color: '#4ade80', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 16 },
  actions: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  button: { flex: 1, borderRadius: 8, paddingVertical: 16, alignItems: 'center' },
  declineButton: { backgroundColor: '#292524', borderWidth: 1, borderColor: '#57534e' },
  declineButtonText: { color: '#fafaf9', fontSize: 15, fontWeight: '700' },
  acceptButton: { backgroundColor: '#4ade80' },
  acceptButtonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
