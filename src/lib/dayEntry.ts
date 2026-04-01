import type { DayBreak, DayEntry, WorkLocation } from '../types';

function normalizeBreaks(raw: unknown): DayBreak[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((b) => {
    const x = b as DayBreak;
    return {
      start: x.start,
      end: x.end === undefined ? null : x.end,
    };
  });
}

export function parseDayEntry(data: Record<string, unknown> | undefined): DayEntry | null {
  if (!data) return null;
  return {
    clockIn: (data.clockIn as DayEntry['clockIn']) ?? null,
    clockOut: (data.clockOut as DayEntry['clockOut']) ?? null,
    breaks: normalizeBreaks(data.breaks),
    workLocation: (data.workLocation as WorkLocation | null) ?? null,
    updatedAt: data.updatedAt as DayEntry['updatedAt'],
  };
}

export function grossShiftMs(entry: DayEntry, now: Date): number {
  if (!entry.clockIn) return 0;
  const start = entry.clockIn.toDate().getTime();
  const endMs = entry.clockOut ? entry.clockOut.toDate().getTime() : now.getTime();
  return Math.max(0, endMs - start);
}

export function entryWorkedHours(entry: DayEntry, now: Date): number {
  if (!entry.clockIn) return 0;
  const start = entry.clockIn.toDate().getTime();
  const end = entry.clockOut ? entry.clockOut.toDate().getTime() : now.getTime();
  let ms = end - start;
  for (const b of entry.breaks) {
    const bs = b.start.toDate().getTime();
    const be =
      b.end != null
        ? b.end.toDate().getTime()
        : entry.clockOut
          ? end
          : now.getTime();
    const o0 = Math.max(bs, start);
    const o1 = Math.min(be, end);
    if (o1 > o0) ms -= o1 - o0;
  }
  return Math.max(0, ms) / (1000 * 60 * 60);
}
