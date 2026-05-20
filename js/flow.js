import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.FLOW_SUPABASE_CONFIG ?? {};
const SUPABASE_URL = cfg.url || '';
const SUPABASE_ANON_KEY = cfg.anonKey || '';
const SUPABASE_CONFIGURED =
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;

let supabase = null;
if (SUPABASE_CONFIGURED) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.error('Supabase client init failed', e);
  }
}

function formatNetworkError(err) {
  const msg = err?.message || String(err);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
    return 'Cannot reach Supabase — check internet, allow supabase.co (disable ad blockers), and open http://127.0.0.1:8765/flow.html';
  }
  return msg;
}

function refreshTeamAccounts() {
  const hint = document.getElementById('demoCredsBody');
  if (!hint) return;
  hint.innerHTML = USERS.length
    ? USERS.map(u => `<tr><td>${esc(u.email)}</td><td>${esc(u.name)}</td></tr>`).join('')
    : '<tr><td colspan="2">No profiles yet — add users in Supabase → Authentication, then run sql/02-sync-auth-users.sql</td></tr>';
}

const STATUSES = ['todo', 'prog', 'done'];
const ICONS = ['🚀', '📦', '🎨', '🛠️', '🔬', '📊', '💡', '🌐', '🔐', '📱'];
const COLORS = ['#c8f564', '#64c8f5', '#f564a0', '#ef9f27', '#a78bfa', '#34d399', '#f87171', '#60a5fa'];

let USERS = [];
let MEMBERS = [];
let state = { projects: [] };
let currentUser = null;
let currentView = 'dashboard';
let currentProjectId = null;
let filterAssignee = '';
let editingTicketId = null;
let selectedIcon = ICONS[0];
let selectedColor = COLORS[0];
let ticketModalReadOnly = false;
let loginFormBound = false;
let ticketImageHandlersBound = false;

const TICKET_IMAGE_BUCKET = 'ticket-images';
const TICKET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TICKET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** @type {{ file: File, previewUrl: string } | null} */
let pendingTicketImage = null;
/** @type {string | null} */
let existingTicketImageUrl = null;
let removeTicketImage = false;

function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function getUser(name) {
  return USERS.find(u => u.name === name);
}

function renderAvatarHtml(name, sizeClass) {
  const u = getUser(name);
  const cls = sizeClass ? `avatar ${sizeClass}` : 'avatar';
  if (!u) return `<span class="${cls}">${esc((name || '?').charAt(0))}</span>`;
  return `<span class="${cls}" style="background:${u.bg};color:${u.color};border:1px solid ${u.color}">${esc(u.initial)}</span>`;
}

function isOwnTicket(ticket) {
  return currentUser && ticket.assignee === currentUser.name;
}

function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : 'info');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function populateMemberDropdowns() {
  const opts = '<option value="">All members</option>' +
    MEMBERS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  const filter = document.getElementById('filterAssignee');
  const cur = filter.value;
  filter.innerHTML = opts;
  filter.value = MEMBERS.includes(cur) ? cur : '';
  document.getElementById('ticketAssignee').innerHTML =
    MEMBERS.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
}

function renderSessionBox() {
  if (!currentUser) return;
  document.getElementById('sessionBox').innerHTML = `
    <div class="session-user">
      <span class="session-avatar" style="background:${esc(currentUser.bg)};color:${esc(currentUser.color)};border:1px solid ${esc(currentUser.color)}">${esc(currentUser.initial)}</span>
      <div>
        <div class="session-name">${esc(currentUser.name)}</div>
        <div class="session-status">Logged in</div>
      </div>
    </div>
    <button type="button" class="btn btn-ghost btn-logout" id="btnLogout">Log out</button>
  `;
  document.getElementById('btnLogout').addEventListener('click', logout);
}

async function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.add('visible');
  document.documentElement.style.setProperty('--user-accent', currentUser.color);
  renderSessionBox();
  populateMemberDropdowns();
  initPickers();
  initTicketImageHandlers();
  try {
    await loadState();
    render();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to load data', 'error');
  }
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appRoot').classList.remove('visible');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').textContent = '';
}

