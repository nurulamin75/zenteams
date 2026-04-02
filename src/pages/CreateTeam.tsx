import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { arrayUnion, doc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { generateInviteCode } from '../lib/invite';

export function CreateTeam() {
  const { user, refreshTeam } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = user;
    if (!u) return;
    if (!u.email) {
      setError('Missing email on account');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a team name');
      return;
    }
    setError('');
    setPending(true);
    try {
      const teamRef = doc(db, 'teams', crypto.randomUUID());
      const inviteCode = generateInviteCode();
      const batch = writeBatch(db);
      batch.set(teamRef, {
        name: trimmed,
        inviteCode,
        createdAt: serverTimestamp(),
        createdBy: u.uid,
        expectedStartHour: 9,
        expectedStartMinute: 0,
        policies: {},
      });
      batch.set(doc(teamRef, 'members', u.uid), {
        role: 'admin',
        displayName: u.displayName ?? trimmed,
        email: u.email,
        joinedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'users', u.uid),
        {
          teamId: teamRef.id,
          teamIds: arrayUnion(teamRef.id),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await batch.commit();
      await refreshTeam();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create team');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Create team</h1>
        <p className="page-sub">
          You&apos;ll be the admin. Invite code and join link are on the <strong>Teams</strong> page under Invite. You
          can belong to several teams and switch between them anytime.
        </p>
      </header>
      <div className="card narrow">
        <form onSubmit={(e) => void handleSubmit(e)} className="form">
          <label>
            Team name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Engineering"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create team'}
          </button>
        </form>
        <p className="muted small" style={{ marginTop: '1rem', marginBottom: 0 }}>
          <Link to="/settings">Back to settings</Link>
          {' · '}
          <Link to="/">Home</Link>
        </p>
      </div>
    </div>
  );
}
