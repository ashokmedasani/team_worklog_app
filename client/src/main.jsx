import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  Edit,
  Eye,
  EyeOff,
  FileText,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');
const statuses = ['Pending', 'In Progress', 'Completed', 'Blocked'];
const priorities = ['Low', 'Medium', 'High'];
const projectStatuses = ['Active', 'On Hold', 'Completed', 'Archived'];
const accessLevels = ['Admin', 'Manager', 'Employee'];
const today = () => new Date().toISOString().slice(0, 10);
const authContext = { token: '', actor: '', access_level: 'Employee' };

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: authContext.token ? `Bearer ${authContext.token}` : '',
      'X-Actor': authContext.actor || 'Unknown',
      'X-Access-Level': authContext.access_level || 'Employee',
      ...(options.headers || {})
    },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem('worklog-session');
    return saved ? JSON.parse(saved) : null;
  });
  const [activeView, setActiveView] = useState('dashboard');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(localStorage.getItem('selected-project-id') || '');
  const [tasks, setTasks] = useState([]);
  const [logs, setLogs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [members, setMembers] = useState([]);
  const [users, setUsers] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedProject = projects.find((project) => String(project.id) === String(selectedProjectId));
  const memberNames = useMemo(() => members.map((member) => member.name).filter(Boolean).sort(), [members]);
  const currentMember = session?.user?.display_name || '';
  const currentAccessLevel = session?.user?.role || 'Employee';
  const canManage = ['Admin', 'Manager'].includes(currentAccessLevel);
  const isAdmin = currentAccessLevel === 'Admin';

  authContext.token = session?.token || '';
  authContext.actor = currentMember || 'Unknown';
  authContext.access_level = currentAccessLevel;

  async function loadAll(projectId = selectedProjectId) {
    if (!session?.token) return;
    setLoading(true);
    try {
      const projectRows = await api('/api/projects');
      const nextProjectId = projectId || projectRows[0]?.id || '';
      const qs = nextProjectId ? `?project_id=${nextProjectId}` : '';
      const [memberRows, taskRows, logRows, noteRows, dashboardData] = await Promise.all([
        api(`/api/project-members${qs}`),
        api(`/api/tasks${qs}`),
        api(`/api/work-logs${qs}`),
        api(`/api/notes${qs}`),
        api(`/api/dashboard${qs}`)
      ]);
      const auditRows = isAdmin ? await api(`/api/audit-logs${qs}`) : [];
      const userRows = isAdmin ? await api('/api/users') : [];
      setProjects(projectRows);
      setSelectedProjectId(nextProjectId ? String(nextProjectId) : '');
      setMembers(memberRows);
      setTasks(taskRows);
      setLogs(logRows);
      setNotes(noteRows);
      setAuditLogs(auditRows);
      setUsers(userRows);
      setDashboard(dashboardData);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.token) loadAll();
    else setLoading(false);
  }, [session?.token]);

  useEffect(() => {
    localStorage.setItem('selected-project-id', selectedProjectId);
  }, [selectedProjectId]);

  function handleLogin(nextSession) {
    localStorage.setItem('worklog-session', JSON.stringify(nextSession));
    setSession(nextSession);
    setActiveView('dashboard');
  }

  function logout() {
    localStorage.removeItem('worklog-session');
    setSession(null);
    setProjects([]);
    setTasks([]);
    setLogs([]);
    setNotes([]);
    setAuditLogs([]);
    setUsers([]);
  }

  async function changeProject(projectId) {
    setSelectedProjectId(projectId);
    await loadAll(projectId);
  }

  const nav = [
    ['dashboard', LayoutDashboard, 'Dashboard'],
    ['projects', BriefcaseBusiness, 'Projects'],
    ['team', Users, 'Team'],
    ...(isAdmin ? [['users', ShieldCheck, 'Users']] : []),
    ['tasks', ClipboardList, 'Tasks'],
    ['logs', Clock3, 'Work Logs'],
    ['notes', MessageSquareText, 'Notes'],
    ...(isAdmin ? [['audit', ShieldCheck, 'Audit']] : [])
  ];

  if (!session?.token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-emerald-600 text-white">
            <BriefcaseBusiness size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold">Team Worklog</h1>
            <p className="text-xs text-zinc-500">Projects, tasks, and time</p>
          </div>
        </div>
        <nav className="space-y-1 p-4">
          {nav.map(([id, Icon, label]) => (
            <button key={id} onClick={() => setActiveView(id)} className={`nav-item ${activeView === id ? 'nav-item-active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:px-8">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Shared team workspace</p>
                <h2 className="text-xl font-semibold">{nav.find(([id]) => id === activeView)?.[2]}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SelectBare value={selectedProjectId} onChange={changeProject} disabled={!projects.length}>
                  <option value="">{projects.length ? 'All projects' : 'Create a project first'}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </SelectBare>
                <div className="flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                  <Users size={16} />
                  <span className="max-w-36 truncate">{currentMember}</span>
                </div>
                <span className="badge">{currentAccessLevel}</span>
                <button className="icon-button" type="button" onClick={logout} title="Logout"><LogOut size={17} /></button>
                <a className="icon-button" href={`${API_BASE}/api/export/tasks.csv`} title="Export tasks CSV"><Download size={17} /></a>
                <a className="icon-button" href={`${API_BASE}/api/export/work-logs.csv`} title="Export work logs CSV"><FileText size={17} /></a>
              </div>
            </div>
          </div>
          <nav className="grid border-t border-zinc-200 lg:hidden" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map(([id, Icon, label]) => (
              <button key={id} onClick={() => setActiveView(id)} className={`mobile-nav ${activeView === id ? 'mobile-nav-active' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </header>

        <div className="px-4 py-6 lg:px-8">
          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="rounded border border-zinc-200 bg-white p-6 text-sm text-zinc-600">Loading workspace...</div>
          ) : (
            <>
              {!projects.length && activeView !== 'projects' && <EmptyProjectNotice onCreate={() => setActiveView('projects')} />}
              {activeView === 'dashboard' && <Dashboard dashboard={dashboard} selectedProject={selectedProject} />}
              {activeView === 'projects' && <ProjectsView projects={projects} selectedProjectId={selectedProjectId} reload={loadAll} selectProject={changeProject} canManage={isAdmin} />}
              {activeView === 'team' && <TeamView members={members} projects={projects} selectedProjectId={selectedProjectId} reload={loadAll} isAdmin={isAdmin} />}
              {activeView === 'users' && isAdmin && <UsersView users={users} reload={loadAll} currentUserId={session.user.id} />}
              {activeView === 'tasks' && <TasksView tasks={tasks} projects={projects} members={memberNames} selectedProjectId={selectedProjectId} reload={loadAll} canManage={canManage} />}
              {activeView === 'logs' && <LogsView logs={logs} tasks={tasks} members={memberNames} currentMember={currentMember} reload={loadAll} canManage={canManage} />}
              {activeView === 'notes' && <NotesView notes={notes} tasks={tasks} members={memberNames} currentMember={currentMember} reload={loadAll} canManage={canManage} />}
              {activeView === 'audit' && isAdmin && <AuditView auditLogs={auditLogs} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyProjectNotice({ onCreate }) {
  return (
    <section className="panel mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="font-semibold">No projects yet</h3>
        <p className="text-sm text-zinc-600">Create a project, add the team, then add tasks under that project.</p>
      </div>
      <button className="primary-button" onClick={onCreate}><Plus size={16} />Create Project</button>
    </section>
  );
}

function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(form) });
      onLogin(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-emerald-700 text-white"><BriefcaseBusiness size={20} /></div>
          <div>
            <h1 className="text-xl font-semibold">Team Worklog</h1>
            <p className="text-sm text-zinc-500">Sign in to continue</p>
          </div>
        </div>
        {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-4">
          <TextInput label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} required />
          <PasswordInput label="Password" value={form.password} onChange={(password) => setForm({ ...form, password })} required />
          <button className="primary-button w-full justify-center" disabled={saving}><Save size={16} />{saving ? 'Signing in...' : 'Sign In'}</button>
        </div>
      </form>
    </main>
  );
}

function Dashboard({ dashboard, selectedProject }) {
  const counts = dashboard?.counts || {};
  const chartData = statuses.map((status) => ({ name: status, value: Number(counts[statusKey(status)] || 0) }));
  const cards = [
    ['Total Tasks', counts.total || 0, ClipboardList],
    ['Pending', counts.pending || 0, CalendarDays],
    ['In Progress', counts.in_progress || 0, Clock3],
    ['Completed', counts.completed || 0, CheckCircle2]
  ];

  return (
    <div className="space-y-6">
      <div className="panel">
        <p className="text-sm text-zinc-500">Current project</p>
        <h3 className="mt-1 text-xl font-semibold">{selectedProject?.name || 'All projects'}</h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, Icon]) => <div key={label} className="stat-card"><div><p className="text-sm text-zinc-500">{label}</p><p className="mt-1 text-3xl font-semibold">{value}</p></div><Icon className="text-emerald-700" size={26} /></div>)}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel h-80"><Title icon={BarChart3} text="Task Status" /><ResponsiveContainer width="100%" height="85%"><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3}>{chartData.map((entry, index) => <Cell key={entry.name} fill={['#f59e0b', '#2563eb', '#16a34a', '#dc2626'][index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></section>
        <section className="panel h-80"><Title icon={Users} text="Work Hours By Member" /><ResponsiveContainer width="100%" height="85%"><BarChart data={dashboard?.hoursByMember || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="author" /><YAxis /><Tooltip /><Bar dataKey="hours" fill="#0f766e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></section>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel"><Title icon={Clock3} text="Recent Work Logs" /><div className="divide-y divide-zinc-200">{(dashboard?.recentLogs || []).map((log) => <div key={log.id} className="py-3"><div className="flex items-center justify-between gap-3"><p className="font-medium">{log.task_title}</p><span className="badge">{formatMinutes(log.time_minutes)}</span></div><p className="mt-1 text-sm text-zinc-600">{log.work_description}</p><p className="mt-1 text-xs text-zinc-500">{log.author} - {formatDate(log.log_date)}</p></div>)}</div></section>
        <section className="panel"><Title icon={FileText} text="Recent Activity" /><div className="space-y-3">{(dashboard?.recentActivity || []).map((item, index) => <div key={`${item.type}-${index}`} className="rounded border border-zinc-200 p-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="badge">{item.type}</span><span className="font-medium">{item.label}</span></div><p className="mt-1 line-clamp-2 text-sm text-zinc-600">{item.detail}</p><p className="mt-1 text-xs text-zinc-500">{item.actor} - {formatDateTime(item.activity_at)}</p></div>)}</div></section>
      </div>
    </div>
  );
}

function ProjectsView({ projects, selectedProjectId, reload, selectProject, canManage }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyProject());
  const [saving, setSaving] = useState(false);
  const canEditProjects = canManage || projects.length === 0;

  function startEdit(project) {
    setEditing(project.id);
    setForm({ ...project, start_date: project.start_date || '', due_date: project.due_date || '' });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const saved = editing
        ? await api(`/api/projects/${editing}`, { method: 'PUT', body: JSON.stringify(form) })
        : await api('/api/projects', { method: 'POST', body: JSON.stringify(form) });
      setEditing(null);
      setForm(emptyProject());
      await selectProject(String(saved.id));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this project and all team members, tasks, logs, and notes under it?')) {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      await reload('');
    }
  }

  return (
    <div className="space-y-6">
      {!canEditProjects && <div className="rounded border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">Only Admin can create or edit projects.</div>}
      {canEditProjects && (
        <FormPanel title={editing ? 'Edit Project' : 'Create Project'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyProject()); } : null}>
          <TextInput label="Project Name" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          <SelectInput label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })} options={projectStatuses} />
          <TextInput label="Start Date" type="date" value={form.start_date} onChange={(start_date) => setForm({ ...form, start_date })} />
          <TextInput label="Due Date" type="date" value={form.due_date} onChange={(due_date) => setForm({ ...form, due_date })} />
          <TextArea label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} />
        </FormPanel>
      )}
      <DataTable columns={['Project', 'Status', 'Start', 'Due', 'Updated', '']} rows={projects.map((project) => [
        <button className={`text-left font-medium ${String(project.id) === String(selectedProjectId) ? 'text-emerald-700' : ''}`} onClick={() => selectProject(String(project.id))}>{project.name}<p className="text-sm font-normal text-zinc-500">{project.description}</p></button>,
        <span className="badge">{project.status}</span>,
        formatDate(project.start_date),
        formatDate(project.due_date),
        formatDateTime(project.updated_at),
        <RowActions onEdit={() => startEdit(project)} onDelete={() => remove(project.id)} canEdit={canManage} canDelete={canManage} />
      ])} />
    </div>
  );
}

