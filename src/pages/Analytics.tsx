import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CalendarDays, Clock, FileSpreadsheet, TrendingUp, Users } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatShortDayLabel, lastNDates } from '../lib/date';
import { entryWorkedHours, parseDayEntry } from '../lib/dayEntry';
import { TeamAvatar } from '../components/TeamAvatar';

const OVERTIME_THRESHOLD_H = 8;

type RangeChoice = 7 | 14 | 30;

interface DayAgg {
  dateId: string;
  label: string;
  hours: number;
  officeHours: number;
  remoteHours: number;
  employees: number;
}

interface MemberAgg {
  userId: string;
  displayName: string;
  daysWorked: number;
  totalHours: number;
  avgHoursPerDay: number;
}

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadAnalyticsCsv(
  rangeDays: number,
  series: DayAgg[],
  members: MemberAgg[],
  kpis: {
    totalHours: number;
    officeHoursTotal: number;
    remoteHoursTotal: number;
    overtimePersonDays: number;
  }
) {
  const lines: string[] = [];
  lines.push(
    [
      'summary',
      'range_days',
      String(rangeDays),
      'total_hours',
      String(kpis.totalHours),
      'office_hours',
      String(kpis.officeHoursTotal),
      'remote_hours',
      String(kpis.remoteHoursTotal),
      'overtime_person_days',
      String(kpis.overtimePersonDays),
    ].join(',')
  );
  lines.push('date_id,label,total_hours,office_hours,remote_hours,employees');
  for (const d of series) {
    lines.push(
      [
        escapeCsvCell(d.dateId),
        escapeCsvCell(d.label),
        String(d.hours),
        String(d.officeHours),
        String(d.remoteHours),
        String(d.employees),
      ].join(',')
    );
  }
  lines.push('');
  lines.push('member_id,display_name,days_worked,total_hours,avg_hours_per_day');
  for (const m of members) {
    lines.push(
      [
        escapeCsvCell(m.userId),
        escapeCsvCell(m.displayName),
        String(m.daysWorked),
        String(m.totalHours),
        String(m.avgHoursPerDay),
      ].join(',')
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date();
  a.href = url;
  a.download = `zenteams-analytics-${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Analytics() {
  const { teamId } = useAuth();
  const [rangeDays, setRangeDays] = useState<RangeChoice>(7);
  const dateRange = useMemo(() => lastNDates(rangeDays).slice().reverse(), [rangeDays]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [series, setSeries] = useState<DayAgg[]>([]);
  const [members, setMembers] = useState<MemberAgg[]>([]);
  const [kpis, setKpis] = useState({
    totalHours: 0,
    totalDays: 0,
    avgHoursPerDay: 0,
    avgTeamPerDay: 0,
    officeHoursTotal: 0,
    remoteHoursTotal: 0,
    overtimePersonDays: 0,
  });

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError('');
    try {
      const now = new Date();
      const entrySnaps = await Promise.all(
        dateRange.map((d) => getDocs(collection(db, 'teams', teamId, 'days', d, 'entries')))
      );

      let officeHoursTotal = 0;
      let remoteHoursTotal = 0;
      let overtimePersonDays = 0;

      const dayAggs: DayAgg[] = dateRange.map((dateId, i) => {
        let hours = 0;
        let officeHours = 0;
        let remoteHours = 0;
        let employees = 0;
        for (const docSnap of entrySnaps[i]!.docs) {
          const entry = parseDayEntry(docSnap.data() as Record<string, unknown>);
          if (!entry?.clockIn) continue;
          employees += 1;
          const h = entryWorkedHours(entry, now);
          hours += h;
          if (h > OVERTIME_THRESHOLD_H) overtimePersonDays += 1;
          if (entry.workLocation === 'office') {
            officeHours += h;
            officeHoursTotal += h;
          } else if (entry.workLocation === 'remote') {
            remoteHours += h;
            remoteHoursTotal += h;
          }
        }
        return {
          dateId,
          label: formatShortDayLabel(dateId),
          hours: Math.round(hours * 10) / 10,
          officeHours: Math.round(officeHours * 10) / 10,
          remoteHours: Math.round(remoteHours * 10) / 10,
          employees,
        };
      });

      const totalHours = dayAggs.reduce((s, d) => s + d.hours, 0);
      const daysWithActivity = dayAggs.filter((d) => d.employees > 0).length;
      const personDays = dayAggs.reduce((s, d) => s + d.employees, 0);
      const headcountSum = dayAggs.reduce((s, d) => s + d.employees, 0);

      setKpis({
        totalHours: Math.round(totalHours * 10) / 10,
        totalDays: daysWithActivity,
        avgHoursPerDay:
          personDays > 0 ? Math.round((totalHours / personDays) * 10) / 10 : 0,
        avgTeamPerDay:
          daysWithActivity > 0
            ? Math.round((headcountSum / daysWithActivity) * 10) / 10
            : 0,
        officeHoursTotal: Math.round(officeHoursTotal * 10) / 10,
        remoteHoursTotal: Math.round(remoteHoursTotal * 10) / 10,
        overtimePersonDays,
      });

      setSeries(dayAggs);

      const membersSnap = await getDocs(collection(db, 'teams', teamId, 'members'));
      const byUser = new Map<string, { hours: number; days: number }>();

      dateRange.forEach((_d, i) => {
        for (const docSnap of entrySnaps[i]!.docs) {
          const entry = parseDayEntry(docSnap.data() as Record<string, unknown>);
          if (!entry?.clockIn) continue;
          const uid = docSnap.id;
          const h = entryWorkedHours(entry, now);
          const cur = byUser.get(uid) ?? { hours: 0, days: 0 };
          cur.hours += h;
          cur.days += 1;
          byUser.set(uid, cur);
        }
      });

      const rows: MemberAgg[] = [];
      for (const m of membersSnap.docs) {
        const uid = m.id;
        const data = m.data();
        const displayName = (data.displayName as string) ?? uid;
        const agg = byUser.get(uid);
        if (!agg || agg.days === 0) {
          rows.push({
            userId: uid,
            displayName,
            daysWorked: 0,
            totalHours: 0,
            avgHoursPerDay: 0,
          });
        } else {
          const th = Math.round(agg.hours * 10) / 10;
          rows.push({
            userId: uid,
            displayName,
            daysWorked: agg.days,
            totalHours: th,
            avgHoursPerDay: Math.round((agg.hours / agg.days) * 10) / 10,
          });
        }
      }
      rows.sort((a, b) => b.totalHours - a.totalHours || a.displayName.localeCompare(b.displayName));
      setMembers(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [teamId, dateRange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!teamId) return null;

  const onExportCsv = () => {
    downloadAnalyticsCsv(rangeDays, series, members, {
      totalHours: kpis.totalHours,
      officeHoursTotal: kpis.officeHoursTotal,
      remoteHoursTotal: kpis.remoteHoursTotal,
      overtimePersonDays: kpis.overtimePersonDays,
    });
  };

  return (
    <div className="page analytics-page">
      <header className="analytics-header">
        <div className="analytics-header-row">
          <div>
            <h1>Reports &amp; Analytics</h1>
            <p className="analytics-sub">Insights into your team&apos;s attendance and productivity</p>
          </div>
          <div className="analytics-toolbar">
            <label className="analytics-range-label">
              <span className="muted small">Range</span>
              <select
                className="history-select analytics-range-select"
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value) as RangeChoice)}
                aria-label="Date range"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm analytics-export-btn"
              disabled={loading || !series.length}
              onClick={onExportCsv}
            >
              <FileSpreadsheet size={16} aria-hidden />
              Export CSV
            </button>
          </div>
        </div>
      </header>

      {error && <p className="error analytics-error">{error}</p>}

      <div className="analytics-kpis">
        <div className="card analytics-kpi-card">
          <Clock className="analytics-kpi-icon analytics-kpi-icon--blue" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Total hours</span>
            <span className="analytics-kpi-value">{loading ? '—' : kpis.totalHours}</span>
          </div>
        </div>
        <div className="card analytics-kpi-card">
          <CalendarDays className="analytics-kpi-icon analytics-kpi-icon--green" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Active days</span>
            <span className="analytics-kpi-value">{loading ? '—' : kpis.totalDays}</span>
          </div>
        </div>
        <div className="card analytics-kpi-card">
          <TrendingUp className="analytics-kpi-icon analytics-kpi-icon--purple" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Avg hours / person-day</span>
            <span className="analytics-kpi-value">{loading ? '—' : kpis.avgHoursPerDay}</span>
          </div>
        </div>
        <div className="card analytics-kpi-card">
          <Users className="analytics-kpi-icon analytics-kpi-icon--orange" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Avg team / active day</span>
            <span className="analytics-kpi-value">{loading ? '—' : kpis.avgTeamPerDay}</span>
          </div>
        </div>
        <div className="card analytics-kpi-card">
          <Users className="analytics-kpi-icon analytics-kpi-icon--blue" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Office / remote hours</span>
            <span className="analytics-kpi-value analytics-kpi-value--split">
              {loading
                ? '—'
                : `${kpis.officeHoursTotal} / ${kpis.remoteHoursTotal}`}
            </span>
            <span className="analytics-kpi-sublabel muted small">office · remote</span>
          </div>
        </div>
        <div className="card analytics-kpi-card">
          <AlertTriangle className="analytics-kpi-icon analytics-kpi-icon--orange" size={22} strokeWidth={1.75} />
          <div className="analytics-kpi-text">
            <span className="analytics-kpi-label">Heavy days (&gt;{OVERTIME_THRESHOLD_H}h)</span>
            <span className="analytics-kpi-value">{loading ? '—' : kpis.overtimePersonDays}</span>
            <span className="analytics-kpi-sublabel muted small">person-days in range</span>
          </div>
        </div>
      </div>

      <div className="analytics-charts">
        <section className="card analytics-chart-card">
          <h2 className="analytics-chart-title">Last {rangeDays} days — total hours</h2>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                <LineChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    name="Total hours"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 4, fill: '#2563eb' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
        <section className="card analytics-chart-card">
          <h2 className="analytics-chart-title">Last {rangeDays} days — hours by location</h2>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                <BarChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="officeHours"
                    stackId="loc"
                    name="Office"
                    fill="#2563eb"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="remoteHours"
                    stackId="loc"
                    name="Remote"
                    fill="#7c3aed"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
        <section className="card analytics-chart-card">
          <h2 className="analytics-chart-title">Last {rangeDays} days — headcount</h2>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                <BarChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Bar dataKey="employees" name="Employees" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="card analytics-table-card">
        <h2 className="analytics-table-title">Team member statistics</h2>
        <div className="analytics-table-scroll">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Days worked</th>
                <th>Total hours</th>
                <th>Avg hours / day</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="analytics-table-loading muted">
                    Loading…
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.userId}>
                    <td>
                      <span className="analytics-member-cell">
                        <TeamAvatar teamId={m.userId} name={m.displayName} size={32} />
                        <span>{m.displayName}</span>
                      </span>
                    </td>
                    <td>{m.daysWorked}</td>
                    <td>{m.totalHours > 0 ? `${m.totalHours} hrs` : '—'}</td>
                    <td>{m.daysWorked > 0 ? `${m.avgHoursPerDay} hrs` : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
