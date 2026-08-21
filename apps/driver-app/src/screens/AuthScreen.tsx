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
import { ApiClientError } from '../lib/apiClient';
import { useAuth } from '../context/AuthContext';
import { minTouchTarget } from '../theme';

type Mode = 'login' | 'register';

/**
 * Combined login/register screen for the driver role — same shape as
 * apps/passenger-app's AuthScreen (Phase 3), with the two extra fields
 * POST /auth/drivers/register requires (licenseNumber, licenseState).
 */
export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseState, setLicenseState] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRegister = mode === 'register';

  async function handleSubmit() {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (isRegister) {
        await register({ email, password, firstName, lastName, licenseNumber, licenseState });
      } else {
        await login({ email, password });
      }
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Something went wrong. Please try again.',
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
        <Text style={styles.badge}>STAGE 1 — DEVELOPMENT BUILD</Text>
        <Text style={styles.title}>{isRegister ? 'Apply to drive' : 'Welcome back'}</Text>

        {isRegister && (
          <>
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor="#78716c"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              testID="firstName-input"
              accessibilityLabel="First name"
            />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor="#78716c"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              testID="lastName-input"
              accessibilityLabel="Last name"
            />
            <TextInput
              style={styles.input}
              placeholder="Driver's license number"
              placeholderTextColor="#78716c"
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              autoCapitalize="characters"
              testID="licenseNumber-input"
              accessibilityLabel="Driver's license number"
            />
            <TextInput
              style={styles.input}
              placeholder="License state (e.g. CA)"
              placeholderTextColor="#78716c"
              value={licenseState}
              onChangeText={setLicenseState}
              autoCapitalize="characters"
              maxLength={2}
              testID="licenseState-input"
              accessibilityLabel="License state"
            />
          </>
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#78716c"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          testID="email-input"
          accessibilityLabel="Email address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#78716c"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          testID="password-input"
          accessibilityLabel="Password"
        />

        {errorMessage && (
          <Text style={styles.error} testID="auth-error" accessibilityRole="alert">
            {errorMessage}
          </Text>
        )}

        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          testID="submit-button"
          accessibilityRole="button"
          accessibilityLabel={isRegister ? 'Apply' : 'Log in'}
          accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#1c1917" />
          ) : (
            <Text style={styles.submitButtonText}>{isRegister ? 'Apply' : 'Log in'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(isRegister ? 'login' : 'register');
            setErrorMessage(null);
          }}
          accessibilityRole="button"
          accessibilityLabel={isRegister ? 'Switch to log in' : 'Switch to apply to drive'}
          style={styles.toggleButton}
        >
          <Text style={styles.toggleText}>
            {isRegister
              ? 'Already have an account? Log in'
              : "Don't have an account? Apply to drive"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#1c1917' },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  badge: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  title: {
    color: '#fafaf9',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#292524',
    color: '#fafaf9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  error: {
    color: '#f87171',
    marginBottom: 12,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 8,
    paddingVertical: 14,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#1c1917',
    fontSize: 16,
    fontWeight: '700',
  },
  toggleButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  toggleText: {
    color: '#a8a29e',
    textAlign: 'center',
    fontSize: 14,
  },
});
