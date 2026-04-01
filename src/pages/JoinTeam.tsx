import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp, Timestamp, arrayUnion } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';

export function JoinTeam() {
  const { user, teamId, refreshTeam } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [teamIdInput, setTeamIdInput] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const t = searchParams.get('team')?.trim();
    if (t) setTeamIdInput(t);
  }, [searchParams]);

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
    setError('');
    setPending(true);
    try {
      const tid = teamIdInput.trim();
      const code = inviteCode.trim().toUpperCase();
      const memberRef = doc(db, 'teams', tid, 'members', u.uid);
      const existingMember = await getDoc(memberRef);
      if (!existingMember.exists()) {
        await setDoc(memberRef, {
          role: 'member',
          displayName: u.displayName ?? u.email,
          email: u.email,
          joinedAt: serverTimestamp(),
          inviteCode: code,
        });
      }
      await setDoc(
        doc(db, 'users', u.uid),
        {
          teamId: tid,
          teamIds: arrayUnion(tid),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await refreshTeam();
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not join. Check team ID and invite code.'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>{teamId ? 'Join another team' : 'Join team'}</h1>
        <p className="page-sub">
          Ask your admin for the <strong>invite code</strong>. If they sent a join link, your team ID may
          already be filled in. Firestore checks the code matches the team before you are added.
          {teamId && ' After you join, that team becomes your active team; use the sidebar switcher to move between teams.'}
        </p>
      </header>
      <div className="card narrow">
        <form onSubmit={handleSubmit} className="form">
          <label>
            Team ID
            <input
              type="text"
              value={teamIdInput}
              onChange={(e) => setTeamIdInput(e.target.value)}
              required
              autoComplete="off"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </label>
          <label>
            Invite code
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              autoComplete="off"
              placeholder="8-character code"
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Joining…' : 'Join team'}
          </button>
        </form>
      </div>
    </div>
  );
}
