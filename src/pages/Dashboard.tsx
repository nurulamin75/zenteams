import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock,
  ArrowRight,
  CalendarDays,
  Camera,
  Clock,
  ClockCheck,
  Pause,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { getDownloadURL, ref as sRef, uploadBytes } from 'firebase/storage';
import { updateProfile } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase/config';
import {
  dayFirstClockIn,
  dayHasOpenSession,
  dayHasPunches,
  dayLastClockOut,
  entryWorkedHours,
  getOpenSession,
  getOpenSessionIndex,
  openSessionGrossMs,
  parseDayEntry,
  purgeLegacyDayEntryFields,
} from '../lib/dayEntry';
import { formatDurationFromHours, formatLongDate, formatTime, lastNDates, localDateId } from '../lib/date';
import { invalidateHistoryRowsCache } from '../lib/historyRowsCache';
import type { DayBreak, DayEntry, MemberRole, WorkLocation, WorkSession } from '../types';

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;
const TARGET_HOURS = 8;

function activeBreakIndex(breaks: DayBreak[]): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (breaks[i]!.end == null) return i;
  }
  return -1;
}

function roleLabel(r: MemberRole | null | undefined): string {
  if (r === 'admin') return 'Administrator';
  if (r === 'manager') return 'Manager';
  if (r === 'auditor') return 'Auditor';
  return 'Team Member';
}