async function setCurrentUserFromSession(session) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, name, email, color, bg, initial')
    .eq('id', session.user.id)
    .single();
  if (error || !profile) throw new Error('Profile not found. Run supabase/sql/02-sync-auth-users.sql.');
  currentUser = {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    bg: profile.bg,
    initial: profile.initial,
  };
}

async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) return { ok: false, message: error.message };
  await setCurrentUserFromSession(data.session);
  return { ok: true };
}

async function logout() {
  await supabase.auth.signOut();
  editingTicketId = null;
  filterAssignee = '';
  closeProjectModal();
  closeTicketModal();
  currentView = 'dashboard';
  currentProjectId = null;
  currentUser = null;
  state = { projects: [] };
  document.getElementById('viewDashboard').classList.add('active');
  document.getElementById('viewBoard').classList.remove('active');
  document.getElementById('navDashboard').classList.add('active');
  document.querySelectorAll('.nav-project').forEach(el => el.classList.remove('active'));
  showLogin();
}

function projectPrefix(name) {
  const letters = name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (letters.length >= 3) return letters.slice(0, 3);
  return (letters + 'XXX').slice(0, 3);
}

function formatTicketId(project, ticket) {
  const num = ticket.ticketNum ?? ticket.ticket_number ?? 0;
  return projectPrefix(project.name) + '-' + String(num).padStart(3, '0');
}

function getProject(id) {
  return state.projects.find(p => p.id === id);
}

function priorityLabel(p) {
  return { high: 'high', med: 'medium', low: 'low' }[p] || p;
}

function mapTicket(row) {
  return {
    id: row.id,
    ticketNum: row.ticket_number,
    title: row.title,
    desc: row.description || '',
    assignee: row.assignee_name,
    priority: row.priority,
    status: row.status,
    imageUrl: row.image_url || null,
  };
}

function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/${TICKET_IMAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length)) : null;
}

function extFromMime(mime) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[mime] || 'jpg';
}

function resetTicketImageState() {
  if (pendingTicketImage?.previewUrl) URL.revokeObjectURL(pendingTicketImage.previewUrl);
  pendingTicketImage = null;
  existingTicketImageUrl = null;
  removeTicketImage = false;
}

function renderTicketImagePreview() {
  const drop = document.getElementById('ticketImageDrop');
  const preview = document.getElementById('ticketImagePreview');
  const img = document.getElementById('ticketImageImg');
  const url = pendingTicketImage?.previewUrl || (!removeTicketImage && existingTicketImageUrl) || null;
  if (url) {
    img.src = url;
    preview.classList.remove('hidden');
    drop.classList.add('hidden');
  } else {
    img.removeAttribute('src');
    preview.classList.add('hidden');
    drop.classList.remove('hidden');
  }
}

function normalizeImageFile(file) {
  if (!file || !file.size) return null;
  if (file.type && TICKET_IMAGE_TYPES.includes(file.type)) return file;
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext];
  if (mime) return new File([file], file.name || `image.${ext}`, { type: mime });
  if (!file.type || file.type === 'application/octet-stream') {
    return new File([file], file.name || 'pasted-image.png', { type: 'image/png' });
  }
  return null;
}

function setTicketImageFromFile(file) {
  const normalized = normalizeImageFile(file);
  if (!normalized) {
    showToast('Use JPEG, PNG, GIF, or WebP', 'error');
    return;
  }
  file = normalized;
  if (!TICKET_IMAGE_TYPES.includes(file.type)) {
    showToast('Use JPEG, PNG, GIF, or WebP', 'error');
    return;
  }
  if (file.size > TICKET_IMAGE_MAX_BYTES) {
    showToast('Image must be under 5 MB', 'error');
    return;
  }
  if (pendingTicketImage?.previewUrl) URL.revokeObjectURL(pendingTicketImage.previewUrl);
  pendingTicketImage = { file, previewUrl: URL.createObjectURL(file) };
  removeTicketImage = false;
  renderTicketImagePreview();
}

function setTicketImageUIReadonly(readonly) {
  const group = document.getElementById('ticketImageGroup');
  if (group) group.classList.toggle('readonly', readonly);
}

