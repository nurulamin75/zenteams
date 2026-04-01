import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { doc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { generateInviteCode } from '../lib/invite';

export function CreateTeam() {
  const { user, teamId, refreshTeam } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (teamId) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const u = user;
    if (!u) return;
    if (!u.email) {
      setError('Missing email on account');
      return;
    }
    setError('');
    setPending(true);
    try {
      const teamRef = doc(db, 'teams', crypto.randomUUID());
      const inviteCode = generateInviteCode();
      const batch = writeBatch(db);
      batch.set(teamRef, {
        name: name.trim(),
        inviteCode,
        createdAt: serverTimestamp(),
        createdBy: u.uid,
        expectedStartHour: 9,
        expectedStartMinute: 0,
        policies: {},
      });
      batch.set(doc(teamRef, 'members', u.uid), {
        role: 'admin',
        displayName: u.displayName ?? name.trim(),
        email: u.email,
        joinedAt: serverTimestamp(),
      });
      batch.set(
        doc(db, 'users', u.uid),
        {
          teamId: teamRef.id,
          teamIds: [teamRef.id],
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
          You&apos;ll be the admin. Your invite code and join link appear on the <strong>Teams</strong> page.
        </p>
      </header>
      <div className="card narrow">
        <form onSubmit={handleSubmit} className="form">
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
      </div>
    </div>
  );
}
