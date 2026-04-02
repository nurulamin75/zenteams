import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';

export function Settings() {
  const { user, teamId, refreshTeam, userPreferences } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [compactUI, setCompactUI] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? '');
  }, [user]);

  useEffect(() => {
    setCompactUI(Boolean(userPreferences?.compactUI));
  }, [userPreferences?.compactUI]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const u = user;
    if (!u) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Display name is required');
      return;
    }
    setError('');
    setMessage('');
    setPending(true);
    try {
      await updateProfile(u, { displayName: trimmed });
      if (teamId) {
        const mref = doc(db, 'teams', teamId, 'members', u.uid);
        const ms = await getDoc(mref);
        if (ms.exists()) {
          await updateDoc(mref, { displayName: trimmed });
        }
      }
      await setDoc(
        doc(db, 'users', u.uid),
        {
          preferences: {
            ...userPreferences,
            compactUI,
          },
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await refreshTeam();
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setPending(false);
    }
  }

  if (!user) return null;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <p className="page-sub">Update how you appear to teammates and how ZenTeams looks for you.</p>
      </header>

      <div className="card settings-card">
        <h2 className="card-title">Profile</h2>
        <p className="muted small">Email: {user.email ?? '—'}</p>
        <form onSubmit={(e) => void handleSaveProfile(e)} className="form">
          <label>
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={compactUI}
              onChange={(e) => setCompactUI(e.target.checked)}
            />
            Compact tables
          </label>
          {error && <p className="error">{error}</p>}
          {message && <p className="success">{message}</p>}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </form>
      </div>

      <div className="card settings-card">
        <h2 className="card-title">Theme</h2>
        <ThemeToggle />
      </div>

      <div className="card settings-card">
        <h2 className="card-title">Workspaces</h2>
        <p className="muted small">
          Create another team anytime. You stay admin of the new workspace and can switch teams from the team menu
          (sidebar on desktop, <strong>More</strong> on mobile).
        </p>
        <Link to="/team/create" className="btn btn-secondary">
          Create new team
        </Link>
      </div>

      {!teamId && (
        <p className="muted small">
          <Link to="/onboarding">Get started</Link> to create or join a team.
        </p>
      )}
    </div>
  );
}
