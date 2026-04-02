import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  ClockCheck,
  Link2,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  type DocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import {
  dayFirstClockIn,
  dayHasOpenSession,
  dayHasPunches,
  dayLastClockOut,
  entryWorkedHours,
  getOpenSession,
  parseDayEntry,
} from '../lib/dayEntry';
import { formatLongDate, formatTime, lastNDates, localDateId } from '../lib/date';
import type { DayBreak, DayEntry } from '../types';

function activeBreakIndex(breaks: DayBreak[]): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (breaks[i]!.end == null) return i;
  }
  return -1;
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

const RECENT_DAYS = 5;

export function Dashboard() {
  const { user, teamId, teamName, role, memberDisplayName, teamSettings } = useAuth();
  const dateId = useMemo(() => localDateId(), []);
  const [todayEntry, setTodayEntry] = useState<DayEntry | null>(null);
  const [recent, setRecent] = useState<{ dateId: string; entry: DayEntry }[]>([]);
  const [staleOpenShiftDateId, setStaleOpenShiftDateId] = useState<string | null>(null);
  const [teamStats, setTeamStats] = useState<TeamTodayStats | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

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
      if (role === 'admin' || role === 'manager') {
        tail.push(getDocs(collection(db, 'teams', teamId, 'members')));
        tail.push(getDocs(collection(db, 'teams', teamId, 'days', dateId, 'entries')));
      }
      const snapshots = await Promise.all([...entryReads, ...tail]);
      const n = dates.length;
      const entrySnaps = snapshots.slice(0, n) as DocumentSnapshot[];
      let membersSnap: QuerySnapshot | null = null;
      let entriesSnap: QuerySnapshot | null = null;
      if ((role === 'admin' || role === 'manager') && tail.length === 2) {
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
      dates.forEach((d, i) => {
        const snap = entrySnaps[i]!;
        if (!snap.exists()) return;
        const entry = parseDayEntry(snap.data() as Record<string, unknown>);
        if (!entry) return;
        if (d !== dateId && dayHasOpenSession(entry)) {
          if (!staleOpen || d < staleOpen) staleOpen = d;
        }
        if (d === dateId) return;
        recentList.push({ dateId: d, entry });
      });
      setRecent(recentList);
      setStaleOpenShiftDateId(staleOpen);

      if ((role === 'admin' || role === 'manager') && membersSnap && entriesSnap) {
        const now = new Date();
        let clockedIn = 0;
        let clockedOut = 0;
        let hoursSum = 0;
        for (const d of entriesSnap.docs) {
          const entry = parseDayEntry(d.data() as Record<string, unknown>);
          if (!entry) continue;
          if (dayHasOpenSession(entry)) clockedIn += 1;
          if (dayHasPunches(entry) && !dayHasOpenSession(entry)) clockedOut += 1;
          hoursSum += entryWorkedHours(entry, now);
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
    const threshold =
      typeof policyH === 'number' && policyH > 0 ? policyH : 14;
    const ms = Date.now() - open.clockIn.toMillis();
    return ms > threshold * 3600_000;
  }, [todayEntry, teamSettings.policies.autoClockOutHours]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const shortcutLinks = useMemo(() => {
    const base: { to: string; label: string }[] = [
      { to: '/today', label: 'Attendance' },
      { to: '/history', label: 'Attendance history' },
      { to: '/settings', label: 'Settings' },
    ];
    if (role === 'admin' || role === 'manager') {
      return [...base, { to: '/teams', label: 'Teams' }, { to: '/analytics', label: 'Analytics' }];
    }
    return base;
  }, [role]);

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

      {(role === 'admin' || role === 'manager') && (
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

      <div className="dashboard-panels">
        <section className="card dashboard-panel">
          <header className="dashboard-panel__head">
            <CalendarDays className="dashboard-panel__icon" size={18} strokeWidth={2} aria-hidden />
            <div>
              {/* <p className="dashboard-panel__eyebrow">Today</p> */}
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
              {/* <p className="dashboard-panel__eyebrow">Last {RECENT_DAYS} days</p> */}
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

        <section className="card dashboard-panel dashboard-panel--links">
          <header className="dashboard-panel__head">
            <Link2 className="dashboard-panel__icon" size={18} strokeWidth={2} aria-hidden />
            <div>
              {/* <p className="dashboard-panel__eyebrow">Navigate</p> */}
              <h2 className="dashboard-panel__title">Quick links</h2>
            </div>
          </header>
          <nav className="dashboard-links" aria-label="Quick links">
            <ul>
              {shortcutLinks.map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="dashboard-links__item">
                    <span>{label}</span>
                    <ArrowRight size={16} strokeWidth={2} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      </div>
    </div>
  );
}
