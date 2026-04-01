import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Globe, Lock, Mail, UserRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function Register() {
  const { user, register, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
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
      await register(email, password, displayName.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
      <h1 className="auth-card-title">Create account</h1>
      <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-name">
            Display name
          </label>
          <div className="auth-input-wrap">
            <UserRound className="auth-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="register-name"
              className="auth-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Your name"
            />
          </div>
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="register-email">
            Email
          </label>
          <div className="auth-input-wrap">
            <Mail className="auth-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="register-email"
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
          <label className="auth-label" htmlFor="register-password">
            Password
          </label>
          <div className="auth-input-wrap">
            <Lock className="auth-input-icon" size={18} strokeWidth={2} aria-hidden />
            <input
              id="register-password"
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />
          </div>
        </div>
        {error && <p className="error auth-error">{error}</p>}
        <button type="submit" className="auth-btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Register'}
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
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
