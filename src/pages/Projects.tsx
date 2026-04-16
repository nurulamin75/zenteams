import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { Archive, ArchiveRestore, Briefcase, Plus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase/config';
import { formatLongDate } from '../lib/date';
import type { TeamProject } from '../types';

type StatusFilter = 'active' | 'archived' | 'all';

interface ProjectDraft {
  name: string;
  client: string;
  description: string;
}

function emptyDraft(): ProjectDraft {
  return { name: '', client: '', description: '' };
}

export function Projects() {
  const { teamId, role } = useAuth();
  const canManage = role === 'admin' || role === 'manager';

  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!teamId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'teams', teamId, 'projects'));
      const list: TeamProject[] = snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          name: x.name as string,
          client: typeof x.client === 'string' ? x.client : '',
          archived: Boolean(x.archived),
          createdAt: x.createdAt as Timestamp,
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(list);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = useMemo(() => {
    if (statusFilter === 'active') return projects.filter((p) => !p.archived);
    if (statusFilter === 'archived') return projects.filter((p) => p.archived);
    return projects;
  }, [projects, statusFilter]);

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError('');
    setModalOpen(true);
  }

  function openEdit(p: TeamProject) {
    setEditingId(p.id);
    setDraft({ name: p.name, client: p.client, description: '' });
    setError('');
    setModalOpen(true);
  }

  function closeModal() {
    if (pending) return;
    setModalOpen(false);
    setEditingId(null);
  }

  async function saveModal() {
    if (!teamId || !canManage) return;
    const name = draft.name.trim().slice(0, 120);
    const client = draft.client.trim().slice(0, 120);
    if (!name) {
      setError('Project name is required.');
      return;
    }
    setPending(true);
    setError('');
    try {
      if (editingId) {
        await updateDoc(doc(db, 'teams', teamId, 'projects', editingId), {
          name,
          client,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'teams', teamId, 'projects'), {
          name,
          client,
          archived: false,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setPending(false);
    }
  }

  async function setArchived(p: TeamProject, archived: boolean) {
    if (!teamId || !canManage) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'projects', p.id), { archived });
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, archived } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    }
  }

  const activeCnt = projects.filter((p) => !p.archived).length;
  const archivedCnt = projects.filter((p) => p.archived).length;

  return (
    <div className="page projects-page">
      <header className="page-header">
        <div className="projects-header">
          <div>
            <h1>Projects</h1>
            <p className="page-sub">
              Team projects used in timesheets.{' '}
              {activeCnt} active · {archivedCnt} archived
            </p>
          </div>
          {canManage && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={18} strokeWidth={2} aria-hidden />
              New project
            </button>
          )}
        </div>
      </header>

      {error && !modalOpen && <p className="error" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="projects-filter-tabs" role="tablist">
        {(['active', 'archived', 'all'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={statusFilter === f}
            className={`projects-filter-tab${statusFilter === f ? ' projects-filter-tab--active' : ''}`}
            onClick={() => setStatusFilter(f)}
          >
            {f === 'active' ? `Active (${activeCnt})` : f === 'archived' ? `Archived (${archivedCnt})` : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="projects-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card projects-card projects-card--skel" aria-hidden>
              <div className="skeleton skeleton-line" style={{ width: '60%', marginBottom: '0.5rem' }} />
              <div className="skeleton skeleton-line" style={{ width: '40%' }} />
            </div>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="projects-empty">
          <Briefcase size={36} strokeWidth={1.5} className="projects-empty__icon" aria-hidden />
          <p className="muted">
            {statusFilter === 'active'
              ? 'No active projects yet.'
              : statusFilter === 'archived'
                ? 'No archived projects.'
                : 'No projects yet.'}
          </p>
          {canManage && statusFilter !== 'archived' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              <Plus size={16} strokeWidth={2} aria-hidden />
              Create first project
            </button>
          )}
        </div>
      ) : (
        <div className="projects-grid">
          {displayed.map((p) => (
            <div
              key={p.id}
              className={`card projects-card${p.archived ? ' projects-card--archived' : ''}`}
            >
              <div className="projects-card__icon-wrap" aria-hidden>
                <Briefcase size={20} strokeWidth={2} />
              </div>
              <div className="projects-card__body">
                <p className="projects-card__name">{p.name}</p>
                {p.client && <p className="projects-card__client muted small">{p.client}</p>}
                <p className="projects-card__meta muted" style={{ fontSize: '0.7rem' }}>
                  {p.archived ? 'Archived · ' : ''}Created {formatLongDate(p.createdAt.toDate().toISOString().slice(0, 10))}
                </p>
              </div>
              {canManage && (
                <div className="projects-card__actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm projects-card__action-btn"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.name}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm projects-card__action-btn"
                    onClick={() => void setArchived(p, !p.archived)}
                    aria-label={p.archived ? `Restore ${p.name}` : `Archive ${p.name}`}
                    title={p.archived ? 'Restore' : 'Archive'}
                  >
                    {p.archived ? (
                      <ArchiveRestore size={16} strokeWidth={2} aria-hidden />
                    ) : (
                      <Archive size={16} strokeWidth={2} aria-hidden />
                    )}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && canManage && (
        <div className="timesheet-modal-backdrop" role="presentation" onClick={closeModal}>
          <div
            className="timesheet-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="timesheet-modal__head">
              <h2 id="project-modal-title" className="timesheet-modal__title">
                {editingId ? 'Edit project' : 'New project'}
              </h2>
              <button
                type="button"
                className="timesheet-modal__close btn btn-ghost btn-sm"
                onClick={closeModal}
                aria-label="Close"
              >
                <X size={22} strokeWidth={2} />
              </button>
            </div>
            {error && <p className="error timesheet-modal-error">{error}</p>}
            <div className="timesheet-modal-body">
              <form
                className="form projects-modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveModal();
                }}
              >
                <label className="projects-modal-field">
                  <span className="timesheet-field-label">
                    Project name <span className="timesheet-req">*</span>
                  </span>
                  <input
                    type="text"
                    value={draft.name}
                    maxLength={120}
                    placeholder="e.g. Website redesign"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    autoFocus
                  />
                </label>
                <label className="projects-modal-field">
                  <span className="timesheet-field-label">Client</span>
                  <input
                    type="text"
                    value={draft.client}
                    maxLength={120}
                    placeholder="e.g. Acme Corp"
                    onChange={(e) => setDraft((d) => ({ ...d, client: e.target.value }))}
                  />
                </label>
              </form>
            </div>
            <div className="timesheet-modal__actions">
              <button type="button" className="btn btn-secondary" disabled={pending} onClick={closeModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => void saveModal()}
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