async function uploadTicketImage(projectId, ticketId, file) {
  const path = `${projectId}/${ticketId}/${Date.now()}.${extFromMime(file.type)}`;
  const { error } = await supabase.storage.from(TICKET_IMAGE_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(TICKET_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function deleteStorageImage(publicUrl) {
  const path = storagePathFromPublicUrl(publicUrl);
  if (!path) return;
  await supabase.storage.from(TICKET_IMAGE_BUCKET).remove([path]);
}

async function resolveTicketImageUrl(projectId, ticketId, previousUrl) {
  if (removeTicketImage) {
    if (previousUrl) await deleteStorageImage(previousUrl);
    return null;
  }
  if (pendingTicketImage?.file) {
    if (previousUrl) await deleteStorageImage(previousUrl);
    return uploadTicketImage(projectId, ticketId, pendingTicketImage.file);
  }
  return previousUrl || null;
}

function initTicketImageHandlers() {
  if (ticketImageHandlersBound) return;
  ticketImageHandlersBound = true;

  const drop = document.getElementById('ticketImageDrop');
  const input = document.getElementById('ticketImageInput');
  const removeBtn = document.getElementById('ticketImageRemove');
  const modal = document.getElementById('ticketModal');

  input.addEventListener('change', () => {
    if (ticketModalReadOnly) return;
    const file = input.files?.[0];
    if (file) setTicketImageFromFile(file);
    input.value = '';
  });

  drop.addEventListener('click', e => {
    if (ticketModalReadOnly) e.preventDefault();
  });

  removeBtn.addEventListener('click', () => {
    if (pendingTicketImage?.previewUrl) URL.revokeObjectURL(pendingTicketImage.previewUrl);
    pendingTicketImage = null;
    removeTicketImage = true;
    renderTicketImagePreview();
  });

  drop.addEventListener('dragover', e => {
    e.preventDefault();
    if (!ticketModalReadOnly) drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (ticketModalReadOnly) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) setTicketImageFromFile(file);
  });

  document.addEventListener('paste', e => {
    const overlay = document.getElementById('ticketModalOverlay');
    if (!overlay?.classList.contains('open') || ticketModalReadOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setTicketImageFromFile(file);
          showToast('Image pasted', 'info');
          break;
        }
      }
    }
  });
}

function mapProject(row, tickets) {
  return {
    id: row.id,
    name: row.name,
    desc: row.description || '',
    icon: row.icon,
    color: row.color,
    tickets: tickets.map(mapTicket),
  };
}

async function loadProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, color, bg, initial')
    .order('name');
  if (error) throw error;
  USERS = data || [];
  MEMBERS = USERS.map(u => u.name);
}

async function loadState() {
  const [{ data: projects, error: pErr }, { data: tickets, error: tErr }] = await Promise.all([
    supabase.from('projects').select('*').order('created_at', { ascending: true }),
    supabase.from('tickets').select('*').order('ticket_number', { ascending: true }),
  ]);
  if (pErr) throw pErr;
  if (tErr) throw tErr;
  const byProject = {};
  (tickets || []).forEach(t => {
    if (!byProject[t.project_id]) byProject[t.project_id] = [];
    byProject[t.project_id].push(t);
  });
  state.projects = (projects || []).map(p => mapProject(p, byProject[p.id] || []));
}

