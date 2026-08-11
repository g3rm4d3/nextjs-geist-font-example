import type { DriverEarningsSummary, EarningsPeriodTotals } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getEarningsSummary } from '../lib/apiClient';
import { formatCents } from '../lib/format';

const PERIODS: { key: keyof DriverEarningsSummary; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

function PeriodCard({ label, totals }: { label: string; totals: EarningsPeriodTotals }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardTotal}>{formatCents(totals.driverGrossEarningsCents)}</Text>
      <View style={styles.cardDetailRow}>
        <Text style={styles.cardDetailLabel}>{totals.rideCount} ride{totals.rideCount === 1 ? '' : 's'}</Text>
        <Text style={styles.cardDetailLabel}>Gross {formatCents(totals.grossFareCents)}</Text>
      </View>
      <View style={styles.cardDetailRow}>
        <Text style={styles.cardDetailLabelMuted}>
          Platform commission −{formatCents(totals.platformCommissionCents)}
        </Text>
      </View>
      {totals.adjustmentsCents !== 0 && (
        <View style={styles.cardDetailRow}>
          <Text style={styles.cardDetailLabelMuted}>Adjustments {formatCents(totals.adjustmentsCents)}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Section 12: "Driver sees: Today / Week / Month." Each card is an
 * independently-summed window (GET /drivers/me/earnings/summary), not a
 * running total or a chart — the same three fixed windows the backend
 * computes in UTC (see docs/financial-ledger.md's known limitations on
 * timezone). The headline number per card is what the driver actually
 * keeps (`driverGrossEarningsCents`); gross fare and the platform's cut
 * are shown as the supporting breakdown, not the headline.
 */
export function EarningsScreen() {
  const { accessToken } = useAuth();
  const [summary, setSummary] = useState<DriverEarningsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return undefined;

    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getEarningsSummary(token);
        if (!cancelled) setSummary(result);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load earnings.',
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Earnings</Text>
      <Text style={styles.subtitle}>
        Stripe TEST MODE totals — fictional test rides only, never real money.
      </Text>

      {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}
      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      {summary &&
        PERIODS.map(({ key, label }) => (
          <PeriodCard key={key} label={label} totals={summary[key]} />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  title: { color: '#fafaf9', fontSize: 20, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#a8a29e', fontSize: 13, marginBottom: 20 },
  spinner: { marginVertical: 8 },
  errorText: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  card: { backgroundColor: '#292524', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardLabel: { color: '#a8a29e', fontSize: 13, fontWeight: '600' },
  cardTotal: { color: '#4ade80', fontSize: 24, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  cardDetailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  cardDetailLabel: { color: '#fafaf9', fontSize: 13 },
  cardDetailLabelMuted: { color: '#78716c', fontSize: 12 },
});
