import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, Timestamp, updateDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { ArrowDownUp, ChevronLeft, FileSpreadsheet, FileText, FileType, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { attendanceRowPill } from '../lib/attendance';
import { formatDurationFromHours, formatLongDate, lastNDates, localDateId } from '../lib/date';
import {
  dayDisplayWorkLocation,
  dayHasOpenSession,
  dayHasPunches,
  entryWorkedHours,
  getOpenSession,
  getOpenSessionIndex,
  parseDayEntry,
  purgeLegacyDayEntryFields,
  sessionInOutLines,
} from '../lib/dayEntry';
import {
  buildHistoryExportRows,
  downloadHistoryCsv,
  downloadHistoryDoc,
  downloadHistoryPdf,
} from '../lib/historyExport';
import {
  HISTORY_CACHE_TTL_MS,
  HISTORY_LOOKBACK,
  type HistoryRow,
  historyRowsCacheKey,
  invalidateHistoryRowsCache,
  readHistoryRowsCache,
  writeHistoryRowsCache,
} from '../lib/historyRowsCache';
import { effectiveExpectedStartForDate } from '../lib/teamSettings';
import { pillTimeOffOpts, timeOffSetsForMember, type TimeOffDocLite } from '../lib/timeOffLookup';
import type { DayBreak, TimeOffKind } from '../types';

const INITIAL_CHUNK = 10;

function activeBreakIndex(breaks: DayBreak[]): number {
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (breaks[i]!.end == null) return i;
  }
  return -1;
}

function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

function suggestedClockOut(dateId: string, clockIn: Date): Date {
  const [y, m, d] = dateId.split('-').map(Number);
  const endOfDay = new Date(y, m - 1, d, 23, 59, 0, 0);
  const now = Date.now();
  const lower = clockIn.getTime() + 60 * 1000;
  const eightH = clockIn.getTime() + 8 * 60 * 60 * 1000;
  const upper = Math.min(endOfDay.getTime(), now);
  return new Date(Math.min(Math.max(eightH, lower), upper));
}

type HistoryFilter = 'all' | 'punched' | 'completed' | 'empty';
type SortDir = 'desc' | 'asc';

function filterRows(rows: HistoryRow[], f: HistoryFilter): HistoryRow[] {
  if (f === 'all') return rows;
  if (f === 'punched') return rows.filter((r) => dayHasPunches(r.entry));
  if (f === 'completed') {
    return rows.filter((r) => r.entry && dayHasPunches(r.entry) && !dayHasOpenSession(r.entry));
  }
  if (f === 'empty') return rows.filter((r) => !dayHasPunches(r.entry));
  return rows;
}

