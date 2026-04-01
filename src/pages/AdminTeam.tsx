import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, type Timestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { parseDayEntry } from '../lib/dayEntry';
import { formatTime, localDateId } from '../lib/date';
import type { DayBreak, DayEntry } from '../types';

function breaksSummary(breaks: DayBreak[]): string {
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

interface Row {
  userId: string;
  displayName: string;
  email: string;
  entry: DayEntry | null;
}

export function AdminTeam() {
  const { teamId } = useAuth();
  const [dateId, setDateId] = useState(() => localDateId());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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

      const list: Row[] = membersSnap.docs.map((m) => {
        const uid = m.id;
        const data = m.data();
        return {
          userId: uid,
          displayName: (data.displayName as string) ?? uid,
          email: (data.email as string) ?? '',
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
    void load();
  }, [load]);

  function downloadCsv() {
    const header = ['date', 'userId', 'displayName', 'email', 'workLocation', 'clockIn', 'clockOut', 'breaks'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const e = r.entry;
      const clockIn =
        e?.clockIn && 'toDate' in e.clockIn ? (e.clockIn as Timestamp).toDate().toISOString() : '';
      const clockOut =
        e?.clockOut && 'toDate' in e.clockOut ? (e.clockOut as Timestamp).toDate().toISOString() : '';
      const loc = e?.workLocation ?? '';
      const breaks = e ? breaksSummary(e.breaks) : '';
      lines.push(
        [dateId, r.userId, r.displayName, r.email, loc, clockIn, clockOut, breaks]
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Team roster</h1>
        <p className="page-sub">
          Review clock times by day and export CSV. Invite people from <Link to="/invite">Invite</Link>.
        </p>
      </header>
      <div className="card wide">
        <div className="admin-toolbar">
          <label>
            Date
            <input type="date" value={dateId} onChange={(e) => setDateId(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={downloadCsv} disabled={loading || !rows.length}>
            Export CSV
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.displayName}</td>
                    <td>{r.email}</td>
                    <td>{formatTime(r.entry?.clockIn ?? null)}</td>
                    <td>{formatTime(r.entry?.clockOut ?? null)}</td>
                    <td>{r.entry?.workLocation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
