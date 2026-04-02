import type { TimesheetLine } from '../types';

export type PayrollRow = {
  userId: string;
  dateId: string;
  project: string;
  client: string;
  task: string;
  hours: number;
  activity: string;
  notes: string;
};

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildPayrollRows(lines: TimesheetLine[], displayNames: Map<string, string>): PayrollRow[] {
  return lines.map((l) => ({
    userId: l.userId,
    dateId: l.dateId,
    project: l.project,
    client: l.client,
    task: l.task,
    hours: l.hours,
    activity: l.activity,
    notes: l.notes ?? '',
  })).sort((a, b) => {
    const nameA = displayNames.get(a.userId) ?? a.userId;
    const nameB = displayNames.get(b.userId) ?? b.userId;
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    if (a.dateId !== b.dateId) return a.dateId.localeCompare(b.dateId);
    return a.project.localeCompare(b.project);
  });
}

export function downloadPayrollCsv(
  rows: PayrollRow[],
  displayNames: Map<string, string>,
  filenameBase: string
): void {
  const header = ['Member', 'User ID', 'Date', 'Client', 'Project', 'Task', 'Hours', 'Activity', 'Notes'];
  const lines = [header.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    const name = displayNames.get(r.userId) ?? '';
    lines.push(
      [name, r.userId, r.dateId, r.client, r.project, r.task, String(r.hours), r.activity, r.notes]
        .map((c) => escapeCsvCell(String(c)))
        .join(',')
    );
  }
  const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
