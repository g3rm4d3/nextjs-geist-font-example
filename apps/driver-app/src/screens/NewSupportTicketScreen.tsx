import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { ApiClientError, createSupportTicket } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSupportTicket'>;

/**
 * Section 18: "create support ticket. Ticket can reference ride." The
 * ride reference is a manually-entered ride id rather than a picker over
 * past rides — this app has no "list my past rides" endpoint yet, and
 * building one is out of this phase's scope; see docs/support-system.md's
 * known limitations. The backend re-verifies server-side that any id
 * entered here actually belongs to the caller (section 3's
 * server-authoritative principle) — a wrong or someone-else's id is
 * rejected with a clear `400`, not silently ignored.
 */
export function NewSupportTicketScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rideId, setRideId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!accessToken) return;
    if (!subject.trim() || !body.trim()) {
      setErrorMessage('A subject and a description are both required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const ticket = await createSupportTicket(accessToken, {
        subject: subject.trim(),
        body: body.trim(),
        rideId: rideId.trim() || undefined,
      });
      navigation.replace('SupportTicketDetail', { ticketId: ticket.id });
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not create this ticket.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Subject</Text>
      <TextInput
        style={styles.input}
        value={subject}
        onChangeText={setSubject}
        placeholder="e.g. I was underpaid for a ride"
        placeholderTextColor="#78716c"
        testID="ticket-subject-input"
      />

      <Text style={styles.label}>What&apos;s going on?</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={body}
        onChangeText={setBody}
        placeholder="Describe the issue…"
        placeholderTextColor="#78716c"
        multiline
        numberOfLines={5}
        testID="ticket-body-input"
      />

      <Text style={styles.label}>Ride ID (optional)</Text>
      <TextInput
        style={styles.input}
        value={rideId}
        onChangeText={setRideId}
        placeholder="Paste a ride ID if this is about a specific ride"
        placeholderTextColor="#78716c"
        autoCapitalize="none"
        testID="ticket-ride-id-input"
      />

      {errorMessage && (
        <Text style={styles.error} testID="new-ticket-error">
          {errorMessage}
        </Text>
      )}

      <Pressable
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={() => void handleSubmit()}
        disabled={isSubmitting}
        testID="submit-ticket-button"
      >
        {isSubmitting ? <ActivityIndicator color="#1c1917" /> : <Text style={styles.submitButtonText}>Submit</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  label: { color: '#a8a29e', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#292524',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fafaf9',
    fontSize: 15,
  },
  textArea: { minHeight: 110, textAlignVertical: 'top' },
  error: { color: '#f87171', fontSize: 13, marginTop: 16 },
  submitButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#1c1917', fontSize: 15, fontWeight: '700' },
});
