import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login, register } from '../lib/api';
import type { AuthResponse } from '../types';

interface AuthPageProps {
  mode: 'login' | 'signup';
  onAuthSuccess: (payload: AuthResponse) => void;
}

export function AuthPage({ mode, onAuthSuccess }: AuthPageProps) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSignup = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const payload = isSignup
        ? await register({ name, email, password })
        : await login({ email, password });

      onAuthSuccess(payload);
      navigate('/dashboard');
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Authentication failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#f59e0b_0%,#fbf4de_35%,#f8f7f2_100%)] px-4 py-8 text-slate-900 sm:px-8 sm:py-14">
      <section className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-amber-100 bg-white/90 shadow-[0_30px_80px_-35px_rgba(146,64,14,0.45)] backdrop-blur md:grid-cols-2">
        <div className="relative hidden bg-[linear-gradient(145deg,#7c2d12,#c2410c_55%,#ea580c)] p-10 text-amber-50 md:block">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-amber-200/80">
            CloudDocs Platform
          </p>
          <h1 className="mt-8 text-4xl font-semibold leading-tight">
            Secure documents for teams building on the cloud.
          </h1>
          <p className="mt-6 max-w-sm text-sm text-amber-100/90">
            Start with local storage and evolve into S3, RDS, and ECS without changing your product workflow.
          </p>
        </div>

        <div className="p-8 sm:p-10">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-orange-700">
            {isSignup ? 'Create Account' : 'Welcome'}
          </p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">
            {isSignup ? 'Sign up for CloudDocs' : 'Login to CloudDocs'}
          </h2>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            {isSignup && (
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
                <input
                  className="w-full rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none ring-orange-200 transition focus:ring"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                className="w-full rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none ring-orange-200 transition focus:ring"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                minLength={6}
                className="w-full rounded-xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none ring-orange-200 transition focus:ring"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? 'Please wait...'
                : isSignup
                  ? 'Create account'
                  : 'Login'}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
            <Link
              to={isSignup ? '/login' : '/signup'}
              className="font-semibold text-orange-700 underline-offset-4 hover:underline"
            >
              {isSignup ? 'Login' : 'Sign up'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
