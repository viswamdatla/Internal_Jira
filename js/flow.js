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
    : '<tr><td colspan="2">No profiles yet — add users in Authentication, then run sql/06-fix-login.sql</td></tr>';
}

const STATUSES = ['todo', 'prog', 'done'];

/** Allowed status transitions (todo → prog → done; can move back one step) */
const STATUS_TRANSITIONS = {
  todo: ['prog'],
  prog: ['todo', 'done'],
  done: ['prog'],
};

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
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
let ticketModalCanEditDetails = false;
let ticketModalCanChangeStatus = false;
let loginFormBound = false;
let ticketImageHandlersBound = false;

const TICKET_IMAGE_BUCKET = 'ticket-images';
const TICKET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TICKET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** @type {{ id: string, file: File, previewUrl: string }[]} */
let pendingTicketImages = [];
/** @type {string[]} */
let existingTicketImageUrls = [];
/** @type {Set<string>} */
let removedExistingImageUrls = new Set();
let pendingImageIdSeq = 0;

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

const FLOW_DEBUG = typeof localStorage !== 'undefined' && localStorage.getItem('FLOW_DEBUG') === '1';
const signedUrlCache = new Map();
const lightboxState = { urls: [], index: 0, currentUrl: null, currentDisplayUrl: null };

function flowLog(...args) {
  if (FLOW_DEBUG) console.log('[FLOW]', ...args);
}

