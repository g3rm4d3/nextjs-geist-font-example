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

type Mode = 'login' | 'register';

/**
 * Combined login/register screen for the passenger role. There is no
 * separate admin-style flow here — this is exactly what Phase 2's
 * POST /auth/passengers/register and POST /auth/login expect.
 */
export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRegister = mode === 'register';

  async function handleSubmit() {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (isRegister) {
        await register({ email, password, firstName, lastName });
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
        <Text style={styles.title}>{isRegister ? 'Create your account' : 'Welcome back'}</Text>

        {isRegister && (
          <>
            <TextInput
              style={styles.input}
              placeholder="First name"
              placeholderTextColor="#64748b"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              testID="firstName-input"
            />
            <TextInput
              style={styles.input}
              placeholder="Last name"
              placeholderTextColor="#64748b"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              testID="lastName-input"
            />
          </>
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          testID="email-input"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          testID="password-input"
        />

        {errorMessage && (
          <Text style={styles.error} testID="auth-error">
            {errorMessage}
          </Text>
        )}

        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
          testID="submit-button"
        >
          {isSubmitting ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.submitButtonText}>{isRegister ? 'Sign up' : 'Log in'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(isRegister ? 'login' : 'register');
            setErrorMessage(null);
          }}
        >
          <Text style={styles.toggleText}>
            {isRegister ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
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
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
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
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
  },
  toggleText: {
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 14,
  },
});
