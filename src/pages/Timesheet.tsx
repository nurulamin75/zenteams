import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatLongDate, localDateId } from '../lib/date';
import {
  buildCalendarMonthCells,
  formatCalendarMonthTitle,
  groupLinesByDateId,
  readStoredTimesheetView,
  weekdayShortLabels,
  writeStoredTimesheetView,
  type TimesheetViewMode,
} from '../lib/timesheetViews';
import {
  buildTimesheetExportRows,
  downloadTimesheetCsv,
  downloadTimesheetDoc,
  downloadTimesheetJson,
  downloadTimesheetPdf,
  downloadTimesheetTsv,
} from '../lib/timesheetExport';
import {
  clampHours,
  formatHoursAsHMM,
  formatTime12h,
  hoursFromStartEndLocal,
  parseTimesheetLine,
  truncateField,
  truncateTags,
} from '../lib/timesheetLine';
import type { TimesheetLine } from '../types';

const PAGE_SIZES = [10, 25, 50] as const;

function daysAgoDateId(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateId(d);
}

type SortKey = 'dateId' | 'start' | 'end' | 'hours' | 'client' | 'project' | 'task' | 'activity';

interface ModalDraft {
  dateId: string;
  client: string;
  project: string;
  task: string;
  activity: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  notes: string;
  tags: string;
}

function emptyModalDraft(dateId: string): ModalDraft {
  return {
    dateId,
    client: '',
    project: '',
    task: '',
    activity: '',
    startTime: '',
    endTime: '',
    durationHours: '',
    notes: '',
    tags: '',
  };
}

