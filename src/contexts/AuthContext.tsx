import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { canAccessAppModule, firstAccessiblePath, parseMemberPermissions } from '../lib/memberPermissions';
import { DEFAULT_TEAM_SETTINGS, parseTeamSettings } from '../lib/teamSettings';
import type { AppModule, MemberPermissions, MemberRole, TeamSettings, UserPreferences, UserTeam } from '../types';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  teamId: string | null;
  teamName: string | null;
  inviteCode: string | null;
  teams: UserTeam[];
  role: MemberRole | null;
  canManageTeam: boolean;
  isAuditor: boolean;
  memberDisplayName: string | null;
  teamSettings: TeamSettings;
  memberScheduleOverride: { hour: number; minute: number } | null;
  userPreferences: UserPreferences | null;
  memberPermissions: MemberPermissions | null;
  canAccessModule: (module: AppModule) => boolean;
  permissionFallbackPath: string;
  refreshTeam: () => Promise<void>;
  refreshUserDoc: () => Promise<void>;
  switchTeam: (teamId: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [teams, setTeams] = useState<UserTeam[]>([]);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [memberDisplayName, setMemberDisplayName] = useState<string | null>(null);
  const [teamSettings, setTeamSettings] = useState<TeamSettings>(DEFAULT_TEAM_SETTINGS);
  const [memberScheduleOverride, setMemberScheduleOverride] = useState<{
    hour: number;
    minute: number;
  } | null>(null);
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [memberPermissions, setMemberPermissions] = useState<MemberPermissions | null>(null);

  const loadUserAndTeam = useCallback(async (uid: string) => {
    const userSnap = await getDoc(doc(db, 'users', uid));
    const data = userSnap.exists() ? userSnap.data() : null;
    setUserPreferences((data?.preferences as UserPreferences | undefined) ?? null);

    const tid = data?.teamId as string | undefined;
    const storedIds = Array.isArray(data?.teamIds) ? (data.teamIds as string[]) : [];
    const idSet = new Set<string>(storedIds);
    if (tid) idSet.add(tid);
    const mergedIds = [...idSet];

    if (mergedIds.length === 0) {
      setTeamId(null);
      setTeamName(null);
      setInviteCode(null);
      setTeams([]);
      setRole(null);
      setMemberDisplayName(null);
      setTeamSettings(DEFAULT_TEAM_SETTINGS);
      setMemberScheduleOverride(null);
      setMemberPermissions(null);
      return;
    }

    if (tid && storedIds.length === 0 && userSnap.exists()) {
      void updateDoc(doc(db, 'users', uid), { teamIds: [tid], updatedAt: Timestamp.now() });
    }

    const membershipResults = await Promise.all(
      mergedIds.map(async (teamDocId) => {
        const [teamSnap, memberSnap] = await Promise.all([
          getDoc(doc(db, 'teams', teamDocId)),
          getDoc(doc(db, 'teams', teamDocId, 'members', uid)),
        ]);
        if (!memberSnap.exists()) return null;
        const name = teamSnap.exists() ? (teamSnap.data().name as string) : 'Team';
        return { id: teamDocId, name };
      })
    );

    const validTeams = membershipResults.filter((t): t is UserTeam => t !== null);
    setTeams(validTeams);

    if (validTeams.length === 0) {
      setTeamId(null);
      setTeamName(null);
      setInviteCode(null);
      setTeams([]);
      setRole(null);
      setMemberDisplayName(null);
      setTeamSettings(DEFAULT_TEAM_SETTINGS);
      setMemberScheduleOverride(null);
      setMemberPermissions(null);
      return;
    }

    const activeId =
      tid && validTeams.some((t) => t.id === tid) ? tid : validTeams[0]!.id;
    if (tid !== activeId && userSnap.exists()) {
      await updateDoc(doc(db, 'users', uid), { teamId: activeId, updatedAt: Timestamp.now() });
    }

    const [teamSnap, memberSnap] = await Promise.all([
      getDoc(doc(db, 'teams', activeId)),
      getDoc(doc(db, 'teams', activeId, 'members', uid)),
    ]);
    setTeamId(activeId);
    setTeamName(teamSnap.exists() ? (teamSnap.data().name as string) : null);
    setInviteCode(
      teamSnap.exists() ? ((teamSnap.data().inviteCode as string | undefined) ?? null) : null
    );
    setTeamSettings(teamSnap.exists() ? parseTeamSettings(teamSnap.data() as Record<string, unknown>) : DEFAULT_TEAM_SETTINGS);
    if (memberSnap.exists()) {
      const m = memberSnap.data();
      setRole(m.role as MemberRole);
      setMemberDisplayName(m.displayName as string);
      setMemberPermissions(parseMemberPermissions(m.permissions));
      const h = m.expectedStartHour;
      const min = m.expectedStartMinute;
      if (typeof h === 'number' && typeof min === 'number' && h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        setMemberScheduleOverride({ hour: h, minute: min });
      } else {
        setMemberScheduleOverride(null);
      }
    } else {
      setRole(null);
      setMemberDisplayName(null);
      setMemberScheduleOverride(null);
      setMemberPermissions(null);
    }
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await loadUserAndTeam(u.uid);
      } else {
        setTeamId(null);
        setTeamName(null);
        setInviteCode(null);
        setTeams([]);
        setRole(null);
        setMemberDisplayName(null);
        setTeamSettings(DEFAULT_TEAM_SETTINGS);
        setMemberScheduleOverride(null);
        setUserPreferences(null);
        setMemberPermissions(null);
      }
      setLoading(false);
    });
  }, [loadUserAndTeam]);

  const refreshTeam = useCallback(async () => {
    if (user) await loadUserAndTeam(user.uid);
  }, [user, loadUserAndTeam]);

  const refreshUserDoc = useCallback(async () => {
    if (!user) return;
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const data = userSnap.exists() ? userSnap.data() : null;
    setUserPreferences((data?.preferences as UserPreferences | undefined) ?? null);
  }, [user]);

  const switchTeam = useCallback(
    async (nextTeamId: string) => {
      if (!user || nextTeamId === teamId) return;
      if (!teams.some((t) => t.id === nextTeamId)) return;
      await updateDoc(doc(db, 'users', user.uid), {
        teamId: nextTeamId,
        updatedAt: Timestamp.now(),
      });
      await loadUserAndTeam(user.uid);
    },
    [user, teamId, teams, loadUserAndTeam]
  );

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName });
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const canManageTeam = role === 'admin' || role === 'manager';
  const isAuditor = role === 'auditor';
  const canLeadTeam = role === 'admin' || role === 'manager' || role === 'auditor';

  const canAccessModule = useCallback(
    (module: AppModule) => canAccessAppModule(role, memberPermissions, module, canLeadTeam),
    [role, memberPermissions, canLeadTeam]
  );

  const permissionFallbackPath = useMemo(
    () => firstAccessiblePath(role, memberPermissions, canLeadTeam),
    [role, memberPermissions, canLeadTeam]
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      teamId,
      teamName,
      inviteCode,
      teams,
      role,
      canManageTeam,
      isAuditor,
      memberDisplayName,
      teamSettings,
      memberScheduleOverride,
      userPreferences,
      memberPermissions,
      canAccessModule,
      permissionFallbackPath,
      refreshTeam,
      refreshUserDoc,
      switchTeam,
      login,
      register,
      signInWithGoogle,
      logout,
    }),
    [
      user,
      loading,
      teamId,
      teamName,
      inviteCode,
      teams,
      role,
      canManageTeam,
      isAuditor,
      memberDisplayName,
      teamSettings,
      memberScheduleOverride,
      userPreferences,
      memberPermissions,
      canAccessModule,
      permissionFallbackPath,
      refreshTeam,
      refreshUserDoc,
      switchTeam,
      login,
      register,
      signInWithGoogle,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
