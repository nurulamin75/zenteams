import type { DayEntry } from '../types';

export type HistoryRow = { dateId: string; entry: DayEntry | null };

const rowsCache = new Map<string, { rows: HistoryRow[]; storedAt: number }>();

export const HISTORY_LOOKBACK = 30;
export const HISTORY_CACHE_TTL_MS = 45_000;

export function historyRowsCacheKey(uid: string, tid: string) {
  return `${uid}|${tid}|${HISTORY_LOOKBACK}`;
}

export function readHistoryRowsCache(key: string) {
  return rowsCache.get(key);
}

export function writeHistoryRowsCache(key: string, rows: HistoryRow[]) {
  rowsCache.set(key, { rows, storedAt: Date.now() });
}

export function invalidateHistoryRowsCache(uid: string, tid: string) {
  rowsCache.delete(historyRowsCacheKey(uid, tid));
}
