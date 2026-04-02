import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatLongDate } from './date';
import { escapeCsvCell, formatHoursAsHMM, formatTime12h } from './timesheetLine';
import type { TimesheetLine } from '../types';

export type TimesheetExportRow = {
  dateLabel: string;
  start: string;
  end: string;
  duration: string;
  client: string;
  project: string;
  task: string;
  activity: string;
  tags: string;
  notes: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildTimesheetExportRows(lines: TimesheetLine[]): TimesheetExportRow[] {
  return lines.map((l) => ({
    dateLabel: formatLongDate(l.dateId),
    start: formatTime12h(l.startTimeLocal),
    end: formatTime12h(l.endTimeLocal),
    duration: formatHoursAsHMM(l.hours),
    client: l.client,
    project: l.project,
    task: l.task,
    activity: l.activity || '—',
    tags: l.tags ?? '—',
    notes: l.notes ?? '—',
  }));
}

export function downloadTimesheetCsv(rows: TimesheetExportRow[], filenameBase: string) {
  const header = [
    'Date',
    'Start',
    'End',
    'Duration',
    'Client',
    'Project',
    'Task',
    'Activity',
    'Tags',
    'Notes',
  ];
  const linesOut = [header.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    linesOut.push(
      [
        r.dateLabel,
        r.start,
        r.end,
        r.duration,
        r.client,
        r.project,
        r.task,
        r.activity,
        r.tags,
        r.notes,
      ]
        .map((c) => escapeCsvCell(String(c)))
        .join(',')
    );
  }
  const blob = new Blob(['\ufeff', linesOut.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTimesheetPdf(rows: TimesheetExportRow[], title: string, filenameBase: string) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [['Date', 'Start', 'End', 'Dur.', 'Client', 'Project', 'Task', 'Activity', 'Tags']],
    body: rows.map((r) => [
      r.dateLabel,
      r.start,
      r.end,
      r.duration,
      r.client,
      r.project,
      r.task,
      r.activity,
      r.tags,
    ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [244, 129, 94], textColor: 255 },
    margin: { left: 10, right: 10 },
  });
  doc.save(`${filenameBase}.pdf`);
}

export function downloadTimesheetDoc(rows: TimesheetExportRow[], filenameBase: string) {
  const tr = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.dateLabel)}</td><td>${escapeHtml(r.start)}</td><td>${escapeHtml(r.end)}</td><td>${escapeHtml(r.duration)}</td><td>${escapeHtml(r.client)}</td><td>${escapeHtml(r.project)}</td><td>${escapeHtml(r.task)}</td><td>${escapeHtml(r.activity)}</td><td>${escapeHtml(r.tags)}</td><td>${escapeHtml(r.notes)}</td></tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><title>Timesheet</title></head><body><table border="1" cellspacing="0" cellpadding="5"><thead><tr><th>Date</th><th>Start</th><th>End</th><th>Duration</th><th>Client</th><th>Project</th><th>Task</th><th>Activity</th><th>Tags</th><th>Notes</th></tr></thead><tbody>${tr}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTimesheetTsv(rows: TimesheetExportRow[], filenameBase: string) {
  const header = ['Date', 'Start', 'End', 'Duration', 'Client', 'Project', 'Task', 'Activity', 'Tags', 'Notes'];
  const esc = (s: string) => s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  const linesOut = [header.join('\t')];
  for (const r of rows) {
    linesOut.push(
      [
        r.dateLabel,
        r.start,
        r.end,
        r.duration,
        r.client,
        r.project,
        r.task,
        r.activity,
        r.tags,
        r.notes,
      ]
        .map((c) => esc(String(c)))
        .join('\t')
    );
  }
  const blob = new Blob([linesOut.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.tsv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTimesheetJson(lines: TimesheetLine[], filenameBase: string) {
  const payload = lines.map((l) => ({
    dateId: l.dateId,
    startTimeLocal: l.startTimeLocal,
    endTimeLocal: l.endTimeLocal,
    hours: l.hours,
    client: l.client,
    project: l.project,
    task: l.task,
    activity: l.activity,
    tags: l.tags,
    notes: l.notes,
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