function TeamView({ members, projects, selectedProjectId, reload, isAdmin }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyMember(selectedProjectId));
  const [saving, setSaving] = useState(false);
  const canManageTeam = isAdmin;

  useEffect(() => setForm((value) => ({ ...value, project_id: value.project_id || selectedProjectId })), [selectedProjectId]);

  function startEdit(member) {
    setEditing(member.id);
    setForm({ ...member, project_id: String(member.project_id) });
  }

  async function submit(event) {
    event.preventDefault();
    if (!canManageTeam) return;
    if (saving) return;
    setSaving(true);
    try {
      if (editing) await api(`/api/project-members/${editing}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/project-members', { method: 'POST', body: JSON.stringify(form) });
      setEditing(null);
      setForm(emptyMember(selectedProjectId));
      await reload(selectedProjectId);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this team member?')) {
      await api(`/api/project-members/${id}`, { method: 'DELETE' });
      await reload(selectedProjectId);
    }
  }

  return (
    <div className="space-y-6">
      <RequireProject projects={projects} />
      {!canManageTeam && <div className="rounded border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">Only Admin can add employees, edit team details, or change access levels.</div>}
      {canManageTeam && (
        <FormPanel title={editing ? 'Edit Team Member' : 'Add Team Member'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyMember(selectedProjectId)); } : null}>
          <ProjectSelect projects={projects} value={form.project_id} onChange={(project_id) => setForm({ ...form, project_id })} />
          <TextInput label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} required />
          <TextInput label="Project Role" value={form.role} onChange={(role) => setForm({ ...form, role })} />
          <SelectInput label="Project Access" value={form.access_level} onChange={(access_level) => setForm({ ...form, access_level })} options={accessLevels} />
          <TextInput label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <TextInput label="Phone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
          <TextArea label="Notes" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
        </FormPanel>
      )}
      <DataTable columns={['Name', 'Project', 'Role', 'Access', 'Email', 'Phone', '']} rows={members.map((member) => [member.name, member.project_name, member.role, <span className="badge">{member.access_level}</span>, member.email, member.phone, <RowActions onEdit={() => startEdit(member)} onDelete={() => remove(member.id)} canEdit={isAdmin} canDelete={isAdmin} />])} />
    </div>
  );
}

function UsersView({ users, reload, currentUserId }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyUser());
  const [saving, setSaving] = useState(false);

  function startEdit(user) {
    setEditing(user.id);
    setForm({ ...user, password: '', active: Boolean(user.active) });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = { ...form, active: form.active ? 1 : 0 };
      if (editing) await api(`/api/users/${editing}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
      setEditing(null);
      setForm(emptyUser());
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this login user?')) {
      await api(`/api/users/${id}`, { method: 'DELETE' });
      await reload();
    }
  }

  return (
    <div className="space-y-6">
      <FormPanel title={editing ? 'Edit Login User' : 'Create Login User'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyUser()); } : null}>
        <TextInput label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} required />
        <TextInput label="Display Name" value={form.display_name} onChange={(display_name) => setForm({ ...form, display_name })} required />
        <PasswordInput label={editing ? 'New Password' : 'Password'} value={form.password} onChange={(password) => setForm({ ...form, password })} required={!editing} />
        <SelectInput label="Role" value={form.role} onChange={(role) => setForm({ ...form, role })} options={accessLevels} />
        <label className="input-wrap">
          <span>Active</span>
          <select value={form.active ? '1' : '0'} onChange={(event) => setForm({ ...form, active: event.target.value === '1' })}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </label>
      </FormPanel>
      <DataTable columns={['Name', 'Username', 'Role', 'Status', 'Updated', '']} rows={users.map((user) => [
        user.display_name,
        user.username,
        <span className="badge">{user.role}</span>,
        user.active ? 'Active' : 'Inactive',
        formatDateTime(user.updated_at),
        <RowActions onEdit={() => startEdit(user)} onDelete={() => remove(user.id)} canDelete={Number(user.id) !== Number(currentUserId)} />
      ])} />
    </div>
  );
}

