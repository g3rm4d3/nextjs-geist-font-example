import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SupportTicketDetail } from '@rideshare/types';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, getSupportTicket } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SupportTicketDetail'>;

/**
 * A passenger's own ticket, read-only: the current status and the full
 * message thread (their own opening message plus any admin replies —
 * never an internal note, which the backend never even sends down this
 * path; see supportService.getOwnTicketDetail). Section 18's spec text
 * lists "reply" only under Admin App, not Passenger/Driver App, so
 * there's deliberately no reply box here — see
 * docs/support-system.md's known limitations.
 */
export function SupportTicketDetailScreen({ route }: Props) {
  const { ticketId } = route.params;
  const { accessToken } = useAuth();
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function load(token: string) {
      try {
        const result = await getSupportTicket(token, ticketId);
        if (!cancelled) setTicket(result);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiClientError ? error.message : 'Could not load this ticket.');
        }
      }
    }

    void load(accessToken);
    return () => {
      cancelled = true;
    };
  }, [accessToken, ticketId]);

  if (errorMessage) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{errorMessage}</Text>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.subject}>{ticket.subject}</Text>
      <Text style={styles.status}>{ticket.status}</Text>

      {ticket.messages.map((message) => (
        <View
          key={message.id}
          style={[styles.bubble, message.isFromSupport ? styles.bubbleSupport : styles.bubbleSelf]}
          testID={`message-${message.id}`}
        >
          <Text style={styles.bubbleAuthor}>{message.isFromSupport ? 'Support' : 'You'}</Text>
          <Text style={styles.bubbleBody}>{message.body}</Text>
          <Text style={styles.bubbleMeta}>{new Date(message.createdAt).toLocaleString()}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  error: { color: '#f87171', fontSize: 14, textAlign: 'center', padding: 20 },
  subject: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  status: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginTop: 4, marginBottom: 20 },
  bubble: { borderRadius: 12, padding: 14, marginBottom: 12, maxWidth: '90%' },
  bubbleSelf: { backgroundColor: '#1e293b', alignSelf: 'flex-end' },
  bubbleSupport: { backgroundColor: '#334155', alignSelf: 'flex-start' },
  bubbleAuthor: { color: '#94a3b8', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleBody: { color: '#f8fafc', fontSize: 14 },
  bubbleMeta: { color: '#64748b', fontSize: 10, marginTop: 8 },
});