function dayLetter(dateId: string): string {
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dateId}T12:00:00`).getDay()]!;
}

function formatTrackerTime(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function todayStatus(entry: DayEntry | null): 'out' | 'in' | 'break' | 'done' {
  if (!entry || !dayHasPunches(entry)) return 'out';
  const open = getOpenSession(entry);
  if (!open) return 'done';
  if (activeBreakIndex(open.breaks) >= 0) return 'break';
  return 'in';
}

interface TeamTodayStats {
  totalMembers: number;
  clockedIn: number;
  clockedOut: number;
  hoursToday: number;
}

const RECENT_DAYS = 7;

export function Dashboard() {
  const { user, teamId, teamName, role, memberDisplayName, teamSettings } = useAuth();
  const dateId = useMemo(() => localDateId(), []);
  const [todayEntry, setTodayEntry] = useState<DayEntry | null>(null);
  const [recent, setRecent] = useState<{ dateId: string; entry: DayEntry }[]>([]);
  const [weekHoursData, setWeekHoursData] = useState<{ dateId: string; hours: number }[]>([]);
  const [staleOpenShiftDateId, setStaleOpenShiftDateId] = useState<string | null>(null);
  const [teamStats, setTeamStats] = useState<TeamTodayStats | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const [photoURL, setPhotoURL] = useState<string | null>(user?.photoURL ?? null);
  const [uploading, setUploading] = useState(false);
  const [clockActionPending, setClockActionPending] = useState(false);
  const [clockError, setClockError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPhotoURL(user?.photoURL ?? null);
  }, [user?.photoURL]);

  const load = useCallback(async () => {
    if (!user || !teamId) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    try {
      const dates = lastNDates(RECENT_DAYS);
      const entryReads = dates.map((d) =>
        getDoc(doc(db, 'teams', teamId, 'days', d, 'entries', user.uid))
      );
      const tail: Promise<QuerySnapshot>[] = [];
      if (role === 'admin' || role === 'manager' || role === 'auditor') {
        tail.push(getDocs(collection(db, 'teams', teamId, 'members')));
        tail.push(getDocs(collection(db, 'teams', teamId, 'days', dateId, 'entries')));
      }
      const snapshots = await Promise.all([...entryReads, ...tail]);
      const n = dates.length;
      const entrySnaps = snapshots.slice(0, n) as DocumentSnapshot[];
      let membersSnap: QuerySnapshot | null = null;
      let entriesSnap: QuerySnapshot | null = null;
      if ((role === 'admin' || role === 'manager' || role === 'auditor') && tail.length === 2) {
        membersSnap = snapshots[n] as QuerySnapshot;
        entriesSnap = snapshots[n + 1] as QuerySnapshot;
      }

      const todayIdx = dates.findIndex((d) => d === dateId);
      const todaySnap = entrySnaps[todayIdx >= 0 ? todayIdx : 0]!;
      setTodayEntry(
        todaySnap.exists() ? parseDayEntry(todaySnap.data() as Record<string, unknown>) : null
      );

      const recentList: { dateId: string; entry: DayEntry }[] = [];
      let staleOpen: string | null = null;
      const weekData: { dateId: string; hours: number }[] = [];
      const now = new Date();
      dates.forEach((d, i) => {
        const snap = entrySnaps[i]!;
        const entry = snap.exists() ? parseDayEntry(snap.data() as Record<string, unknown>) : null;
        weekData.push({
          dateId: d,
          hours: entry && dayHasPunches(entry) ? entryWorkedHours(entry, now) : 0,
        });
        if (!entry) return;
        if (d !== dateId && dayHasOpenSession(entry)) {
          if (!staleOpen || d < staleOpen) staleOpen = d;
        }
        if (d === dateId) return;
        recentList.push({ dateId: d, entry });
      });
      setRecent(recentList);
      setStaleOpenShiftDateId(staleOpen);
      setWeekHoursData([...weekData].reverse());

      if ((role === 'admin' || role === 'manager') && membersSnap && entriesSnap) {
        const now2 = new Date();
        let clockedIn = 0;
        let clockedOut = 0;
        let hoursSum = 0;
        for (const d of entriesSnap.docs) {
          const entry = parseDayEntry(d.data() as Record<string, unknown>);
          if (!entry) continue;
          if (dayHasOpenSession(entry)) clockedIn += 1;
          if (dayHasPunches(entry) && !dayHasOpenSession(entry)) clockedOut += 1;
          hoursSum += entryWorkedHours(entry, now2);
        }
        setTeamStats({
          totalMembers: membersSnap.size,
          clockedIn,
          clockedOut,
          hoursToday: Math.round(hoursSum * 10) / 10,
        });
      } else {
        setTeamStats(null);
      }
    } finally {
      setDataLoading(false);
    }
  }, [user, teamId, dateId, role]);

  const longOpenToday = useMemo(() => {
    const open = todayEntry ? getOpenSession(todayEntry) : null;
    if (!open) return false;
    const policyH = teamSettings.policies.autoClockOutHours;
    const threshold = typeof policyH === 'number' && policyH > 0 ? policyH : 14;
    return Date.now() - open.clockIn.toMillis() > threshold * 3600_000;
  }, [todayEntry, teamSettings.policies.autoClockOutHours]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const open = todayEntry ? getOpenSession(todayEntry) : null;
    if (!open) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [todayEntry]);

  const weekHours = useMemo(() => {
    if (!weekHoursData.length) return weekHoursData;
    const now = new Date();
    return weekHoursData.map((d) => {
      if (d.dateId !== dateId) return d;
      return {
        ...d,
        hours: todayEntry && dayHasPunches(todayEntry) ? entryWorkedHours(todayEntry, now) : 0,
      };
    });
  }, [weekHoursData, todayEntry, dateId, tick]);

  const weekTotal = useMemo(() => weekHours.reduce((s, d) => s + d.hours, 0), [weekHours]);

  const todayWorkedMs = useMemo(() => {
    if (!todayEntry || !dayHasPunches(todayEntry)) return 0;
    return entryWorkedHours(todayEntry, new Date()) * 3_600_000;
  }, [todayEntry, tick]);

  const trackerOpenMs = useMemo(
    () => openSessionGrossMs(todayEntry, new Date()),
    [todayEntry, tick]
  );

  const status = todayStatus(todayEntry);
  const statusLabel =
    status === 'out'
      ? 'Not clocked in yet'
      : status === 'in'
        ? 'Working'
        : status === 'break'
          ? 'On break'
          : 'Finished for today';

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const r = sRef(storage, `profile-images/${user.uid}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await updateProfile(user, { photoURL: url });
      setPhotoURL(url);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  }

  async function handleClockIn(loc: WorkLocation) {
    if (!user || !teamId) return;
    setClockActionPending(true);
    setClockError('');
    try {
      const ref = doc(db, 'teams', teamId, 'days', dateId, 'entries', user.uid);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? parseDayEntry(snap.data() as Record<string, unknown>) : null;
      if (getOpenSessionIndex(existing) >= 0) return;
      const ts = Timestamp.now();
      const newSession: WorkSession = {
        clockIn: ts,
        clockOut: null,
        breaks: [],
        workLocation: loc,
        note: null,
        clockInGeo: null,
      };
      await setDoc(
        ref,
        { sessions: [...(existing?.sessions ?? []), newSession], updatedAt: ts, ...purgeLegacyDayEntryFields() },
        { merge: true }
      );
      invalidateHistoryRowsCache(user.uid, teamId);
      const after = await getDoc(ref);
      setTodayEntry(after.exists() ? parseDayEntry(after.data() as Record<string, unknown>) : null);
    } catch (e) {
      setClockError(e instanceof Error ? e.message : 'Clock-in failed');
    } finally {
      setClockActionPending(false);
    }
  }

  async function handleClockOut() {
    if (!user || !teamId) return;
    setClockActionPending(true);
    setClockError('');
    try {
      const ref = doc(db, 'teams', teamId, 'days', dateId, 'entries', user.uid);
      const snap = await getDoc(ref);
      const entry = snap.exists() ? parseDayEntry(snap.data() as Record<string, unknown>) : null;
      const si = getOpenSessionIndex(entry);
      if (si < 0 || !entry) return;
      const ts = Timestamp.now();
      const sessions = entry.sessions.map((s, i) => (i !== si ? s : { ...s, clockOut: ts }));
      await updateDoc(ref, { sessions, updatedAt: ts, ...purgeLegacyDayEntryFields() });
      invalidateHistoryRowsCache(user.uid, teamId);
      const after = await getDoc(ref);
      setTodayEntry(after.exists() ? parseDayEntry(after.data() as Record<string, unknown>) : null);
    } catch (e) {
      setClockError(e instanceof Error ? e.message : 'Clock-out failed');
    } finally {
      setClockActionPending(false);
    }
  }

  const ringProgress = Math.min(1, todayWorkedMs / (TARGET_HOURS * 3_600_000));

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div className="dashboard-hero__text">
          <h1 className="dashboard-hero__title">
            {greeting},{' '}
            <span className="dashboard-hero__name">{memberDisplayName ?? user?.displayName ?? 'there'}</span>
          </h1>
          <p className="dashboard-hero__sub">{teamName ?? 'Your workspace'}</p>
        </div>
      </header>

      {(role === 'admin' || role === 'manager' || role === 'auditor') && (
        <section className="card wide dashboard-team" aria-label="Team today">
          <p className="dashboard-team__eyebrow">Today · team</p>
          <div className="dashboard-team__grid">
            {dataLoading ? (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="dashboard-team__skel" aria-hidden>
                    <div className="skeleton skeleton-line skeleton-stat-label" />
                    <div className="skeleton skeleton-line skeleton-stat-value" />
                  </div>
                ))}
              </>
            ) : (
              teamStats && (
                <>
                  <div className="dashboard-team__stat">
                    <Users className="dashboard-team__glyph" size={18} strokeWidth={2} aria-hidden />
                    <div>
                      <span className="dashboard-team__label">Members</span>
                      <span className="dashboard-team__value">{teamStats.totalMembers}</span>
                    </div>
                  </div>
                  <div className="dashboard-team__stat">
                    <Clock className="dashboard-team__glyph" size={18} strokeWidth={2} aria-hidden />
                    <div>
                      <span className="dashboard-team__label">Clocked in</span>
                      <span className="dashboard-team__value dashboard-team__value--accent">
                        {teamStats.clockedIn}
                      </span>
                    </div>
                  </div>
                  <div className="dashboard-team__stat">
                    <ClockCheck className="dashboard-team__glyph" size={18} strokeWidth={2} aria-hidden />
                    <div>
                      <span className="dashboard-team__label">Clocked out</span>
                      <span className="dashboard-team__value">{teamStats.clockedOut}</span>
                    </div>
                  </div>
                  <div className="dashboard-team__stat">
                    <TrendingUp className="dashboard-team__glyph" size={18} strokeWidth={2} aria-hidden />
                    <div>
                      <span className="dashboard-team__label">Hours logged</span>
                      <span className="dashboard-team__value">{teamStats.hoursToday}</span>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        </section>
      )}

      {(staleOpenShiftDateId || longOpenToday) && (
        <div className="dashboard-alert" role="status">
          {staleOpenShiftDateId ? (
            <p className="dashboard-alert__text">
              You still have an <strong>open shift</strong> on {formatLongDate(staleOpenShiftDateId)}. Close it from{' '}
              <Link to="/history">attendance history</Link> or ask a team lead for help.
            </p>
          ) : (
            <p className="dashboard-alert__text">
              You&apos;ve been clocked in a long time today. When you&apos;re done, clock out on{' '}
              <Link to="/today">Attendance</Link>.
            </p>
          )}
        </div>
      )}

      <div className="dashboard-widgets">
        {/* Profile */}
        <section className="card dashboard-widget db-profile" aria-label="Your profile">
          <button
            type="button"
            className="db-profile__photo-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label="Change profile picture"
          >
            {photoURL ? (
              <img src={photoURL} alt={memberDisplayName ?? ''} className="db-profile__photo" />
            ) : (
              <div className="db-profile__initials-bg" aria-hidden>
                <span className="db-profile__initials">
                  {(memberDisplayName ?? user?.displayName ?? 'U')[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <span className="db-profile__photo-overlay" aria-hidden>
              <Camera size={22} strokeWidth={2} />
              {uploading ? 'Uploading…' : 'Change photo'}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void handlePhotoUpload(e)}
          />
          <div className="db-profile__pill">
            <div className="db-profile__pill-text">
              <p className="db-profile__name">{memberDisplayName ?? user?.displayName ?? 'You'}</p>
              <p className="db-profile__role">{roleLabel(role)}</p>
            </div>
          </div>
        </section>

        {/* Progress – weekly bar chart */}
        <section className="card dashboard-widget db-progress" aria-label="Weekly progress">
          <div className="db-progress__head">
            <div>
              <p className="db-progress__big">
                {dataLoading ? '—' : `${Math.round(weekTotal * 10) / 10}h`}
              </p>
              <p className="db-progress__sub muted small">Work time this week</p>
            </div>
          </div>
          <div className="db-progress__chart" aria-hidden>
            {dataLoading
              ? Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="db-progress__col">
                    <div className="db-progress__bar-wrap">
                      <div className="skeleton db-progress__bar-skel" />
                    </div>
                    <span className="db-progress__day">·</span>
                  </div>
                ))
              : (() => {
                  const maxH = Math.max(...weekHours.map((d) => d.hours), 1);
                  return weekHours.map(({ dateId: d, hours: h }) => {
                    const isToday = d === dateId;
                    const pct = h > 0 ? Math.max((h / maxH) * 100, 8) : 0;
                    return (
                      <div key={d} className={`db-progress__col${isToday ? ' db-progress__col--today' : ''}`}>
                        {isToday && h > 0 && (
                          <span className="db-progress__bubble">{formatDurationFromHours(h)}</span>
                        )}
                        <div className="db-progress__bar-wrap">
                          {h > 0 ? (
                            <div
                              className={`db-progress__bar${isToday ? ' db-progress__bar--today' : ''}`}
                              style={{ height: `${pct}%` }}
                            />
                          ) : (
                            <div className="db-progress__dot" />
                          )}
                        </div>
                        <span className="db-progress__day">{dayLetter(d)}</span>
                      </div>
                    );
                  });
                })()}
          </div>
        </section>

        {/* Time Tracker */}
        <section className="card dashboard-widget db-tracker" aria-label="Time tracker">
          <p className="db-tracker__title">Time tracker</p>
          <div className="db-tracker__ring-wrap">
            <svg className="db-tracker__ring" viewBox="0 0 120 120" aria-hidden>
              <circle
                className="db-tracker__ring-track"
                cx="60"
                cy="60"
                r={RING_R}
                fill="none"
                strokeWidth="9"
              />
              <circle
                className="db-tracker__ring-fill"
                cx="60"
                cy="60"
                r={RING_R}
                fill="none"
                strokeWidth="9"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - ringProgress)}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="db-tracker__center">
              <span className="db-tracker__time">
                {formatTrackerTime(status === 'in' || status === 'break' ? trackerOpenMs : todayWorkedMs)}
              </span>
              <span className="db-tracker__label muted small">
                {status === 'in' ? 'Session' : status === 'break' ? 'On break' : 'Today'}
              </span>
            </div>
          </div>

          {clockError && <p className="db-tracker__error error small">{clockError}</p>}

          {status === 'done' ? (
            <p className="db-tracker__done muted small">All done for today ✓</p>
          ) : status === 'in' || status === 'break' ? (
            <button
              type="button"
              className="btn btn-secondary db-tracker__clock-out-btn"
              disabled={clockActionPending}
              onClick={() => void handleClockOut()}
            >
              <Pause size={16} strokeWidth={2} aria-hidden />
              {clockActionPending ? 'Saving…' : 'Clock out'}
            </button>
          ) : (
            <div className="db-tracker__clock-in">
              <p className="db-tracker__clock-in-label muted small">Clock in as:</p>
              <div className="db-tracker__clock-in-btns">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={clockActionPending}
                  onClick={() => void handleClockIn('remote')}
                >
                  {clockActionPending ? '…' : 'Remote'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={clockActionPending}
                  onClick={() => void handleClockIn('office')}
                >
                  {clockActionPending ? '…' : 'Office'}
                </button>
              </div>
            </div>
          )}

          <Link to="/today" className="db-tracker__view-link muted small">
            <AlarmClock size={13} strokeWidth={2} aria-hidden />
            Open attendance
          </Link>
        </section>
      </div>

      <div className="dashboard-panels">
        <section className="card dashboard-panel">
          <header className="dashboard-panel__head">
            <CalendarDays className="dashboard-panel__icon" size={18} strokeWidth={2} aria-hidden />
            <div>
              <h2 className="dashboard-panel__title">{formatLongDate(dateId)}</h2>
            </div>
          </header>
          <div className="dashboard-panel__body">
            {dataLoading ? (
              <div className="dashboard-panel__skeleton" aria-hidden>
                <div className="skeleton skeleton-pill" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line dashboard-panel__skeleton-line--short" />
              </div>
            ) : (
              <>
                <div className={`dashboard-status-pill status-pill status-${status}`}>{statusLabel}</div>
                {todayEntry && dayHasPunches(todayEntry) && (
                  <ul className="dashboard-session-list">
                    {todayEntry.sessions.map((s, i) => (
                      <li key={i}>
                        <span className="dashboard-session-list__in">{formatTime(s.clockIn)}</span>
                        {s.workLocation && (
                          <span className="dashboard-session-list__loc">
                            {s.workLocation === 'office' ? 'Office' : 'Remote'}
                          </span>
                        )}
                        {s.clockOut ? (
                          <span className="dashboard-session-list__out">→ {formatTime(s.clockOut)}</span>
                        ) : (
                          <span className="dashboard-session-list__open">Open</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <Link to="/today" className="btn btn-primary dashboard-panel__cta">
            {dataLoading ? 'Open attendance' : status === 'out' ? 'Clock in' : 'Open attendance'}
          </Link>
        </section>

        <section className="card dashboard-panel">
          <header className="dashboard-panel__head">
            <Clock className="dashboard-panel__icon" size={18} strokeWidth={2} aria-hidden />
            <div>
              <h2 className="dashboard-panel__title">Recent activity</h2>
            </div>
          </header>
          <div className="dashboard-panel__body">
            {dataLoading ? (
              <ul className="dashboard-recent" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <li key={i} className="dashboard-recent__row">
                    <span className="skeleton skeleton-line dashboard-recent__skel-date" />
                    <span className="skeleton skeleton-line dashboard-recent__skel-time" />
                  </li>
                ))}
              </ul>
            ) : recent.length === 0 ? (
              <p className="dashboard-panel__empty muted small">No other punched days in this window.</p>
            ) : (
              <ul className="dashboard-recent">
                {recent.map(({ dateId: d, entry: e }) => {
                  const ci = dayFirstClockIn(e);
                  const co = dayLastClockOut(e);
                  return (
                    <li key={d} className="dashboard-recent__row">
                      <span className="dashboard-recent__date">{formatLongDate(d)}</span>
                      <span className="dashboard-recent__times muted">
                        {ci ? formatTime(ci) : '—'} – {co ? formatTime(co) : '—'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Link to="/history" className="dashboard-panel__link">
            Full history
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </Link>
        </section>
      </div>
    </div>
  );
}
