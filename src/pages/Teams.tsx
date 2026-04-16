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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Shield, X } from 'lucide-react';
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
import {
  APP_MODULE_LABELS,
  APP_MODULE_ORDER,
  LEAD_ONLY_MODULES,
  emptyCustomModules,
  parseMemberPermissions,
} from '../lib/memberPermissions';
import type { AppModule, DayEntry, MemberPermissions, MemberRole, TeamProject, TimeOffKind, WeeklyExpectedStartMap } from '../types';

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
  timezone?: string | null;
}

interface TimeOffRow {
  id: string;
  dateId: string;
  kind: TimeOffKind;
  userId?: string | null;
  label?: string | null;
  at: Timestamp;
}

type TeamsTab =
  | 'general'
  | 'roster'
  | 'directory'
  | 'invite'
  | 'timeoff'
  | 'settings'
  | 'backup'
  | 'approvals'
  | 'projects'
  | 'permissions';

interface PermRow {
  userId: string;
  displayName: string;
  email: string;
  role: MemberRole;
  permissions: MemberPermissions;
}

interface PermModalState {
  userId: string;
  displayName: string;
  role: MemberRole;
  fullAccess: boolean;
  modules: Record<AppModule, boolean>;
}

interface ApprovalDoc {
  id: string;
  requesterUid: string;
  dateId: string;
  label: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Timestamp;
}

