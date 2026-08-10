import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DriverOnboardingStatus } from '@rideshare/types';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDriverProfile } from '../context/DriverProfileContext';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ApplicationStatus'>;

const STATUS_COPY: Record<DriverOnboardingStatus, { label: string; description: string }> = {
  DRAFT: {
    label: 'Not submitted',
    description: 'Add your vehicle and submit your application to start the review process.',
  },
  PENDING_REVIEW: {
    label: 'Under review',
    description:
      'Your application is with the platform team. This normally takes 1–2 business days in a real deployment.',
  },
  APPROVED: {
    label: 'Approved',
    description:
      'You can go online and start receiving ride requests once matching exists (Phase 8+).',
  },
  REJECTED: {
    label: 'Not approved',
    description:
      'Your application was not approved. Contact support for details once support tickets exist (Phase 18).',
  },
  SUSPENDED: {
    label: 'Suspended',
    description:
      'Your driver account has been suspended. Contact support for details once support tickets exist (Phase 18).',
  },
};

export function ApplicationStatusScreen({ navigation }: Props) {
  const { profile, isLoading, errorMessage } = useDriverProfile();

  if (isLoading && !profile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#fbbf24" />
      </View>
    );
  }

  if (errorMessage || !profile) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{errorMessage ?? 'Could not load your application.'}</Text>
      </View>
    );
  }

  const copy = STATUS_COPY[profile.onboardingStatus];

  return (
    <View style={styles.container}>
      <View style={styles.statusBadge}>
        <Text style={styles.statusBadgeText}>{copy.label}</Text>
      </View>
      <Text style={styles.description}>{copy.description}</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Vehicle on file</Text>
          <Text style={styles.rowValue}>
            {profile.vehicle
              ? `${profile.vehicle.year} ${profile.vehicle.make} ${profile.vehicle.model}`
              : 'None yet'}
          </Text>
        </View>
      </View>

      {profile.onboardingStatus === 'DRAFT' && (
        <Pressable
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Onboarding')}
          testID="continue-onboarding-button"
        >
          <Text style={styles.primaryButtonText}>Continue onboarding</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1c1917' },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#292524',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 16,
  },
  statusBadgeText: { color: '#fbbf24', fontSize: 13, fontWeight: '700' },
  description: { color: '#a8a29e', fontSize: 14, marginBottom: 24, lineHeight: 20 },
  card: {
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: '#a8a29e', fontSize: 14 },
  rowValue: { color: '#fafaf9', fontSize: 14, fontWeight: '600' },
  primaryButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#1c1917', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#f87171', textAlign: 'center', padding: 24 },
});