async function nextTicketNumber(projectId) {
  const { data, error } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('project_id', projectId)
    .order('ticket_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.ticket_number || 0) + 1;
}

function setTicketAssigneeField(mode, assigneeName) {
  const sel = document.getElementById('ticketAssignee');
  const ro = document.getElementById('ticketAssigneeReadonly');
  if (mode === 'new' || mode === 'edit-own') {
    sel.style.display = '';
    ro.style.display = 'none';
    sel.disabled = false;
    if (assigneeName) sel.value = assigneeName;
  } else {
    sel.style.display = 'none';
    ro.style.display = '';
    sel.disabled = true;
    ro.textContent = assigneeName || '';
  }
}

function setTicketModalMode(mode, ticket) {
  const readonly = mode === 'view';
  ticketModalReadOnly = readonly;
  const form = document.getElementById('ticketForm');
  const hint = document.getElementById('ticketViewHint');
  const saveBtn = document.getElementById('ticketSaveBtn');
  const cancelBtn = document.getElementById('ticketCancel');
  form.classList.toggle('ticket-modal-readonly', readonly);
  hint.style.display = readonly ? 'block' : 'none';
  saveBtn.style.display = readonly ? 'none' : '';
  cancelBtn.textContent = readonly ? 'Close' : 'Cancel';
  const titleInput = document.getElementById('ticketTitle');
  const descInput = document.getElementById('ticketDesc');
  const prioritySel = document.getElementById('ticketPriority');
  const statusSel = document.getElementById('ticketStatus');
  titleInput.disabled = readonly;
  titleInput.readOnly = readonly;
  descInput.disabled = readonly;
  descInput.readOnly = readonly;
  prioritySel.disabled = readonly;
  statusSel.disabled = readonly;
  setTicketImageUIReadonly(readonly);
  if (mode === 'view' && ticket) setTicketAssigneeField('view', ticket.assignee);
  else if (mode === 'new') setTicketAssigneeField('new', currentUser.name);
  else if (mode === 'edit' && ticket) setTicketAssigneeField('edit-own', ticket.assignee);
}

function allTickets() {
  return state.projects.flatMap(p => p.tickets);
}

function projectStats(project) {
  const t = project.tickets;
  const done = t.filter(x => x.status === 'done').length;
  const total = t.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { total, done, pct, todo: t.filter(x => x.status === 'todo').length, prog: t.filter(x => x.status === 'prog').length };
}

function globalStats() {
  const tickets = allTickets();
  return {
    projects: state.projects.length,
    total: tickets.length,
    prog: tickets.filter(t => t.status === 'prog').length,
    done: tickets.filter(t => t.status === 'done').length,
  };
}

function assignedMembers(project) {
  const set = new Set(project.tickets.map(t => t.assignee));
  return MEMBERS.filter(m => set.has(m));
}

function navigate(view, projectId) {
  if (!currentUser) return;
  currentView = view;
  currentProjectId = projectId ?? null;
  if (view === 'board') filterAssignee = '';
  const filterEl = document.getElementById('filterAssignee');
  if (filterEl) filterEl.value = '';
  document.getElementById('viewDashboard').classList.toggle('active', view === 'dashboard');
  document.getElementById('viewBoard').classList.toggle('active', view === 'board');
  document.getElementById('navDashboard').classList.toggle('active', view === 'dashboard');
  document.querySelectorAll('.nav-project').forEach(el => {
    el.classList.toggle('active', view === 'board' && el.dataset.projectId === projectId);
  });
  render();
}

function openBoard(projectId) {
  if (!getProject(projectId)) return;
  navigate('board', projectId);
}

function render() {
  if (!currentUser) return;
  renderSidebar();
  if (currentView === 'dashboard') renderDashboard();
  else renderBoard();
}

function renderSidebar() {
  const container = document.getElementById('navProjects');
  container.innerHTML = state.projects.map(p => `
    <button type="button" class="nav-item nav-project ${currentView === 'board' && currentProjectId === p.id ? 'active' : ''}"
      data-project-id="${p.id}">
      <span class="nav-emoji">${esc(p.icon)}</span>
      <span class="nav-text">${esc(p.name)}</span>
    </button>
  `).join('');
  container.querySelectorAll('.nav-project').forEach(btn => {
    btn.addEventListener('click', () => openBoard(btn.dataset.projectId));
  });
}

function renderDashboard() {
  const gs = globalStats();
  document.getElementById('dashSubtitle').textContent =
    `${gs.projects} project${gs.projects !== 1 ? 's' : ''} · ${gs.total} ticket${gs.total !== 1 ? 's' : ''}`;
  document.getElementById('dashStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-num cyan">${gs.projects}</div></div>
    <div class="stat-card"><div class="stat-label">Total Tickets</div><div class="stat-num">${gs.total}</div></div>
    <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-num cyan">${gs.prog}</div></div>
    <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-num lime">${gs.done}</div></div>
  `;
  const grid = document.getElementById('projectsGrid');
  const cards = state.projects.map(p => {
    const st = projectStats(p);
    const members = assignedMembers(p);
    return `
      <article class="proj-card" data-project-id="${p.id}">
        <div class="proj-stripe" style="background:${esc(p.color)}"></div>
        <div class="proj-body">
          <button type="button" class="proj-delete" aria-label="Delete project">✕</button>
          <div class="proj-header">
            <div class="proj-icon-box">${esc(p.icon)}</div>
            <div><div class="proj-name">${esc(p.name)}</div></div>
          </div>
          <div class="proj-desc">${esc(p.desc || '')}</div>
          <div class="proj-progress-track"><div class="proj-progress-fill" style="width:${st.pct}%;background:${esc(p.color)}"></div></div>
          <div class="proj-footer">
            <span class="proj-meta">${st.total} tickets · ${st.pct}% done</span>
            <div class="proj-avatars">${members.map(m => renderAvatarHtml(m, 'xs')).join('')}</div>
          </div>
        </div>
      </article>
    `;
  }).join('');
  grid.innerHTML = cards + `<div class="add-proj-card" id="addProjCard" title="New project">+</div>`;
  grid.querySelectorAll('.proj-card').forEach(card => {
    const pid = card.dataset.projectId;
    card.addEventListener('click', () => openBoard(pid));
    card.querySelector('.proj-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteProject(pid);
    });
  });
  document.getElementById('addProjCard').addEventListener('click', openProjectModal);
}

function renderBoard() {
  const project = getProject(currentProjectId);
  if (!project) { navigate('dashboard'); return; }
  const st = projectStats(project);
  document.getElementById('boardIcon').textContent = project.icon;
  document.getElementById('boardTitle').textContent = project.name;
  document.getElementById('boardSubtitle').textContent =
    `${st.total} ticket${st.total !== 1 ? 's' : ''} · ${st.done} done`;
  document.getElementById('boardStats').innerHTML = `
    <div class="board-stat"><div class="stat-label">Total</div><div class="stat-num">${st.total}</div></div>
    <div class="board-stat"><div class="stat-label">To Do</div><div class="stat-num">${st.todo}</div></div>
    <div class="board-stat"><div class="stat-label">In Progress</div><div class="stat-num cyan">${st.prog}</div></div>
    <div class="board-stat"><div class="stat-label">Done</div><div class="stat-num lime">${st.done}</div></div>
    <div class="board-stat"><div class="stat-label">Completion</div><div class="stat-num pink">${st.pct}%</div></div>
  `;
  const filtered = filterAssignee
    ? project.tickets.filter(t => t.assignee === filterAssignee)
    : project.tickets;
  const cols = { todo: document.getElementById('colTodo'), prog: document.getElementById('colProg'), done: document.getElementById('colDone') };
  const countIds = { todo: 'countTodo', prog: 'countProg', done: 'countDone' };
  STATUSES.forEach(s => { cols[s].innerHTML = ''; });
  STATUSES.forEach(status => {
    const inCol = filtered.filter(t => t.status === status);
    const mine = inCol.filter(t => t.assignee === currentUser.name).length;
    const total = inCol.length;
    document.getElementById(countIds[status]).textContent = total ? `${mine} / ${total}` : '0';
    if (total === 0) cols[status].innerHTML = '<div class="column-empty">No tickets</div>';
    else inCol.forEach(ticket => cols[status].appendChild(buildTicketCard(project, ticket)));
  });
}

function buildTicketCard(project, ticket) {
  const el = document.createElement('article');
  const own = isOwnTicket(ticket);
  el.className = 'ticket-card ' + (own ? 'own' : 'other');
  if (own) el.style.borderLeftColor = currentUser.color;
  const moves = [];
  if (own) {
    if (ticket.status === 'todo') moves.push('<button type="button" class="move-btn" data-move="prog">→ In Progress</button>');
    else if (ticket.status === 'prog') {
      moves.push('<button type="button" class="move-btn" data-move="todo">→ To Do</button>');
      moves.push('<button type="button" class="move-btn" data-move="done">→ Done</button>');
    } else moves.push('<button type="button" class="move-btn" data-move="prog">→ In Progress</button>');
  }
  el.innerHTML = `
    ${own ? '<button type="button" class="ticket-delete" aria-label="Delete">✕</button>' : ''}
    <div class="ticket-id">${esc(formatTicketId(project, ticket))}</div>
    <div class="ticket-title">${esc(ticket.title)}</div>
    ${ticket.imageUrl ? `<div class="ticket-card-thumb"><img src="${esc(ticket.imageUrl)}" alt=""></div>` : ''},
    ${ticket.desc ? `<div class="ticket-desc">${esc(ticket.desc)}</div>` : ''}
    <div class="ticket-footer">
      <span class="priority-badge priority-${esc(ticket.priority)}">${esc(priorityLabel(ticket.priority))}</span>
      ${renderAvatarHtml(ticket.assignee, 'sm')}
    </div>
    ${moves.length ? `<div class="ticket-moves">${moves.join('')}</div>` : ''}
  `;
  if (own) {
    el.querySelector('.ticket-delete').addEventListener('click', e => { e.stopPropagation(); deleteTicket(project.id, ticket.id); });
    el.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); moveTicket(project.id, ticket.id, btn.dataset.move); });
    });
  }
  el.addEventListener('click', e => {
    if (e.target.closest('.ticket-delete, .move-btn')) return;
    openTicketModal(project.id, ticket.id);
  });
  return el;
}

async function moveTicket(projectId, ticketId, status) {
  if (!currentUser) return;
  const project = getProject(projectId);
  const ticket = project?.tickets.find(t => t.id === ticketId);
  if (!ticket || ticket.status === status) return;
  if (!isOwnTicket(ticket)) { showToast(`Only ${ticket.assignee} can move this ticket`, 'error'); return; }
  const { error } = await supabase.from('tickets').update({ status }).eq('id', ticketId);
  if (error) { showToast(error.message, 'error'); return; }
  await loadState();
  render();
}

async function deleteTicket(projectId, ticketId) {
  if (!currentUser) return;
  const project = getProject(projectId);
  const ticket = project?.tickets.find(t => t.id === ticketId);
  if (!ticket) return;
  if (!isOwnTicket(ticket)) { showToast(`Only ${ticket.assignee} can delete this ticket`, 'error'); return; }
  if (!confirm(`Delete ticket "${ticket.title}"?`)) return;
  const { error } = await supabase.from('tickets').delete().eq('id', ticketId);
  if (error) { showToast(error.message, 'error'); return; }
  await loadState();
  render();
}

async function deleteProject(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  if (!confirm(`Delete project "${project.name}" and all its tickets?`)) return;
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) { showToast(error.message, 'error'); return; }
  if (currentProjectId === projectId) navigate('dashboard');
  await loadState();
  render();
}

function renderPickers() {
  document.getElementById('iconPicker').innerHTML = ICONS.map(icon =>
    `<button type="button" class="icon-tile ${icon === selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</button>`
  ).join('');
  document.getElementById('colorPicker').innerHTML = COLORS.map(c =>
    `<button type="button" class="color-swatch ${c === selectedColor ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>`
  ).join('');
}

function updatePickerSelection() {
  document.querySelectorAll('#iconPicker .icon-tile').forEach(t => t.classList.toggle('selected', t.dataset.icon === selectedIcon));
  document.querySelectorAll('#colorPicker .color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === selectedColor));
}

function bindPickersOnce() {
  document.getElementById('iconPicker').addEventListener('click', e => {
    const tile = e.target.closest('.icon-tile');
    if (!tile) return;
    selectedIcon = tile.dataset.icon;
    updatePickerSelection();
  });
  document.getElementById('colorPicker').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    selectedColor = swatch.dataset.color;
    updatePickerSelection();
  });
}

