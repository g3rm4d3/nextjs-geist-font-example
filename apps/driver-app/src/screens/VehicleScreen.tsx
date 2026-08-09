import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useDriverProfile } from '../context/DriverProfileContext';
import { ApiClientError, upsertVehicle } from '../lib/apiClient';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Vehicle'>;

/**
 * A single form, not a list: a driver has at most one active vehicle
 * (see apps/api's vehicles_one_active_per_driver_key), so submitting
 * again edits it in place rather than creating a second one.
 */
export function VehicleScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const { profile, setProfile } = useDriverProfile();
  const existing = profile?.vehicle ?? null;

  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing ? String(existing.year) : '');
  const [color, setColor] = useState(existing?.color ?? '');
  const [licensePlate, setLicensePlate] = useState(existing?.licensePlate ?? '');
  const [seats, setSeats] = useState(existing ? String(existing.seats) : '4');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit() {
    if (!accessToken || !profile) return;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const vehicle = await upsertVehicle(accessToken, {
        make,
        model,
        year: Number(year),
        color,
        licensePlate,
        seats: Number(seats),
      });
      setProfile({ ...profile, vehicle });
      navigation.goBack();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Could not save your vehicle.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{existing ? 'Edit your vehicle' : 'Add your vehicle'}</Text>

        <TextInput
          style={styles.input}
          placeholder="Make (e.g. Toyota)"
          placeholderTextColor="#78716c"
          value={make}
          onChangeText={setMake}
          testID="make-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Model (e.g. Camry)"
          placeholderTextColor="#78716c"
          value={model}
          onChangeText={setModel}
          testID="model-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Year"
          placeholderTextColor="#78716c"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          testID="year-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Color"
          placeholderTextColor="#78716c"
          value={color}
          onChangeText={setColor}
          testID="color-input"
        />
        <TextInput
          style={styles.input}
          placeholder="License plate"
          placeholderTextColor="#78716c"
          value={licensePlate}
          onChangeText={setLicensePlate}
          autoCapitalize="characters"
          testID="licensePlate-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Seats"
          placeholderTextColor="#78716c"
          value={seats}
          onChangeText={setSeats}
          keyboardType="number-pad"
          testID="seats-input"
        />

        {errorMessage && (
          <Text style={styles.error} testID="vehicle-error">
            {errorMessage}
          </Text>
        )}

        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          testID="save-vehicle-button"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#1c1917" />
          ) : (
            <Text style={styles.submitButtonText}>Save vehicle</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#1c1917' },
  container: { flexGrow: 1, padding: 20 },
  title: { color: '#fafaf9', fontSize: 20, fontWeight: '700', marginBottom: 20 },
  input: {
    backgroundColor: '#292524',
    color: '#fafaf9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: { color: '#f87171', marginBottom: 12, textAlign: 'center' },
  submitButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#1c1917', fontSize: 16, fontWeight: '700' },
});