export function Teams() {
  const { user, teamId, role, teamName, teamSettings, refreshTeam, canManageTeam, isAuditor } = useAuth();
  const isAdmin = role === 'admin';
  const canLeadMutate = canManageTeam && !isAuditor;

  const [tab, setTab] = useState<TeamsTab>('general');
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

  const [approvalRows, setApprovalRows] = useState<ApprovalDoc[]>([]);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const [teamProjects, setTeamProjects] = useState<TeamProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projName, setProjName] = useState('');
  const [projClient, setProjClient] = useState('');
  const [projPending, setProjPending] = useState(false);

  const [weeklyDraft, setWeeklyDraft] = useState<Record<string, { h: string; m: string }>>({});

  const [permRows, setPermRows] = useState<PermRow[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [permModal, setPermModal] = useState<PermModalState | null>(null);
  const [permPending, setPermPending] = useState(false);

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
    const adminOnly: TeamsTab[] = ['general', 'settings', 'backup', 'projects', 'permissions'];
    if (!isAdmin && adminOnly.includes(tab)) setTab('roster');
  }, [isAdmin, tab]);

  useEffect(() => {
    const ws = teamSettings.weeklySchedule;
    if (!ws) {
      setWeeklyDraft({});
      return;
    }
    const next: Record<string, { h: string; m: string }> = {};
    for (const k of ['0', '1', '2', '3', '4', '5', '6'] as const) {
      const d = ws[k];
      if (d) next[k] = { h: String(d.hour), m: String(d.minute) };
    }
    setWeeklyDraft(next);
  }, [teamSettings.weeklySchedule]);

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
          timezone: (data.timezone as string) ?? null,
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

  const loadApprovals = useCallback(async () => {
    if (!teamId) return;
    setApprovalLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'teams', teamId, 'approvalRequests'), orderBy('createdAt', 'desc'), limit(80))
      );
      setApprovalRows(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            requesterUid: x.requesterUid as string,
            dateId: x.dateId as string,
            label: (x.label as string) ?? null,
            note: (x.note as string) ?? null,
            status: x.status as ApprovalDoc['status'],
            createdAt: x.createdAt as Timestamp,
          };
        })
      );
    } finally {
      setApprovalLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (tab === 'approvals' && teamId) void loadApprovals();
  }, [tab, teamId, loadApprovals]);

  const loadProjects = useCallback(async () => {
    if (!teamId) return;
    setProjectsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'teams', teamId, 'projects'));
      const list: TeamProject[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: x.name as string,
          client: typeof x.client === 'string' ? x.client : '',
          archived: Boolean(x.archived),
          createdAt: x.createdAt as Timestamp,
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setTeamProjects(list);
    } finally {
      setProjectsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (tab === 'projects' && teamId) void loadProjects();
  }, [tab, teamId, loadProjects]);

  const loadPermMembers = useCallback(async () => {
    if (!teamId) return;
    setPermLoading(true);
    try {
      const snap = await getDocs(collection(db, 'teams', teamId, 'members'));
      const list: PermRow[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          userId: d.id,
          displayName: (x.displayName as string) ?? d.id,
          email: (x.email as string) ?? '',
          role: (x.role as MemberRole) ?? 'member',
          permissions: parseMemberPermissions(x.permissions),
        };
      });
      list.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setPermRows(list);
    } finally {
      setPermLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (tab === 'permissions' && teamId && isAdmin) void loadPermMembers();
  }, [tab, teamId, isAdmin, loadPermMembers]);

  function openPermModal(row: PermRow) {
    const p = row.permissions;
    const base = emptyCustomModules();
    if (!p.fullAccess) {
      for (const k of APP_MODULE_ORDER) {
        if (p.modules[k] === true) base[k] = true;
      }
    } else {
      for (const k of APP_MODULE_ORDER) base[k] = true;
    }
    setPermModal({
      userId: row.userId,
      displayName: row.displayName,
      role: row.role,
      fullAccess: p.fullAccess,
      modules: base,
    });
    setError('');
  }

  async function savePermModal() {
    if (!teamId || !user || !permModal) return;
    if (!permModal.fullAccess) {
      const anyOn = APP_MODULE_ORDER.some((m) => {
        if (permModal.role === 'member' && LEAD_ONLY_MODULES.includes(m)) return false;
        return permModal.modules[m];
      });
      if (!anyOn) {
        setError('Enable at least one module, or choose Full access.');
        return;
      }
    }
    setPermPending(true);
    setError('');
    try {
      const modulesOut: Partial<Record<AppModule, boolean>> = {};
      if (!permModal.fullAccess) {
        for (const k of APP_MODULE_ORDER) {
          if (permModal.role === 'member' && LEAD_ONLY_MODULES.includes(k)) continue;
          if (permModal.modules[k]) modulesOut[k] = true;
        }
      }
      await updateDoc(doc(db, 'teams', teamId, 'members', permModal.userId), {
        permissions: permModal.fullAccess
          ? { fullAccess: true, modules: {} }
          : { fullAccess: false, modules: modulesOut },
      });
      await appendAuditLog(teamId, user.uid, 'member_permissions_updated', {
        memberUid: permModal.userId,
        fullAccess: permModal.fullAccess,
        modules: modulesOut,
      });
      const editedSelf = permModal.userId === user.uid;
      setPermModal(null);
      await loadPermMembers();
      if (editedSelf) await refreshTeam();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save permissions');
    } finally {
      setPermPending(false);
    }
  }

  function buildWeeklySchedulePayload(): WeeklyExpectedStartMap | null {
    const out: WeeklyExpectedStartMap = {};
    for (const k of ['0', '1', '2', '3', '4', '5', '6'] as const) {
      const v = weeklyDraft[k];
      if (!v?.h?.trim()) continue;
      const h = Number.parseInt(v.h, 10);
      const mi = Number.parseInt(v.m?.trim() ? v.m : '0', 10);
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) out[k] = { hour: h, minute: mi };
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  async function approvePtoRequest(req: ApprovalDoc) {
    if (!teamId || !user || !canLeadMutate || req.status !== 'pending') return;
    setError('');
    try {
      const batch = writeBatch(db);
      const aref = doc(db, 'teams', teamId, 'approvalRequests', req.id);
      const toRef = doc(collection(db, 'teams', teamId, 'timeOff'));
      batch.update(aref, {
        status: 'approved',
        reviewedByUid: user.uid,
        reviewedAt: Timestamp.now(),
      });
      batch.set(toRef, {
        dateId: req.dateId,
        kind: 'pto',
        userId: req.requesterUid,
        label: req.label,
        createdAt: Timestamp.now(),
      });
      await batch.commit();
      await appendAuditLog(teamId, user.uid, 'pto_request_approved', { requestId: req.id, dateId: req.dateId });
      await loadApprovals();
      await loadTimeOff();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed');
    }
  }

  async function rejectPtoRequest(req: ApprovalDoc) {
    if (!teamId || !user || !canLeadMutate || req.status !== 'pending') return;
    setError('');
    try {
      await updateDoc(doc(db, 'teams', teamId, 'approvalRequests', req.id), {
        status: 'rejected',
        reviewedByUid: user.uid,
        reviewedAt: Timestamp.now(),
      });
      await appendAuditLog(teamId, user.uid, 'pto_request_rejected', { requestId: req.id });
      await loadApprovals();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed');
    }
  }

  async function addTeamProject() {
    if (!teamId || !user || !isAdmin) return;
    const name = projName.trim();
    if (!name) {
      setError('Project name is required');
      return;
    }
    setProjPending(true);
    setError('');
    try {
      await addDoc(collection(db, 'teams', teamId, 'projects'), {
        name,
        client: projClient.trim(),
        archived: false,
        createdAt: serverTimestamp(),
      });
      await appendAuditLog(teamId, user.uid, 'project_created', { name });
      setProjName('');
      setProjClient('');
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add project');
    } finally {
      setProjPending(false);
    }
  }

  async function setProjectArchived(p: TeamProject, archived: boolean) {
    if (!teamId || !user || !isAdmin) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'projects', p.id), { archived });
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  }

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
        weeklySchedule: buildWeeklySchedulePayload(),
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
    if (!teamId || !user || !canLeadMutate) return;
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
    if (!teamId || !user || !canLeadMutate) return;
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
    if (isAdmin) base.push({ id: 'general', label: 'General' });
    base.push(
      { id: 'roster', label: 'Roster' },
      { id: 'directory', label: 'Directory' },
      { id: 'invite', label: 'Invite' },
      { id: 'timeoff', label: 'Time off' }
    );
    if (canManageTeam) base.push({ id: 'approvals', label: 'Approvals' });
    if (isAdmin) {
      base.push(
        { id: 'settings', label: 'Policies' },
        { id: 'projects', label: 'Projects' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'backup', label: 'Backup' }
      );
    }
    return base;
  }, [isAdmin, canManageTeam]);

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

          </div>
        </div>
      )}

      {tab === 'invite' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <h2 className="teams-panel-title">Invite teammates</h2>
            <p className="teams-panel-lede muted small">
              Share the join link or copy the team ID and invite code—new members use them on the join page.
            </p>
          </header>
          <TeamInviteSection />

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
                <input type="date" value={dateId} onChange={(e) => setDateId(e.target.value)} />
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-md"
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
                            <option value="auditor">Auditor</option>
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
                          {canLeadMutate && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAdjust(r)}>
                              Adjust
                            </button>
                          )}
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

      {tab === 'directory' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <h2 className="teams-panel-title">Member directory</h2>
            <p className="teams-panel-lede muted small">
              Roles and timezones. Members set timezone in Settings
            </p>
          </header>
          <div className="teams-directory-grid">
            {rows.map((r) => (
              <div key={r.userId} className="teams-directory-card">
                <p className="teams-directory-name">{r.displayName}</p>
                <p className="muted small">{r.email}</p>
                <p className="teams-directory-role">{r.role}</p>
                {r.timezone ? <p className="muted small">TZ: {r.timezone}</p> : <p className="muted small">Timezone not set</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head teams-panel-head--toolbar">
            <div>
              <h2 className="teams-panel-title">PTO requests</h2>
              <p className="teams-panel-lede muted small">Submitted from Settings. Approve to create PTO for that day.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadApprovals()}>
              Refresh
            </button>
          </header>
          {approvalLoading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : approvalRows.length === 0 ? (
            <p className="muted">No requests yet.</p>
          ) : (
            <ul className="teams-approval-list">
              {approvalRows.map((req) => (
                <li key={req.id} className="teams-approval-item">
                  <div>
                    <strong>{req.dateId}</strong> · {rows.find((x) => x.userId === req.requesterUid)?.displayName ?? req.requesterUid.slice(0, 8)}
                    {req.label ? ` · ${req.label}` : ''}
                    <span className={`teams-approval-status teams-approval-status--${req.status}`}>{req.status}</span>
                    {req.note ? <p className="muted small">{req.note}</p> : null}
                  </div>
                  {req.status === 'pending' && canLeadMutate && (
                    <div className="teams-row-actions">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => void approvePtoRequest(req)}>
                        Approve
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void rejectPtoRequest(req)}>
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'projects' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <h2 className="teams-panel-title">Projects</h2>
            <p className="teams-panel-lede muted small">Link timesheet lines to a project (name + default client).</p>
          </header>
          <div className="form teams-profile-form" style={{ maxWidth: '28rem' }}>
            <label>
              Name
              <input type="text" value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="e.g. Website redesign" />
            </label>
            <label>
              Default client (optional)
              <input type="text" value={projClient} onChange={(e) => setProjClient(e.target.value)} />
            </label>
            <div className="teams-actions">
              <button type="button" className="btn btn-primary" disabled={projPending} onClick={() => void addTeamProject()}>
                {projPending ? 'Adding…' : 'Add project'}
              </button>
            </div>
          </div>
          {projectsLoading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : (
            <ul className="teams-project-list">
              {teamProjects.map((p) => (
                <li key={p.id} className="teams-project-item">
                  <span>
                    <strong>{p.name}</strong>
                    {p.client ? ` · ${p.client}` : ''}
                    {p.archived ? <span className="muted small"> (archived)</span> : null}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setProjectArchived(p, !p.archived)}>
                    {p.archived ? 'Restore' : 'Archive'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'timeoff' && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <h2 className="teams-panel-title">Time off &amp; holidays</h2>
            <p className="teams-panel-lede muted small">Holidays: whole team. PTO: pick a member.</p>
          </header>
          {canLeadMutate ? (
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
          ) : (
            <p className="muted small teams-panel-loading">Read-only: time off is managed by admins and managers.</p>
          )}
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
                  {canLeadMutate && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeTimeOff(t.id)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'settings' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
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
            <p className="muted small teams-weekly-hint">
              Optional per weekday (0–23 / 0–59). Leave blank to use the default above for that day.
            </p>
            <div className="teams-weekly-grid">
              {(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const).map((label, i) => {
                const key = String(i);
                const v = weeklyDraft[key] ?? { h: '', m: '' };
                return (
                  <div key={key} className="teams-weekly-row">
                    <span className="teams-weekly-label">{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      placeholder="H"
                      aria-label={`${label} hour`}
                      value={v.h}
                      onChange={(e) =>
                        setWeeklyDraft((prev) => ({ ...prev, [key]: { ...v, h: e.target.value } }))
                      }
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      placeholder="M"
                      aria-label={`${label} minute`}
                      value={v.m}
                      onChange={(e) =>
                        setWeeklyDraft((prev) => ({ ...prev, [key]: { ...v, m: e.target.value } }))
                      }
                    />
                  </div>
                );
              })}
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

      {tab === 'permissions' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
            <div className="teams-perm-head">
              <Shield className="teams-perm-head__icon" size={22} strokeWidth={2} aria-hidden />
              <div>
                <h2 className="teams-panel-title">Permissions</h2>
                <p className="teams-panel-lede muted small">
                  Full access uses the default for their role. Custom limits which modules appear in the sidebar and which
                  routes open. Admins always have full access. Teams, Analytics, and Reports require a lead role (manager,
                  auditor, or admin) in addition to the module toggle.
                </p>
              </div>
            </div>
          </header>
          {permLoading ? (
            <p className="muted teams-panel-loading">Loading…</p>
          ) : (
            <div className="table-wrap teams-table-wrap">
              <table className="data-table teams-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Access</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {permRows.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <strong>{r.displayName}</strong>
                        <div className="muted small">{r.email}</div>
                      </td>
                      <td>{r.role}</td>
                      <td>
                        {r.role === 'admin' ? (
                          <span className="muted small">Full (admin)</span>
                        ) : r.permissions.fullAccess ? (
                          <span className="muted small">Full access</span>
                        ) : (
                          <span className="muted small">
                            Custom ({APP_MODULE_ORDER.filter((m) => r.permissions.modules[m] === true).length} modules)
                          </span>
                        )}
                      </td>
                      <td>
                        {r.role !== 'admin' && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openPermModal(r)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {permModal && (
        <div className="timesheet-modal-backdrop" role="presentation" onClick={() => !permPending && setPermModal(null)}>
          <div
            className="timesheet-modal timesheet-modal--wide card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="perm-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timesheet-modal__head">
              <h2 id="perm-modal-title" className="timesheet-modal__title">
                Permissions · {permModal.displayName}
              </h2>
              <button
                type="button"
                className="timesheet-modal__close btn btn-ghost btn-sm"
                disabled={permPending}
                onClick={() => setPermModal(null)}
                aria-label="Close"
              >
                <X size={22} strokeWidth={2} />
              </button>
            </div>
            {error && <p className="error timesheet-modal-error">{error}</p>}
            <div className="timesheet-modal-body">
              <fieldset className="teams-perm-fieldset">
                <legend className="sr-only">Access mode</legend>
                <label className="teams-perm-radio">
                  <input
                    type="radio"
                    name="perm-mode"
                    checked={permModal.fullAccess}
                    onChange={() => setPermModal((p) => (p ? { ...p, fullAccess: true } : null))}
                  />
                  <span>
                    <strong>Full access</strong>
                    <span className="muted small"> All modules allowed for this person&apos;s role.</span>
                  </span>
                </label>
                <label className="teams-perm-radio">
                  <input
                    type="radio"
                    name="perm-mode"
                    checked={!permModal.fullAccess}
                    onChange={() => setPermModal((p) => (p ? { ...p, fullAccess: false } : null))}
                  />
                  <span>
                    <strong>Custom</strong>
                    <span className="muted small"> Pick modules below.</span>
                  </span>
                </label>
              </fieldset>
              {!permModal.fullAccess && (
                <div className="teams-perm-check-grid">
                  {APP_MODULE_ORDER.map((mod) => {
                    const leadOnly = LEAD_ONLY_MODULES.includes(mod);
                    const disabled = permModal.role === 'member' && leadOnly;
                    return (
                      <label key={mod} className={`teams-perm-check${disabled ? ' teams-perm-check--disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={permModal.modules[mod]}
                          disabled={disabled}
                          onChange={(e) =>
                            setPermModal((p) =>
                              p ? { ...p, modules: { ...p.modules, [mod]: e.target.checked } } : null
                            )
                          }
                        />
                        <span>{APP_MODULE_LABELS[mod]}</span>
                        {disabled && <span className="muted small"> (needs lead role)</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="timesheet-modal__actions">
              <button type="button" className="btn btn-secondary" disabled={permPending} onClick={() => setPermModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={permPending} onClick={() => void savePermModal()}>
                {permPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'backup' && isAdmin && (
        <div className="card wide teams-tab-panel teams-panel">
          <header className="teams-panel-head">
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
