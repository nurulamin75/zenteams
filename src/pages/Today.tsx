import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { doc, getDoc, onSnapshot, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { Coffee, Hourglass, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { attendanceRowPill } from '../lib/attendance';
import { entryWorkedHours, grossShiftMs, parseDayEntry } from '../lib/dayEntry';
import { formatDurationFromHours, formatLongDate, formatTime, lastNDates, localDateId } from '../lib/date';
import { invalidateHistoryRowsCache } from '../lib/historyRowsCache';
import type { DayBreak, DayEntry, WorkLocation } from '../types';

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
  const { user, teamId } = useAuth();
  const dateId = useMemo(() => localDateId(), []);
  const tableDateIds = useMemo(() => lastNDates(TABLE_DAYS), []);

  const [entry, setEntry] = useState<DayEntry | null>(null);
  const entryLatest = useRef<DayEntry | null>(null);
  const [entryMap, setEntryMap] = useState<Map<string, DayEntry | null>>(new Map());
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [tick, setTick] = useState(0);
  const [weekWorkedHours, setWeekWorkedHours] = useState<number | null>(null);

  const entryRef =
    user && teamId ? doc(db, 'teams', teamId, 'days', dateId, 'entries', user.uid) : null;

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
            if (i < WEEK_SUM_DAYS && e?.clockIn) weekSum += entryWorkedHours(e, staleNow);
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

  const openShiftTickKey =
    entry?.clockIn && !entry.clockOut ? entry.clockIn.toMillis() : null;

  useEffect(() => {
    if (openShiftTickKey == null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [openShiftTickKey]);

  const now = useMemo(() => new Date(), [tick]);

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
      const ts = Timestamp.now();
      await setDoc(
        entryRef!,
        {
          clockIn: ts,
          clockOut: null,
          breaks: [],
          workLocation: loc,
          updatedAt: ts,
        },
        { merge: true }
      );
    });
  }

  async function startBreak() {
    await write(async () => {
      const prev = entryLatest.current;
      if (!prev?.clockIn || prev.clockOut) return;
      const breaks = [...prev.breaks, { start: Timestamp.now(), end: null }];
      await updateDoc(entryRef!, { breaks, updatedAt: Timestamp.now() });
    });
  }

  async function endBreak() {
    await write(async () => {
      const prev = entryLatest.current;
      if (!prev?.clockIn || prev.clockOut) return;
      const idx = activeBreakIndex(prev.breaks);
      if (idx < 0) return;
      const breaks = prev.breaks.map((b, i) =>
        i === idx ? { ...b, end: Timestamp.now() } : b
      );
      await updateDoc(entryRef!, { breaks, updatedAt: Timestamp.now() });
    });
  }

  async function clockOut() {
    await write(async () => {
      const prev = entryLatest.current;
      if (!prev?.clockIn || prev.clockOut) return;
      let breaks = prev.breaks;
      const idx = activeBreakIndex(breaks);
      if (idx >= 0) {
        breaks = breaks.map((b, i) => (i === idx ? { ...b, end: Timestamp.now() } : b));
      }
      await updateDoc(entryRef!, {
        clockOut: Timestamp.now(),
        breaks,
        updatedAt: Timestamp.now(),
      });
    });
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!teamId) return <Navigate to="/onboarding" replace />;

  const onBreak = entry ? activeBreakIndex(entry.breaks) >= 0 : false;
  const working = Boolean(entry?.clockIn && !entry.clockOut);
  const canClockIn = !working;
  const liveElapsedMs =
    entry?.clockIn && !entry.clockOut ? grossShiftMs(entry, now) : 0;
  const netToday =
    entry?.clockIn ? formatDurationFromHours(entryWorkedHours(entry, now)) : null;

  const locLabel =
    entry?.workLocation === 'office'
      ? 'Office'
      : entry?.workLocation === 'remote'
        ? 'Remote'
        : null;

  const pageBusy = snapshotLoading;

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
          ) : entry?.clockOut ? (
            <p className="attendance-hero__status-line muted">You&apos;re done for today</p>
          ) : (
            <p className="attendance-hero__status-line muted">You haven&apos;t clocked in today</p>
          )}
        </div>

        <div className="attendance-hero__actions">
          {canClockIn ? (
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
                  const pill = attendanceRowPill(rowId, dateId, rowEntry);
                  const nowForRow = rowId === dateId ? now : new Date();
                  const duration =
                    rowEntry?.clockIn
                      ? rowEntry.clockOut
                        ? formatDurationFromHours(entryWorkedHours(rowEntry, nowForRow))
                        : formatDurationFromHours(grossShiftMs(rowEntry, nowForRow) / (1000 * 60 * 60))
                      : '—';
                  const outDisplay =
                    rowEntry?.clockIn && !rowEntry.clockOut ? '—' : formatTime(rowEntry?.clockOut ?? null);

                  return (
                    <tr key={rowId} className={rowId === dateId ? 'attendance-table__today' : undefined}>
                      <td className="attendance-table__day">{formatLongDate(rowId)}</td>
                      <td>{formatTime(rowEntry?.clockIn ?? null)}</td>
                      <td className="attendance-table__out">{outDisplay}</td>
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
          Status uses <strong>9:00 AM</strong> local on each day: on time = Present, after = Late.
        </p>
      </section>
    </div>
  );
}