function initPickers() { renderPickers(); bindPickersOnce(); }

function openProjectModal() {
  if (!currentUser) return;
  selectedIcon = ICONS[0];
  selectedColor = COLORS[0];
  document.getElementById('projName').classList.remove('error');
  document.getElementById('projectForm').reset();
  renderPickers();
  updatePickerSelection();
  document.getElementById('projectModalOverlay').classList.add('open');
  document.getElementById('projName').focus();
}

function closeProjectModal() {
  document.getElementById('projectModalOverlay').classList.remove('open');
}

async function createProject(e) {
  e.preventDefault();
  if (!currentUser) return;
  const nameInput = document.getElementById('projName');
  const name = nameInput.value.trim();
  if (!name) { nameInput.classList.add('error'); nameInput.focus(); return; }
  const { data, error } = await supabase.from('projects').insert({
    name,
    description: document.getElementById('projDesc').value.trim(),
    icon: selectedIcon,
    color: selectedColor,
  }).select().single();
  if (error) { showToast(error.message, 'error'); return; }
  closeProjectModal();
  await loadState();
  openBoard(data.id);
}

function openTicketModal(projectId, ticketId) {
  if (!currentUser || !projectId) return;
  const project = getProject(projectId);
  if (!project) return;
  resetTicketImageState();
  editingTicketId = ticketId || null;
  const titleInput = document.getElementById('ticketTitle');
  titleInput.classList.remove('error');
  if (ticketId) {
    const t = project.tickets.find(x => x.id === ticketId);
    if (!t) return;
    const canEdit = isOwnTicket(t);
    document.getElementById('ticketModalTitle').textContent =
      (canEdit ? 'Edit · ' : 'View · ') + formatTicketId(project, t);
    document.getElementById('ticketTitle').value = t.title;
    document.getElementById('ticketDesc').value = t.desc || '';
    document.getElementById('ticketPriority').value = t.priority;
    document.getElementById('ticketStatus').value = t.status;
    existingTicketImageUrl = t.imageUrl || null;
    setTicketModalMode(canEdit ? 'edit' : 'view', t);
  } else {
    document.getElementById('ticketModalTitle').textContent = 'New ticket';
    document.getElementById('ticketForm').reset();
    document.getElementById('ticketPriority').value = 'med';
    document.getElementById('ticketStatus').value = 'todo';
    setTicketModalMode('new');
  }
  renderTicketImagePreview();
  document.getElementById('ticketModalOverlay').classList.add('open');
  document.getElementById('ticketModalOverlay').dataset.projectId = projectId;
  if (!ticketModalReadOnly) setTimeout(() => titleInput.focus(), 40);
}

