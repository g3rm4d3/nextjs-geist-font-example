'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { ApiClientError } from '@/lib/apiClient';

/**
 * Minimal admin login — just enough to reach the live fleet map (Phase 6's
 * "Admin App should display virtual drivers on map" requirement). There
 * is no public admin registration endpoint by design (section 8); admin
 * accounts are provisioned directly against the database, the same
 * pattern used throughout the backend's own tests and
 * packages/database/src/seed.ts's SEED_ADMIN_PASSWORD-gated fixture. The
 * rest of the Admin App (dashboard, driver/ride/payment management, its
 * own polished login UX) is Phase 14's job — this exists only so this
 * phase's map has something to authenticate against.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const { status, login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'signedIn') router.replace('/live-map');
  }, [status, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await login({ email, password });
      router.replace('/live-map');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-amber-600">
        Stage 1 — Development build
      </p>
      <h1 className="mb-6 text-center text-2xl font-semibold text-slate-900">Admin sign in</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            data-testid="email-input"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            data-testid="password-input"
          />
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600" data-testid="login-error">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60"
          data-testid="submit-button"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-500">
        No self-service admin registration — accounts are provisioned directly in the database. See
        docs/authentication.md.
      </p>
    </main>
  );
}
