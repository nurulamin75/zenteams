import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { attendanceRowPill } from './attendance';
import { formatDurationFromHours, formatLongDate } from './date';
import { dayDisplayWorkLocation, dayHasPunches, entryWorkedHours, sessionInOutLines } from './dayEntry';
import { effectiveExpectedStartForDate } from './teamSettings';
import type { HistoryRow } from './historyRowsCache';
import type { TeamSettings } from '../types';

export type HistoryExportRow = {
  dateId: string;
  dateLabel: string;
  clockIn: string;
  clockOut: string;
  duration: string;
  location: string;
  status: string;
};

function escapeCsvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildHistoryExportRows(
  rows: HistoryRow[],
  todayDateId: string,
  teamSettings: TeamSettings,
  memberScheduleOverride: { hour: number; minute: number } | null,
  holidays: Set<string>,
  pto: Set<string>
): HistoryExportRow[] {
  const now = new Date();
  return rows.map(({ dateId, entry }) => {
    const { hour, minute } = effectiveExpectedStartForDate(dateId, teamSettings, memberScheduleOverride);
    const pill = attendanceRowPill(dateId, todayDateId, entry, hour, minute, {
      isTeamHoliday: holidays.has(dateId),
      isMemberPto: pto.has(dateId),
    });
    const duration =
      entry && dayHasPunches(entry) ? formatDurationFromHours(entryWorkedHours(entry, now)) : '—';
    const { clockIns, clockOuts } = sessionInOutLines(entry);
    const wl = dayDisplayWorkLocation(entry);
    return {
      dateId,
      dateLabel: formatLongDate(dateId),
      clockIn: clockIns.join('; '),
      clockOut: clockOuts.join('; '),
      duration,
      location: wl === 'office' ? 'Office' : wl === 'remote' ? 'Remote' : '—',
      status: pill.label,
    };
  });
}

export function downloadHistoryCsv(rows: HistoryExportRow[], filenameBase: string) {
  const header = ['Date', 'Clock in', 'Clock out', 'Duration', 'Location', 'Status'];
  const lines = [header.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [r.dateLabel, r.clockIn, r.clockOut, r.duration, r.location, r.status]
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

export function downloadHistoryPdf(rows: HistoryExportRow[], title: string, filenameBase: string) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [['Date', 'In', 'Out', 'Duration', 'Location', 'Status']],
    body: rows.map((r) => [r.dateLabel, r.clockIn, r.clockOut, r.duration, r.location, r.status]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [244, 129, 94], textColor: 255 },
    margin: { left: 14, right: 14 },
  });
  doc.save(`${filenameBase}.pdf`);
}

export function downloadHistoryDoc(rows: HistoryExportRow[], filenameBase: string) {
  const tr = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.dateLabel)}</td><td>${escapeHtml(r.clockIn)}</td><td>${escapeHtml(r.clockOut)}</td><td>${escapeHtml(r.duration)}</td><td>${escapeHtml(r.location)}</td><td>${escapeHtml(r.status)}</td></tr>`
    )
    .join('');
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><title>Attendance history</title></head><body><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Duration</th><th>Location</th><th>Status</th></tr></thead><tbody>${tr}</tbody></table></body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}