function normalizePersonName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function assigneeNamesMatch(ticketAssignee, userName) {
  const a = normalizePersonName(ticketAssignee);
  const b = normalizePersonName(userName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  return false;
}

function isAdminUser(user = currentUser) {
  return Boolean(user?.role && ADMIN_ROLES.has(user.role));
}

function isAssignee(ticket) {
  if (!currentUser || !ticket) return false;
  if (ticket.assigneeId && currentUser.id) return ticket.assigneeId === currentUser.id;
  return assigneeNamesMatch(ticket.assignee, currentUser.name);
}

function isTicketCreator(ticket) {
  return Boolean(currentUser?.id && ticket?.createdBy && ticket.createdBy === currentUser.id);
}

/** User who last assigned the ticket (Assigned By) — can edit to refine work they delegated. */
function isAssignedBy(ticket) {
  if (!currentUser || !ticket) return false;
  if (ticket.assignedById && currentUser.id) return ticket.assignedById === currentUser.id;
  if (ticket.assignedByName && currentUser.name) {
    return assigneeNamesMatch(ticket.assignedByName, currentUser.name);
  }
  if (!ticket.assignedById && ticket.createdBy && currentUser.id) {
    return ticket.createdBy === currentUser.id;
  }
  return false;
}

/** Assigned By (raiser) — title, description, images, priority, reassignment. Not status. */
function canEditTicketDetails(ticket) {
  return isAssignedBy(ticket) || isAdminUser();
}

/** Assigned To — status / kanban moves only. */
function canChangeTicketStatus(ticket) {
  return isAssignee(ticket) || isAdminUser();
}

/** Open modal with save (details and/or status). */
function canEditTicket(ticket) {
  return canEditTicketDetails(ticket) || canChangeTicketStatus(ticket);
}

function canMoveTicket(ticket) {
  return canChangeTicketStatus(ticket);
}

function canDeleteTicket(ticket) {
  return isAdminUser() || isTicketCreator(ticket);
}

function canAssignTicket(ticket) {
  return canEditTicketDetails(ticket);
}

function canEditTicketImages(ticket) {
  return canEditTicketDetails(ticket);
}

function isValidStatusTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus || fromStatus === toStatus) return false;
  return (STATUS_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

function logPermission(action, ticket, allowed, extra = {}) {
  flowLog(`permission:${action}`, {
    allowed,
    userId: currentUser?.id,
    userName: currentUser?.name,
    userRole: currentUser?.role,
    ticketId: ticket?.id,
    assignee: ticket?.assignee,
    assigneeId: ticket?.assigneeId,
    assignedById: ticket?.assignedById,
    createdBy: ticket?.createdBy,
    status: ticket?.status,
    ...extra,
  });
}

/** @deprecated use isAssignee / canEditTicket */
function isOwnTicket(ticket) {
  return isAssignee(ticket);
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

const PROFILE_SELECT_FULL = 'id, name, email, role, color, bg, initial';
const PROFILE_SELECT_BASE = 'id, name, email, color, bg, initial';

function isMissingProfileRoleColumn(error) {
  const msg = error?.message || '';
  return /profiles\.role|column.*role.*does not exist/i.test(msg);
}

async function fetchProfileByUserId(userId) {
  let { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_FULL)
    .eq('id', userId)
    .maybeSingle();
  if (error && isMissingProfileRoleColumn(error)) {
    const fallback = await supabase
      .from('profiles')
      .select(PROFILE_SELECT_BASE)
      .eq('id', userId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
    if (data && !data.role) data.role = 'member';
  }
  return { data, error };
}

async function fetchAllProfiles() {
  let { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT_FULL)
    .order('name');
  if (error && isMissingProfileRoleColumn(error)) {
    const fallback = await supabase
      .from('profiles')
      .select(PROFILE_SELECT_BASE)
      .order('name');
    data = (fallback.data || []).map(p => ({ ...p, role: p.role || 'member' }));
    error = fallback.error;
  }
  return { data, error };
}

const LOGIN_SETUP_HINT =
  'Database setup incomplete. In Supabase → SQL Editor, run supabase/sql/06-fix-login.sql then refresh and sign in again.';

async function setCurrentUserFromSession(session) {
  const { data: profile, error } = await fetchProfileByUserId(session.user.id);
  if (error) throw new Error(error.message || LOGIN_SETUP_HINT);
  if (!profile) {
    throw new Error(
      `No profile for ${session.user.email || 'this account'}. ${LOGIN_SETUP_HINT}`
    );
  }
  currentUser = {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: profile.role || 'member',
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

function statusLabel(s) {
  return { todo: 'To Do', prog: 'In Progress', done: 'Done' }[s] || s;
}

function parseImageUrlsValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
      } catch { /* ignore */ }
    }
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    if (trimmed.startsWith('http')) return [trimmed];
  }
  return [];
}

function ticketImageUrlsFromRow(row) {
  const fromArray = parseImageUrlsValue(row?.image_urls);
  if (fromArray.length) return fromArray;
  if (row?.image_url) return [String(row.image_url)];
  return [];
}

function getTicketImageUrls(ticketOrRow) {
  if (ticketOrRow?.imageUrls?.length) return [...ticketOrRow.imageUrls];
  return ticketImageUrlsFromRow(ticketOrRow);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      flowLog(`${label} failed (attempt ${i + 1})`, err);
      if (i < attempts - 1) await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

function mapTicket(row) {
  const imageUrls = ticketImageUrlsFromRow(row);
  return {
    id: row.id,
    ticketNum: row.ticket_number,
    title: row.title,
    desc: row.description || '',
    assignee: row.assignee_name,
    assigneeId: row.assignee_id || null,
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    assignedById: row.assigned_by || null,
    assignedByName: row.assigned_by_name || null,
    assignedAt: row.assigned_at || null,
    updatedAt: row.updated_at || null,
    priority: row.priority,
    status: row.status,
    imageUrls,
    imageUrl: imageUrls[0] || null,
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
  pendingTicketImages.forEach(p => {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  });
  pendingTicketImages = [];
  existingTicketImageUrls = [];
  removedExistingImageUrls = new Set();
}

function nextPendingImageId() {
  pendingImageIdSeq += 1;
  return `pending-${pendingImageIdSeq}`;
}

function getVisibleTicketImages() {
  const existing = existingTicketImageUrls.filter(url => !removedExistingImageUrls.has(url));
  const pending = pendingTicketImages.map(p => ({
    id: p.id,
    url: p.previewUrl,
    kind: 'pending',
  }));
  const kept = existing.map((url, i) => ({
    id: `existing-${i}-${url}`,
    url,
    kind: 'existing',
  }));
  return [...kept, ...pending];
}

async function resolveDisplayUrl(publicUrl) {
  if (!publicUrl) return publicUrl;
  const cached = signedUrlCache.get(publicUrl);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url;
  if (!supabase) return publicUrl;
  const path = storagePathFromPublicUrl(publicUrl);
  if (!path) return publicUrl;
  try {
    const { data, error } = await supabase.storage
      .from(TICKET_IMAGE_BUCKET)
      .createSignedUrl(path, 3600);
    if (!error && data?.signedUrl) {
      signedUrlCache.set(publicUrl, { url: data.signedUrl, expiresAt: Date.now() + 3_500_000 });
      return data.signedUrl;
    }
    flowLog('signed URL unavailable', error?.message);
  } catch (err) {
    flowLog('signed URL error', err);
  }
  return publicUrl;
}

function bindImageWithFallback(img, publicUrl) {
  let triedSigned = false;
  img.addEventListener('error', async () => {
    if (triedSigned) {
      img.classList.add('img-load-failed');
      return;
    }
    triedSigned = true;
    try {
      const signed = await resolveDisplayUrl(publicUrl);
      if (signed) img.src = signed;
    } catch {
      img.classList.add('img-load-failed');
    }
  });
}

function appendAttachmentThumb(container, item, canRemove, onOpen) {
  const wrap = document.createElement('div');
  wrap.className = 'ticket-image-preview-item';
  if (item.kind === 'pending') wrap.classList.add('is-pending');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ticket-image-thumb-btn';
  btn.setAttribute('aria-label', 'View attachment');
  const skel = document.createElement('span');
  skel.className = 'img-skeleton';
  btn.appendChild(skel);
  const img = document.createElement('img');
  img.alt = 'Task attachment';
  img.loading = 'lazy';
  bindImageWithFallback(img, item.url);
  if (item.kind === 'pending') {
    img.src = item.url;
    skel.remove();
  } else {
    resolveDisplayUrl(item.url).then(url => { img.src = url; skel.remove(); }).catch(() => { img.src = item.url; skel.remove(); });
  }
  img.addEventListener('load', () => skel.remove());
  btn.appendChild(img);
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(item);
  });
  wrap.appendChild(btn);
  if (canRemove) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ticket-image-remove';
    remove.setAttribute('aria-label', 'Remove attachment');
    remove.textContent = '✕';
    remove.addEventListener('click', e => {
      e.stopPropagation();
      if (item.kind === 'pending') {
        const idx = pendingTicketImages.findIndex(p => p.id === item.id);
        if (idx >= 0) {
          const [removed] = pendingTicketImages.splice(idx, 1);
          if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        }
      } else {
        removedExistingImageUrls.add(item.url);
      }
      renderTicketImagePreview();
    });
    wrap.appendChild(remove);
  }
  container.appendChild(wrap);
}