function TasksView({ tasks, projects, members, selectedProjectId, reload, canManage }) {
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyTask(selectedProjectId, members[0]));
  const [saving, setSaving] = useState(false);
  const filtered = applyTaskFilters(tasks, filters);

  useEffect(() => setForm((value) => ({ ...value, project_id: value.project_id || selectedProjectId, assignee: value.assignee || members[0] || '' })), [selectedProjectId, members]);

  function startEdit(task) {
    setEditing(task.id);
    setForm({ ...task, project_id: String(task.project_id), due_date: task.due_date || '' });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) await api(`/api/tasks/${editing}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/tasks', { method: 'POST', body: JSON.stringify(form) });
      setEditing(null);
      setForm(emptyTask(selectedProjectId, members[0]));
      await reload(selectedProjectId);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this task and its related work logs and notes?')) {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      await reload(selectedProjectId);
    }
  }

  return (
    <div className="space-y-6">
      <RequireProject projects={projects} />
      <FormPanel title={editing ? 'Edit Task' : 'Create Task'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyTask(selectedProjectId, members[0])); } : null}>
        <ProjectSelect projects={projects} value={form.project_id} onChange={(project_id) => setForm({ ...form, project_id })} />
        <TextInput label="Title" value={form.title} onChange={(title) => setForm({ ...form, title })} required />
        <TextInput label="Assignee" value={form.assignee} onChange={(assignee) => setForm({ ...form, assignee })} list="members" required />
        <SelectInput label="Priority" value={form.priority} onChange={(priority) => setForm({ ...form, priority })} options={priorities} />
        <SelectInput label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })} options={statuses} />
        <TextInput label="Due Date" type="date" value={form.due_date} onChange={(due_date) => setForm({ ...form, due_date })} />
        <TextArea label="Description" value={form.description} onChange={(description) => setForm({ ...form, description })} />
      </FormPanel>
      <FilterBar filters={filters} setFilters={setFilters} members={members} includePriority includeStatus includeMember includeDate />
      <DataTable columns={['Task', 'Project', 'Assignee', 'Priority', 'Status', 'Due', '']} rows={filtered.map((task) => [<div><p className="font-medium">{task.title}</p><p className="text-sm text-zinc-500">{task.description}</p></div>, task.project_name, task.assignee, <PriorityBadge priority={task.priority} />, <StatusBadge status={task.status} />, formatDate(task.due_date), <RowActions onEdit={() => startEdit(task)} onDelete={() => remove(task.id)} canDelete={canManage} />])} />
    </div>
  );
}

function LogsView({ logs, tasks, members, currentMember, reload, canManage }) {
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyLog(tasks[0]?.id, currentMember || members[0]));
  const [saving, setSaving] = useState(false);
  const filtered = applyLogFilters(logs, filters);

  useEffect(() => setForm((value) => ({ ...value, task_id: value.task_id || tasks[0]?.id || '', author: value.author || currentMember || members[0] || '' })), [tasks, currentMember, members]);

  function startEdit(log) {
    setEditing(log.id);
    setForm({ ...log, task_id: String(log.task_id), time_spent: formatMinutes(log.time_minutes) });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) await api(`/api/work-logs/${editing}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/work-logs', { method: 'POST', body: JSON.stringify(form) });
      setEditing(null);
      setForm(emptyLog(tasks[0]?.id, currentMember || members[0]));
      await reload(tasks[0]?.project_id || '');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this work log?')) {
      await api(`/api/work-logs/${id}`, { method: 'DELETE' });
      await reload(tasks[0]?.project_id || '');
    }
  }

  return (
    <div className="space-y-6">
      <FormPanel title={editing ? 'Edit Work Log' : 'Add Work Log'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyLog(tasks[0]?.id, currentMember || members[0])); } : null}>
        <TaskSelect tasks={tasks} value={form.task_id} onChange={(task_id) => setForm({ ...form, task_id })} />
        <TextInput label="Author" value={form.author} onChange={(author) => setForm({ ...form, author })} list="members" required />
        <TextInput label="Time Spent" value={form.time_spent} onChange={(time_spent) => setForm({ ...form, time_spent })} placeholder="4h25m" required />
        <TextInput label="Date" type="date" value={form.log_date} onChange={(log_date) => setForm({ ...form, log_date })} required />
        <TextArea label="Work Description" value={form.work_description} onChange={(work_description) => setForm({ ...form, work_description })} required />
        <TextArea label="Notes / Blockers / Next Steps" value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />
      </FormPanel>
      <FilterBar filters={filters} setFilters={setFilters} members={members} includeMember includeDate />
      <DataTable columns={['Task', 'Project', 'Author', 'Work', 'Time', 'Date', '']} rows={filtered.map((log) => [log.task_title, log.project_name, log.author, log.work_description, formatMinutes(log.time_minutes), formatDate(log.log_date), <RowActions onEdit={() => startEdit(log)} onDelete={() => remove(log.id)} canDelete={canManage} />])} />
    </div>
  );
}

