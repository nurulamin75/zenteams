import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Download,
  TrendingUp,
  Users,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatShortDayLabel, lastNDates } from '../lib/date';
import { dayHasPunches, entryHoursByLocation, entryWorkedHours, parseDayEntry } from '../lib/dayEntry';
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
          if (!entry || !dayHasPunches(entry)) continue;
          employees += 1;
          const h = entryWorkedHours(entry, now);
          hours += h;
          if (h > OVERTIME_THRESHOLD_H) overtimePersonDays += 1;
          const { office, remote } = entryHoursByLocation(entry, now);
          officeHours += office;
          remoteHours += remote;
          officeHoursTotal += office;
          remoteHoursTotal += remote;
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
          if (!entry || !dayHasPunches(entry)) continue;
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

  const rangeOptions: { value: RangeChoice; label: string }[] = [
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
  ];

  const chartTooltipStyle: CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    fontSize: '0.8125rem',
    boxShadow: '0 4px 20px rgb(15 23 42 / 8%)',
  };

  return (
    <div className="page analytics-page">
      <header className="analytics-top">
        <div className="analytics-top__intro">
          <h1 className="analytics-title">Reports & Analytics</h1>
          {/* <p className="analytics-lede">Attendance and hours across your workspace.</p> */}
        </div>
        <div className="analytics-top__controls">
          <div className="analytics-segment" role="group" aria-label="Report range">
            {rangeOptions.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`analytics-segment__btn${rangeDays === value ? ' analytics-segment__btn--active' : ''}`}
                onClick={() => setRangeDays(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary analytics-export-icon"
            disabled={loading || !series.length}
            onClick={onExportCsv}
            aria-label="Export CSV"
            title="Export CSV"
          >
            <Download size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </header>

      {error && <p className="error analytics-error">{error}</p>}

      <section className="card wide analytics-stats-card" aria-label="Summary metrics">
        <div className="analytics-stats">
          <div className="analytics-stat">
            <Clock className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Total hours</span>
              <span className="analytics-stat__value">{loading ? '—' : kpis.totalHours}</span>
            </div>
          </div>
          <div className="analytics-stat">
            <CalendarDays className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Active days</span>
              <span className="analytics-stat__value">{loading ? '—' : kpis.totalDays}</span>
            </div>
          </div>
          <div className="analytics-stat">
            <TrendingUp className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Avg hrs</span>
              <span className="analytics-stat__value">{loading ? '—' : kpis.avgHoursPerDay}</span>
            </div>
          </div>
          <div className="analytics-stat">
            <Users className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Avg people</span>
              <span className="analytics-stat__value">{loading ? '—' : kpis.avgTeamPerDay}</span>
            </div>
          </div>
          <div className="analytics-stat">
            <Users className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Office / remote</span>
              <span className="analytics-stat__value analytics-stat__value--dense">
                {loading ? '—' : `${kpis.officeHoursTotal} · ${kpis.remoteHoursTotal}`}
              </span>
              <span className="analytics-stat__hint">hrs</span>
            </div>
          </div>
          <div className="analytics-stat">
            <AlertTriangle className="analytics-stat__glyph" size={18} strokeWidth={2} aria-hidden />
            <div className="analytics-stat__body">
              <span className="analytics-stat__label">Heavy days (&gt;{OVERTIME_THRESHOLD_H}h)</span>
              <span className="analytics-stat__value">{loading ? '—' : kpis.overtimePersonDays}</span>
              {/* <span className="analytics-stat__hint">person-days</span> */}
            </div>
          </div>
        </div>
      </section>

      <div className="analytics-charts">
        <section className="card analytics-chart-card">
          <div className="analytics-chart-head">
            <h2 className="analytics-chart-title">Total hours</h2>
          </div>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                <LineChart data={series} margin={{ top: 4, right: 4, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    allowDecimals
                    width={36}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    name="Hours"
                    stroke="#f4815e"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#f4815e', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
        <section className="card analytics-chart-card">
          <div className="analytics-chart-head">
            <h2 className="analytics-chart-title">Hours by location</h2>
          </div>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                <BarChart data={series} margin={{ top: 4, right: 4, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    allowDecimals
                    width={36}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '0.75rem', paddingTop: 8 }} />
                  <Bar
                    dataKey="officeHours"
                    stackId="loc"
                    name="Office"
                    fill="#94a3b8"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="remoteHours"
                    stackId="loc"
                    name="Remote"
                    fill="#f4815e"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
        <section className="card analytics-chart-card analytics-chart-card--wide">
          <div className="analytics-chart-head">
            <h2 className="analytics-chart-title">People per day</h2>
          </div>
          <div className="analytics-chart-wrap">
            {loading ? (
              <div className="analytics-chart-skeleton" aria-hidden />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                <BarChart data={series} margin={{ top: 4, right: 4, left: -12, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                    allowDecimals={false}
                    width={36}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar
                    dataKey="employees"
                    name="People"
                    fill="#cbd5e1"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <section className="card wide analytics-table-card">
        <div className="analytics-table-head">
          <h2 className="analytics-table-title">Members</h2>
          <span className="analytics-table-caption muted small">Hours in selected range</span>
        </div>
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
