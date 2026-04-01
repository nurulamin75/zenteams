import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { copyToClipboard } from '../lib/copy';

export function TeamInviteSection() {
  const { teamId, inviteCode: authInviteCode } = useAuth();
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!teamId || authInviteCode) {
      setFetchedCode(null);
      return;
    }
    let cancelled = false;
    setFetching(true);
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'teams', teamId));
        if (!cancelled && snap.exists()) setFetchedCode(snap.data().inviteCode as string);
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, authInviteCode]);

  const inviteCode = authInviteCode ?? fetchedCode;
  const loading = Boolean(teamId && !inviteCode && fetching);

  const joinUrl =
    typeof window !== 'undefined' && teamId
      ? `${window.location.origin}/team/join?team=${encodeURIComponent(teamId)}`
      : '';

  async function copy(value: string) {
    await copyToClipboard(value);
  }

  if (!teamId) return null;

  return (
    <section className="teams-invite-section" aria-labelledby="teams-invite-heading">
      {/* <h2 id="teams-invite-heading" className="teams-section-title">
        Invite teammates
      </h2>
      <p className="page-sub teams-invite-sub">
        Share the join link (best) or the team ID plus invite code. It&apos;s stored on your team—nothing to
        generate.
      </p> */}
      <div className="card invite-card teams-invite-card">
        {loading ? (
          <div className="invite-grid" aria-busy="true">
            <div className="invite-field-card">
              <span className="invite-label">Invite code</span>
              <span className="skeleton skeleton-line" style={{ width: '8rem' }} />
              <span className="skeleton skeleton-pill" style={{ width: '4.5rem' }} />
            </div>
            <div className="invite-field-card">
              <span className="invite-label">Team ID</span>
              <span className="skeleton skeleton-line" style={{ width: '100%', maxWidth: '20rem' }} />
              <span className="skeleton skeleton-pill" style={{ width: '4.5rem' }} />
            </div>
            <div className="invite-field-card invite-field-card--wide">
              <span className="invite-label">Join link</span>
              <span className="skeleton skeleton-line" style={{ width: '100%' }} />
              <span className="skeleton skeleton-pill" style={{ width: '4.5rem' }} />
            </div>
          </div>
        ) : inviteCode ? (
          <div className="invite-grid">
            <div className="invite-field-card">
              <span className="invite-label">Invite code</span>
              <code className="invite-value">{inviteCode}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(inviteCode)}>
                <Copy size={16} /> Copy
              </button>
            </div>
            <div className="invite-field-card">
              <span className="invite-label">Team ID</span>
              <code className="invite-value invite-value--sm">{teamId}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(teamId)}>
                <Copy size={16} /> Copy
              </button>
            </div>
            <div className="invite-field-card invite-field-card--wide">
              <span className="invite-label">Join link</span>
              <code className="invite-value invite-value--sm">{joinUrl}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(joinUrl)}>
                <Copy size={16} /> Copy
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">Could not load invite details.</p>
        )}
      </div>
    </section>
  );
}