function NotesView({ notes, tasks, members, currentMember, reload, canManage }) {
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyNote(tasks[0]?.id, currentMember || members[0]));
  const [saving, setSaving] = useState(false);
  const filtered = applyNoteFilters(notes, filters);

  useEffect(() => setForm((value) => ({ ...value, task_id: value.task_id || tasks[0]?.id || '', author: value.author || currentMember || members[0] || '' })), [tasks, currentMember, members]);

  function startEdit(note) {
    setEditing(note.id);
    setForm({ ...note, task_id: String(note.task_id) });
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      if (editing) await api(`/api/notes/${editing}`, { method: 'PUT', body: JSON.stringify(form) });
      else await api('/api/notes', { method: 'POST', body: JSON.stringify(form) });
      setEditing(null);
      setForm(emptyNote(tasks[0]?.id, currentMember || members[0]));
      await reload(tasks[0]?.project_id || '');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (confirm('Delete this note?')) {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      await reload(tasks[0]?.project_id || '');
    }
  }

  return (
    <div className="space-y-6">
      <FormPanel title={editing ? 'Edit Note' : 'Add Task Note'} onSubmit={submit} saving={saving} onCancel={editing ? () => { setEditing(null); setForm(emptyNote(tasks[0]?.id, currentMember || members[0])); } : null}>
        <TaskSelect tasks={tasks} value={form.task_id} onChange={(task_id) => setForm({ ...form, task_id })} />
        <TextInput label="Author" value={form.author} onChange={(author) => setForm({ ...form, author })} list="members" required />
        <TextInput label="Date" type="date" value={form.note_date} onChange={(note_date) => setForm({ ...form, note_date })} required />
        <TextArea label="Content" value={form.content} onChange={(content) => setForm({ ...form, content })} required />
      </FormPanel>
      <FilterBar filters={filters} setFilters={setFilters} members={members} includeMember includeDate />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((note) => <article key={note.id} className="rounded border border-zinc-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{note.task_title}</p><p className="text-xs text-zinc-500">{note.project_name} - {note.author} - {formatDate(note.note_date)}</p></div><RowActions onEdit={() => startEdit(note)} onDelete={() => remove(note.id)} canDelete={canManage} /></div><p className="mt-3 text-sm text-zinc-700">{note.content}</p></article>)}</div>
    </div>
  );
}

