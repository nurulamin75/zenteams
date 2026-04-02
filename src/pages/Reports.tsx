import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { localDateId } from '../lib/date';
import { parseTimesheetLine } from '../lib/timesheetLine';
import { buildPayrollRows, downloadPayrollCsv } from '../lib/payrollReport';
import type { TimesheetLine } from '../types';

function daysAgoDateId(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateId(d);
}

export function Reports() {
  const { teamId } = useAuth();
  const [from, setFrom] = useState(() => daysAgoDateId(29));
  const [to, setTo] = useState(() => localDateId());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [names, setNames] = useState<Map<string, string>>(new Map());

  const loadNames = useCallback(async () => {
    if (!teamId) return;
    const snap = await getDocs(collection(db, 'teams', teamId, 'members'));
    const m = new Map<string, string>();
    for (const d of snap.docs) {
      m.set(d.id, (d.data().displayName as string) ?? d.id);
    }
    setNames(m);
  }, [teamId]);

  useEffect(() => {
    void loadNames();
  }, [loadNames]);

  const runExport = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError('');
    try {
      const a = from <= to ? from : to;
      const b = from <= to ? to : from;
      const q = query(
        collection(db, 'teams', teamId, 'timesheetLines'),
        where('dateId', '>=', a),
        where('dateId', '<=', b)
      );
      const snap = await getDocs(q);
      const lines: TimesheetLine[] = [];
      for (const d of snap.docs) {
        const row = parseTimesheetLine(d.id, d.data() as Record<string, unknown>);
        if (row) lines.push(row);
      }
      const rows = buildPayrollRows(lines, names);
      if (!rows.length) {
        setError('No timesheet lines in this range.');
        return;
      }
      downloadPayrollCsv(rows, names, `zenteams-payroll-${a}-${b}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [teamId, from, to, names]);

  return (
    <div className="page reports-page">
      <header className="page-header">
        <h1>Reports</h1>
        <p className="page-sub">
          Payroll-style CSV: all members&apos; timesheet lines in a date range (hours, client, project). For attendance,
          use Teams → Roster export or individual history exports.
        </p>
      </header>

      <div className="card wide">
        <h2 className="card-title">Payroll / billing export</h2>
        <div className="admin-toolbar teams-toolbar" style={{ marginBottom: '1rem' }}>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={loading} onClick={() => void runExport()}>
            <Download size={16} aria-hidden />
            {loading ? 'Working…' : 'Download CSV'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="muted small">
          CSV includes every timesheet row in range across the team. Open in Excel or your payroll tool.
        </p>
      </div>
    </div>
  );
}
