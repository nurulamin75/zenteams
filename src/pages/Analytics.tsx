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
import { CalendarDays, Clock, TrendingUp, Users } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatShortDayLabel, lastNDates } from '../lib/date';
import { entryWorkedHours, parseDayEntry } from '../lib/dayEntry';
import { TeamAvatar } from '../components/TeamAvatar';

const RANGE_DAYS = 7;

interface DayAgg {
  dateId: string;
  label: string;
  hours: number;
  employees: number;
}

interface MemberAgg {
  userId: string;
  displayName: string;
  daysWorked: number;
  totalHours: number;
  avgHoursPerDay: number;
}

export function Analytics() {
  const { teamId } = useAuth();
  const dateRange = useMemo(() => lastNDates(RANGE_DAYS).slice().reverse(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [series, setSeries] = useState<DayAgg[]>([]);
  const [members, setMembers] = useState<MemberAgg[]>([]);
  const [kpis, setKpis] = useState({
    totalHours: 0,
    totalDays: 0,
    avgHoursPerDay: 0,
    avgTeamPerDay: 0,
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

      const dayAggs: DayAgg[] = dateRange.map((dateId, i) => {
        let hours = 0;
        let employees = 0;
        for (const docSnap of entrySnaps[i]!.docs) {
          const entry = parseDayEntry(docSnap.data() as Record<string, unknown>);
          if (!entry?.clockIn) continue;
          employees += 1;
          hours += entryWorkedHours(entry, now);
        }
        return {
          dateId,
          label: formatShortDayLabel(dateId),
          hours: Math.round(hours * 10) / 10,
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

  return (
    <div className="page analytics-page">
      <header className="analytics-header">
        <h1>Reports &amp; Analytics</h1>
        <p className="analytics-sub">Insights into your team&apos;s attendance and productivity</p>
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
      </div>

      <div className="analytics-charts">
        <section className="card analytics-chart-card">
          <h2 className="analytics-chart-title">Last 7 days — hours worked</h2>
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
          <h2 className="analytics-chart-title">Last 7 days — attendance</h2>
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
