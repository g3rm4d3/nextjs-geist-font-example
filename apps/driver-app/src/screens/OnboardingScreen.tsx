import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useDriverProfile } from '../context/DriverProfileContext';
import { ApiClientError, submitApplication } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

/**
 * A checklist, not a form: the actual data entry happens on the Vehicle
 * screen (and, later, Documents — Phase 15). This screen's own job is
 * just tracking "have you done the steps yet?" and submitting DRAFT ->
 * PENDING_REVIEW once they're done. Document upload isn't required to
 * submit in Stage 1 since Phase 15 doesn't exist yet.
 */
export function OnboardingScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { profile, setProfile } = useDriverProfile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!profile) return null;

  const hasVehicle = profile.vehicle !== null;
  const canSubmit = hasVehicle && profile.onboardingStatus === 'DRAFT';

  async function handleSubmit() {
    if (!accessToken) return;
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const updated = await submitApplication(accessToken);
      setProfile(updated);
      navigation.navigate('ApplicationStatus');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not submit your application.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Get approved to drive</Text>

      <Pressable
        style={styles.step}
        onPress={() => navigation.navigate('Vehicle')}
        testID="onboarding-vehicle-step"
      >
        <Text style={styles.stepCheck}>{hasVehicle ? '✓' : '○'}</Text>
        <View style={styles.stepBody}>
          <Text style={styles.stepTitle}>Add your vehicle</Text>
          <Text style={styles.stepDescription}>
            {hasVehicle
              ? `${profile.vehicle?.year} ${profile.vehicle?.make} ${profile.vehicle?.model}`
              : 'Make, model, year, color, plate, and seats'}
          </Text>
        </View>
      </Pressable>

      <Pressable
        style={styles.step}
        onPress={() => navigation.navigate('Documents')}
        testID="onboarding-documents-step"
      >
        <Text style={styles.stepCheck}>○</Text>
        <View style={styles.stepBody}>
          <Text style={styles.stepTitle}>Upload documents</Text>
          <Text style={styles.stepDescription}>Not required to submit yet — built in Phase 15</Text>
        </View>
      </Pressable>

      {errorMessage && (
        <Text style={styles.error} testID="onboarding-error">
          {errorMessage}
        </Text>
      )}

      <Pressable
        style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={!canSubmit || isSubmitting}
        testID="submit-application-button"
      >
        {isSubmitting ? (
          <ActivityIndicator color="#1c1917" />
        ) : (
          <Text style={styles.submitButtonText}>
            {profile.onboardingStatus === 'DRAFT' ? 'Submit application' : 'Application submitted'}
          </Text>
        )}
      </Pressable>
      {!hasVehicle && (
        <Text style={styles.hint}>Add your vehicle before you can submit your application.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1c1917', padding: 20 },
  title: { color: '#fafaf9', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#292524',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  stepCheck: { color: '#fbbf24', fontSize: 18, marginRight: 12, width: 20 },
  stepBody: { flex: 1 },
  stepTitle: { color: '#fafaf9', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  stepDescription: { color: '#a8a29e', fontSize: 13 },
  error: { color: '#f87171', marginBottom: 12, textAlign: 'center' },
  submitButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: '#1c1917', fontSize: 16, fontWeight: '700' },
  hint: { color: '#78716c', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
