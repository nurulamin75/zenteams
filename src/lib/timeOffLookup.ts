import type { TimeOffKind } from '../types';

export type TimeOffDocLite = { dateId: string; kind: TimeOffKind; userId?: string };

export function timeOffSetsForMember(rows: TimeOffDocLite[], memberUid: string) {
  const holidays = new Set<string>();
  const pto = new Set<string>();
  for (const r of rows) {
    if (r.kind === 'holiday') holidays.add(r.dateId);
    else if (r.kind === 'pto' && r.userId === memberUid) pto.add(r.dateId);
  }
  return { holidays, pto };
}

export function pillTimeOffOpts(
  dateId: string,
  holidays: Set<string>,
  pto: Set<string>
): { isTeamHoliday: boolean; isMemberPto: boolean } {
  return {
    isTeamHoliday: holidays.has(dateId),
    isMemberPto: pto.has(dateId),
  };
}
