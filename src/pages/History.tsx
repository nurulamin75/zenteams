import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatTime, lastNDates } from '../lib/date';
import { parseDayEntry } from '../lib/dayEntry';
import {
  HISTORY_CACHE_TTL_MS,
  HISTORY_LOOKBACK,
  type HistoryRow,
  historyRowsCacheKey,
  readHistoryRowsCache,
  writeHistoryRowsCache,
} from '../lib/historyRowsCache';

const INITIAL_CHUNK = 10;

export function History() {
  const { user, teamId } = useAuth();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const dates = useMemo(() => lastNDates(HISTORY_LOOKBACK), []);

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

  return (
    <div className="page">
      <header className="page-header">
        <h1>History</h1>
        <p className="page-sub">Your punches for the last {HISTORY_LOOKBACK} days (local dates).</p>
      </header>
      <div className="card">
        {loading && !rows.length ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <ul className="history-list">
              {rows.map(({ dateId, entry }) => (
                <li key={dateId}>
                  <span className="history-date">{dateId}</span>
                  <span className="history-times">
                    {entry?.clockIn
                      ? `${formatTime(entry.clockIn)} – ${formatTime(entry.clockOut)}`
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
            {loadingMore && <p className="muted small history-loading-more">Loading older days…</p>}
          </>
        )}
      </div>
    </div>
  );
}
