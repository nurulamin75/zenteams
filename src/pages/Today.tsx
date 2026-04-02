import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { Coffee, Hourglass, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { attendanceRowPill } from '../lib/attendance';
import {
  dayHasOpenSession,
  dayHasPunches,
  entryWorkedHours,
  getOpenSession,
  getOpenSessionIndex,
  openSessionGrossMs,
  parseDayEntry,
  purgeLegacyDayEntryFields,
  sessionInOutLines,
} from '../lib/dayEntry';
import {
  formatDurationFromHours,
  formatHourMinute,
  formatLongDate,
  lastNDates,
  localDateId,
} from '../lib/date';
import { invalidateHistoryRowsCache } from '../lib/historyRowsCache';
import { effectiveExpectedStart } from '../lib/teamSettings';
import { pillTimeOffOpts, timeOffSetsForMember, type TimeOffDocLite } from '../lib/timeOffLookup';
import type { ClockInGeo, DayBreak, DayEntry, TimeOffKind, WorkLocation, WorkSession } from '../types';

const TABLE_DAYS = 10;
const WEEK_SUM_DAYS = 7;

function activeBreakIndex(breaks: DayBreak[]): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (breaks[i]!.end == null) return i;
  }
  return -1;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function Today() {
  const { user, teamId, teamSettings, memberScheduleOverride } = useAuth();
  const dateId = useMemo(() => localDateId(), []);
  const tableDateIds = useMemo(() => lastNDates(TABLE_DAYS), []);

  const [entry, setEntry] = useState<DayEntry | null>(null);
  const entryLatest = useRef<DayEntry | null>(null);
  const [entryMap, setEntryMap] = useState<Map<string, DayEntry | null>>(new Map());
  const [timeOffRows, setTimeOffRows] = useState<TimeOffDocLite[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [weekWorkedHours, setWeekWorkedHours] = useState<number | null>(null);
  const [punchNote, setPunchNote] = useState('');
  const [includeGeoOnClockIn, setIncludeGeoOnClockIn] = useState(false);

  const entryRef =
    user && teamId ? doc(db, 'teams', teamId, 'days', dateId, 'entries', user.uid) : null;

  useEffect(() => {
    if (!teamId) return;
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'teams', teamId, 'timeOff'));
        setTimeOffRows(
          snap.docs.map((d) => {
            const x = d.data();
            return {
              dateId: x.dateId as string,
              kind: x.kind as TimeOffKind,
              userId: x.userId as string | undefined,
            };
          })
        );
      } catch {
        setTimeOffRows([]);
      }
    })();
  }, [teamId]);

  useEffect(() => {
    entryLatest.current = entry;
  }, [entry]);

  useEffect(() => {
    if (!entryRef) {
      setSnapshotLoading(false);
      return;
    }
    return onSnapshot(
      entryRef,
      (snap) => {
        setEntry(snap.exists() ? parseDayEntry(snap.data() as Record<string, unknown>) : null);
        setSnapshotLoading(false);
      },
      () => setSnapshotLoading(false)
    );
  }, [entryRef]);

  useEffect(() => {
    if (!user || !teamId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setTableLoading(true);
        try {
          const snaps = await Promise.all(
            tableDateIds.map((d) =>
              getDoc(doc(db, 'teams', teamId, 'days', d, 'entries', user.uid))
            )
          );
          if (cancelled) return;
          const map = new Map<string, DayEntry | null>();
          let weekSum = 0;
          const staleNow = new Date();
          for (let i = 0; i < tableDateIds.length; i++) {
            const id = tableDateIds[i]!;
            const e = snaps[i]!.exists() ? parseDayEntry(snaps[i]!.data() as Record<string, unknown>) : null;
            map.set(id, e);
            if (i < WEEK_SUM_DAYS && e && dayHasPunches(e)) weekSum += entryWorkedHours(e, staleNow);
          }
          setEntryMap(map);
          setWeekWorkedHours(weekSum);
        } catch {
          if (!cancelled) setWeekWorkedHours(null);
        } finally {
          if (!cancelled) setTableLoading(false);
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, teamId, tableDateIds]);

  const openShiftTickKey = (() => {
    const open = getOpenSession(entry);
    return open ? open.clockIn.toMillis() : null;
  })();

  useEffect(() => {
    if (openShiftTickKey == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [openShiftTickKey]);

  const now = useMemo(() => new Date(), [tick]);

  const expectedStart = useMemo(
    () => effectiveExpectedStart(teamSettings, memberScheduleOverride),
    [teamSettings, memberScheduleOverride]
  );

  const { holidays, pto } = useMemo(
    () => timeOffSetsForMember(timeOffRows, user?.uid ?? ''),
    [timeOffRows, user?.uid]
  );

  const mergedRows = useMemo(
    () =>
      tableDateIds.map((id) => ({
        dateId: id,
        entry: id === dateId ? entry : entryMap.get(id) ?? null,
      })),
    [tableDateIds, dateId, entry, entryMap]
  );

  const write = useCallback(
    async (fn: () => Promise<void>) => {
      if (!entryRef || !user || !teamId) return;
      setError('');
      setPending(true);
      try {
        await fn();
        invalidateHistoryRowsCache(user.uid, teamId);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed');
      } finally {
        setPending(false);
      }
    },
    [entryRef, user, teamId]
  );

  async function clockIn(loc: WorkLocation) {
    await write(async () => {
      const prev = entryLatest.current;
      const existing = prev?.sessions ?? [];
      if (getOpenSessionIndex(prev) >= 0) return;
      const ts = Timestamp.now();
      let clockInGeo: ClockInGeo | null = null;
      if (includeGeoOnClockIn && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              clockInGeo = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
              };
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 120_000 }
          );
        });
      }
      const noteTrim = punchNote.trim();
      const note = noteTrim.length > 0 ? noteTrim.slice(0, 500) : null;
      const newSession: WorkSession = {
        clockIn: ts,
        clockOut: null,
        breaks: [],
        workLocation: loc,
        note,
        clockInGeo,
      };
      await setDoc(
        entryRef!,
        {
          sessions: [...existing, newSession],
          updatedAt: ts,
          ...purgeLegacyDayEntryFields(),
        },
        { merge: true }
      );
    });
    setPunchNote('');
  }

  async function startBreak() {
    const prev = entryLatest.current;
    const oi = getOpenSessionIndex(prev);
    if (oi < 0) return;
    const open = prev!.sessions[oi]!;
    const minGap = teamSettings.policies.minBreakMinutesBetween;
    if (typeof minGap === 'number' && minGap > 0) {
      let lastEndMs = 0;
      for (const b of open.breaks) {
        if (b.end) lastEndMs = Math.max(lastEndMs, b.end.toMillis());
      }
      if (lastEndMs > 0 && Date.now() - lastEndMs < minGap * 60_000) {
        setError(`Team policy: wait at least ${minGap} minutes between breaks.`);
        return;
      }
    }
    await write(async () => {
      const cur = entryLatest.current;
      const idx = getOpenSessionIndex(cur);
      if (idx < 0) return;
      const sessions = cur!.sessions.map((s, i) =>
        i === idx ? { ...s, breaks: [...s.breaks, { start: Timestamp.now(), end: null }] } : s
      );
      await updateDoc(entryRef!, {
        sessions,
        updatedAt: Timestamp.now(),
        ...purgeLegacyDayEntryFields(),
      });
    });
  }

  async function endBreak() {
    await write(async () => {
      const prev = entryLatest.current;
      const si = getOpenSessionIndex(prev);
      if (si < 0) return;
      const open = prev!.sessions[si]!;
      const idx = activeBreakIndex(open.breaks);
      if (idx < 0) return;
      const sessions = prev!.sessions.map((s, i) => {
        if (i !== si) return s;
        const breaks = s.breaks.map((b, j) => (j === idx ? { ...b, end: Timestamp.now() } : b));
        return { ...s, breaks };
      });
      await updateDoc(entryRef!, {
        sessions,
        updatedAt: Timestamp.now(),
        ...purgeLegacyDayEntryFields(),
      });
    });
  }

  async function clockOut() {
    await write(async () => {
      const prev = entryLatest.current;
      const si = getOpenSessionIndex(prev);
      if (si < 0) return;
      const ts = Timestamp.now();
      const sessions = prev!.sessions.map((s, i) => {
        if (i !== si) return s;
        let breaks = s.breaks;
        const bi = activeBreakIndex(breaks);
        if (bi >= 0) {
          breaks = breaks.map((b, j) => (j === bi ? { ...b, end: ts } : b));
        }
        return { ...s, clockOut: ts, breaks };
      });
      await updateDoc(entryRef!, {
        sessions,
        updatedAt: ts,
        ...purgeLegacyDayEntryFields(),
      });
    });
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!teamId) return <Navigate to="/onboarding" replace />;

  const openSession = entry ? getOpenSession(entry) : null;
  const onBreak = openSession ? activeBreakIndex(openSession.breaks) >= 0 : false;
  const working = dayHasOpenSession(entry);
  const canClockIn = !working;
  const liveElapsedMs = working && !onBreak ? openSessionGrossMs(entry, now) : 0;
  const netToday =
    entry && dayHasPunches(entry) ? formatDurationFromHours(entryWorkedHours(entry, now)) : null;

  const locLabel =
    openSession?.workLocation === 'office'
      ? 'Office'
      : openSession?.workLocation === 'remote'
        ? 'Remote'
        : null;

  const pageBusy = snapshotLoading;

  const breakTooLong = useMemo(() => {
    if (!onBreak || !openSession) return false;
    const maxM = teamSettings.policies.maxBreakMinutes;
    if (typeof maxM !== 'number' || maxM <= 0) return false;
    const idx = activeBreakIndex(openSession.breaks);
    if (idx < 0) return false;
    const b = openSession.breaks[idx]!;
    return Date.now() - b.start.toMillis() > maxM * 60_000;
  }, [onBreak, openSession, teamSettings.policies.maxBreakMinutes, tick]);

  const shiftLongWarning = useMemo(() => {
    if (!working || !entry) return null;
    const policyH = teamSettings.policies.autoClockOutHours;
    const threshold =
      typeof policyH === 'number' && policyH > 0 ? policyH : 12;
    const grossH = openSessionGrossMs(entry, now) / (1000 * 60 * 60);
    if (grossH < threshold) return null;
    return { threshold, grossH };
  }, [working, entry, now, teamSettings.policies.autoClockOutHours]);

  return (
    <div className="page attendance-page">
      <div className="attendance-hero">
        <div className="attendance-hero__lead">
          <h1 className="attendance-hero__title">Attendance</h1>
          <p className="attendance-hero__meta">
            <span className="muted">{formatLongDate(dateId)}</span>
            {weekWorkedHours !== null && (
              <>
                <span className="attendance-hero__dot" aria-hidden>
                  ·
                </span>
                <span className="muted">
                  Last 7 days:{' '}
                  <strong className="attendance-hero__stat">{formatDurationFromHours(weekWorkedHours)}</strong>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="attendance-hero__status">
          {pageBusy ? (
            <p className="muted attendance-hero__status-line">Loading…</p>
          ) : working ? (
            onBreak ? (
              <p className="attendance-hero__status-line">
                On break
                {netToday && (
                  <span className="muted attendance-hero__net">
                    {' '}
                    · Net today {netToday}
                  </span>
                )}
              </p>
            ) : (
              <p className="attendance-hero__status-line">
                You are in for{' '}
                <span className="attendance-hero__timer">{formatElapsed(liveElapsedMs)}</span>
                {locLabel && (
                  <span className="attendance-loc-inline">
                    <MapPin size={15} aria-hidden />
                    {locLabel}
                  </span>
                )}
                {netToday && (
                  <span className="muted attendance-hero__net">
                    {' '}
                    · Net {netToday}
                  </span>
                )}
              </p>
            )
          ) : dayHasPunches(entry) ? (
            <p className="attendance-hero__status-line muted">
              You&apos;re clocked out — clock in again if you work more today.
            </p>
          ) : (
            <p className="attendance-hero__status-line muted">You haven&apos;t clocked in today</p>
          )}
        </div>

        <div className="attendance-hero__actions">
          {canClockIn ? (
            <div className="today-clock-in-stack">
              <label className="today-punch-note-label">
                <span className="muted small">Note (optional)</span>
                <textarea
                  className="today-punch-note"
                  rows={2}
                  maxLength={500}
                  value={punchNote}
                  onChange={(e) => setPunchNote(e.target.value)}
                  placeholder="Visible to you and team leads"
                  disabled={pending || pageBusy}
                />
              </label>
              <label className="today-geo-check muted small">
                <input
                  type="checkbox"
                  checked={includeGeoOnClockIn}
                  onChange={(e) => setIncludeGeoOnClockIn(e.target.checked)}
                  disabled={pending || pageBusy}
                />
                Save approximate location on clock-in
              </label>
              <div className="attendance-loc-btns">
                <button
                  type="button"
                  className="btn btn-primary attendance-loc-btns__btn"
                  disabled={pending || pageBusy}
                  onClick={() => void clockIn('office')}
                >
                  Office
                </button>
                <button
                  type="button"
                  className="btn btn-secondary attendance-loc-btns__btn"
                  disabled={pending || pageBusy}
                  onClick={() => void clockIn('remote')}
                >
                  Remote
                </button>
              </div>
            </div>
          ) : (
            <div className="attendance-inout-stack">
              {!onBreak ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost attendance-btn-break"
                    disabled={pending}
                    onClick={() => void startBreak()}
                  >
                    <Coffee size={17} aria-hidden />
                    Break
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary attendance-btn-inout"
                    disabled={pending}
                    onClick={() => void clockOut()}
                  >
                    <Hourglass size={18} strokeWidth={2} aria-hidden />
                    Clock out
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary attendance-btn-inout"
                    disabled={pending}
                    onClick={() => void endBreak()}
                  >
                    End break
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary attendance-btn-inout"
                    disabled={pending}
                    onClick={() => void clockOut()}
                  >
                    <Hourglass size={18} strokeWidth={2} aria-hidden />
                    Clock out
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {breakTooLong && (
        <p className="attendance-banner attendance-banner--warn" role="status">
          Your break is longer than the team&apos;s maximum. End break when you&apos;re ready.
        </p>
      )}
      {shiftLongWarning && (
        <p className="attendance-banner attendance-banner--warn" role="status">
          You&apos;ve been clocked in about {shiftLongWarning.grossH.toFixed(1)} hours (policy reminder after{' '}
          {shiftLongWarning.threshold}h). Please clock out if you&apos;re done.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      <section className="attendance-table-card" aria-labelledby="attendance-recent-heading">
        <div className="attendance-table-card__head">
          <h2 id="attendance-recent-heading" className="attendance-table-card__title">
            Recent days
          </h2>
          <Link to="/history" className="attendance-table-card__link">
            Full history
          </Link>
        </div>
        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead>
              <tr>
                <th scope="col">Day &amp; date</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading && entryMap.size === 0 ? (
                <tr>
                  <td colSpan={5} className="attendance-table__loading muted">
                    Loading…
                  </td>
                </tr>
              ) : (
                mergedRows.map(({ dateId: rowId, entry: rowEntry }) => {
                  const to = pillTimeOffOpts(rowId, holidays, pto);
                  const pill = attendanceRowPill(
                    rowId,
                    dateId,
                    rowEntry,
                    expectedStart.hour,
                    expectedStart.minute,
                    to.isTeamHoliday || to.isMemberPto ? to : undefined
                  );
                  const nowForRow = rowId === dateId ? now : new Date();
                  const { clockIns, clockOuts } = sessionInOutLines(rowEntry);
                  const duration =
                    rowEntry && dayHasPunches(rowEntry)
                      ? formatDurationFromHours(entryWorkedHours(rowEntry, nowForRow))
                      : '—';

                  return (
                    <tr key={rowId} className={rowId === dateId ? 'attendance-table__today' : undefined}>
                      <td className="attendance-table__day">{formatLongDate(rowId)}</td>
                      <td>
                        <div className="attendance-time-stack">
                          {clockIns.map((t, i) => (
                            <span key={`in-${i}`} className="attendance-time-stack__line">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="attendance-table__out">
                        <div className="attendance-time-stack">
                          {clockOuts.map((t, i) => (
                            <span key={`out-${i}`} className="attendance-time-stack__line">
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="attendance-table__dur">{duration}</td>
                      <td>
                        <span className={`attendance-pill attendance-pill--${pill.variant}`}>
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="attendance-table-foot muted small">
          Status uses <strong>{formatHourMinute(expectedStart.hour, expectedStart.minute)}</strong> local on each
          day: on time = Present, after = Late. Holidays / PTO override status when configured on the team.
        </p>
      </section>
    </div>
  );
}
