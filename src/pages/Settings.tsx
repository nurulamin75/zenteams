import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { updateProfile } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';
import { localDateId } from '../lib/date';

export function Settings() {
  const { user, teamId, refreshTeam, refreshUserDoc, userPreferences, role } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [compactUI, setCompactUI] = useState(false);
  const [notifyLongShiftHours, setNotifyLongShiftHours] = useState('');
  const [notifyBeforeExpectedStart, setNotifyBeforeExpectedStart] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const [ptoDate, setPtoDate] = useState(() => localDateId());
  const [ptoLabel, setPtoLabel] = useState('');
  const [ptoNote, setPtoNote] = useState('');
  const [ptoPending, setPtoPending] = useState(false);
  const [ptoMsg, setPtoMsg] = useState('');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? '');
  }, [user]);

  useEffect(() => {
    setCompactUI(Boolean(userPreferences?.compactUI));
    setNotifyBeforeExpectedStart(Boolean(userPreferences?.notifyBeforeExpectedStart));
    const h = userPreferences?.notifyLongShiftHours;
    setNotifyLongShiftHours(typeof h === 'number' && h > 0 ? String(h) : '');
  }, [userPreferences]);

  useEffect(() => {
    if (!teamId || !user) return;
    void (async () => {
      const ms = await getDoc(doc(db, 'teams', teamId, 'members', user.uid));
      const tz = ms.exists() ? (ms.data().timezone as string | undefined) : undefined;
      setTimezone(tz ?? '');
    })();
  }, [teamId, user]);

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
      const tzTrim = timezone.trim();
      if (teamId) {
        const mref = doc(db, 'teams', teamId, 'members', u.uid);
        const ms = await getDoc(mref);
        if (ms.exists()) {
          await updateDoc(mref, { displayName: trimmed, timezone: tzTrim || null });
        }
      }
      const longH = notifyLongShiftHours.trim();
      const longN = longH ? Number.parseFloat(longH) : NaN;
      await setDoc(
        doc(db, 'users', u.uid),
        {
          preferences: {
            ...userPreferences,
            compactUI,
            notifyBeforeExpectedStart,
            notifyLongShiftHours: Number.isFinite(longN) && longN > 0 ? longN : null,
          },
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      await refreshTeam();
      await refreshUserDoc();
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setPending(false);
    }
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      setError('Notifications are not supported in this browser.');
      return;
    }
    const r = await Notification.requestPermission();
    if (r !== 'granted') setError('Permission was not granted.');
    else setMessage('Notifications enabled for this browser.');
  }

  async function submitPtoRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId || !user) return;
    setPtoMsg('');
    setPtoPending(true);
    try {
      await addDoc(collection(db, 'teams', teamId, 'approvalRequests'), {
        kind: 'pto',
        status: 'pending',
        requesterUid: user.uid,
        dateId: ptoDate,
        label: ptoLabel.trim() || null,
        note: ptoNote.trim() || null,
        createdAt: Timestamp.now(),
      });
      setPtoLabel('');
      setPtoNote('');
      setPtoMsg('Request sent. A manager will review it in Teams → Approvals.');
    } catch (err) {
      setPtoMsg(err instanceof Error ? err.message : 'Could not submit');
    } finally {
      setPtoPending(false);
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
          {teamId && (
            <label>
              Timezone (for directory)
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
              />
            </label>
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={compactUI} onChange={(e) => setCompactUI(e.target.checked)} />
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
        <h2 className="card-title">Reminders (this browser)</h2>
        <p className="muted small">
          Optional browser notifications while ZenTeams is open. Grant permission once; they are not sent when the tab is
          closed (no server push yet).
        </p>
        <div className="form">
          <label>
            Nudge after open shift (hours)
            <input
              type="number"
              min={1}
              step={0.5}
              value={notifyLongShiftHours}
              onChange={(e) => setNotifyLongShiftHours(e.target.value)}
              placeholder="e.g. 10"
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notifyBeforeExpectedStart}
              onChange={(e) => setNotifyBeforeExpectedStart(e.target.checked)}
            />
            Remind in the 15 minutes before expected start if not clocked in
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void requestNotificationPermission()}>
            Enable browser notifications
          </button>
        </div>
      </div>

      {teamId && role !== 'auditor' && (
        <div className="card settings-card">
          <h2 className="card-title">Request PTO</h2>
          <p className="muted small">Managers approve in Teams → Approvals. Approved requests create a PTO day for you.</p>
          <form className="form" onSubmit={(e) => void submitPtoRequest(e)}>
            <label>
              Date
              <input type="date" value={ptoDate} onChange={(e) => setPtoDate(e.target.value)} required />
            </label>
            <label>
              Label (optional)
              <input type="text" value={ptoLabel} onChange={(e) => setPtoLabel(e.target.value)} placeholder="e.g. Doctor" />
            </label>
            <label>
              Note to manager (optional)
              <input type="text" value={ptoNote} onChange={(e) => setPtoNote(e.target.value)} />
            </label>
            {ptoMsg && <p className={ptoMsg.startsWith('Request') ? 'success' : 'error'}>{ptoMsg}</p>}
            <button type="submit" className="btn btn-primary" disabled={ptoPending}>
              {ptoPending ? 'Sending…' : 'Submit request'}
            </button>
          </form>
        </div>
      )}

      <div className="card settings-card">
        <h2 className="card-title">Enterprise sign-in (SSO)</h2>
        <p className="muted small">
          SAML, OIDC, and enforced SSO are available with Firebase Identity Platform and a short backend setup. If you need
          this for your organization, contact your ZenTeams administrator or hosting provider to enable it on your Firebase
          project.
        </p>
      </div>

      <div className="card settings-card">
        <h2 className="card-title">Theme</h2>
        <ThemeToggle />
      </div>

      <div className="card settings-card">
        <h2 className="card-title">Workspaces</h2>
        <p className="muted small">
          Create another team anytime. You stay admin of the new workspace and can switch teams from the team menu (sidebar on
          desktop, <strong>More</strong> on mobile).
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