function closeTicketModal() {
  document.getElementById('ticketModalOverlay').classList.remove('open');
  editingTicketId = null;
  ticketModalReadOnly = false;
  resetTicketImageState();
  if (currentUser) setTicketModalMode('new');
}

async function saveTicket(e) {
  e.preventDefault();
  if (!currentUser || ticketModalReadOnly) return;
  const projectId = document.getElementById('ticketModalOverlay').dataset.projectId;
  const project = getProject(projectId);
  if (!project) return;
  const titleInput = document.getElementById('ticketTitle');
  const title = titleInput.value.trim();
  if (!title) { titleInput.classList.add('error'); titleInput.focus(); return; }
  const sel = document.getElementById('ticketAssignee');
  const payload = {
    title,
    description: document.getElementById('ticketDesc').value.trim(),
    assignee_name: sel.disabled ? undefined : sel.value,
    priority: document.getElementById('ticketPriority').value,
    status: document.getElementById('ticketStatus').value,
  };
  if (editingTicketId) {
    const t = project.tickets.find(x => x.id === editingTicketId);
    if (!t || !isOwnTicket(t)) {
      showToast(`Only ${t ? t.assignee : 'the assignee'} can edit this ticket`, 'error');
      return;
    }
    if (payload.assignee_name === undefined) delete payload.assignee_name;
    if (pendingTicketImage?.file || removeTicketImage) {
      try {
        payload.image_url = await resolveTicketImageUrl(projectId, editingTicketId, t.imageUrl);
      } catch (imgErr) {
        showToast(imgErr.message || 'Image upload failed', 'error');
        return;
      }
    }
    const { error } = await supabase.from('tickets').update(payload).eq('id', editingTicketId);
    if (error) { showToast(error.message, 'error'); return; }
    closeTicketModal();
    showToast('Ticket saved', 'info');
  } else {
    if (!MEMBERS.includes(payload.assignee_name)) payload.assignee_name = currentUser.name;
    const ticketNum = await nextTicketNumber(projectId);
    const { data: created, error } = await supabase.from('tickets').insert({
      project_id: projectId,
      ticket_number: ticketNum,
      title: payload.title,
      description: payload.description,
      assignee_name: payload.assignee_name,
      priority: payload.priority,
      status: payload.status,
    }).select('id').single();
    if (error) { showToast(error.message, 'error'); return; }
    if (pendingTicketImage?.file) {
      try {
        const image_url = await resolveTicketImageUrl(projectId, created.id, null);
        if (image_url) {
          await supabase.from('tickets').update({ image_url }).eq('id', created.id);
        }
      } catch (imgErr) {
        showToast(imgErr.message || 'Image upload failed', 'error');
        return;
      }
    }
    closeTicketModal();
    showToast('Ticket created', 'info');
  }
  await loadState();
  render();
}

