import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SupportTicket } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getSupportTickets } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Support'>;

const STATUS_COLOR: Record<SupportTicket['status'], string> = {
  OPEN: '#fbbf24',
  IN_PROGRESS: '#38bdf8',
  WAITING_USER: '#a78bfa',
  RESOLVED: '#4ade80',
  CLOSED: '#94a3b8',
};

/**
 * Section 18: "Passenger App ... create support ticket." This screen is
 * the list half — every ticket the signed-in passenger has ever opened,
 * most recent first, plus the entry point into `NewSupportTicketScreen`.
 * Previously an honest placeholder explicitly noting "there's nowhere
 * for a message submitted here to go" — this phase is what gives it
 * somewhere to go.
 */
export function SupportScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Bumped whenever this screen regains focus (e.g. returning here after
  // creating a ticket) — the actual fetch stays inline in the effect
  // below, same react-hooks/set-state-in-effect workaround used
  // throughout these apps.
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    return navigation.addListener('focus', () => {
      setRefreshCount((count) => count + 1);
    });
  }, [navigation]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await getSupportTickets(token);
        if (!cancelled) setTickets(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof ApiClientError ? error.message : 'Could not load support tickets.',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshCount]);

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.newButton}
        onPress={() => navigation.navigate('NewSupportTicket')}
        testID="new-ticket-button"
      >
        <Text style={styles.newButtonText}>New ticket</Text>
      </Pressable>

      {errorMessage && (
        <Text style={styles.error} testID="support-error">
          {errorMessage}
        </Text>
      )}

      {isLoading && tickets.length === 0 ? (
        <ActivityIndicator color="#fbbf24" style={styles.loading} />
      ) : tickets.length === 0 ? (
        <Text style={styles.empty}>No support tickets yet.</Text>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate('SupportTicketDetail', { ticketId: item.id })}
              testID={`ticket-${item.id}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.subject}
                </Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] }]}>
                  <Text style={styles.badgeText}>{item.status}</Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 20 },
  newButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  newButtonText: { color: '#0f172a', fontSize: 15, fontWeight: '700' },
  loading: { marginTop: 24 },
  error: { color: '#f87171', fontSize: 13, marginBottom: 12 },
  empty: { color: '#94a3b8', fontSize: 14, marginTop: 24, textAlign: 'center' },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: '#0f172a', fontSize: 11, fontWeight: '700' },
  cardMeta: { color: '#64748b', fontSize: 11, marginTop: 8 },
});