function sortRowsByDate(rows: HistoryRow[], dir: SortDir): HistoryRow[] {
  const sorted = [...rows].sort((a, b) => (a.dateId < b.dateId ? -1 : a.dateId > b.dateId ? 1 : 0));
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export function History() {
  const { user, teamId, teamSettings, memberScheduleOverride } = useAuth();
  const todayId = useMemo(() => localDateId(), []);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [timeOffRows, setTimeOffRows] = useState<TimeOffDocLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [, setLiveTick] = useState(0);
  const [resolveDateId, setResolveDateId] = useState<string | null>(null);
  const [clockOutLocal, setClockOutLocal] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);

  const dates = useMemo(() => lastNDates(HISTORY_LOOKBACK), []);

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

  const load = useCallback(async () => {
    if (!user || !teamId) {
      setLoading(false);
      return;
    }
    const key = historyRowsCacheKey(user.uid, teamId);
    const hit = readHistoryRowsCache(key);
    if (hit && Date.now() - hit.storedAt < HISTORY_CACHE_TTL_MS) {
      setRows(hit.rows);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    setLoading(true);
    setRows([]);
    let firstRows: HistoryRow[] = [];
    try {
      const first = dates.slice(0, INITIAL_CHUNK);
      const snaps1 = await Promise.all(
        first.map((d) => getDoc(doc(db, 'teams', teamId, 'days', d, 'entries', user.uid)))
      );
      firstRows = first.map((dateId, i) => ({
        dateId,
        entry: snaps1[i]!.exists() ? parseDayEntry(snaps1[i]!.data() as Record<string, unknown>) : null,
      }));
      setRows(firstRows);
    } finally {
      setLoading(false);
    }

    const rest = dates.slice(INITIAL_CHUNK);
    if (!rest.length) {
      writeHistoryRowsCache(key, firstRows);
      return;
    }
    setLoadingMore(true);
    try {
      const snaps2 = await Promise.all(
        rest.map((d) => getDoc(doc(db, 'teams', teamId, 'days', d, 'entries', user.uid)))
      );
      const rows2 = rest.map((dateId, i) => ({
        dateId,
        entry: snaps2[i]!.exists() ? parseDayEntry(snaps2[i]!.data() as Record<string, unknown>) : null,
      }));
      const merged = [...firstRows, ...rows2];
      setRows(merged);
      writeHistoryRowsCache(key, merged);
    } finally {
      setLoadingMore(false);
    }
  }, [user, teamId, dates]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasAnyOpenSession = useMemo(() => rows.some((r) => dayHasOpenSession(r.entry)), [rows]);

  useEffect(() => {
    if (!hasAnyOpenSession) return;
    const id = window.setInterval(() => setLiveTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasAnyOpenSession]);

  useEffect(() => {
    if (!resolveDateId) return;
    const row = rows.find((r) => r.dateId === resolveDateId);
    if (!row?.entry || !getOpenSession(row.entry)) {
      setResolveDateId(null);
    }
  }, [resolveDateId, rows]);

  const displayRows = useMemo(() => {
    const f = filterRows(rows, filter);
    return sortRowsByDate(f, sortDir);
  }, [rows, filter, sortDir]);

  const { holidays, pto } = useMemo(
    () => timeOffSetsForMember(timeOffRows, user?.uid ?? ''),
    [timeOffRows, user?.uid]
  );

  const exportRows = useMemo(
    () =>
      buildHistoryExportRows(displayRows, todayId, teamSettings, memberScheduleOverride, holidays, pto),
    [displayRows, todayId, teamSettings, memberScheduleOverride, holidays, pto]
  );

  const exportBase = useMemo(() => {
    const d = new Date();
    return `zenteams-history-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const closeResolveModal = useCallback(() => {
    setResolveDateId(null);
    setResolveError('');
  }, []);

  const confirmResolveOpen = useCallback(async () => {
    if (!user || !teamId || !resolveDateId) return;
    const parsed = new Date(clockOutLocal);
    if (Number.isNaN(parsed.getTime())) {
      setResolveError('Enter a valid date and time.');
      return;
    }
    setResolveBusy(true);
    setResolveError('');
    try {
      const ref = doc(db, 'teams', teamId, 'days', resolveDateId, 'entries', user.uid);
      const snap = await getDoc(ref);
      const entry = snap.exists() ? parseDayEntry(snap.data() as Record<string, unknown>) : null;
      const si = getOpenSessionIndex(entry);
      if (si < 0 || !entry) {
        setResolveError('This day no longer has an open shift.');
        return;
      }
      const clockInMs = entry.sessions[si]!.clockIn.toMillis();
      if (parsed.getTime() <= clockInMs) {
        setResolveError('Clock-out must be after clock-in.');
        return;
      }
      if (parsed.getTime() > Date.now() + 60_000) {
        setResolveError('Clock-out cannot be in the future.');
        return;
      }
      const outTs = Timestamp.fromDate(parsed);
      const sessions = entry.sessions.map((s, i) => {
        if (i !== si) return s;
        let breaks = s.breaks;
        const bi = activeBreakIndex(breaks);
        if (bi >= 0) {
          breaks = breaks.map((b, j) => (j === bi ? { ...b, end: outTs } : b));
        }
        return { ...s, clockOut: outTs, breaks };
      });
      await updateDoc(ref, {
        sessions,
        updatedAt: outTs,
        ...purgeLegacyDayEntryFields(),
      });
      invalidateHistoryRowsCache(user.uid, teamId);
      const after = await getDoc(ref);
      const newEntry = after.exists() ? parseDayEntry(after.data() as Record<string, unknown>) : null;
      setRows((prev) => prev.map((r) => (r.dateId === resolveDateId ? { ...r, entry: newEntry } : r)));
      setResolveDateId(null);
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setResolveBusy(false);
    }
  }, [user, teamId, resolveDateId, clockOutLocal]);

  return (
    <div className="page history-page">
      <header className="page-header">
        <Link to="/today" className="history-back">
          <ChevronLeft size={20} strokeWidth={2} aria-hidden />
          Back to attendance
        </Link>
        <h1>History</h1>
        <p className="page-sub">
          Your punches for the last {HISTORY_LOOKBACK} days (local dates). Filter, sort, and export what you see
          below.
        </p>
      </header>

      <div className="card wide history-card">
        <div className="history-toolbar">
          <div className="history-toolbar__filters">
            <label className="history-field">
              <span className="history-field__label">Show</span>
              <select
                className="history-select"
                value={filter}
                onChange={(e) => setFilter(e.target.value as HistoryFilter)}
                aria-label="Filter rows"
              >
                <option value="all">All days</option>
                <option value="punched">Days with a clock-in</option>
                <option value="completed">Completed shifts</option>
                <option value="empty">No punches</option>
              </select>
            </label>
            <label className="history-field">
              <span className="history-field__label">Sort</span>
              <select
                className="history-select"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as SortDir)}
                aria-label="Sort by date"
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
            <span className="history-toolbar__meta muted small">
              <ArrowDownUp size={14} aria-hidden />
              {displayRows.length} row{displayRows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="history-toolbar__exports">
            <button
              type="button"
              className="btn btn-secondary btn-sm history-export-btn"
              disabled={!exportRows.length}
              onClick={() => downloadHistoryCsv(exportRows, exportBase)}
            >
              <FileSpreadsheet size={16} aria-hidden />
              CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm history-export-btn"
              disabled={!exportRows.length}
              onClick={() => downloadHistoryPdf(exportRows, 'ZenTeams — attendance history', exportBase)}
            >
              <FileType size={16} aria-hidden />
              PDF
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm history-export-btn"
              disabled={!exportRows.length}
              onClick={() => downloadHistoryDoc(exportRows, exportBase)}
            >
              <FileText size={16} aria-hidden />
              Word
            </button>
          </div>
        </div>

        {loading && !rows.length ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="history-table-wrap">
              <table className="data-table history-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">In</th>
                    <th scope="col">Out</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ dateId, entry }) => {
                    const to = pillTimeOffOpts(dateId, holidays, pto);
                    const expRow = effectiveExpectedStartForDate(dateId, teamSettings, memberScheduleOverride);
                    const pill = attendanceRowPill(
                      dateId,
                      todayId,
                      entry,
                      expRow.hour,
                      expRow.minute,
                      to.isTeamHoliday || to.isMemberPto ? to : undefined
                    );
                    const nowForRow = new Date();
                    const { clockIns, clockOuts } = sessionInOutLines(entry);
                    const duration =
                      entry && dayHasPunches(entry)
                        ? formatDurationFromHours(entryWorkedHours(entry, nowForRow))
                        : '—';
                    const wl = dayDisplayWorkLocation(entry);
                    const loc = wl === 'office' ? 'Office' : wl === 'remote' ? 'Remote' : '—';
                    const isPastOpen = Boolean(entry && dayHasOpenSession(entry) && dateId !== todayId);

                    return (
                      <tr key={dateId} className={dateId === todayId ? 'history-table__today' : undefined}>
                        <td className="history-table__date">{formatLongDate(dateId)}</td>
                        <td>
                          <div className="attendance-time-stack">
                            {clockIns.map((t, i) => (
                              <span key={`in-${i}`} className="attendance-time-stack__line">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className="attendance-time-stack">
                            {clockOuts.map((t, i) => (
                              <span key={`out-${i}`} className="attendance-time-stack__line">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="history-table__num">{duration}</td>
                        <td>{loc}</td>
                        <td>
                          <div className="history-status-cell">
                            <span className={`attendance-pill attendance-pill--${pill.variant}`}>{pill.label}</span>
                            {isPastOpen && entry && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm history-open-resolve-btn"
                                onClick={() => {
                                  const o = getOpenSession(entry);
                                  if (!o) return;
                                  setClockOutLocal(
                                    toDatetimeLocalValue(suggestedClockOut(dateId, o.clockIn.toDate()))
                                  );
                                  setResolveError('');
                                  setResolveDateId(dateId);
                                }}
                              >
                                Set clock-out
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {displayRows.length === 0 && !loading && (
              <p className="muted history-empty">No rows match this filter.</p>
            )}
            {loadingMore && <p className="muted small history-loading-more">Loading older days…</p>}
          </>
        )}
      </div>

      {resolveDateId && (
        <div className="timesheet-modal-backdrop" role="presentation" onClick={closeResolveModal}>
          <div
            className="timesheet-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-resolve-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timesheet-modal__head">
              <h2 id="history-resolve-title" className="timesheet-modal__title">
                Close open shift
              </h2>
              <button
                type="button"
                className="timesheet-modal__close btn btn-ghost btn-sm"
                onClick={closeResolveModal}
              >
                <X size={22} strokeWidth={2} aria-label="Close" />
              </button>
            </div>
            {resolveError && <p className="error timesheet-modal-error">{resolveError}</p>}
            <div className="timesheet-modal-body">
              <p className="muted small history-resolve-lede">
                You left a shift open on {formatLongDate(resolveDateId)}. Set when you finished; any open break on
                that shift ends at the same time.
              </p>
              <label className="history-resolve-field">
                <span className="history-field__label">Clock-out</span>
                <input
                  type="datetime-local"
                  className="history-resolve-datetime"
                  value={clockOutLocal}
                  disabled={resolveBusy}
                  onChange={(e) => setClockOutLocal(e.target.value)}
                />
              </label>
            </div>
            <div className="timesheet-modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={resolveBusy}
                onClick={closeResolveModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={resolveBusy}
                onClick={() => void confirmResolveOpen()}
              >
                {resolveBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