function fillThumbContainer(container, items, canRemove, lightboxUrls) {
  if (!container) return;
  container.innerHTML = '';
  const openAt = item => {
    const idx = lightboxUrls.indexOf(item.url);
    openImageLightbox(lightboxUrls, idx >= 0 ? idx : 0);
  };
  items.forEach(item => appendAttachmentThumb(container, item, canRemove, openAt));
  container.classList.toggle('empty', items.length === 0);
}

function updateTicketImageSectionUI(savedCount, pendingCount) {
  const group = document.getElementById('ticketImageGroup');
  const gallery = document.getElementById('ticketImageGallery');
  const emptyMsg = document.getElementById('ticketImageEmpty');
  const upload = document.getElementById('ticketImageUpload');
  const countEl = document.getElementById('ticketImageCount');
  const total = savedCount + pendingCount;
  if (countEl) countEl.textContent = total ? `${total} file${total === 1 ? '' : 's'}` : '';
  if (group) group.classList.toggle('has-images', total > 0);
  if (emptyMsg) {
    emptyMsg.style.display = total === 0 ? 'block' : 'none';
    if (ticketModalCanEditDetails && total === 0) emptyMsg.textContent = 'No attachments yet.';
  }
  if (gallery) gallery.classList.toggle('empty', savedCount === 0);
  if (upload) upload.style.display = ticketModalCanEditDetails ? '' : 'none';
}

function renderTicketImagePreview() {
  const gallery = document.getElementById('ticketImageGallery');
  const pendingList = document.getElementById('ticketImagePendingList');
  const items = getVisibleTicketImages();
  const saved = items.filter(i => i.kind === 'existing');
  const pending = items.filter(i => i.kind === 'pending');
  const canRemove = ticketModalCanEditDetails;
  const lightboxUrls = items.map(i => i.url);
  fillThumbContainer(gallery, saved, canRemove, lightboxUrls);
  fillThumbContainer(pendingList, pending, canRemove, lightboxUrls);
  updateTicketImageSectionUI(saved.length, pending.length);
}

function filenameFromAttachmentUrl(url) {
  if (!url) return 'attachment';
  if (url.startsWith('blob:')) return 'upload.jpg';
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.split('/').pop() || '');
    return name.replace(/[^\w.\-()+ ]/g, '_') || 'attachment';
  } catch {
    return 'attachment';
  }
}

function isSafeAttachmentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:')) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function attachmentKindFromUrl(url) {
  const name = filenameFromAttachmentUrl(url).toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/.test(name)) return 'image';
  if (/\.pdf$/.test(name)) return 'pdf';
  return 'file';
}

function setLightboxEl(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !show);
}

function showLightboxLoading(show) {
  setLightboxEl('imageLightboxLoading', show);
}

function getLightboxDisplayUrl(url) {
  return url.startsWith('blob:') ? Promise.resolve(url) : resolveDisplayUrl(url);
}

async function renderLightboxSlide() {
  const img = document.getElementById('imageLightboxImg');
  const pdf = document.getElementById('imageLightboxPdf');
  const err = document.getElementById('imageLightboxError');
  const meta = document.getElementById('imageLightboxMeta');
  const filenameEl = document.getElementById('imageLightboxFilename');
  const prevBtn = document.getElementById('imageLightboxPrev');
  const nextBtn = document.getElementById('imageLightboxNext');
  if (!img || !lightboxState.urls.length) return;

  const url = lightboxState.urls[lightboxState.index];
  const kind = attachmentKindFromUrl(url);
  const filename = filenameFromAttachmentUrl(url);
  lightboxState.currentUrl = url;
  lightboxState.currentDisplayUrl = null;

  if (filenameEl) filenameEl.textContent = filename;
  if (meta) {
    meta.textContent = lightboxState.urls.length > 1
      ? `${lightboxState.index + 1} / ${lightboxState.urls.length}`
      : '';
  }
  const multi = lightboxState.urls.length > 1;
  if (prevBtn) prevBtn.style.display = multi ? '' : 'none';
  if (nextBtn) nextBtn.style.display = multi ? '' : 'none';

  setLightboxEl('imageLightboxImg', false);
  setLightboxEl('imageLightboxPdf', false);
  setLightboxEl('imageLightboxFileFallback', false);
  if (err) err.classList.add('hidden');
  showLightboxLoading(true);

  if (!isSafeAttachmentUrl(url)) {
    showLightboxLoading(false);
    if (err) err.classList.remove('hidden');
    return;
  }

  try {
    const display = await getLightboxDisplayUrl(url);
    lightboxState.currentDisplayUrl = display;
    showLightboxLoading(false);

    if (kind === 'image') {
      setLightboxEl('imageLightboxImg', true);
      img.onload = () => showLightboxLoading(false);
      img.onerror = () => {
        img.classList.add('hidden');
        if (err) err.classList.remove('hidden');
      };
      img.classList.remove('hidden', 'img-load-failed');
      img.src = display;
      img.alt = filename;
    } else if (kind === 'pdf') {
      setLightboxEl('imageLightboxPdf', true);
      pdf.src = display;
    } else {
      setLightboxEl('imageLightboxFileFallback', true);
    }
  } catch (e) {
    flowLog('lightbox load failed', e);
    showLightboxLoading(false);
    if (err) err.classList.remove('hidden');
  }
}

function openImageLightbox(urls, index) {
  const safe = (urls || []).filter(isSafeAttachmentUrl);
  if (!safe.length) return;
  const overlay = document.getElementById('imageLightboxOverlay');
  const dialog = document.getElementById('imageLightboxDialog');
  if (!overlay) return;

  lightboxState.urls = safe;
  lightboxState.index = Math.max(0, Math.min(index, safe.length - 1));
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
  dialog?.focus();
  void renderLightboxSlide();
  flowLog('lightbox open', { index: lightboxState.index, total: safe.length });
}

