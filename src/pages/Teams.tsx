import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { TeamInviteSection } from '../components/TeamInviteSection';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { appendAuditLog } from '../lib/auditLog';
import {
  breaksSummaryForSessions,
  dayFirstClockIn,
  dayLastClockOut,
  dayWorkLocationSummary,
  parseDayEntry,
  purgeLegacyDayEntryFields,
  sessionInOutLines,
} from '../lib/dayEntry';
import { localDateId } from '../lib/date';
import { generateInviteCode } from '../lib/invite';
import type { DayEntry, MemberRole, TimeOffKind } from '../types';

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface RosterRow {
  userId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  entry: DayEntry | null;
}

interface TimeOffRow {
  id: string;
  dateId: string;
  kind: TimeOffKind;
  userId?: string | null;
  label?: string | null;
  at: Timestamp;
}

interface AuditRow {
  id: string;
  action: string;
  actorUid: string;
  at: Timestamp;
  meta: Record<string, unknown>;
}

type TeamsTab = 'general' | 'roster' | 'invite' | 'timeoff' | 'audit' | 'settings' | 'backup';

export function Teams() {
  const { user, teamId, role, teamName, teamSettings, refreshTeam } = useAuth();
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState<TeamsTab>('roster');
  const [dateId, setDateId] = useState(() => localDateId());
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [memberOptions, setMemberOptions] = useState<{ userId: string; displayName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [timeOffRows, setTimeOffRows] = useState<TimeOffRow[]>([]);
  const [timeOffLoading, setTimeOffLoading] = useState(false);
  const [toDateId, setToDateId] = useState(() => localDateId());
  const [toKind, setToKind] = useState<TimeOffKind>('holiday');
  const [toUserId, setToUserId] = useState('');
  const [toLabel, setToLabel] = useState('');
  const [toPending, setToPending] = useState(false);

  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [setHour, setSetHour] = useState(String(teamSettings.expectedStartHour));
  const [setMinute, setSetMinute] = useState(String(teamSettings.expectedStartMinute));
  const [polMaxBreak, setPolMaxBreak] = useState(teamSettings.policies.maxBreakMinutes?.toString() ?? '');
  const [polMinBetween, setPolMinBetween] = useState(teamSettings.policies.minBreakMinutesBetween?.toString() ?? '');
  const [polAutoOut, setPolAutoOut] = useState(teamSettings.policies.autoClockOutHours?.toString() ?? '');
  const [settingsPending, setSettingsPending] = useState(false);

  const [backupFrom, setBackupFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [backupTo, setBackupTo] = useState(() => localDateId());
  const [backupPending, setBackupPending] = useState(false);

  const [adjustRow, setAdjustRow] = useState<RosterRow | null>(null);
  const [adjDateId, setAdjDateId] = useState(dateId);
  const [adjIn, setAdjIn] = useState('');
  const [adjOut, setAdjOut] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjPending, setAdjPending] = useState(false);

  const [draftTeamName, setDraftTeamName] = useState('');
  const [teamProfilePending, setTeamProfilePending] = useState(false);
  const [inviteRegenPending, setInviteRegenPending] = useState(false);
  const [nameEdit, setNameEdit] = useState<{ userId: string; value: string } | null>(null);
  const [nameEditPending, setNameEditPending] = useState(false);
  const [removePendingUid, setRemovePendingUid] = useState<string | null>(null);

  useEffect(() => {
    setSetHour(String(teamSettings.expectedStartHour));
    setSetMinute(String(teamSettings.expectedStartMinute));
    setPolMaxBreak(teamSettings.policies.maxBreakMinutes?.toString() ?? '');
    setPolMinBetween(teamSettings.policies.minBreakMinutesBetween?.toString() ?? '');
    setPolAutoOut(teamSettings.policies.autoClockOutHours?.toString() ?? '');
  }, [teamSettings]);

  useEffect(() => {
    if (teamName) setDraftTeamName(teamName);
  }, [teamName]);

  useEffect(() => {
    if (!isAdmin && (tab === 'general' || tab === 'settings' || tab === 'backup')) {
      setTab('roster');
    }
  }, [isAdmin, tab]);

  useEffect(() => {
    if (!teamId) return;
    void (async () => {
      const ms = await getDocs(collection(db, 'teams', teamId, 'members'));
      setMemberOptions(
        ms.docs.map((m) => ({
          userId: m.id,
          displayName: (m.data().displayName as string) ?? m.id,
        }))
      );
    })();
  }, [teamId]);

  const loadRoster = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError('');
    try {
      const entriesRef = collection(db, 'teams', teamId, 'days', dateId, 'entries');
      const membersRef = collection(db, 'teams', teamId, 'members');
      const [entriesSnap, membersSnap] = await Promise.all([getDocs(entriesRef), getDocs(membersRef)]);

      const entryByUserId = new Map<string, DayEntry | null>();
      for (const d of entriesSnap.docs) {
        entryByUserId.set(d.id, parseDayEntry(d.data() as Record<string, unknown>));
      }

      const list: RosterRow[] = membersSnap.docs.map((m) => {
        const uid = m.id;
        const data = m.data();
        return {
          userId: uid,
          displayName: (data.displayName as string) ?? uid,
          email: (data.email as string) ?? '',
          role: (data.role as MemberRole) ?? 'member',
          entry: entryByUserId.get(uid) ?? null,
        };
      });
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [teamId, dateId]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const loadTimeOff = useCallback(async () => {
    if (!teamId) return;
    setTimeOffLoading(true);
    try {
      const snap = await getDocs(collection(db, 'teams', teamId, 'timeOff'));
      const mapped = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          dateId: x.dateId as string,
          kind: x.kind as TimeOffKind,
          userId: x.userId as string | undefined,
          label: x.label as string | undefined,
          at: x.createdAt as Timestamp,
        };
      });
      mapped.sort((a, b) => b.dateId.localeCompare(a.dateId));
      setTimeOffRows(mapped);
    } finally {
      setTimeOffLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (tab === 'timeoff' && teamId) void loadTimeOff();
  }, [tab, teamId, loadTimeOff]);

  const loadAudit = useCallback(async () => {
    if (!teamId) return;
    setAuditLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'teams', teamId, 'auditLogs'), orderBy('at', 'desc'), limit(100))
      );
      setAuditRows(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            action: x.action as string,
            actorUid: x.actorUid as string,
            at: x.at as Timestamp,
            meta: (x.meta as Record<string, unknown>) ?? {},
          };
        })
      );
    } finally {
      setAuditLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (tab === 'audit' && teamId) void loadAudit();
  }, [tab, teamId, loadAudit]);

  function downloadRosterCsv() {
    if (!teamId) return;
    const header = ['date', 'userId', 'displayName', 'email', 'role', 'workLocation', 'clockIn', 'clockOut', 'breaks'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const e = r.entry;
      const clockIn =
        (e?.sessions ?? [])
          .map((s) => (s.clockIn && 'toDate' in s.clockIn ? s.clockIn.toDate().toISOString() : ''))
          .filter(Boolean)
          .join('; ') ?? '';
      const clockOut =
        (e?.sessions ?? [])
          .map((s) =>
            s.clockOut && 'toDate' in s.clockOut ? s.clockOut.toDate().toISOString() : ''
          )
          .filter(Boolean)
          .join('; ') ?? '';
      const loc = e ? dayWorkLocationSummary(e) : '';
      const breaks = e ? breaksSummaryForSessions(e.sessions) : '';
      lines.push(
        [dateId, r.userId, r.displayName, r.email, r.role, loc, clockIn, clockOut, breaks]
          .map((c) => escapeCsvCell(String(c)))
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenteams-${teamId}-${dateId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveTeamSettings() {
    if (!teamId || !isAdmin) return;
    const h = Number.parseInt(setHour, 10);
    const m = Number.parseInt(setMinute, 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      setError('Invalid expected start time');
      return;
    }
    setSettingsPending(true);
    setError('');
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        expectedStartHour: h,
        expectedStartMinute: m,
        policies: {
          maxBreakMinutes: polMaxBreak ? Number(polMaxBreak) : null,
          minBreakMinutesBetween: polMinBetween ? Number(polMinBetween) : null,
          autoClockOutHours: polAutoOut ? Number(polAutoOut) : null,
        },
      });
      await appendAuditLog(teamId, user!.uid, 'team_settings_updated', { expectedStartHour: h, expectedStartMinute: m });
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSettingsPending(false);
    }
  }

  async function addTimeOff() {
    if (!teamId || !user) return;
    setToPending(true);
    setError('');
    try {
      await addDoc(collection(db, 'teams', teamId, 'timeOff'), {
        dateId: toDateId,
        kind: toKind,
        userId: toKind === 'pto' ? toUserId || null : null,
        label: toLabel.trim() || null,
        createdAt: Timestamp.now(),
      });
      await appendAuditLog(teamId, user.uid, 'time_off_added', { dateId: toDateId, kind: toKind });
      await loadTimeOff();
      setToLabel('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setToPending(false);
    }
  }

  async function removeTimeOff(id: string) {
    if (!teamId || !user) return;
    try {
      await deleteDoc(doc(db, 'teams', teamId, 'timeOff', id));
      await appendAuditLog(teamId, user.uid, 'time_off_removed', { id });
      await loadTimeOff();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    }
  }

  function adminCount(): number {
    return rows.filter((r) => r.role === 'admin').length;
  }

  async function changeMemberRole(uid: string, newRole: MemberRole) {
    if (!teamId || !user || !isAdmin) return;
    const target = rows.find((r) => r.userId === uid);
    if (target?.role === 'admin' && newRole !== 'admin' && adminCount() <= 1) {
      setError('There must be at least one admin.');
      return;
    }
    setError('');
    try {
      await updateDoc(doc(db, 'teams', teamId, 'members', uid), { role: newRole });
      await appendAuditLog(teamId, user.uid, 'member_role_changed', { targetUserId: uid, newRole });
      await loadRoster();
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  async function saveMemberDisplayName(uid: string) {
    if (!teamId || !user || !isAdmin || !nameEdit || nameEdit.userId !== uid) return;
    const v = nameEdit.value.trim();
    if (!v) {
      setError('Display name is required');
      return;
    }
    setError('');
    setNameEditPending(true);
    try {
      await updateDoc(doc(db, 'teams', teamId, 'members', uid), { displayName: v });
      await appendAuditLog(teamId, user.uid, 'member_display_name_updated', { targetUserId: uid });
      setNameEdit(null);
      await loadRoster();
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      setNameEditPending(false);
    }
  }

  async function removeMemberFromTeam(uid: string) {
    if (!teamId || !user || !isAdmin) return;
    if (uid === user.uid) {
      setError('You cannot remove yourself from the team.');
      return;
    }
    const target = rows.find((r) => r.userId === uid);
    if (target?.role === 'admin' && adminCount() <= 1) {
      setError('Cannot remove the only admin.');
      return;
    }
    if (!window.confirm(`Remove ${target?.displayName ?? uid} from this team? They will lose access until invited again.`)) {
      return;
    }
    setError('');
    setRemovePendingUid(uid);
    try {
      await deleteDoc(doc(db, 'teams', teamId, 'members', uid));
      await appendAuditLog(teamId, user.uid, 'member_removed', { targetUserId: uid });
      await loadRoster();
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setRemovePendingUid(null);
    }
  }

  async function saveTeamProfile() {
    if (!teamId || !user || !isAdmin) return;
    const n = draftTeamName.trim();
    if (!n) {
      setError('Team name is required');
      return;
    }
    setError('');
    setTeamProfilePending(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), { name: n });
      await appendAuditLog(teamId, user.uid, 'team_profile_updated', { name: n });
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setTeamProfilePending(false);
    }
  }

  async function regenerateInviteCode() {
    if (!teamId || !user || !isAdmin) return;
    if (!window.confirm('Generate a new invite code? The old code will stop working for new joins.')) return;
    setError('');
    setInviteRegenPending(true);
    try {
      const code = generateInviteCode();
      await updateDoc(doc(db, 'teams', teamId), { inviteCode: code });
      await appendAuditLog(teamId, user.uid, 'invite_code_regenerated', {});
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate');
    } finally {
      setInviteRegenPending(false);
    }
  }

  function openAdjust(r: RosterRow) {
    setAdjustRow(r);
    setAdjDateId(dateId);
    const e = r.entry;
    const firstIn = e ? dayFirstClockIn(e) : null;
    const lastOut = e ? dayLastClockOut(e) : null;
    if (firstIn) {
      setAdjIn(toDatetimeLocal(firstIn.toDate()));
    } else setAdjIn('');
    if (lastOut) {
      setAdjOut(toDatetimeLocal(lastOut.toDate()));
    } else setAdjOut('');
    setAdjReason('');
  }

  function toDatetimeLocal(d: Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function saveAdjust() {
    if (!teamId || !user || !adjustRow) return;
    setAdjPending(true);
    setError('');
    try {
      const ref = doc(db, 'teams', teamId, 'days', adjDateId, 'entries', adjustRow.userId);
      const prevSnap = await getDoc(ref);
      const prev = prevSnap.exists() ? parseDayEntry(prevSnap.data() as Record<string, unknown>) : null;
      const clockIn = adjIn ? Timestamp.fromDate(new Date(adjIn)) : null;
      const clockOut = adjOut ? Timestamp.fromDate(new Date(adjOut)) : null;
      if (!clockIn) {
        setError('Clock in is required');
        setAdjPending(false);
        return;
      }
      const first = prev?.sessions[0];
      const wl = first?.workLocation ?? 'remote';
      await setDoc(
        ref,
        {
          sessions: [
            {
              clockIn,
              clockOut,
              breaks: [],
              workLocation: wl,
              note: first?.note ?? null,
              clockInGeo: first?.clockInGeo ?? null,
            },
          ],
          updatedAt: Timestamp.now(),
          ...purgeLegacyDayEntryFields(),
        },
        { merge: true }
      );
      await appendAuditLog(teamId, user.uid, 'entry_corrected', {
        targetUserId: adjustRow.userId,
        dateId: adjDateId,
        reason: adjReason.trim() || null,
      });
      setAdjustRow(null);
      await loadRoster();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Correction failed');
    } finally {
      setAdjPending(false);
    }
  }

  async function runBackup() {
    if (!teamId || !isAdmin) return;
    setBackupPending(true);
    setError('');
    try {
      const from = new Date(`${backupFrom}T12:00:00`);
      const to = new Date(`${backupTo}T12:00:00`);
      const dates: string[] = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
      }
      const membersSnap = await getDocs(collection(db, 'teams', teamId, 'members'));
      const members = membersSnap.docs.map((m) => ({ id: m.id, ...m.data() }));
      const days: Record<string, Record<string, unknown>> = {};
      for (const di of dates) {
        const es = await getDocs(collection(db, 'teams', teamId, 'days', di, 'entries'));
        const entries: Record<string, unknown> = {};
        for (const ed of es.docs) entries[ed.id] = ed.data();
        if (Object.keys(entries).length) days[di] = entries;
      }
      const payload = { exportedAt: new Date().toISOString(), teamId, members, days };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zenteams-backup-${teamId}-${backupFrom}-${backupTo}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await appendAuditLog(teamId, user!.uid, 'backup_exported', { from: backupFrom, to: backupTo });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setBackupPending(false);
    }
  }

  const tabButtons = useMemo(() => {
    const base: { id: TeamsTab; label: string }[] = [];
    if (isAdmin) {
      base.push({ id: 'general', label: 'General' });
    }
    base.push(
      { id: 'roster', label: 'Roster' },
      { id: 'invite', label: 'Invite' },
      { id: 'timeoff', label: 'Time off' },
      { id: 'audit', label: 'Audit log' }
    );
    if (isAdmin) {
      base.push({ id: 'settings', label: 'Policies' }, { id: 'backup', label: 'Backup' });
    }
    return base;
  }, [isAdmin]);

  return (
    <div className="page teams-page">
      <header className="teams-hero">
        <div className="teams-hero__text">
          <h1 className="teams-hero__title">Teams & workspace</h1>
        </div>
      </header>

      <div className="teams-tabs" role="tablist">
        {tabButtons.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={tab === b.id}
            className={`teams-tab${tab === b.id ? ' teams-tab--active' : ''}`}
            onClick={() => setTab(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && <p className="error teams-page-error">{error}</p>}

      {tab === 'general' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <p className="teams-panel-eyebrow">Identity</p>
            <h2 className="teams-panel-title">Team profile</h2>
            <p className="teams-panel-lede muted small">
              Name and invite rotation. More workspaces:{' '}
              <Link to="/team/create">Create team</Link> · <Link to="/settings">Settings</Link>
            </p>
          </header>
          <div className="form teams-profile-form">
            <label>
              Team name
              <input
                type="text"
                value={draftTeamName}
                onChange={(e) => setDraftTeamName(e.target.value)}
                placeholder="Team display name"
              />
            </label>
            <div className="teams-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={teamProfilePending}
                onClick={() => void saveTeamProfile()}
              >
                {teamProfilePending ? 'Saving…' : 'Save name'}
              </button>
            </div>
            <div className="teams-divider" role="separator" />
            <p className="teams-muted-block muted small">
              If a link leaked, rotate the code—old joins stop working.
            </p>
            <div className="teams-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={inviteRegenPending}
                onClick={() => void regenerateInviteCode()}
              >
                {inviteRegenPending ? 'Updating…' : 'Regenerate invite code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'invite' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <p className="teams-panel-eyebrow">Access</p>
            <h2 className="teams-panel-title">Invite teammates</h2>
            <p className="teams-panel-lede muted small">
              Share the join link or copy the team ID and invite code—new members use them on the join page.
            </p>
          </header>
          <TeamInviteSection />
        </div>
      )}

      {tab === 'roster' && (
        <div className="card wide teams-roster-card teams-tab-panel teams-panel">
          <header className="teams-panel-head teams-panel-head--toolbar">
            <div>
              <p className="teams-panel-eyebrow">People</p>
              <h2 className="teams-panel-title">Roster</h2>
            </div>
            <div className="admin-toolbar teams-toolbar">
              <label>
                Date
                <input type="date" value={dateId} onChange={(e) => setDateId(e.target.value)} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadRoster()} disabled={loading}>
                Refresh
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={downloadRosterCsv}
                disabled={loading || !rows.length}
              >
                Export CSV
              </button>
            </div>
          </header>
          {loading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : (
            <div className="table-wrap teams-table-wrap">
              <table className="data-table teams-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Location</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        {nameEdit?.userId === r.userId ? (
                          <div className="teams-inline-name">
                            <input
                              type="text"
                              className="teams-inline-name-input"
                              value={nameEdit.value}
                              onChange={(e) => setNameEdit({ userId: r.userId, value: e.target.value })}
                              disabled={nameEditPending}
                            />
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={nameEditPending}
                              onClick={() => void saveMemberDisplayName(r.userId)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={nameEditPending}
                              onClick={() => setNameEdit(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span className="teams-name-cell">
                            {r.displayName}
                            {isAdmin && r.userId !== user?.uid && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setNameEdit({ userId: r.userId, value: r.displayName })}
                              >
                                Rename
                              </button>
                            )}
                          </span>
                        )}
                      </td>
                      <td>{r.email}</td>
                      <td>
                        {isAdmin && r.userId !== user?.uid ? (
                          <select
                            className="history-select teams-role-select"
                            value={r.role}
                            onChange={(e) => void changeMemberRole(r.userId, e.target.value as MemberRole)}
                          >
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          r.role
                        )}
                      </td>
                      <td>
                        {(() => {
                          const { clockIns } = sessionInOutLines(r.entry);
                          return (
                            <div className="attendance-time-stack">
                              {clockIns.map((t, i) => (
                                <span key={`in-${i}`} className="attendance-time-stack__line">
                                  {t}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const { clockOuts } = sessionInOutLines(r.entry);
                          return (
                            <div className="attendance-time-stack">
                              {clockOuts.map((t, i) => (
                                <span key={`out-${i}`} className="attendance-time-stack__line">
                                  {t}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td>{r.entry ? dayWorkLocationSummary(r.entry) : '—'}</td>
                      <td>
                        <div className="teams-row-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAdjust(r)}>
                            Adjust
                          </button>
                          {isAdmin && r.userId !== user?.uid && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm teams-remove-btn"
                              disabled={removePendingUid === r.userId}
                              onClick={() => void removeMemberFromTeam(r.userId)}
                            >
                              {removePendingUid === r.userId ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'timeoff' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <p className="teams-panel-eyebrow">Calendar</p>
            <h2 className="teams-panel-title">Time off &amp; holidays</h2>
            <p className="teams-panel-lede muted small">Holidays: whole team. PTO: pick a member.</p>
          </header>
          <div className="admin-toolbar teams-toolbar teams-timeoff-form">
            <label>
              Date
              <input type="date" value={toDateId} onChange={(e) => setToDateId(e.target.value)} />
            </label>
            <label>
              Type
              <select className="history-select" value={toKind} onChange={(e) => setToKind(e.target.value as TimeOffKind)}>
                <option value="holiday">Holiday (whole team)</option>
                <option value="pto">PTO (one member)</option>
              </select>
            </label>
            {toKind === 'pto' && (
              <label>
                Member
                <select className="history-select" value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
                  <option value="">Select…</option>
                  {memberOptions.map((r) => (
                    <option key={r.userId} value={r.userId}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="teams-timeoff-label-wide">
              Label (optional)
              <input type="text" value={toLabel} onChange={(e) => setToLabel(e.target.value)} placeholder="e.g. New Year" />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={toPending || (toKind === 'pto' && !toUserId)}
              onClick={() => void addTimeOff()}
            >
              Add
            </button>
          </div>
          {timeOffLoading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : (
            <ul className="teams-timeoff-list">
              {timeOffRows.map((t) => (
                <li key={t.id}>
                  <span>
                    <strong>{t.dateId}</strong> · {t.kind}
                    {t.userId ? ` · ${t.userId}` : ''}
                    {t.label ? ` · ${t.label}` : ''}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeTimeOff(t.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head teams-panel-head--toolbar">
            <div>
              <p className="teams-panel-eyebrow">Security</p>
              <h2 className="teams-panel-title">Audit log</h2>
            </div>
            <button type="button" className="btn btn-ghost btn-sm teams-audit-refresh" onClick={() => void loadAudit()}>
              Refresh
            </button>
          </header>
          {auditLoading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : (
            <div className="table-wrap teams-table-wrap">
              <table className="data-table teams-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((a) => (
                    <tr key={a.id}>
                      <td>{a.at?.toDate?.().toLocaleString() ?? '—'}</td>
                      <td className="teams-mono">{a.actorUid.slice(0, 8)}…</td>
                      <td>{a.action}</td>
                      <td className="teams-mono small">{JSON.stringify(a.meta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <p className="teams-panel-eyebrow">Rules</p>
            <h2 className="teams-panel-title">Schedule &amp; policies</h2>
            <p className="teams-panel-lede muted small">
              Expected start drives Late / Present. Members can override their own start in their profile.
            </p>
          </header>
          <div className="form teams-settings-form teams-profile-form">
            <div className="teams-settings-row">
              <label>
                Expected start (hour)
                <input type="number" min={0} max={23} value={setHour} onChange={(e) => setSetHour(e.target.value)} />
              </label>
              <label>
                Minute
                <input type="number" min={0} max={59} value={setMinute} onChange={(e) => setSetMinute(e.target.value)} />
              </label>
            </div>
            <label>
              Max single break (minutes, optional)
              <input type="number" min={1} value={polMaxBreak} onChange={(e) => setPolMaxBreak(e.target.value)} placeholder="e.g. 60" />
            </label>
            <label>
              Min minutes between breaks (optional)
              <input type="number" min={0} value={polMinBetween} onChange={(e) => setPolMinBetween(e.target.value)} placeholder="e.g. 30" />
            </label>
            <label>
              Suggest clock out after (hours on shift, optional)
              <input type="number" min={1} step={0.5} value={polAutoOut} onChange={(e) => setPolAutoOut(e.target.value)} placeholder="e.g. 10" />
            </label>
            <div className="teams-actions">
              <button type="button" className="btn btn-primary" disabled={settingsPending} onClick={() => void saveTeamSettings()}>
                Save policies
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <p className="teams-panel-eyebrow">Export</p>
            <h2 className="teams-panel-title">Data backup</h2>
            <p className="teams-panel-lede muted small">Client-side JSON: members and day entries in the range.</p>
          </header>
          <div className="admin-toolbar teams-toolbar">
            <label>
              From
              <input type="date" value={backupFrom} onChange={(e) => setBackupFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={backupTo} onChange={(e) => setBackupTo(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary btn-sm" disabled={backupPending} onClick={() => void runBackup()}>
              Download JSON
            </button>
          </div>
        </div>
      )}

      {adjustRow && (
        <div className="teams-modal-backdrop" role="presentation" onClick={() => !adjPending && setAdjustRow(null)}>
          <div className="teams-modal teams-modal--sheet card" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="teams-modal__title">Adjust punch</h3>
            <p className="teams-modal__sub muted small">{adjustRow.displayName}</p>
            <div className="form teams-modal__form">
              <label>
                Date
                <input type="date" value={adjDateId} onChange={(e) => setAdjDateId(e.target.value)} />
              </label>
              <label>
                Clock in
                <input type="datetime-local" value={adjIn} onChange={(e) => setAdjIn(e.target.value)} />
              </label>
              <label>
                Clock out
                <input type="datetime-local" value={adjOut} onChange={(e) => setAdjOut(e.target.value)} />
              </label>
              <label>
                Reason (audit)
                <input type="text" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
              </label>
            </div>
            <div className="teams-modal-actions">
              <button type="button" className="btn btn-secondary" disabled={adjPending} onClick={() => setAdjustRow(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={adjPending} onClick={() => void saveAdjust()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