function AuditView({ auditLogs }) {
  return (
    <div className="space-y-6">
      <section className="panel">
        <Title icon={ShieldCheck} text="Admin Audit Log" />
        <p className="mt-2 text-sm text-zinc-600">Create, update, and delete actions are recorded here. Deleted records include a stored snapshot in the details field.</p>
      </section>
      <DataTable
        columns={['When', 'Actor', 'Action', 'Type', 'Project', 'Summary', 'Details']}
        rows={auditLogs.map((entry) => [
          formatDateTime(entry.created_at),
          entry.actor,
          <span className="badge">{entry.action}</span>,
          entry.entity_type,
          entry.project_name || 'Deleted / none',
          entry.summary,
          <details className="max-w-md"><summary className="cursor-pointer text-emerald-700">View</summary><pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-100 p-2 text-xs">{prettyDetails(entry.details)}</pre></details>
        ])}
      />
    </div>
  );
}

function FormPanel({ title, children, onSubmit, onCancel, saving }) {
  return (
    <form onSubmit={onSubmit} className="panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Title icon={Plus} text={title} />
        <div className="flex items-center gap-2">
          {onCancel && <button type="button" onClick={onCancel} className="secondary-button" disabled={saving}><X size={16} />Cancel</button>}
          <button className="primary-button" disabled={saving}><Save size={16} />{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </form>
  );
}

function Title({ icon: Icon, text }) {
  return <div className="section-title"><Icon size={18} /><h3>{text}</h3></div>;
}

function RequireProject({ projects }) {
  if (projects.length) return null;
  return <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Create a project before adding team members, tasks, logs, or notes.</div>;
}

function FilterBar({ filters, setFilters, members, includePriority, includeStatus, includeMember, includeDate }) {
  return (
    <section className="panel">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="input-wrap"><span><Search size={14} />Search</span><input value={filters.search || ''} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="Find records" /></label>
        {includeStatus && <SelectInput label="Status" value={filters.status || ''} onChange={(status) => setFilters({ ...filters, status })} options={['', ...statuses]} />}
        {includePriority && <SelectInput label="Priority" value={filters.priority || ''} onChange={(priority) => setFilters({ ...filters, priority })} options={['', ...priorities]} />}
        {includeMember && <SelectInput label="Team Member" value={filters.member || ''} onChange={(member) => setFilters({ ...filters, member })} options={['', ...members]} />}
        {includeDate && <TextInput label="Date" type="date" value={filters.date || ''} onChange={(date) => setFilters({ ...filters, date })} />}
      </div>
    </section>
  );
}

function DataTable({ columns, rows }) {
  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase text-zinc-500"><tr>{columns.map((column) => <th key={column} className="px-4 py-3 font-semibold">{column}</th>)}</tr></thead>
          <tbody className="divide-y divide-zinc-200">{rows.length ? rows.map((row, index) => <tr key={index} className="align-top">{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-sm px-4 py-3">{cell}</td>)}</tr>) : <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-zinc-500">No records found.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, type = 'text', required, list, step, placeholder }) {
  return <label className="input-wrap"><span>{label}</span><input type={type} step={step} value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} list={list} placeholder={placeholder} /></label>;
}

function PasswordInput({ label, value, onChange, required }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <label className="input-wrap">
      <span>{label}</span>
      <div className="relative">
        <input className="pr-11" type={visible ? 'text' : 'password'} value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} />
        <button
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          type="button"
          onClick={() => setVisible((next) => !next)}
          title={visible ? 'Hide password' : 'Show password'}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <Icon size={18} />
        </button>
      </div>
    </label>
  );
}