function closeImageLightbox() {
  const overlay = document.getElementById('imageLightboxOverlay');
  const img = document.getElementById('imageLightboxImg');
  const pdf = document.getElementById('imageLightboxPdf');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('lightbox-open');
  if (img) {
    img.removeAttribute('src');
    img.onload = null;
    img.onerror = null;
  }
  if (pdf) pdf.removeAttribute('src');
  lightboxState.urls = [];
  lightboxState.currentUrl = null;
  lightboxState.currentDisplayUrl = null;
}

function lightboxStep(delta) {
  if (!lightboxState.urls.length) return;
  lightboxState.index = (lightboxState.index + delta + lightboxState.urls.length) % lightboxState.urls.length;
  void renderLightboxSlide();
}

function downloadCurrentLightboxFile() {
  const url = lightboxState.currentDisplayUrl || lightboxState.currentUrl;
  if (!url || !isSafeAttachmentUrl(url)) return;
  const filename = filenameFromAttachmentUrl(lightboxState.currentUrl || url);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  if (!url.startsWith('blob:')) a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openCurrentLightboxInTab() {
  const url = lightboxState.currentDisplayUrl || lightboxState.currentUrl;
  if (url && isSafeAttachmentUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

function initImageLightbox() {
  const overlay = document.getElementById('imageLightboxOverlay');
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = '1';

  document.getElementById('imageLightboxClose')?.addEventListener('click', e => {
    e.stopPropagation();
    closeImageLightbox();
  });
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeImageLightbox();
  });
  document.getElementById('imageLightboxDialog')?.addEventListener('click', e => e.stopPropagation());

  document.getElementById('imageLightboxPrev')?.addEventListener('click', e => {
    e.stopPropagation();
    lightboxStep(-1);
  });
  document.getElementById('imageLightboxNext')?.addEventListener('click', e => {
    e.stopPropagation();
    lightboxStep(1);
  });
  document.getElementById('imageLightboxDownload')?.addEventListener('click', e => {
    e.stopPropagation();
    downloadCurrentLightboxFile();
  });
  document.getElementById('imageLightboxOpenTab')?.addEventListener('click', e => {
    e.stopPropagation();
    openCurrentLightboxInTab();
  });
  document.getElementById('imageLightboxFileOpen')?.addEventListener('click', e => {
    e.stopPropagation();
    openCurrentLightboxInTab();
  });

  let touchStartX = 0;
  overlay.addEventListener('touchstart', e => {
    if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (!overlay.classList.contains('open') || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) < 48) return;
    lightboxStep(dx < 0 ? 1 : -1);
  }, { passive: true });
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

async function compressImageFile(file) {
  if (!file.type?.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size < 250_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1920;
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Compression failed'))), mime, 0.85);
    });
    flowLog('compressed', file.size, '→', blob.size);
    return new File([blob], file.name, { type: mime });
  } catch (err) {
    flowLog('compression skipped', err);
    return file;
  }
}

async function addTicketImageFromFile(file) {
  const normalized = normalizeImageFile(file);
  if (!normalized) {
    showToast('Use JPEG, PNG, GIF, or WebP', 'error');
    return false;
  }
  file = normalized;
  if (!TICKET_IMAGE_TYPES.includes(file.type)) {
    showToast('Use JPEG, PNG, GIF, or WebP', 'error');
    return false;
  }
  file = await compressImageFile(file);
  if (file.size > TICKET_IMAGE_MAX_BYTES) {
    showToast('Image must be under 5 MB', 'error');
    return false;
  }
  pendingTicketImages.push({
    id: nextPendingImageId(),
    file,
    previewUrl: URL.createObjectURL(file),
  });
  return true;
}

async function addTicketImagesFromFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f && f.size);
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    if (await addTicketImageFromFile(file)) added += 1;
  }
  if (added) {
    renderTicketImagePreview();
    showToast(added > 1 ? `${added} images added` : 'Image added', 'info');
  }
}

function setTicketImageUIReadonly(readonly) {
  const group = document.getElementById('ticketImageGroup');
  const upload = document.getElementById('ticketImageUpload');
  if (group) group.classList.toggle('readonly', readonly);
  if (upload) upload.style.display = readonly ? 'none' : '';
}

async function uploadTicketImage(projectId, ticketId, file) {
  const path = `${projectId}/${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extFromMime(file.type)}`;
  return withRetry(async () => {
    const { error } = await supabase.storage.from(TICKET_IMAGE_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: '31536000',
    });
    if (error) throw error;
    const { data } = supabase.storage.from(TICKET_IMAGE_BUCKET).getPublicUrl(path);
    flowLog('uploaded', path, data.publicUrl);
    return data.publicUrl;
  }, `upload ${path}`);
}

async function persistTicketImageUrls(ticketId, image_urls) {
  const urls = (image_urls || []).filter(Boolean);
  const payload = {
    image_url: urls[0] || null,
    image_urls: urls.length ? urls : null,
  };
  const { error } = await supabase.from('tickets').update(payload).eq('id', ticketId);
  if (error) {
    const missingColumn = /image_urls|column/i.test(error.message || '') || error.code === '42703';
    if (missingColumn) {
      flowLog('image_urls column missing — saving image_url only');
      const { error: e2 } = await supabase.from('tickets').update({ image_url: payload.image_url }).eq('id', ticketId);
      if (e2) throw e2;
      return;
    }
    throw error;
  }
  flowLog('saved image URLs to ticket', ticketId, urls.length);
}

