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
import { TeamInviteSection } from '../components/TeamInviteSection';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { appendAuditLog } from '../lib/auditLog';
import { parseDayEntry } from '../lib/dayEntry';
import { formatTime, localDateId } from '../lib/date';
import type { DayEntry, MemberRole, TimeOffKind } from '../types';

function breaksSummaryForCsv(breaks: DayEntry['breaks']): string {
  if (!breaks.length) return '';
  return breaks
    .map((b, i) => {
      const start = formatTime(b.start);
      const end = b.end != null ? formatTime(b.end) : 'open';
      return `#${i + 1} ${start}-${end}`;
    })
    .join('; ');
}

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

type TeamsTab = 'roster' | 'invite' | 'timeoff' | 'audit' | 'settings' | 'backup';

export function Teams() {
  const { user, teamId, role, teamSettings, refreshTeam } = useAuth();
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

  useEffect(() => {
    setSetHour(String(teamSettings.expectedStartHour));
    setSetMinute(String(teamSettings.expectedStartMinute));
    setPolMaxBreak(teamSettings.policies.maxBreakMinutes?.toString() ?? '');
    setPolMinBetween(teamSettings.policies.minBreakMinutesBetween?.toString() ?? '');
    setPolAutoOut(teamSettings.policies.autoClockOutHours?.toString() ?? '');
  }, [teamSettings]);

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
        e?.clockIn && 'toDate' in e.clockIn ? (e.clockIn as Timestamp).toDate().toISOString() : '';
      const clockOut =
        e?.clockOut && 'toDate' in e.clockOut ? (e.clockOut as Timestamp).toDate().toISOString() : '';
      const loc = e?.workLocation ?? '';
      const breaks = e ? breaksSummaryForCsv(e.breaks) : '';
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

  async function changeMemberRole(uid: string, newRole: MemberRole) {
    if (!teamId || !user || !isAdmin) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'members', uid), { role: newRole });
      await appendAuditLog(teamId, user.uid, 'member_role_changed', { targetUserId: uid, newRole });
      await loadRoster();
      await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  function openAdjust(r: RosterRow) {
    setAdjustRow(r);
    setAdjDateId(dateId);
    const e = r.entry;
    if (e?.clockIn) {
      const d = e.clockIn.toDate();
      setAdjIn(toDatetimeLocal(d));
    } else setAdjIn('');
    if (e?.clockOut) {
      setAdjOut(toDatetimeLocal(e.clockOut.toDate()));
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
      await setDoc(
        ref,
        {
          clockIn,
          clockOut,
          breaks: prev?.breaks ?? [],
          workLocation: prev?.workLocation ?? null,
          note: prev?.note ?? null,
          clockInGeo: prev?.clockInGeo ?? null,
          updatedAt: Timestamp.now(),
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
    const base: { id: TeamsTab; label: string }[] = [
      { id: 'roster', label: 'Roster' },
      { id: 'invite', label: 'Invite' },
      { id: 'timeoff', label: 'Time off' },
      { id: 'audit', label: 'Audit log' },
    ];
    if (isAdmin) {
      base.push({ id: 'settings', label: 'Policies' }, { id: 'backup', label: 'Backup' });
    }
    return base;
  }, [isAdmin]);

  return (
    <div className="page teams-page">
      <header className="page-header">
        <h1>Teams</h1>
        <p className="page-sub">
          Roster, invites, time off, and audit trail. {isAdmin ? 'Admins can edit policies and run backups.' : ''}
        </p>
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

      {error && <p className="error">{error}</p>}

      {tab === 'invite' && (
        <div className="teams-tab-panel">
          <TeamInviteSection />
        </div>
      )}

      {tab === 'roster' && (
        <div className="card wide teams-roster-card teams-tab-panel">
          <div className="admin-toolbar">
            <label>
              Date
              <input type="date" value={dateId} onChange={(e) => setDateId(e.target.value)} />
            </label>
            <button type="button" className="btn btn-secondary" onClick={() => void loadRoster()} disabled={loading}>
              Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={downloadRosterCsv} disabled={loading || !rows.length}>
              Export CSV
            </button>
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
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
                      <td>{r.displayName}</td>
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
                      <td>{formatTime(r.entry?.clockIn ?? null)}</td>
                      <td>{formatTime(r.entry?.clockOut ?? null)}</td>
                      <td>{r.entry?.workLocation ?? '—'}</td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAdjust(r)}>
                          Adjust
                        </button>
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
        <div className="card wide teams-tab-panel">
          <h2 className="card-title">Time off &amp; holidays</h2>
          <p className="muted small">Holidays apply to everyone. PTO is per person (pick member).</p>
          <div className="admin-toolbar teams-timeoff-form">
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
            <button type="button" className="btn btn-primary" disabled={toPending || (toKind === 'pto' && !toUserId)} onClick={() => void addTimeOff()}>
              Add
            </button>
          </div>
          {timeOffLoading ? (
            <p className="muted">Loading…</p>
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
        <div className="card wide teams-tab-panel">
          <h2 className="card-title">Audit log</h2>
          <button type="button" className="btn btn-secondary btn-sm teams-audit-refresh" onClick={() => void loadAudit()}>
            Refresh
          </button>
          {auditLoading ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
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
        <div className="card wide teams-tab-panel">
          <h2 className="card-title">Work schedule &amp; policies</h2>
          <p className="muted small">Late / Present on attendance uses expected start (per member override on member doc if set).</p>
          <div className="form teams-settings-form">
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
            <button type="button" className="btn btn-primary" disabled={settingsPending} onClick={() => void saveTeamSettings()}>
              Save policies
            </button>
          </div>
        </div>
      )}

      {tab === 'backup' && isAdmin && (
        <div className="card wide teams-tab-panel">
          <h2 className="card-title">Data backup</h2>
          <p className="muted small">Download JSON of members and all day entries in the range (client-side export).</p>
          <div className="admin-toolbar">
            <label>
              From
              <input type="date" value={backupFrom} onChange={(e) => setBackupFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={backupTo} onChange={(e) => setBackupTo(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" disabled={backupPending} onClick={() => void runBackup()}>
              Download JSON
            </button>
          </div>
        </div>
      )}

      {adjustRow && (
        <div className="teams-modal-backdrop" role="presentation" onClick={() => !adjPending && setAdjustRow(null)}>
          <div className="teams-modal card" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title">Adjust punch — {adjustRow.displayName}</h3>
            <div className="form">
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