function TextArea({ label, value, onChange, required }) {
  return <label className="input-wrap md:col-span-2"><span>{label}</span><textarea value={value || ''} onChange={(e) => onChange(e.target.value)} required={required} rows={3} /></label>;
}

function SelectInput({ label, value, onChange, options, disabled }) {
  return <label className="input-wrap"><span>{label}</span><select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{options.map((option) => <option key={option} value={option}>{option || 'Any'}</option>)}</select></label>;
}

function SelectBare({ value, onChange, children, disabled }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none">{children}</select>;
}

function ProjectSelect({ projects, value, onChange }) {
  return <label className="input-wrap"><span>Project</span><select value={value || ''} onChange={(e) => onChange(e.target.value)} required><option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>;
}

function TaskSelect({ tasks, value, onChange }) {
  return <label className="input-wrap"><span>Task</span><select value={value || ''} onChange={(e) => onChange(e.target.value)} required><option value="" disabled>Select task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>;
}

function RowActions({ onEdit, onDelete, canDelete, canEdit = true }) {
  return <div className="flex items-center gap-2">{canEdit && <button className="icon-button" type="button" onClick={onEdit} title="Edit"><Edit size={16} /></button>}{canDelete && <button className="icon-button danger" type="button" onClick={onDelete} title="Delete"><Trash2 size={16} /></button>}</div>;
}