async function deleteStorageImage(publicUrl) {
  const path = storagePathFromPublicUrl(publicUrl);
  if (!path) return;
  await supabase.storage.from(TICKET_IMAGE_BUCKET).remove([path]);
}

function ticketImagesChanged() {
  return pendingTicketImages.length > 0 || removedExistingImageUrls.size > 0;
}

async function resolveTicketImageUrls(projectId, ticketId, previousUrls) {
  const prev = previousUrls || [];
  for (const url of prev) {
    if (removedExistingImageUrls.has(url)) await deleteStorageImage(url);
  }
  const kept = prev.filter(url => !removedExistingImageUrls.has(url));
  const uploaded = [];
  const pending = pendingTicketImages.filter(p => p.file);
  const total = pending.length;
  if (total) setUploadProgress(0);
  for (let i = 0; i < pending.length; i++) {
    if (pending[i].file) {
      uploaded.push(await uploadTicketImage(projectId, ticketId, pending[i].file));
      if (total) setUploadProgress(((i + 1) / total) * 100);
    }
  }
  setUploadProgress(null);
  return [...kept, ...uploaded];
}

function initTicketImageHandlers() {
  if (ticketImageHandlersBound) return;
  ticketImageHandlersBound = true;

  const drop = document.getElementById('ticketImageDrop');
  const input = document.getElementById('ticketImageInput');

  input.addEventListener('change', () => {
    if (!ticketModalCanEditDetails) return;
    void addTicketImagesFromFiles(input.files);
    input.value = '';
  });

  drop.addEventListener('click', e => {
    if (!ticketModalCanEditDetails) e.preventDefault();
  });

  drop.addEventListener('dragover', e => {
    e.preventDefault();
    if (ticketModalCanEditDetails) drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (!ticketModalCanEditDetails) return;
    void addTicketImagesFromFiles(e.dataTransfer?.files);
  });

  document.addEventListener('paste', e => {
    const overlay = document.getElementById('ticketModalOverlay');
    if (!overlay?.classList.contains('open') || !ticketModalCanEditDetails) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length) {
      e.preventDefault();
      void addTicketImagesFromFiles(imageFiles);
      showToast(imageFiles.length > 1 ? `${imageFiles.length} images pasted` : 'Image pasted', 'info');
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
  const { data, error } = await fetchAllProfiles();
  if (error) throw error;
  USERS = data || [];
  MEMBERS = USERS.map(u => u.name);
}

const TICKET_SELECT_FULL =
  'id, project_id, ticket_number, title, description, assignee_name, assignee_id, created_by, created_by_name, assigned_by, assigned_by_name, assigned_at, updated_at, priority, status, image_url, image_urls, created_at';
const TICKET_SELECT_RBAC =
  'id, project_id, ticket_number, title, description, assignee_name, assignee_id, created_by, priority, status, image_url, image_urls, created_at';
const TICKET_SELECT_LEGACY =
  'id, project_id, ticket_number, title, description, assignee_name, priority, status, image_url, image_urls, created_at';

const TICKET_COLUMN_ERR = /assignee_id|created_by|assigned_by|column/i;

function stripServerOwnedTicketFields(row) {
  const r = { ...row };
  delete r.created_by;
  delete r.created_by_name;
  delete r.assigned_by;
  delete r.assigned_by_name;
  delete r.assigned_at;
  delete r.updated_at;
  return r;
}

async function loadTickets() {
  let result = await supabase.from('tickets').select(TICKET_SELECT_FULL).order('ticket_number', { ascending: true });
  if (result.error && TICKET_COLUMN_ERR.test(result.error.message || '')) {
    flowLog('ticket select fallback (rbac only)', result.error.message);
    result = await supabase.from('tickets').select(TICKET_SELECT_RBAC).order('ticket_number', { ascending: true });
  }
  if (result.error && TICKET_COLUMN_ERR.test(result.error.message || '')) {
    flowLog('ticket select fallback (legacy)', result.error.message);
    result = await supabase.from('tickets').select(TICKET_SELECT_LEGACY).order('ticket_number', { ascending: true });
  }
  return result;
}

async function loadState() {
  const [{ data: projects, error: pErr }, { data: tickets, error: tErr }] = await Promise.all([
    supabase.from('projects').select('*').order('created_at', { ascending: true }),
    loadTickets(),
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

async function insertTicketRow(row) {
  const rowForDb = stripServerOwnedTicketFields(row);
  let result = await supabase.from('tickets').insert(rowForDb).select('id').single();
  if (result.error && TICKET_COLUMN_ERR.test(result.error.message || '')) {
    flowLog('insert fallback without rbac columns', result.error.message);
    const fallback = { ...rowForDb };
    delete fallback.assignee_id;
    result = await supabase.from('tickets').insert(fallback).select('id').single();
  }
  return result;
}

async function updateTicketRow(ticketId, payload) {
  const rowForDb = stripServerOwnedTicketFields(payload);
  return supabase.from('tickets').update(rowForDb).eq('id', ticketId);
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

function profileById(profileId) {
  if (!profileId) return null;
  return USERS.find(p => p.id === profileId) || null;
}

function profileNameById(profileId) {
  return profileById(profileId)?.name || null;
}

/** Resolved person for display — never uses session user except mode === 'new' preview. */
function ticketPersonFromTicket(ticket, role) {
  if (!ticket) return null;
  if (role === 'assignedBy') {
    const u = profileById(ticket.assignedById);
    if (u) return { id: u.id, name: u.name, email: u.email, color: u.color, bg: u.bg, initial: u.initial };
    if (ticket.assignedByName || ticket.assignedById) {
      const name = ticket.assignedByName || 'Unknown';
      return { id: ticket.assignedById, name, email: null, color: null, bg: null, initial: name.charAt(0) };
    }
    return ticketPersonFromTicket(ticket, 'createdBy');
  }
  if (role === 'createdBy') {
    const u = profileById(ticket.createdBy);
    if (u) return { id: u.id, name: u.name, email: u.email, color: u.color, bg: u.bg, initial: u.initial };
    if (ticket.createdByName || ticket.createdBy) {
      const name = ticket.createdByName || 'Unknown';
      return { id: ticket.createdBy, name, email: null, color: null, bg: null, initial: name.charAt(0) };
    }
    return null;
  }
  if (role === 'assignee') {
    const u = profileById(ticket.assigneeId) || getUser(ticket.assignee);
    if (u) return { id: u.id, name: u.name, email: u.email, color: u.color, bg: u.bg, initial: u.initial };
    if (ticket.assignee) {
      return { id: ticket.assigneeId, name: ticket.assignee, email: null, color: null, bg: null, initial: ticket.assignee.charAt(0) };
    }
    return null;
  }
  return null;
}

function ticketAssignedByDisplayName(ticket) {
  return ticketPersonFromTicket(ticket, 'assignedBy')?.name || '—';
}

function setTicketAssignedByField(mode, ticket) {
  const el = document.getElementById('ticketAssignedBy');
  if (!el) return;
  if (mode === 'new') {
    const name = currentUser?.name;
    el.innerHTML = name
      ? `<span class="assigned-by-row">${renderAvatarHtml(name, 'sm')}<span>${esc(name)}</span></span>`
      : '—';
    return;
  }
  const person = ticketPersonFromTicket(ticket, 'assignedBy');
  if (!person?.name) {
    el.textContent = '—';
    return;
  }
  el.innerHTML = `<span class="assigned-by-row">${renderAvatarHtml(person.name, 'sm')}<span>${esc(person.name)}</span></span>`;
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
    ro.textContent = assigneeName || '—';
  }
}

function setUploadProgress(percent) {
  const wrap = document.getElementById('ticketUploadProgress');
  const bar = document.getElementById('ticketUploadProgressBar');
  if (!wrap || !bar) return;
  if (percent == null || percent < 0) {
    wrap.classList.add('hidden');
    bar.style.width = '0%';
    return;
  }
  wrap.classList.remove('hidden');
  const pct = Math.min(100, Math.max(0, percent));
  bar.style.width = `${pct}%`;
  wrap.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function setTicketModalMode(mode, ticket) {
  const isView = mode === 'view';
  const isNew = mode === 'new';
  const canDetails = isNew || (ticket && canEditTicketDetails(ticket));
  const canStatus = isNew || (ticket && canChangeTicketStatus(ticket));
  const canInteract = !isView && (canDetails || canStatus);

  ticketModalCanEditDetails = canDetails;
  ticketModalCanChangeStatus = canStatus;
  ticketModalReadOnly = !canInteract;

  const form = document.getElementById('ticketForm');
  const hint = document.getElementById('ticketViewHint');
  const saveBtn = document.getElementById('ticketSaveBtn');
  const cancelBtn = document.getElementById('ticketCancel');
  const detailsLocked = isView || !canDetails;

  form.classList.toggle('ticket-modal-readonly', isView);
  saveBtn.style.display = canInteract ? '' : 'none';
  cancelBtn.textContent = isView ? 'Close' : 'Cancel';

  if (isView) {
    hint.style.display = 'block';
    hint.textContent = 'View only — you can read this ticket but cannot edit, move, or change status.';
  } else if (ticket && canStatus && !canDetails) {
    hint.style.display = 'block';
    hint.textContent = 'You can update status only. Title, description, priority, and attachments are read-only.';
  } else if (ticket && canDetails && !canStatus) {
    hint.style.display = 'block';
    hint.textContent = 'You can edit ticket details. Status is updated by the person assigned to this ticket.';
  } else {
    hint.style.display = 'none';
  }

  const titleInput = document.getElementById('ticketTitle');
  const descInput = document.getElementById('ticketDesc');
  const prioritySel = document.getElementById('ticketPriority');
  const statusSel = document.getElementById('ticketStatus');
  titleInput.disabled = detailsLocked;
  titleInput.readOnly = detailsLocked;
  descInput.disabled = detailsLocked;
  descInput.readOnly = detailsLocked;
  prioritySel.disabled = detailsLocked;
  statusSel.disabled = isView || !canStatus;
  setTicketImageUIReadonly(!canDetails);

  if (mode === 'view' && ticket) {
    setTicketAssignedByField('view', ticket);
    setTicketAssigneeField('view', ticket.assignee);
  } else if (mode === 'new') {
    setTicketAssignedByField('new');
    setTicketAssigneeField('new', currentUser.name);
  } else if (mode === 'edit' && ticket) {
    setTicketAssignedByField('edit', ticket);
    if (canAssignTicket(ticket)) setTicketAssigneeField('edit-own', ticket.assignee);
    else setTicketAssigneeField('view', ticket.assignee);
  }
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
    const mine = inCol.filter(t => isAssignee(t)).length;
    const total = inCol.length;
    document.getElementById(countIds[status]).textContent = total ? `${mine} / ${total}` : '0';
    if (total === 0) cols[status].innerHTML = '<div class="column-empty">No tickets</div>';
    else inCol.forEach(ticket => cols[status].appendChild(buildTicketCard(project, ticket)));
  });
  initBoardDragDrop();
}

function renderTicketCardThumbs(urls) {
  if (!urls?.length) return '';
  const first = urls[0];
  const extra = urls.length - 1;
  return `<div class="ticket-card-thumbs">
    <div class="ticket-card-thumb"><img src="${esc(first)}" alt=""></div>
    ${extra > 0 ? `<span class="ticket-card-thumb-more">+${extra}</span>` : ''}
  </div>`;
}

function buildStatusMoveButtons(ticket) {
  if (!canMoveTicket(ticket)) return [];
  const labels = { todo: 'To Do', prog: 'In Progress', done: 'Done' };
  return (STATUS_TRANSITIONS[ticket.status] || []).map(status =>
    `<button type="button" class="move-btn" data-move="${esc(status)}" title="Move to ${labels[status]}">→ ${labels[status]}</button>`
  );
}

function profileIdForAssigneeName(name) {
  const u = USERS.find(p => assigneeNamesMatch(p.name, name));
  return u?.id || null;
}

function buildTicketCard(project, ticket) {
  const el = document.createElement('article');
  const assignee = isAssignee(ticket);
  const movable = canMoveTicket(ticket);
  const deletable = canDeleteTicket(ticket);
  el.className = 'ticket-card' + (assignee ? ' own' : '') + (movable ? ' can-move' : ' locked') + (!assignee && !movable ? ' other' : '');
  el.dataset.ticketId = ticket.id;
  if (assignee) el.style.borderLeftColor = currentUser.color;
  if (!movable) el.title = `Assigned to ${ticket.assignee}. Only the assignee or an admin can move this ticket.`;
  const moves = buildStatusMoveButtons(ticket);
  el.innerHTML = `
    ${deletable ? '<button type="button" class="ticket-delete" aria-label="Delete ticket" title="Delete ticket">✕</button>' : ''}
    ${!movable ? '<span class="ticket-lock" title="View only — not assigned to you">🔒</span>' : ''}
    <div class="ticket-id">${esc(formatTicketId(project, ticket))}</div>
    <div class="ticket-title">${esc(ticket.title)}</div>
    ${renderTicketCardThumbs(ticket.imageUrls)}
    ${ticket.desc ? `<div class="ticket-desc">${esc(ticket.desc)}</div>` : ''}
    <div class="ticket-footer">
      <span class="priority-badge priority-${esc(ticket.priority)}">${esc(priorityLabel(ticket.priority))}</span>
      ${renderAvatarHtml(ticket.assignee, 'sm')}
    </div>
    ${moves.length ? `<div class="ticket-moves">${moves.join('')}</div>` : ''}
  `;
  if (deletable) {
    el.querySelector('.ticket-delete')?.addEventListener('click', e => {
      e.stopPropagation();
      deleteTicket(project.id, ticket.id);
    });
  }
  if (movable) {
    el.querySelectorAll('.move-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        moveTicket(project.id, ticket.id, btn.dataset.move);
      });
    });
    el.draggable = true;
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/x-flow-ticket', JSON.stringify({ projectId: project.id, ticketId: ticket.id }));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('is-dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-dragging'));
  } else {
    el.draggable = false;
  }
  const cardImg = el.querySelector('.ticket-card-thumb img');
  if (cardImg && ticket.imageUrls?.[0]) {
    bindImageWithFallback(cardImg, ticket.imageUrls[0]);
    resolveDisplayUrl(ticket.imageUrls[0]).then(url => { cardImg.src = url; }).catch(() => { cardImg.src = ticket.imageUrls[0]; });
  }
  el.addEventListener('click', e => {
    if (e.target.closest('.ticket-delete, .move-btn, .ticket-lock')) return;
    openTicketModal(project.id, ticket.id);
  });
  return el;
}

let boardDragBound = false;

function initBoardDragDrop() {
  if (boardDragBound) return;
  boardDragBound = true;
  const colIds = { todo: 'colTodo', prog: 'colProg', done: 'colDone' };
  STATUSES.forEach(status => {
    const col = document.getElementById(colIds[status]);
    if (!col) return;
    col.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('application/x-flow-ticket')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const raw = e.dataTransfer.getData('application/x-flow-ticket');
      if (!raw) return;
      try {
        const { projectId, ticketId } = JSON.parse(raw);
        moveTicket(projectId, ticketId, status);
      } catch (err) {
        flowLog('drop parse error', err);
      }
    });
  });
}

