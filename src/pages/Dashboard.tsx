import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ClockCheck, History, TrendingUp, UserPlus, Users } from 'lucide-react';
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
import { entryWorkedHours, parseDayEntry } from '../lib/dayEntry';
import { formatTime, lastNDates, localDateId } from '../lib/date';
import type { DayBreak, DayEntry } from '../types';

function activeBreakIndex(breaks: DayBreak[]): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (breaks[i]!.end == null) return i;
  }
  return -1;
}

function todayStatus(entry: DayEntry | null): 'out' | 'in' | 'break' | 'done' {
  if (!entry || !entry.clockIn) return 'out';
  if (entry.clockOut) return 'done';
  if (activeBreakIndex(entry.breaks) >= 0) return 'break';
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
        if (d !== dateId && entry.clockIn && !entry.clockOut) {
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
          if (entry.clockIn && !entry.clockOut) clockedIn += 1;
          if (entry.clockOut) clockedOut += 1;
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
    if (!todayEntry?.clockIn || todayEntry.clockOut) return false;
    const policyH = teamSettings.policies.autoClockOutHours;
    const threshold =
      typeof policyH === 'number' && policyH > 0 ? policyH : 14;
    const ms = Date.now() - todayEntry.clockIn.toMillis();
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

  return (
    <div className="page dashboard-page">
      <header className="dashboard-welcome dashboard-welcome--minimal">
        <div className="dashboard-welcome-copy">
          <h1>
            {greeting}, {memberDisplayName ?? user?.displayName ?? 'there'}
          </h1>
          <p className="dashboard-welcome-sub">{teamName ? `${teamName}` : 'Your workspace'}</p>
        </div>
      </header>

      {(role === 'admin' || role === 'manager') && (
        <div className="dashboard-stats" role="region" aria-label="Team overview for today">
          {dataLoading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card dashboard-stat-card dashboard-surface" aria-hidden>
                  <div className="dashboard-stat-body">
                    <div className="skeleton skeleton-line skeleton-stat-label" />
                    <div className="skeleton skeleton-line skeleton-stat-value" />
                  </div>
                  <div className="skeleton skeleton-stat-icon" />
                </div>
              ))}
            </>
          ) : (
            teamStats && (
              <>
                <div className="card dashboard-stat-card dashboard-surface">
                  <div className="dashboard-stat-body">
                    <span className="dashboard-stat-label">Total members</span>
                    <span className="dashboard-stat-value dashboard-stat-value--members">
                      {teamStats.totalMembers}
                    </span>
                  </div>
                  <Users className="dashboard-stat-icon dashboard-stat-icon--members" size={28} strokeWidth={1.75} />
                </div>
                <div className="card dashboard-stat-card dashboard-surface">
                  <div className="dashboard-stat-body">
                    <span className="dashboard-stat-label">Clocked in</span>
                    <span className="dashboard-stat-value dashboard-stat-value--in">
                      {teamStats.clockedIn}
                    </span>
                  </div>
                  <Clock className="dashboard-stat-icon dashboard-stat-icon--in" size={28} strokeWidth={1.75} />
                </div>
                <div className="card dashboard-stat-card dashboard-surface">
                  <div className="dashboard-stat-body">
                    <span className="dashboard-stat-label">Clocked out</span>
                    <span className="dashboard-stat-value dashboard-stat-value--out">
                      {teamStats.clockedOut}
                    </span>
                  </div>
                  <ClockCheck className="dashboard-stat-icon dashboard-stat-icon--out" size={28} strokeWidth={1.75} />
                </div>
                <div className="card dashboard-stat-card dashboard-surface">
                  <div className="dashboard-stat-body">
                    <span className="dashboard-stat-label">Hours today</span>
                    <span className="dashboard-stat-value dashboard-stat-value--hours">
                      {teamStats.hoursToday}
                    </span>
                  </div>
                  <TrendingUp className="dashboard-stat-icon dashboard-stat-icon--hours" size={28} strokeWidth={1.75} />
                </div>
              </>
            )
          )}
        </div>
      )}

      {(staleOpenShiftDateId || longOpenToday) && (
        <div className="dashboard-notice dashboard-notice--warn" role="status">
          {staleOpenShiftDateId ? (
            <p className="dashboard-notice__text">
              You still have an <strong>open shift</strong> on {staleOpenShiftDateId}. Finish it on{' '}
              <Link to="/history">History</Link> or ask a team lead to correct the entry.
            </p>
          ) : (
            <p className="dashboard-notice__text">
              You&apos;ve been clocked in a long time today. If you&apos;re done, clock out on{' '}
              <Link to="/today">Attendance</Link>.
            </p>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        <section className="card dashboard-card dashboard-surface">
          <div className="dashboard-card-head">
            <Clock size={20} strokeWidth={2} />
            <h2>Today</h2>
          </div>
          <p className="dashboard-card-meta">{dateId}</p>
          {dataLoading ? (
            <div className="dashboard-skeleton-block" aria-hidden>
              <div className="skeleton skeleton-pill" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>
          ) : (
            <>
              <div className={`status-pill status-${status} dashboard-status`}>{statusLabel}</div>
              {todayEntry?.clockIn && (
                <ul className="dashboard-mini-list">
                  <li>
                    In {formatTime(todayEntry.clockIn)}
                    {todayEntry.workLocation && ` · ${todayEntry.workLocation === 'office' ? 'Office' : 'Remote'}`}
                  </li>
                  {todayEntry.clockOut && <li>Out {formatTime(todayEntry.clockOut)}</li>}
                </ul>
              )}
            </>
          )}
          <Link to="/today" className="btn btn-primary dashboard-card-cta">
            {dataLoading ? 'Open attendance' : status === 'out' ? 'Clock in' : 'Open attendance'}
          </Link>
        </section>

        <section className="card dashboard-card dashboard-surface">
          <div className="dashboard-card-head">
            <History size={20} strokeWidth={2} />
            <h2>Recent days</h2>
          </div>
          {dataLoading ? (
            <ul className="dashboard-recent-list dashboard-skeleton-list" aria-hidden>
              {[0, 1, 2].map((i) => (
                <li key={i}>
                  <span className="skeleton skeleton-line skeleton-recent-date" />
                  <span className="skeleton skeleton-line skeleton-recent-time" />
                </li>
              ))}
            </ul>
          ) : recent.length === 0 ? (
            <p className="muted small">No other days with punches in the last {RECENT_DAYS} days.</p>
          ) : (
            <ul className="dashboard-recent-list">
              {recent.map(({ dateId: d, entry: e }) => (
                <li key={d}>
                  <span className="dashboard-recent-date">{d}</span>
                  <span className="dashboard-recent-times">
                    {formatTime(e.clockIn)} – {formatTime(e.clockOut)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/history" className="dashboard-card-link">
            Full history →
          </Link>
        </section>

        <section className="card dashboard-card dashboard-surface">
          <div className="dashboard-card-head">
            <UserPlus size={20} strokeWidth={2} />
            <h2>Shortcuts</h2>
          </div>
          <ul className="dashboard-shortcuts">
            <li>
              <Link to="/today">Attendance</Link>
            </li>
            <li>
              <Link to="/history">History</Link>
            </li>
            <li>
              <Link to="/settings">Settings</Link>
            </li>
            {(role === 'admin' || role === 'manager') && (
              <>
                <li>
                  <Link to="/teams">Teams</Link>
                </li>
                <li>
                  <Link to="/analytics">Analytics</Link>
                </li>
              </>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