function initLogin() {
  if (loginFormBound) return;
  loginFormBound = true;

  refreshTeamAccounts();
  const clearError = () => { document.getElementById('loginError').textContent = ''; };
  document.getElementById('loginUser').addEventListener('input', clearError);
  document.getElementById('loginPass').addEventListener('input', clearError);

  const form = document.getElementById('loginForm');
  const submitBtn = document.getElementById('loginSubmit');

  async function attemptLogin() {
    if (!supabase) {
      document.getElementById('loginError').textContent =
        'Supabase not loaded. Check supabase/config.js and refresh.';
      return;
    }
    const email = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    submitBtn.disabled = true;
    document.getElementById('loginError').textContent = 'Signing in…';
    try {
      const result = await login(email, password);
      if (result.ok) {
        document.getElementById('loginError').textContent = '';
        await showApp();
      } else {
        document.getElementById('loginError').textContent = result.message || 'Invalid email or password';
      }
    } catch (err) {
      document.getElementById('loginError').textContent = formatNetworkError(err);
    } finally {
      submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener('click', attemptLogin);
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      attemptLogin();
    }
  });
}

document.getElementById('navDashboard').addEventListener('click', () => navigate('dashboard'));
document.getElementById('btnBack').addEventListener('click', () => navigate('dashboard'));
document.getElementById('btnNewProject').addEventListener('click', openProjectModal);
document.getElementById('btnNewTicket').addEventListener('click', () => {
  if (currentProjectId) openTicketModal(currentProjectId);
});
document.getElementById('projCancel').addEventListener('click', closeProjectModal);
document.getElementById('ticketCancel').addEventListener('click', closeTicketModal);
document.getElementById('projectForm').addEventListener('submit', createProject);
document.getElementById('ticketForm').addEventListener('submit', saveTicket);
document.getElementById('projectModalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeProjectModal();
});
document.getElementById('ticketModalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTicketModal();
});
document.getElementById('projectModal').addEventListener('click', e => e.stopPropagation());
document.getElementById('ticketModal').addEventListener('click', e => e.stopPropagation());
document.getElementById('filterAssignee').addEventListener('change', e => {
  filterAssignee = e.target.value;
  renderBoard();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeProjectModal(); closeTicketModal(); }
});

async function boot() {
  initLogin();

  if (!window.FLOW_SUPABASE_CONFIG) {
    document.getElementById('loginError').textContent =
      'Missing supabase/config.js — hard refresh (Ctrl+Shift+R).';
    return;
  }
  if (!SUPABASE_CONFIGURED || !supabase) {
    document.getElementById('loginError').textContent =
      'Add your anon key to supabase/config.js (Dashboard → Settings → API), then hard refresh.';
    return;
  }
  try {
    await loadProfiles();
    refreshTeamAccounts();
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await setCurrentUserFromSession(session);
      await showApp();
    }
  } catch (err) {
    console.error(err);
    document.getElementById('loginError').textContent = formatNetworkError(err);
  }
}

initTicketImageHandlers();
boot();