async function moveTicket(projectId, ticketId, status) {
  if (!currentUser) return;
  const project = getProject(projectId);
  const ticket = project?.tickets.find(t => t.id === ticketId);
  if (!ticket || ticket.status === status) return;
  if (!canMoveTicket(ticket)) {
    logPermission('move', ticket, false, { toStatus: status });
    showToast('Only the assignee or an admin can move this ticket', 'error');
    return;
  }
  if (!isValidStatusTransition(ticket.status, status)) {
    showToast(`Cannot move from ${statusLabel(ticket.status)} to ${statusLabel(status)}`, 'error');
    return;
  }
  logPermission('move', ticket, true, { from: ticket.status, to: status });
  const { error } = await supabase.from('tickets').update({ status }).eq('id', ticketId);
  if (error) {
    console.error('[FLOW] moveTicket failed', error);
    showToast(error.message, 'error');
    return;
  }
  showToast('Status updated', 'info');
  await loadState();
  render();
}

async function deleteTicket(projectId, ticketId) {
  if (!currentUser) return;
  const project = getProject(projectId);
  const ticket = project?.tickets.find(t => t.id === ticketId);
  if (!ticket) return;
  if (!canDeleteTicket(ticket)) {
    logPermission('delete', ticket, false);
    showToast('Only admins or the ticket creator can delete this ticket', 'error');
    return;
  }
  logPermission('delete', ticket, true);
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
    const canDetails = canEditTicketDetails(t);
    const canStatus = canChangeTicketStatus(t);
    const canInteract = canEditTicket(t);
    const modalPrefix = canDetails
      ? 'Edit · '
      : canStatus
        ? 'Update status · '
        : 'View · ';
    document.getElementById('ticketModalTitle').textContent = modalPrefix + formatTicketId(project, t);
    document.getElementById('ticketTitle').value = t.title;
    document.getElementById('ticketDesc').value = t.desc || '';
    document.getElementById('ticketPriority').value = t.priority;
    document.getElementById('ticketStatus').value = t.status;
    existingTicketImageUrls = getTicketImageUrls(t);
    flowLog('open ticket', {
      ticketId: t.id,
      assignee: t.assignee,
      assignedBy: ticketAssignedByDisplayName(t),
      createdBy: t.createdBy,
      canEditDetails: canDetails,
      canChangeStatus: canStatus,
      canMove: canMoveTicket(t),
      canDelete: canDeleteTicket(t),
      images: existingTicketImageUrls.length,
    });
    setTicketModalMode(canInteract ? 'edit' : 'view', t);
  } else {
    document.getElementById('ticketModalTitle').textContent = 'New ticket';
    document.getElementById('ticketForm').reset();
    document.getElementById('ticketPriority').value = 'med';
    document.getElementById('ticketStatus').value = 'todo';
    setTicketAssignedByField('new');
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
  ticketModalCanEditDetails = false;
  ticketModalCanChangeStatus = false;
  resetTicketImageState();
  setUploadProgress(null);
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
  const sel = document.getElementById('ticketAssignee');
  const assigneeName = sel.disabled ? undefined : sel.value;

  if (editingTicketId) {
    const t = project.tickets.find(x => x.id === editingTicketId);
    const canDetails = t && canEditTicketDetails(t);
    const canStatus = t && canChangeTicketStatus(t);
    if (!t || (!canDetails && !canStatus)) {
      logPermission('edit', t, false);
      showToast('You do not have permission to update this ticket', 'error');
      return;
    }
    const payload = {};
    if (canDetails) {
      if (!title) { titleInput.classList.add('error'); titleInput.focus(); return; }
      payload.title = title;
      payload.description = document.getElementById('ticketDesc').value.trim();
      payload.priority = document.getElementById('ticketPriority').value;
      if (assigneeName === undefined) {
        delete payload.assignee_name;
      } else {
        const prev = t.assignee;
        const next = assigneeName;
        if (!assigneeNamesMatch(prev, next)) {
          payload.assignee_name = next;
          payload.assignee_id = profileIdForAssigneeName(next);
          flowLog('reassign ticket', { ticketId: editingTicketId, from: prev, to: next, by: currentUser?.name });
        }
      }
      if (ticketImagesChanged()) {
        try {
          const image_urls = await resolveTicketImageUrls(projectId, editingTicketId, t.imageUrls);
          payload.image_urls = image_urls.length ? image_urls : null;
          payload.image_url = image_urls[0] || null;
        } catch (imgErr) {
          console.error('[FLOW] image update failed', imgErr);
          showToast(imgErr.message || 'Image upload failed', 'error');
          return;
        }
      }
    }
    if (canStatus) {
      payload.status = document.getElementById('ticketStatus').value;
    }
    const { error } = await updateTicketRow(editingTicketId, payload);
    if (error) { showToast(error.message, 'error'); return; }
    closeTicketModal();
    showToast(canStatus && !canDetails ? 'Status updated' : 'Ticket saved', 'info');
  } else {
    if (!title) { titleInput.classList.add('error'); titleInput.focus(); return; }
    const payload = {
      title,
      description: document.getElementById('ticketDesc').value.trim(),
      assignee_name: assigneeName,
      priority: document.getElementById('ticketPriority').value,
      status: document.getElementById('ticketStatus').value,
    };
    if (!MEMBERS.includes(payload.assignee_name)) payload.assignee_name = currentUser.name;
    const ticketNum = await nextTicketNumber(projectId);
    const { data: created, error } = await insertTicketRow({
      project_id: projectId,
      ticket_number: ticketNum,
      title: payload.title,
      description: payload.description,
      assignee_name: payload.assignee_name,
      assignee_id: profileIdForAssigneeName(payload.assignee_name),
      priority: payload.priority,
      status: payload.status,
    });
    if (error) { showToast(error.message, 'error'); return; }
    if (pendingTicketImages.length) {
      try {
        const image_urls = await resolveTicketImageUrls(projectId, created.id, []);
        if (image_urls.length) await persistTicketImageUrls(created.id, image_urls);
      } catch (imgErr) {
        console.error('[FLOW] image upload failed', imgErr);
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
  const lightboxOpen = document.getElementById('imageLightboxOverlay')?.classList.contains('open');
  if (lightboxOpen) {
    if (e.key === 'Escape') closeImageLightbox();
    else if (e.key === 'ArrowLeft') { e.preventDefault(); lightboxStep(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); lightboxStep(1); }
    return;
  }
  if (e.key === 'Escape') {
    closeProjectModal();
    closeTicketModal();
  }
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
initImageLightbox();
boot();