export function Timesheet() {
  const { user, teamId } = useAuth();
  const [dateFrom, setDateFrom] = useState(() => daysAgoDateId(29));
  const [dateTo, setDateTo] = useState(() => localDateId());
  const [lines, setLines] = useState<TimesheetLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterClient, setFilterClient] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterTask, setFilterTask] = useState('');
  const [filterActivity, setFilterActivity] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('dateId');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalDraft, setModalDraft] = useState<ModalDraft>(() => emptyModalDraft(localDateId()));
  const [modalPending, setModalPending] = useState(false);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const exportDetailsRef = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<TimesheetViewMode>(() => readStoredTimesheetView());
  const [calYM, setCalYM] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [calendarSelectedDateId, setCalendarSelectedDateId] = useState<string | null>(() => localDateId());

  const exportFilenameBase = `zenteams-timesheet-${dateFrom}-${dateTo}`;

  function closeExportMenu() {
    exportDetailsRef.current?.removeAttribute('open');
  }

  const loadLines = useCallback(async () => {
    if (!user || !teamId) {
      setLines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const from = dateFrom <= dateTo ? dateFrom : dateTo;
      const to = dateFrom <= dateTo ? dateTo : dateFrom;
      const q = query(
        collection(db, 'teams', teamId, 'timesheetLines'),
        where('userId', '==', user.uid),
        where('dateId', '>=', from),
        where('dateId', '<=', to)
      );
      const snap = await getDocs(q);
      const next: TimesheetLine[] = [];
      for (const d of snap.docs) {
        const row = parseTimesheetLine(d.id, d.data() as Record<string, unknown>);
        if (row) next.push(row);
      }
      next.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
      setLines(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load timesheet';
      setError(msg);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [user, teamId, dateFrom, dateTo]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  useEffect(() => {
    writeStoredTimesheetView(view);
  }, [view]);

  const suggestions = useMemo(() => {
    const clients = new Set<string>();
    const projects = new Set<string>();
    const tasks = new Set<string>();
    const activities = new Set<string>();
    for (const l of lines) {
      if (l.client) clients.add(l.client);
      if (l.project) projects.add(l.project);
      if (l.task) tasks.add(l.task);
      if (l.activity) activities.add(l.activity);
    }
    return {
      clients: [...clients].sort(),
      projects: [...projects].sort(),
      tasks: [...tasks].sort(),
      activities: [...activities].sort(),
    };
  }, [lines]);

  const filtered = useMemo(() => {
    const fc = filterClient.trim().toLowerCase();
    const fp = filterProject.trim().toLowerCase();
    const ft = filterTask.trim().toLowerCase();
    const fa = filterActivity.trim().toLowerCase();
    return lines.filter((l) => {
      if (fc && !l.client.toLowerCase().includes(fc)) return false;
      if (fp && !l.project.toLowerCase().includes(fp)) return false;
      if (ft && !l.task.toLowerCase().includes(ft)) return false;
      if (fa && !l.activity.toLowerCase().includes(fa)) return false;
      return true;
    });
  }, [lines, filterClient, filterProject, filterTask, filterActivity]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'dateId':
          cmp = a.dateId < b.dateId ? -1 : a.dateId > b.dateId ? 1 : 0;
          break;
        case 'start':
          cmp = (a.startTimeLocal ?? '') < (b.startTimeLocal ?? '')
            ? -1
            : (a.startTimeLocal ?? '') > (b.startTimeLocal ?? '')
              ? 1
              : 0;
          break;
        case 'end':
          cmp = (a.endTimeLocal ?? '') < (b.endTimeLocal ?? '')
            ? -1
            : (a.endTimeLocal ?? '') > (b.endTimeLocal ?? '')
              ? 1
              : 0;
          break;
        case 'hours':
          cmp = a.hours - b.hours;
          break;
        case 'client':
          cmp = a.client.localeCompare(b.client);
          break;
        case 'project':
          cmp = a.project.localeCompare(b.project);
          break;
        case 'task':
          cmp = a.task.localeCompare(b.task);
          break;
        case 'activity':
          cmp = a.activity.localeCompare(b.activity);
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalFilteredHours = useMemo(() => sorted.reduce((s, l) => s + l.hours, 0), [sorted]);

  const byDate = useMemo(() => groupLinesByDateId(filtered), [filtered]);

  const hoursByDateId = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of filtered) {
      m.set(l.dateId, (m.get(l.dateId) ?? 0) + l.hours);
    }
    return m;
  }, [filtered]);

  const calendarCells = useMemo(
    () => buildCalendarMonthCells(calYM.y, calYM.m),
    [calYM.y, calYM.m]
  );

  const weekdayLabels = useMemo(() => weekdayShortLabels(), []);

  const byDayDateIds = useMemo(() => {
    const ids = [...new Set(filtered.map((l) => l.dateId))];
    ids.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return ids;
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(() => {
    const start = safePage * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePage, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'dateId' ? 'desc' : 'asc');
    }
  }

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown size={14} strokeWidth={2} aria-hidden />;
    return sortDir === 'asc' ? (
      <ArrowUp size={14} strokeWidth={2} aria-hidden />
    ) : (
      <ArrowDown size={14} strokeWidth={2} aria-hidden />
    );
  }

  function openCreate() {
    openCreateForDate(localDateId());
  }

  function openCreateForDate(dateId: string) {
    setEditingId(null);
    setModalDraft(emptyModalDraft(dateId));
    setError('');
    setModalOpen(true);
  }

  function calendarPrevMonth() {
    setCalYM(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  }

  function calendarNextMonth() {
    setCalYM(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  }

  function openEdit(line: TimesheetLine) {
    setEditingId(line.id);
    setModalDraft({
      dateId: line.dateId,
      client: line.client,
      project: line.project,
      task: line.task,
      activity: line.activity,
      startTime: line.startTimeLocal ?? '',
      endTime: line.endTimeLocal ?? '',
      durationHours: line.startTimeLocal && line.endTimeLocal ? '' : String(line.hours),
      notes: line.notes ?? '',
      tags: line.tags ?? '',
    });
    setError('');
    setModalOpen(true);
  }

  function closeModal() {
    if (modalPending) return;
    setModalOpen(false);
    setEditingId(null);
  }

  async function saveModal() {
    if (!user || !teamId) return;
    const project = truncateField(modalDraft.project);
    const client = truncateField(modalDraft.client);
    const task = truncateField(modalDraft.task);
    const activity = truncateField(modalDraft.activity);
    const dateId = modalDraft.dateId.trim();
    if (!project || !client || !task) {
      setError('Client, project, and task are required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
      setError('Choose a valid date.');
      return;
    }

    let hours: number | null = null;
    let startTimeLocal: string | null = null;
    let endTimeLocal: string | null = null;

    if (modalDraft.startTime && modalDraft.endTime) {
      hours = hoursFromStartEndLocal(modalDraft.startTime, modalDraft.endTime);
      if (hours == null) {
        setError('End time must be after start time on the same day.');
        return;
      }
      startTimeLocal = modalDraft.startTime;
      endTimeLocal = modalDraft.endTime;
    } else {
      hours = clampHours(modalDraft.durationHours);
      if (hours == null) {
        setError('Enter duration hours (e.g. 1.5) or both start and end time.');
        return;
      }
    }

    const notesTrim = modalDraft.notes.trim().slice(0, 2000);
    const tagsTrim = truncateTags(modalDraft.tags);
    setError('');
    setModalPending(true);
    try {
      const payload = {
        project,
        client,
        task,
        activity,
        hours,
        startTimeLocal,
        endTimeLocal,
        notes: notesTrim.length > 0 ? notesTrim : null,
        tags: tagsTrim.length > 0 ? tagsTrim : null,
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'teams', teamId, 'timesheetLines', editingId), {
          ...payload,
          dateId,
        });
      } else {
        await addDoc(collection(db, 'teams', teamId, 'timesheetLines'), {
          userId: user.uid,
          dateId,
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
      await loadLines();
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setModalPending(false);
    }
  }

  async function handleDelete(lineId: string) {
    if (!teamId) return;
    if (!window.confirm('Remove this entry?')) return;
    setError('');
    setDeletePendingId(lineId);
    try {
      await deleteDoc(doc(db, 'teams', teamId, 'timesheetLines', lineId));
      await loadLines();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setDeletePendingId(null);
    }
  }

  function resetFilters() {
    setFilterClient('');
    setFilterProject('');
    setFilterTask('');
    setFilterActivity('');
    setDateFrom(daysAgoDateId(29));
    setDateTo(localDateId());
  }

  const rowStart = sorted.length === 0 ? 0 : safePage * pageSize + 1;
  const rowEnd = Math.min(sorted.length, (safePage + 1) * pageSize);

  return (
    <div className="page timesheet-page">
      <div className="timesheet-shell card wide">
        <header className="timesheet-header">
          <div className="timesheet-header__title-row">
            <h1 className="timesheet-header__title">
              My times
              <span className="timesheet-header__total" title="Total hours in current filters">
                {formatHoursAsHMM(totalFilteredHours)}
              </span>
            </h1>
            <div className="timesheet-header__actions">
              <button
                type="button"
                className={`btn btn-secondary timesheet-header__icon-action timesheet-filter-toggle${filterOpen ? ' timesheet-filter-toggle--open' : ''}`}
                onClick={() => setFilterOpen((o) => !o)}
                aria-expanded={filterOpen}
                aria-label="Filter"
                title="Filter"
              >
                <Filter size={18} strokeWidth={2} aria-hidden />
              </button>
              <details ref={exportDetailsRef} className="timesheet-export-menu">
                <summary
                  className="btn btn-secondary timesheet-export-menu__summary timesheet-header__icon-action"
                  aria-label="Export"
                  title="Export"
                >
                  <Download size={18} strokeWidth={2} aria-hidden />
                  <ChevronDown size={16} strokeWidth={2} className="timesheet-export-menu__chev" aria-hidden />
                </summary>
                <div className="timesheet-export-menu__panel">
                  <button
                    type="button"
                    disabled={sorted.length === 0}
                    onClick={() => {
                      downloadTimesheetCsv(buildTimesheetExportRows(sorted), exportFilenameBase);
                      closeExportMenu();
                    }}
                  >
                    CSV (.csv)
                  </button>
                  <button
                    type="button"
                    disabled={sorted.length === 0}
                    onClick={() => {
                      downloadTimesheetDoc(buildTimesheetExportRows(sorted), exportFilenameBase);
                      closeExportMenu();
                    }}
                  >
                    Word (.doc)
                  </button>
                  <button
                    type="button"
                    disabled={sorted.length === 0}
                    onClick={() => {
                      downloadTimesheetPdf(
                        buildTimesheetExportRows(sorted),
                        `My times (${dateFrom} – ${dateTo})`,
                        exportFilenameBase
                      );
                      closeExportMenu();
                    }}
                  >
                    PDF (.pdf)
                  </button>
                  <button
                    type="button"
                    disabled={sorted.length === 0}
                    onClick={() => {
                      downloadTimesheetTsv(buildTimesheetExportRows(sorted), exportFilenameBase);
                      closeExportMenu();
                    }}
                  >
                    Tab-separated (.tsv)
                  </button>
                  <button
                    type="button"
                    disabled={sorted.length === 0}
                    onClick={() => {
                      downloadTimesheetJson(sorted, exportFilenameBase);
                      closeExportMenu();
                    }}
                  >
                    JSON (.json)
                  </button>
                </div>
              </details>

              <button type="button" className="btn btn-primary btn-md" onClick={openCreate}>
                <Plus size={18} strokeWidth={2} aria-hidden />
                Add time
              </button>

            </div>
          </div>
          <p className="timesheet-header__hint muted small">
            Only your entries are shown. Team leads can read all lines for reporting.
          </p>
        </header>

        <nav className="timesheet-view-toolbar" aria-label="Timesheet view">
          <div className="timesheet-view-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'table'}
              className={`timesheet-view-tab${view === 'table' ? ' timesheet-view-tab--active' : ''}`}
              onClick={() => setView('table')}
            >
              <LayoutGrid size={17} strokeWidth={2} aria-hidden />
              Table
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'calendar'}
              className={`timesheet-view-tab${view === 'calendar' ? ' timesheet-view-tab--active' : ''}`}
              onClick={() => setView('calendar')}
            >
              <CalendarDays size={17} strokeWidth={2} aria-hidden />
              Calendar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'byDay'}
              className={`timesheet-view-tab${view === 'byDay' ? ' timesheet-view-tab--active' : ''}`}
              onClick={() => setView('byDay')}
            >
              <List size={17} strokeWidth={2} aria-hidden />
              By day
            </button>
          </div>
        </nav>

        {filterOpen && (
          <div className="timesheet-filter-panel">
            <div className="timesheet-filter-panel__head">
              <span className="timesheet-filter-panel__title">Filters</span>
              <span className="timesheet-filter-panel__hint muted small">Date range loads entries; text fields narrow the table.</span>
            </div>
            <div className="timesheet-filter-range">
              <label>
                <span className="timesheet-filter-label">Date from</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <span className="timesheet-filter-range__sep muted" aria-hidden>
                →
              </span>
              <label>
                <span className="timesheet-filter-label">Date to</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </div>
            <div className="timesheet-filter-text-grid">
              <label>
                <span className="timesheet-filter-label">Client</span>
                <input
                  type="text"
                  value={filterClient}
                  onChange={(e) => setFilterClient(e.target.value)}
                  placeholder="Contains…"
                />
              </label>
              <label>
                <span className="timesheet-filter-label">Project</span>
                <input
                  type="text"
                  value={filterProject}
                  onChange={(e) => setFilterProject(e.target.value)}
                  placeholder="Contains…"
                />
              </label>
              <label>
                <span className="timesheet-filter-label">Task</span>
                <input
                  type="text"
                  value={filterTask}
                  onChange={(e) => setFilterTask(e.target.value)}
                  placeholder="Contains…"
                />
              </label>
              <label>
                <span className="timesheet-filter-label">Activity</span>
                <input
                  type="text"
                  value={filterActivity}
                  onChange={(e) => setFilterActivity(e.target.value)}
                  placeholder="Contains…"
                />
              </label>
            </div>
            <div className="timesheet-filter-actions">
              <button type="button" className="btn btn-secondary" onClick={resetFilters}>
                Reset
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setFilterOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}

        {error && !modalOpen && <p className="error timesheet-error">{error}</p>}

        <div className="timesheet-main">
          {loading ? (
            <p className="muted timesheet-loading">Loading…</p>
          ) : view === 'table' ? (
            <div className="table-wrap timesheet-table-wrap">
              <table className="data-table timesheet-data-table">
                <thead>
                  <tr>
                    <th className="timesheet-col-idx">#</th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('dateId')}>
                        Date {sortIcon('dateId')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('start')}>
                        Start {sortIcon('start')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('end')}>
                        End {sortIcon('end')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('hours')}>
                        Duration {sortIcon('hours')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('client')}>
                        Client {sortIcon('client')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('project')}>
                        Project {sortIcon('project')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('task')}>
                        Task {sortIcon('task')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="timesheet-th-btn" onClick={() => toggleSort('activity')}>
                        Activity {sortIcon('activity')}
                      </button>
                    </th>
                    <th className="timesheet-col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="muted timesheet-empty-cell">
                        No entries in this range. Add time or adjust filters.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((line, i) => (
                      <tr key={line.id}>
                        <td className="timesheet-col-idx muted">{safePage * pageSize + i + 1}</td>
                        <td className="timesheet-cell-date">{formatLongDate(line.dateId)}</td>
                        <td>{formatTime12h(line.startTimeLocal)}</td>
                        <td>{formatTime12h(line.endTimeLocal)}</td>
                        <td className="timesheet-cell-duration">{formatHoursAsHMM(line.hours)}</td>
                        <td>{line.client}</td>
                        <td>{line.project}</td>
                        <td>{line.task}</td>
                        <td>{line.activity || '—'}</td>
                        <td className="timesheet-col-actions">
                          <div className="timesheet-row-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm timesheet-icon-action"
                              onClick={() => openEdit(line)}
                              aria-label={`Edit entry for ${line.task}`}
                            >
                              <Pencil size={16} strokeWidth={2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm timesheet-icon-action timesheet-icon-action--danger"
                              disabled={deletePendingId === line.id}
                              onClick={() => void handleDelete(line.id)}
                              aria-label={`Delete entry for ${line.task}`}
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : view === 'calendar' ? (
            <div className="timesheet-calendar">
              <div className="timesheet-calendar__nav">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm timesheet-calendar__nav-btn"
                  onClick={calendarPrevMonth}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={22} strokeWidth={2} />
                </button>
                <h2 className="timesheet-calendar__month">{formatCalendarMonthTitle(calYM.y, calYM.m)}</h2>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm timesheet-calendar__nav-btn"
                  onClick={calendarNextMonth}
                  aria-label="Next month"
                >
                  <ChevronRight size={22} strokeWidth={2} />
                </button>
              </div>
              <div className="timesheet-calendar__grid" aria-label="Month calendar">
                {weekdayLabels.map((w) => (
                  <div key={w} className="timesheet-calendar__dow muted small">
                    {w}
                  </div>
                ))}
                {calendarCells.map((cell) => {
                  const hrs = hoursByDateId.get(cell.dateId) ?? 0;
                  const hasTime = hrs > 0;
                  const isToday = cell.dateId === localDateId();
                  const isSelected = calendarSelectedDateId === cell.dateId;
                  const dayAria = hasTime
                    ? `${formatLongDate(cell.dateId)}, ${formatHoursAsHMM(hrs)} logged`
                    : `${formatLongDate(cell.dateId)}, no time logged`;
                  return (
                    <button
                      key={`${cell.dateId}-${cell.dayLabel}-${cell.inCurrentMonth}`}
                      type="button"
                      aria-label={dayAria}
                      aria-pressed={isSelected}
                      className={`timesheet-calendar__cell${cell.inCurrentMonth ? '' : ' timesheet-calendar__cell--muted'}${hasTime ? ' timesheet-calendar__cell--has-time' : ''}${isToday ? ' timesheet-calendar__cell--today' : ''}${isSelected ? ' timesheet-calendar__cell--selected' : ''}`}
                      onClick={() => setCalendarSelectedDateId(cell.dateId)}
                    >
                      <span className="timesheet-calendar__cell-day">{cell.dayLabel}</span>
                      {hasTime ? (
                        <span className="timesheet-calendar__cell-hours">{formatHoursAsHMM(hrs)}</span>
                      ) : (
                        <span className="timesheet-calendar__cell-hours timesheet-calendar__cell-hours--empty"> </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="timesheet-calendar__detail card">
                {calendarSelectedDateId ? (
                  <>
                    <div className="timesheet-calendar__detail-head">
                      <div>
                        <p className="timesheet-calendar__detail-date">{formatLongDate(calendarSelectedDateId)}</p>
                        <p className="muted small">
                          {(hoursByDateId.get(calendarSelectedDateId) ?? 0) > 0
                            ? `Total ${formatHoursAsHMM(hoursByDateId.get(calendarSelectedDateId) ?? 0)}`
                            : 'No time logged'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => openCreateForDate(calendarSelectedDateId)}
                      >
                        <Plus size={16} strokeWidth={2} aria-hidden />
                        Add
                      </button>
                    </div>
                    <ul className="timesheet-calendar__detail-list">
                      {(byDate.get(calendarSelectedDateId) ?? []).length === 0 ? (
                        <li className="muted small timesheet-calendar__detail-empty">No entries for this day.</li>
                      ) : (
                        (byDate.get(calendarSelectedDateId) ?? []).map((line) => (
                          <li key={line.id} className="timesheet-calendar__detail-row">
                            <div className="timesheet-calendar__detail-meta">
                              <span className="timesheet-calendar__detail-duration">{formatHoursAsHMM(line.hours)}</span>
                              <span className="timesheet-calendar__detail-text">
                                {line.client} · {line.project}
                                <span className="muted"> — {line.task}</span>
                              </span>
                            </div>
                            <div className="timesheet-row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm timesheet-icon-action"
                                onClick={() => openEdit(line)}
                                aria-label="Edit"
                              >
                                <Pencil size={16} strokeWidth={2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm timesheet-icon-action timesheet-icon-action--danger"
                                disabled={deletePendingId === line.id}
                                onClick={() => void handleDelete(line.id)}
                                aria-label="Delete"
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden />
                              </button>
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </>
                ) : (
                  <p className="muted small">Select a day on the calendar.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="timesheet-byday">
              {byDayDateIds.length === 0 ? (
                <p className="muted timesheet-byday-empty">No entries in this range. Add time or adjust filters.</p>
              ) : (
                byDayDateIds.map((dateId) => {
                  const dayLines = byDate.get(dateId) ?? [];
                  const dayHrs = dayLines.reduce((s, l) => s + l.hours, 0);
                  return (
                    <section key={dateId} className="timesheet-byday-section">
                      <header className="timesheet-byday-section__head">
                        <h3 className="timesheet-byday-section__title">{formatLongDate(dateId)}</h3>
                        <div className="timesheet-byday-section__actions">
                          <span className="timesheet-byday-section__total">{formatHoursAsHMM(dayHrs)}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openCreateForDate(dateId)}
                          >
                            <Plus size={16} strokeWidth={2} aria-hidden />
                            Add
                          </button>
                        </div>
                      </header>
                      <ul className="timesheet-byday-list">
                        {dayLines.map((line) => (
                          <li key={line.id} className="timesheet-byday-card">
                            <div className="timesheet-byday-card__main">
                              <p className="timesheet-byday-card__line">
                                <strong>{formatHoursAsHMM(line.hours)}</strong>
                                <span className="muted">
                                  {' '}
                                  {formatTime12h(line.startTimeLocal)} – {formatTime12h(line.endTimeLocal)}
                                </span>
                              </p>
                              <p className="timesheet-byday-card__meta">
                                {line.client} · {line.project} · {line.task}
                                {line.activity ? <span className="muted"> · {line.activity}</span> : null}
                              </p>
                            </div>
                            <div className="timesheet-row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm timesheet-icon-action"
                                onClick={() => openEdit(line)}
                                aria-label="Edit"
                              >
                                <Pencil size={16} strokeWidth={2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm timesheet-icon-action timesheet-icon-action--danger"
                                disabled={deletePendingId === line.id}
                                onClick={() => void handleDelete(line.id)}
                                aria-label="Delete"
                              >
                                <Trash2 size={16} strokeWidth={2} aria-hidden />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>
          )}
        </div>

        <footer className="timesheet-footer">
          <span className="muted small timesheet-footer__count">
            {sorted.length} {sorted.length === 1 ? 'entry' : 'entries'}
          </span>
          {view === 'table' ? (
            <div className="timesheet-footer__table-controls">
              <label className="timesheet-page-size muted small">
                Rows per page
                <select
                  className="history-select"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                    setPage(0);
                  }}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="timesheet-footer__pager">
                <span className="muted small">
                  Showing {sorted.length === 0 ? 0 : rowStart} to {rowEnd} of {sorted.length}
                </span>
                <div className="timesheet-pager-btns">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={safePage <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={20} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    aria-label="Next page"
                  >
                    <ChevronRight size={20} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </footer>
      </div>

      {modalOpen && (
        <div className="timesheet-modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="timesheet-modal timesheet-modal--wide card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timesheet-modal__head">
              <h2 className="timesheet-modal__title">{editingId ? 'Edit time' : 'New time entry'}</h2>
              <button type="button" className="timesheet-modal__close btn btn-ghost btn-sm" onClick={closeModal}>
                <X size={22} strokeWidth={2} aria-label="Close" />
              </button>
            </div>
            {error && modalOpen && <p className="error timesheet-modal-error">{error}</p>}
            <div className="timesheet-modal-body">
              <form className="form timesheet-modal-form timesheet-modal-grid" onSubmit={(e) => e.preventDefault()}>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">
                    Date <span className="timesheet-req">*</span>
                  </span>
                  <input
                    type="date"
                    value={modalDraft.dateId}
                    onChange={(e) => setModalDraft((d) => ({ ...d, dateId: e.target.value }))}
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">Activity</span>
                  <input
                    type="text"
                    value={modalDraft.activity}
                    onChange={(e) => setModalDraft((d) => ({ ...d, activity: e.target.value }))}
                    placeholder="e.g. Stand-up"
                    list="timesheet-datalist-activity"
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">
                    Client <span className="timesheet-req">*</span>
                  </span>
                  <input
                    type="text"
                    value={modalDraft.client}
                    onChange={(e) => setModalDraft((d) => ({ ...d, client: e.target.value }))}
                    placeholder="Client"
                    list="timesheet-datalist-client"
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">
                    Project <span className="timesheet-req">*</span>
                  </span>
                  <input
                    type="text"
                    value={modalDraft.project}
                    onChange={(e) => setModalDraft((d) => ({ ...d, project: e.target.value }))}
                    placeholder="Project"
                    list="timesheet-datalist-project"
                  />
                </label>
                <label className="timesheet-modal-field timesheet-modal-field--full">
                  <span className="timesheet-field-label">
                    Task <span className="timesheet-req">*</span>
                  </span>
                  <input
                    type="text"
                    value={modalDraft.task}
                    onChange={(e) => setModalDraft((d) => ({ ...d, task: e.target.value }))}
                    placeholder="Task"
                    list="timesheet-datalist-task"
                  />
                </label>
                <p className="timesheet-modal-field timesheet-modal-field--full timesheet-modal-time-hint muted small">
                  Use start and end time, or duration only.
                </p>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">Start</span>
                  <input
                    type="time"
                    value={modalDraft.startTime}
                    onChange={(e) => setModalDraft((d) => ({ ...d, startTime: e.target.value }))}
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">End</span>
                  <input
                    type="time"
                    value={modalDraft.endTime}
                    onChange={(e) => setModalDraft((d) => ({ ...d, endTime: e.target.value }))}
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">Duration (h)</span>
                  <input
                    type="number"
                    min={0.01}
                    max={24}
                    step={0.25}
                    value={modalDraft.durationHours}
                    onChange={(e) => setModalDraft((d) => ({ ...d, durationHours: e.target.value }))}
                    placeholder="1.5"
                  />
                </label>
                <label className="timesheet-modal-field">
                  <span className="timesheet-field-label">Tags</span>
                  <input
                    type="text"
                    value={modalDraft.tags}
                    onChange={(e) => setModalDraft((d) => ({ ...d, tags: e.target.value }))}
                    placeholder="Optional, comma-separated"
                  />
                </label>
                <label className="timesheet-modal-field timesheet-modal-field--full">
                  <span className="timesheet-field-label">Description</span>
                  <textarea
                    rows={2}
                    value={modalDraft.notes}
                    onChange={(e) => setModalDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="Optional"
                    maxLength={2000}
                  />
                </label>
                <datalist id="timesheet-datalist-activity">
                  {suggestions.activities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <datalist id="timesheet-datalist-client">
                  {suggestions.clients.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <datalist id="timesheet-datalist-project">
                  {suggestions.projects.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <datalist id="timesheet-datalist-task">
                  {suggestions.tasks.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </form>
            </div>
            <div className="timesheet-modal__actions">
              <button type="button" className="btn btn-secondary" disabled={modalPending} onClick={closeModal}>
                Close
              </button>
              <button type="button" className="btn btn-primary" disabled={modalPending} onClick={() => void saveModal()}>
                {modalPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
