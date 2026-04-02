import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatLongDate, localDateId } from '../lib/date';
import type { TimeOffKind } from '../types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

interface CalCell {
  dateId: string;
  inMonth: boolean;
  dayNum: number;
}

function monthGrid(year: number, month: number): CalCell[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prevLast = new Date(year, month, 0).getDate();
  const cells: CalCell[] = [];
  for (let i = 0; i < startPad; i++) {
    const d = prevLast - startPad + i + 1;
    const p = new Date(year, month - 1, d);
    cells.push({
      dateId: `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      inMonth: false,
      dayNum: d,
    });
  }
  for (let d = 1; d <= lastDay; d++) {
    cells.push({
      dateId: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      inMonth: true,
      dayNum: d,
    });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const tail = cells[cells.length - 1]!;
    const [y, m, day] = tail.dateId.split('-').map(Number);
    const next = new Date(y, m - 1, day + 1);
    cells.push({
      dateId: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
      inMonth: false,
      dayNum: next.getDate(),
    });
  }
  return cells;
}

export function Calendar() {
  const { teamId, user } = useAuth();
  const now = useMemo(() => new Date(), []);
  const [y, setY] = useState(now.getFullYear());
  const [m, setM] = useState(now.getMonth());
  const [byDate, setByDate] = useState<Map<string, { kind: TimeOffKind; label?: string; userId?: string | null }[]>>(
    new Map()
  );

  const load = useCallback(async () => {
    if (!teamId) return;
    const snap = await getDocs(collection(db, 'teams', teamId, 'timeOff'));
    const map = new Map<string, { kind: TimeOffKind; label?: string; userId?: string | null }[]>();
    for (const d of snap.docs) {
      const x = d.data();
      const dateId = x.dateId as string;
      const kind = x.kind as TimeOffKind;
      const userId = x.userId as string | null | undefined;
      const label = x.label as string | undefined;
      const list = map.get(dateId) ?? [];
      list.push({ kind, label, userId });
      map.set(dateId, list);
    }
    setByDate(map);
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cells = useMemo(() => monthGrid(y, m), [y, m]);
  const title = new Date(y, m, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  function prevMonth() {
    if (m === 0) {
      setM(11);
      setY((v) => v - 1);
    } else setM((v) => v - 1);
  }

  function nextMonth() {
    if (m === 11) {
      setM(0);
      setY((v) => v + 1);
    } else setM((v) => v + 1);
  }

  return (
    <div className="page calendar-page">
      <header className="page-header">
        <h1>Team calendar</h1>
        <p className="page-sub">Holidays and PTO recorded for this workspace. Managers add entries from Teams → Time off.</p>
      </header>

      <div className="card wide calendar-card">
        <div className="calendar-toolbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeft size={20} />
          </button>
          <h2 className="calendar-title">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={nextMonth} aria-label="Next month">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="calendar-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((c) => {
            const entries = byDate.get(c.dateId) ?? [];
            const isToday = Boolean(user && c.dateId === localDateId());
            return (
              <div
                key={c.dateId}
                className={`calendar-cell${c.inMonth ? '' : ' calendar-cell--muted'}${isToday ? ' calendar-cell--today' : ''}`}
                title={entries.length ? entries.map((e) => e.kind + (e.label ? ` · ${e.label}` : '')).join('; ') : formatLongDate(c.dateId)}
              >
                <span className="calendar-cell__num">{c.dayNum}</span>
                {entries.length > 0 && (
                  <ul className="calendar-cell__dots">
                    {entries.map((e, i) => (
                      <li
                        key={`${c.dateId}-${i}`}
                        className={`calendar-dot calendar-dot--${e.kind}${e.userId && e.userId === user?.uid ? ' calendar-dot--mine' : ''}`}
                      >
                        {e.kind === 'holiday' ? 'H' : 'P'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <ul className="calendar-legend muted small">
          <li>
            <span className="calendar-dot calendar-dot--holiday calendar-dot--legend" aria-hidden>
              H
            </span>{' '}
            Holiday (whole team)
          </li>
          <li>
            <span className="calendar-dot calendar-dot--pto calendar-dot--legend" aria-hidden>
              P
            </span>{' '}
            PTO (member)
          </li>
        </ul>
      </div>
    </div>
  );
}
