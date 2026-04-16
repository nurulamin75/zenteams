import type { AppModule, MemberPermissions, MemberRole } from '../types';

export const APP_MODULE_ORDER: AppModule[] = [
  'dashboard',
  'attendance',
  'timesheet',
  'calendar',
  'projects',
  'teams',
  'analytics',
  'reports',
  'settings',
];

export const APP_MODULE_LABELS: Record<AppModule, string> = {
  dashboard: 'Dashboard',
  attendance: 'Attendance',
  timesheet: 'Timesheet',
  calendar: 'Calendar',
  projects: 'Projects',
  teams: 'Teams & workspace',
  analytics: 'Analytics',
  reports: 'Reports',
  settings: 'Settings',
};

export const LEAD_ONLY_MODULES: AppModule[] = ['teams', 'analytics', 'reports'];

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  fullAccess: true,
  modules: {},
};

export function parseMemberPermissions(raw: unknown): MemberPermissions {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MEMBER_PERMISSIONS };
  const o = raw as Record<string, unknown>;
  const fullAccess = o.fullAccess !== false;
  const modRaw = o.modules;
  const modules: Partial<Record<AppModule, boolean>> = {};
  if (modRaw && typeof modRaw === 'object') {
    for (const k of APP_MODULE_ORDER) {
      const v = (modRaw as Record<string, unknown>)[k];
      if (v === true) modules[k] = true;
      else if (v === false) modules[k] = false;
    }
  }
  return { fullAccess, modules };
}

export function canAccessAppModule(
  role: MemberRole | null,
  perms: MemberPermissions | null,
  module: AppModule,
  canLeadTeam: boolean
): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  const p = perms ?? DEFAULT_MEMBER_PERMISSIONS;
  const leadOnly = LEAD_ONLY_MODULES.includes(module);
  if (p.fullAccess) {
    if (leadOnly) return canLeadTeam;
    return true;
  }
  if (p.modules[module] !== true) return false;
  if (leadOnly) return canLeadTeam;
  return true;
}

export function firstAccessiblePath(
  role: MemberRole | null,
  perms: MemberPermissions | null,
  canLeadTeam: boolean
): string {
  const pairs: [AppModule, string][] = [
    ['dashboard', '/'],
    ['attendance', '/today'],
    ['timesheet', '/timesheet'],
    ['calendar', '/calendar'],
    ['projects', '/projects'],
    ['teams', '/teams'],
    ['analytics', '/analytics'],
    ['reports', '/reports'],
    ['settings', '/settings'],
  ];
  for (const [mod, path] of pairs) {
    if (canAccessAppModule(role, perms, mod, canLeadTeam)) return path;
  }
  return '/settings';
}

export function emptyCustomModules(): Record<AppModule, boolean> {
  const o = {} as Record<AppModule, boolean>;
  for (const k of APP_MODULE_ORDER) o[k] = false;
  return o;
}

export function allModulesEnabled(): Record<AppModule, boolean> {
  const o = {} as Record<AppModule, boolean>;
  for (const k of APP_MODULE_ORDER) o[k] = true;
  return o;
}