function StatusBadge({ status }) {
  const classes = { Pending: 'bg-amber-50 text-amber-700 border-amber-200', 'In Progress': 'bg-blue-50 text-blue-700 border-blue-200', Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200', Blocked: 'bg-red-50 text-red-700 border-red-200' };
  return <span className={`badge ${classes[status]}`}>{status}</span>;
}

function PriorityBadge({ priority }) {
  const classes = { Low: 'bg-zinc-50 text-zinc-700 border-zinc-200', Medium: 'bg-sky-50 text-sky-700 border-sky-200', High: 'bg-rose-50 text-rose-700 border-rose-200' };
  return <span className={`badge ${classes[priority]}`}>{priority}</span>;
}

function emptyProject() {
  return { name: '', description: '', status: 'Active', start_date: '', due_date: '' };
}

function emptyMember(projectId) {
  return { project_id: projectId || '', name: '', role: '', access_level: 'Employee', email: '', phone: '', notes: '' };
}

function emptyUser() {
  return { username: '', display_name: '', password: '', role: 'Employee', active: true };
}

function emptyTask(projectId, member) {
  return { project_id: projectId || '', title: '', description: '', assignee: member || '', priority: 'Medium', status: 'Pending', due_date: '' };
}

function emptyLog(taskId, member) {
  return { task_id: taskId ? String(taskId) : '', author: member || '', work_description: '', time_spent: '', log_date: today(), notes: '' };
}

function emptyNote(taskId, member) {
  return { task_id: taskId ? String(taskId) : '', author: member || '', content: '', note_date: today() };
}

function applyTaskFilters(rows, filters) {
  return rows.filter((row) => matchesSearch(row, filters.search, ['title', 'description', 'assignee', 'project_name']) && (!filters.status || row.status === filters.status) && (!filters.priority || row.priority === filters.priority) && (!filters.member || row.assignee === filters.member) && (!filters.date || row.due_date === filters.date));
}

function applyLogFilters(rows, filters) {
  return rows.filter((row) => matchesSearch(row, filters.search, ['task_title', 'work_description', 'notes', 'author', 'project_name']) && (!filters.member || row.author === filters.member) && (!filters.date || row.log_date === filters.date));
}

function applyNoteFilters(rows, filters) {
  return rows.filter((row) => matchesSearch(row, filters.search, ['task_title', 'content', 'author', 'project_name']) && (!filters.member || row.author === filters.member) && (!filters.date || row.note_date === filters.date));
}

function matchesSearch(row, search, fields) {
  if (!search) return true;
  const needle = search.toLowerCase();
  return fields.some((field) => String(row[field] || '').toLowerCase().includes(needle));
}

function statusKey(status) {
  return status.toLowerCase().replace(' ', '_');
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(`${value}T00:00:00`).toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function formatMinutes(minutes) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours && mins) return `${hours}h${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function prettyDetails(details) {
  if (!details) return 'No details';
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

createRoot(document.getElementById('root')).render(<App />);
