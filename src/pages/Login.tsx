import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Globe, Lock, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const { user, login, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setPending(true);
    try {
      await signInWithGoogle();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-card-title">Sign in</h1>
      <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="auth-field">
          <label className="auth-label" htmlFor="login-email">
            Email
          </label>
          <div className="auth-input-wrap">
            <Mail className="auth-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="login-email"
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@company.com"
            />
          </div>
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="login-password">
            Password
          </label>
          <div className="auth-input-wrap">
            <Lock className="auth-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="login-password"
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </div>
        </div>
        {error && <p className="error auth-error">{error}</p>}
        <button type="submit" className="auth-btn-primary" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        className="auth-btn-google"
        disabled={pending}
        onClick={() => void handleGoogle()}
      >
        <Globe size={18} strokeWidth={2} aria-hidden />
        Continue with Google
      </button>
      <p className="auth-switch">
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
