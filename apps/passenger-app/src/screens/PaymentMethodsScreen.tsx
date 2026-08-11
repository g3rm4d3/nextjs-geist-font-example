import type { TestPaymentMethodSummary } from '@rideshare/types';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getTestPaymentMethods, updateDefaultPaymentMethod } from '../lib/apiClient';

/**
 * Section 11: "test payment method." Stage 1 never collects real card
 * details — a passenger picks one of Stripe's own documented TEST MODE
 * payment method ids (served by GET /payments/test-methods, sourced from
 * @rideshare/payments's catalog) as their default. That default is what
 * gets charged automatically when a ride they take completes (see
 * RideCompleteScreen + apps/api's paymentService.chargeRideFare) —
 * there is no "add a card" flow here, on purpose.
 */
export function PaymentMethodsScreen() {
  const { accessToken } = useAuth();
  const [methods, setMethods] = useState<TestPaymentMethodSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;
    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getTestPaymentMethods(token);
        if (!cancelled) setMethods(result);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load payment methods.',
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const handleSelect = useCallback(
    async (method: TestPaymentMethodSummary) => {
      if (!accessToken) return;
      setErrorMessage(null);
      setConfirmation(null);
      setSavingId(method.id);
      try {
        await updateDefaultPaymentMethod(accessToken, { testPaymentMethodId: method.id });
        setSelectedId(method.id);
        setConfirmation(`${method.label} is now your default payment method.`);
      } catch (error) {
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not update payment method.',
        );
      } finally {
        setSavingId(null);
      }
    },
    [accessToken],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payment methods</Text>
      <Text style={styles.subtitle}>
        Stripe TEST MODE only — no real card is ever collected or charged in this environment.
      </Text>

      {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}
      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
      {confirmation && <Text style={styles.confirmationText}>{confirmation}</Text>}

      {methods.map((method) => {
        const isSelected = selectedId === method.id;
        const isSaving = savingId === method.id;
        return (
          <Pressable
            key={method.id}
            style={[styles.card, isSelected && styles.cardSelected]}
            disabled={savingId !== null}
            onPress={() => void handleSelect(method)}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>{method.label}</Text>
              <View
                style={[
                  styles.outcomeBadge,
                  method.outcome === 'succeeds' ? styles.outcomeSucceeds : styles.outcomeFails,
                ]}
              >
                <Text style={styles.outcomeBadgeText}>
                  {method.outcome === 'succeeds' ? 'Succeeds' : 'Declines'}
                </Text>
              </View>
            </View>
            <Text style={styles.cardDescription}>{method.description}</Text>
            {isSaving && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}
            {isSelected && !isSaving && <Text style={styles.selectedLabel}>Default</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 20 },
  spinner: { marginVertical: 8 },
  errorText: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  confirmationText: { color: '#4ade80', fontSize: 13, marginBottom: 12 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardSelected: { borderColor: '#fbbf24' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  cardDescription: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  outcomeBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  outcomeSucceeds: { backgroundColor: '#14532d' },
  outcomeFails: { backgroundColor: '#7f1d1d' },
  outcomeBadgeText: { color: '#f8fafc', fontSize: 11, fontWeight: '700' },
  selectedLabel: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginTop: 8 },
});
