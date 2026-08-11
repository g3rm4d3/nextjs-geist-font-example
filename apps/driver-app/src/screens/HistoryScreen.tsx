import type { DriverEarningsHistoryEntry } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getEarningsHistory } from '../lib/apiClient';
import { formatCents } from '../lib/format';

const PAYMENT_STATUS_COLOR: Record<string, string> = {
  SUCCEEDED: '#4ade80',
  PENDING: '#fbbf24',
  FAILED: '#f87171',
  REFUNDED: '#a8a29e',
};

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Payout pending',
  PAID: 'Paid out',
};

function HistoryRow({ entry }: { entry: DriverEarningsHistoryEntry }) {
  return (
    <View style={styles.row} testID="history-row">
      <View style={styles.rowHeader}>
        <Text style={styles.routeLabel} numberOfLines={1}>
          {entry.pickupLabel} → {entry.destinationLabel}
        </Text>
        <Text style={styles.earningsValue}>{formatCents(entry.driverGrossEarningsCents)}</Text>
      </View>
      <View style={styles.rowFooter}>
        <Text style={styles.dateLabel}>{new Date(entry.completedAt).toLocaleDateString()}</Text>
        <View style={styles.badges}>
          {entry.paymentStatus && (
            <Text
              style={[
                styles.badge,
                { color: PAYMENT_STATUS_COLOR[entry.paymentStatus] ?? '#a8a29e' },
              ]}
            >
              {entry.paymentStatus}
            </Text>
          )}
          <Text style={styles.badgeMuted}>{PAYOUT_STATUS_LABEL[entry.payoutStatus] ?? entry.payoutStatus}</Text>
        </View>
      </View>
      <View style={styles.rowFooter}>
        <Text style={styles.detailLabel}>Gross {formatCents(entry.grossFareCents)}</Text>
        <Text style={styles.detailLabel}>
          Commission −{formatCents(entry.platformCommissionCents)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Section 12: "Driver sees: ... Ride history." Backed by
 * GET /drivers/me/earnings/history — every completed ride that has a
 * driver_earnings row, most recent first, with the same fare breakdown
 * as EarningsScreen plus the ride's payment status (from payment_records,
 * Phase 11) and payout status placeholder (Phase 12 — real payouts are
 * explicitly out of scope, see docs/financial-ledger.md).
 */
export function HistoryScreen() {
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState<DriverEarningsHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return undefined;

    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getEarningsHistory(token);
        if (!cancelled) setEntries(result);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof ApiClientError ? error.message : 'Could not load ride history.',
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
      <Text style={styles.title}>Ride history</Text>

      {isLoading && <ActivityIndicator color="#fbbf24" style={styles.spinner} />}
      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

      {!isLoading && !errorMessage && entries.length === 0 && (
        <Text style={styles.emptyText}>No completed rides yet.</Text>
      )}

      {entries.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  title: { color: '#fafaf9', fontSize: 20, fontWeight: '700', marginBottom: 16 },
  spinner: { marginVertical: 8 },
  errorText: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  emptyText: { color: '#a8a29e', fontSize: 14 },
  row: { backgroundColor: '#292524', borderRadius: 12, padding: 14, marginBottom: 10 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeLabel: { color: '#fafaf9', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  earningsValue: { color: '#4ade80', fontSize: 16, fontWeight: '700' },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  dateLabel: { color: '#78716c', fontSize: 12 },
  detailLabel: { color: '#78716c', fontSize: 12 },
  badges: { flexDirection: 'row', gap: 8 },
  badge: { fontSize: 12, fontWeight: '700' },
  badgeMuted: { color: '#78716c', fontSize: 12 },
});
