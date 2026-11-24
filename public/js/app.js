import { SignaturePad } from './signaturePad.js';
import { SignatureImageCleaner } from './imageCleaner.js';
import {
  renderOfficialDocument,
  extractEditedDocumentMeta,
  bindInlinePaperEditor,
} from './documentView.js';

const STORAGE_KEYS = {
  sessionToken: 'fsd2026_session_token',
  adminToken: 'fsd2026_admin_token',
  displayName: 'fsd2026_display_name',
};

const state = {
  documentMeta: null,
  settings: { locked: false, allowSelfAdd: true, requireMeetingCode: true },
  stats: { total: 55, signed: 0, tableTotal: 54, tableSigned: 0, leaderSigned: false, percentage: 0 },
  signatories: [],
  auditLogs: [],
  locks: {},
  onlineCount: 1,
  clientId: null,
  isAdmin: false,
  sessionToken: localStorage.getItem(STORAGE_KEYS.sessionToken) || '',
  adminToken: localStorage.getItem(STORAGE_KEYS.adminToken) || '',
  displayName: localStorage.getItem(STORAGE_KEYS.displayName) || '',

  activeView: 'list', // 'list' | 'document'
  searchQuery: '',
  instansiFilter: 'all',
  statusFilter: 'all',
  recentlySignedIds: new Set(),

  signingSignatoryId: null,
  signingMode: 'draw',
  detailSignatoryId: null,
  editingDoc: false,
};

let ws = null;
let wsReconnectDelay = 1200;
let wsReconnectTimer = null;
let lockRenewTimer = null;
let sigPad = null;
let imgCleaner = null;

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWitaTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/\./g, ':');
  return `${t} WITA`;
}

function formatWitaFull(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const datePart = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(d);
  const timePart = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/\./g, ':');
  return `${datePart}, ${timePart} WITA`;
}

function showToast(message) {
  const stack = $('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms ease';
    setTimeout(() => el.remove(), 220);
  }, 3400);
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.sessionToken) headers['X-Session-Token'] = state.sessionToken;
  if (state.adminToken) headers['X-Admin-Token'] = state.adminToken;
  return headers;
}

function buildDownloadUrl(basePath) {
  const params = new URLSearchParams();
  if (state.sessionToken) params.set('token', state.sessionToken);
  if (state.adminToken) params.set('adminToken', state.adminToken);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: authHeaders({
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Permintaan gagal (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

// ===== BOOTSTRAP =====
async function bootstrap() {
  initSigningTools();
  bindEvents();

  const urlParams = new URLSearchParams(window.location.search);
  const qrCodeParam = urlParams.get('kode');
  if (qrCodeParam) {
    try {
      const auth = await apiFetch('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ code: qrCodeParam }),
      });
      if (auth.token) {
        state.sessionToken = auth.token;
        localStorage.setItem(STORAGE_KEYS.sessionToken, auth.token);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {
      $('gateCodeInput').value = qrCodeParam.toUpperCase();
    }
  }

  try {
    const boot = await apiFetch('/api/bootstrap');
    state.documentMeta = boot.documentMeta;
    state.settings = boot.settings;
    state.stats = boot.stats;
    state.isAdmin = Boolean(boot.isAdmin);
    state.onlineCount = boot.onlineCount || 1;

    const dateDetail = (boot.documentMeta.eventDetails || []).find((r) => /tanggal/i.test(r.label));
    $('gateEventDate').textContent = (dateDetail && dateDetail.value) || 'Rabu, 25 November 2026';
    $('gateProgress').textContent = `${boot.stats.signed} / ${boot.stats.total} pihak`;

    if (boot.authorized) await enterMainApp();
    else showAccessGate();
  } catch {
    showAccessGate();
    $('gateError').textContent = 'Tidak dapat terhubung ke server. Muat ulang halaman.';
    $('gateError').classList.remove('hidden');
  }
}

function showAccessGate() {
  $('appShell').classList.add('hidden');
  $('accessGate').classList.remove('hidden');
}

async function enterMainApp() {
  $('accessGate').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  await fetchFullState();
  connectWebSocket();
}

async function fetchFullState() {
  try {
    const data = await apiFetch('/api/state');
    state.documentMeta = data.documentMeta;
    state.settings = data.settings;
    state.stats = data.stats;
    state.signatories = data.signatories;
    state.auditLogs = data.auditLogs || [];
    state.locks = data.locks || {};
    state.onlineCount = data.onlineCount || 1;
    state.isAdmin = Boolean(data.isAdmin);
    renderAll();
  } catch (err) {
    if (err.code === 'MEETING_CODE_REQUIRED' || err.status === 401) {
      state.sessionToken = '';
      localStorage.removeItem(STORAGE_KEYS.sessionToken);
      showAccessGate();
      $('gateError').textContent = err.message;
      $('gateError').classList.remove('hidden');
    } else {
      showToast(err.message || 'Gagal memuat data.');
    }
  }
}

// ===== WEBSOCKET REALTIME =====
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(wsReconnectTimer);

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  updateConnStatus('connecting', 'Menyambungkan...');
  ws = new WebSocket(`${proto}//${window.location.host}/ws`);

  ws.addEventListener('open', () => {
    wsReconnectDelay = 1200;
    updateConnStatus('online', `${state.onlineCount} online`);
    if (state.displayName) wsSend({ type: 'hello', name: state.displayName });
    if (state.signingSignatoryId) wsSend({ type: 'lock_acquire', signatoryId: state.signingSignatoryId });
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleWsMessage(msg);
  });

  ws.addEventListener('close', () => {
    updateConnStatus('offline', 'Menyambung ulang...');
    wsReconnectTimer = setTimeout(async () => {
      connectWebSocket();
      if (!$('appShell').classList.contains('hidden')) await fetchFullState();
    }, wsReconnectDelay);
    wsReconnectDelay = Math.min(10000, Math.round(wsReconnectDelay * 1.5));
  });

  ws.addEventListener('error', () => ws.close());
}

function wsSend(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function updateConnStatus(status, text) {
  const pill = $('wsStatusPill');
  const label = $('wsStatusText');
  if (!pill || !label) return;
  pill.classList.remove('conn-online', 'conn-offline', 'conn-connecting');
  pill.classList.add(`conn-${status}`);
  label.textContent = text;
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      state.clientId = msg.clientId;
      state.onlineCount = msg.onlineCount || 1;
      state.locks = msg.locks || {};
      updateConnStatus('online', `${state.onlineCount} online`);
      renderAll();
      break;

    case 'presence':
      state.onlineCount = msg.onlineCount || 1;
      updateConnStatus('online', `${state.onlineCount} online`);
      break;

    case 'locks':
      state.locks = msg.locks || {};
      renderList();
      if (state.activeView === 'document' && !state.editingDoc) renderDocumentView();
      break;

    case 'lock_denied':
      showToast(`Sedang diisi oleh ${msg.holderName || 'peserta lain'}.`);
      break;

    case 'signature_saved':
      upsertSignatory(msg.signatory);
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      state.recentlySignedIds.add(msg.signatory.id);
      setTimeout(() => state.recentlySignedIds.delete(msg.signatory.id), 2000);
      renderAll();
      if (state.signingSignatoryId !== msg.signatory.id) {
        showToast(`${msg.signatory.name} telah menandatangani.`);
      }
      break;

    case 'signature_cleared':
      upsertSignatory(msg.signatory);
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast(`Tanda tangan ${msg.signatory.name} dihapus oleh Panitia.`);
      break;

    case 'signatory_added':
      upsertSignatory(msg.signatory);
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast(`Peserta baru: ${msg.signatory.name}.`);
      break;

    case 'signatory_updated':
      upsertSignatory(msg.signatory);
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      break;

    case 'signatory_deleted':
      if (Array.isArray(msg.signatories)) state.signatories = msg.signatories;
      else state.signatories = state.signatories.filter((s) => s.id !== msg.deletedId);
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      break;

    case 'full_reset':
      if (Array.isArray(msg.signatories)) state.signatories = msg.signatories;
      if (msg.stats) state.stats = msg.stats;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast('Seluruh data telah direset oleh Panitia.');
      break;

    case 'settings_updated':
      if (msg.settings) state.settings = msg.settings;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast(state.settings.locked ? 'Dokumen dikunci oleh Panitia.' : 'Pengaturan diperbarui.');
      break;

    case 'document_updated':
      if (msg.documentMeta) state.documentMeta = msg.documentMeta;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast('Teks naskah Berita Acara diperbarui oleh Panitia.');
      break;

    default:
      break;
  }
}

function upsertSignatory(sig) {
  const idx = state.signatories.findIndex((s) => s.id === sig.id);
  if (idx === -1) state.signatories.push(sig);
  else state.signatories[idx] = sig;
}

// ===== RENDER =====
function renderAll() {
  renderChrome();
  renderSummary();
  renderList();
  if (state.activeView === 'document' && !state.editingDoc) renderDocumentView();
}

function renderChrome() {
  const admin = state.isAdmin;
  $('adminBadge').classList.toggle('hidden', !admin);
  $('lockedBadge').classList.toggle('hidden', !state.settings.locked);
  $('adminEnterBtn').classList.toggle('hidden', admin);
  $('adminEditDocBtn').classList.toggle('hidden', !admin);
  $('docStartEditBtn').classList.toggle('hidden', !admin);
  $('adminSettingsBtn').classList.toggle('hidden', !admin);
  $('adminExitBtn').classList.toggle('hidden', !admin);
  $('addParticipantBtn').classList.toggle('hidden', !admin);
  $('adminExportExtras').classList.toggle('hidden', !admin);

  $('dlFullDocx').href = buildDownloadUrl('/api/export/berita-acara.docx');
  $('dlFullPdf').href = buildDownloadUrl('/api/export/berita-acara.pdf');
  $('dlRekapCsv').href = buildDownloadUrl('/api/export/rekap.csv');
  if ($('daftarHadirBtn')) {
    $('daftarHadirBtn').href =
      state.settings?.daftarHadirUrl || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI';
  }

  if (state.documentMeta) {
    const m = state.documentMeta;
    const rawTitle = (m.titleLines || []).join(' ').trim();
    if (rawTitle) {
      // Convert ALL-CAPS document header into clean readable Title Case for the web masthead
      const titleFormatted = rawTitle
        .toLowerCase()
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .replace(/\bSdi\b/g, 'SDI');
      $('mastheadTitle').textContent = titleFormatted;
    }
    const dateRow = (m.eventDetails || []).find((r) => /tanggal/i.test(r.label));
    const timeRow = (m.eventDetails || []).find((r) => /waktu/i.test(r.label));
    const docNum = (m.documentNumber || '').trim();
    // Only display Nomor in the web subtitle if the number blanks have actually been filled
    const hasFilledNum = docNum && !/:\s*\/|\/\s+\//.test(docNum);
    const subParts = [
      dateRow?.value,
      timeRow?.value,
      hasFilledNum ? docNum : 'Ruang Rapat RKPD Bapperida',
    ].filter(Boolean);
    if (subParts.length) $('mastheadSubtitle').textContent = subParts.join(' · ');
  }
}

function renderSummary() {
  const st = state.stats;
  $('statSignedCount').textContent = st.signed;
  $('statTotalCount').textContent = st.total;
  $('statPct').textContent = `${st.percentage}%`;
  $('progressBarFill').style.width = `${st.percentage}%`;
  $('progressBarTrack').setAttribute('aria-valuenow', String(st.percentage));

  renderInstansiFilterOptions();
  const signedAll = state.signatories.filter((s) => s.signed).length;
  const unsignedAll = state.signatories.length - signedAll;
  const statusSel = $('statusFilterSelect');
  if (statusSel && statusSel.options.length >= 3) {
    statusSel.options[0].textContent = `Semua Status (${state.signatories.length})`;
    statusSel.options[1].textContent = `Belum TTD (${unsignedAll})`;
    statusSel.options[2].textContent = `Sudah TTD (${signedAll})`;
  }
}

function renderInstansiFilterOptions() {
  const sel = $('instansiFilter');
  if (!sel) return;
  const counts = new Map();
  for (const s of state.signatories) {
    const g = s.instansiGroup || (s.isRepresentative ? 'Perwakilan Unsur' : 'Lainnya');
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  const order = [
    'Perwakilan Unsur',
    'Badan, Inspektorat & Satpol PP',
    'Dinas & RSUD',
    'Kecamatan (Camat)',
    'Peserta Tambahan',
    'Lainnya',
  ].filter((g) => counts.has(g));

  const current = state.instansiFilter;
  sel.innerHTML = [
    `<option value="all">Semua Instansi (${state.signatories.length})</option>`,
    ...order.map((g) => `<option value="${esc(g)}">${esc(g)} (${counts.get(g)})</option>`),
  ].join('');
  sel.value = counts.has(current) ? current : 'all';
  state.instansiFilter = sel.value;
}

function getFilteredSignatories() {
  const q = state.searchQuery.trim().toLowerCase();
  return [...state.signatories]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .filter((s) => {
      if (state.statusFilter === 'signed' && !s.signed) return false;
      if (state.statusFilter === 'unsigned' && s.signed) return false;
      if (state.instansiFilter !== 'all') {
        const g = s.instansiGroup || (s.isRepresentative ? 'Perwakilan Unsur' : 'Lainnya');
        if (g !== state.instansiFilter) return false;
      }
      if (!q) return true;
      return [s.isRepresentative ? `unsur perwakilan ${s.repOrder}` : String(s.rowNumber), s.name, s.role]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
}

function renderList() {
  const listEl = $('signatoriesList');
  const emptyEl = $('emptyState');
  if (!listEl) return;

  const rows = getFilteredSignatories();
  if (!rows.length) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = rows
    .map((s) => {
      const isFresh = state.recentlySignedIds.has(s.id);

      const classes = ['ledger-row'];
      if (s.isRepresentative) classes.push('is-leader');
      if (isFresh) classes.push('row-flash');

      const noCell = s.isRepresentative
        ? `<div class="r-no-leader">Unsur ${s.repOrder || ''}</div>`
        : `<div class="r-no">${String(s.rowNumber).padStart(2, '0')}</div>`;

      let sigCell = '';
      if (s.signed && s.signatureUrl) {
        sigCell = `
          <div class="r-sig-cell">
            <div class="r-sig-well">
              <img src="${esc(s.signatureUrl)}" alt="TTD ${esc(s.name)}" loading="lazy" />
            </div>
            <span class="r-sig-time">${esc(formatWitaTime(s.signedAt))}</span>
          </div>
        `;
      } else {
        sigCell = `<div class="r-sig-empty">—</div>`;
      }

      let actionCell = '';
      if (s.signed) {
        if (state.isAdmin) {
          actionCell = `
            <button type="button" class="text-btn" data-action="edit" data-id="${esc(s.id)}">Edit</button>
            <button type="button" class="text-btn text-btn-danger" data-action="clear" data-id="${esc(s.id)}">Reset</button>
            ${s.isCustom ? `<button type="button" class="text-btn text-btn-danger" data-action="delete" data-id="${esc(s.id)}">Hapus</button>` : ''}
          `;
        } else {
          actionCell = `<span class="status-done">&#10003; Tercatat</span>`;
        }
      } else {
        const disabled = state.settings.locked && !state.isAdmin;
        actionCell = `
          <button type="button" class="btn btn-primary btn-xs" data-action="sign" data-id="${esc(s.id)}" ${disabled ? 'disabled' : ''}>
            Tanda Tangani
          </button>
          ${
            state.isAdmin
              ? `<button type="button" class="text-btn" data-action="edit" data-id="${esc(s.id)}">Edit</button>
                 ${s.isCustom ? `<button type="button" class="text-btn text-btn-danger" data-action="delete" data-id="${esc(s.id)}">Hapus</button>` : ''}`
              : ''
          }
        `;
      }

      return `
        <div class="${classes.join(' ')}" data-row-id="${esc(s.id)}">
          ${noCell}
          <div class="r-person">
            <div class="r-name">${esc(s.name)}</div>
            <div class="r-role">${esc(s.role)}</div>
          </div>
          ${sigCell}
          <div class="r-actions">${actionCell}</div>
        </div>
      `;
    })
    .join('');
}

function renderDocumentView() {
  const editing = state.isAdmin && state.editingDoc;
  $('docNormalBar').classList.toggle('hidden', editing);
  $('inlineEditBar').classList.toggle('hidden', !editing);
  $('adminEditDocBtn').textContent = editing ? 'Sedang Edit...' : 'Edit Naskah';
  $('adminEditDocBtn').disabled = editing;

  renderOfficialDocument({
    container: $('documentSheetContainer'),
    documentMeta: state.documentMeta,
    signatories: state.signatories,
    locks: state.locks,
    clientId: state.clientId,
    locked: state.settings.locked && !state.isAdmin,
    editMode: editing,
  });
}

function switchView(viewName) {
  if (viewName !== 'document' && state.editingDoc) {
    state.editingDoc = false;
  }
  state.activeView = viewName;
  document.querySelectorAll('.primary-tab').forEach((btn) => {
    const active = btn.dataset.view === viewName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  const isDoc = viewName === 'document';
  $('viewList').classList.toggle('hidden', isDoc);
  $('viewDocument').classList.toggle('hidden', !isDoc);

  if (isDoc) renderDocumentView();
}

function startInlineDocEdit() {
  if (!state.isAdmin) return;
  state.editingDoc = true;
  switchView('document');
  renderDocumentView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelInlineDocEdit() {
  state.editingDoc = false;
  renderDocumentView();
}

async function saveInlineDocEdit() {
  const btn = $('saveInlineEditBtn');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try {
    const patch = extractEditedDocumentMeta($('documentSheetContainer'));
    const res = await apiFetch('/api/admin/document', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (res.documentMeta) state.documentMeta = res.documentMeta;
    state.editingDoc = false;
    renderAll();
    showToast('Teks naskah Berita Acara tersimpan.');
  } catch (err) {
    showToast(err.message || 'Gagal menyimpan teks naskah.');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// ===== SIGNING MODAL =====
function initSigningTools() {
  sigPad = new SignaturePad($('signatureCanvas'), {
    onChange: () => {
      const empty = sigPad.isEmpty();
      $('padPlaceholder').classList.toggle('hidden', !empty);
      $('padUndoBtn').disabled = empty;
    },
  });
  imgCleaner = new SignatureImageCleaner($('uploadPreviewCanvas'));
  window.addEventListener('resize', () => {
    if (!$('signModal').classList.contains('hidden') && state.signingMode === 'draw') {
      sigPad.resize();
    }
  });
}

function openSignModal(signatoryId) {
  const sig = state.signatories.find((s) => s.id === signatoryId);
  if (!sig) return;

  if (state.settings.locked && !state.isAdmin) {
    showToast('Dokumen telah dikunci oleh Panitia.');
    return;
  }
  if (sig.signed && !state.isAdmin) {
    return;
  }

  state.signingSignatoryId = signatoryId;

  $('signModalKicker').textContent = sig.isRepresentative
    ? `Perwakilan Unsur Peserta · Slot ${sig.repOrder}`
    : `Lampiran I · No. ${sig.rowNumber}`;
  $('signModalTitle').textContent = sig.name;
  $('signModalRole').textContent = sig.role;
  $('signError').classList.add('hidden');

  sigPad.clear();
  imgCleaner.reset();
  $('uploadDropzone').classList.remove('hidden');
  $('uploadEditor').classList.add('hidden');
  $('sigFileInput').value = '';

  setSignMode('draw');
  $('signModal').classList.remove('hidden');
  requestAnimationFrame(() => sigPad.resize());
}

function closeSignModal() {
  state.signingSignatoryId = null;
  clearInterval(lockRenewTimer);
  exitPadFullscreen();
  $('signModal').classList.add('hidden');
}

function setSignMode(mode) {
  state.signingMode = mode;
  document.querySelectorAll('.mode-tab').forEach((btn) => {
    const active = btn.dataset.signMode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  $('drawPanel').classList.toggle('hidden', mode !== 'draw');
  $('uploadPanel').classList.toggle('hidden', mode !== 'upload');
  if (mode === 'draw') requestAnimationFrame(() => sigPad.resize());
}

function enterPadFullscreen() {
  $('padCanvasWrap').classList.add('is-fullscreen');
  $('padExitFullscreenBtn').classList.remove('hidden');
  requestAnimationFrame(() => sigPad.resize());
}

function exitPadFullscreen() {
  $('padCanvasWrap').classList.remove('is-fullscreen');
  $('padExitFullscreenBtn').classList.add('hidden');
  requestAnimationFrame(() => sigPad.resize());
}

async function submitSignature() {
  const errEl = $('signError');
  errEl.classList.add('hidden');

  let signatureDataUrl = null;
  if (state.signingMode === 'draw') {
    signatureDataUrl = sigPad.exportTrimmedPng();
    if (!signatureDataUrl) {
      errEl.textContent = 'Silakan goreskan tanda tangan pada kotak di atas.';
      errEl.classList.remove('hidden');
      return;
    }
  } else {
    signatureDataUrl = imgCleaner.exportPng();
    if (!signatureDataUrl) {
      errEl.textContent = 'Pilih gambar tanda tangan terlebih dahulu.';
      errEl.classList.remove('hidden');
      return;
    }
  }

  const btn = $('submitSignBtn');
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const targetId = state.signingSignatoryId;
  try {
    const res = await apiFetch(`/api/signatories/${encodeURIComponent(targetId)}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        signatureDataUrl,
        method: state.signingMode,
      }),
    });

    upsertSignatory(res.signatory);
    if (res.stats) state.stats = res.stats;
    closeSignModal();
    renderAll();
    showToast(`Tanda tangan ${res.signatory.name} tersimpan.`);
  } catch (err) {
    errEl.textContent = err.message || 'Gagal menyimpan tanda tangan.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

// ===== QR ZOOM MODAL (PESERTA: SCAN QR ONLY; PANITIA: EDIT ZOOM LINK) =====
let currentQrTargetUrl = '';

async function openQrModal() {
  $('qrError').classList.add('hidden');
  $('qrAdminControls').classList.toggle('hidden', !state.isAdmin);
  $('qrParticipantHint').classList.toggle('hidden', state.isAdmin);
  $('qrModal').classList.remove('hidden');
  await loadQrCode();
}

async function loadQrCode() {
  try {
    const data = await apiFetch('/api/qr');
    $('qrSvgBox').innerHTML = data.svg;
    currentQrTargetUrl = data.url || '';
    if (state.isAdmin) {
      $('qrUrlInput').value = data.baseUrl || '';
    }
  } catch {
    showToast('Gagal memuat QR Zoom.');
  }
}

async function saveAdminQrSettings() {
  if (!state.isAdmin) return;
  const errEl = $('qrError');
  errEl.classList.add('hidden');
  const rawUrl = $('qrUrlInput').value.trim();
  const btn = $('saveQrUrlBtn');
  btn.disabled = true;
  try {
    await apiFetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        qrCustomUrl: rawUrl,
        qrIncludeCode: false,
      }),
    });
    await loadQrCode();
    showToast('Tautan QR Zoom diperbarui.');
  } catch (err) {
    errEl.textContent = err.message || 'Gagal menyimpan tautan QR Zoom.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

// ===== PANITIA SETTINGS MODAL =====
async function openSettingsModal() {
  if (!state.isAdmin) return;
  $('adminSaveMsg').classList.add('hidden');
  $('settingsModal').classList.remove('hidden');
  renderAuditList();
  try {
    const s = await apiFetch('/api/admin/settings');
    $('adminMeetingCodeInput').value = s.meetingCode || '';
    $('adminDaftarHadirInput').value =
      s.daftarHadirUrl || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI';
    $('adminQrZoomInput').value = s.qrCustomUrl || '';
    $('adminRequireCodeToggle').checked = Boolean(s.requireMeetingCode);
    $('adminLockToggle').checked = Boolean(s.locked);
    $('adminNewPinInput').value = '';
  } catch {
    // ignore
  }
}

function renderAuditList() {
  const list = $('activityList');
  if (!list) return;
  if (!state.auditLogs.length) {
    list.innerHTML = `<div class="empty-state" style="padding:18px">Belum ada aktivitas.</div>`;
    return;
  }
  list.innerHTML = state.auditLogs
    .slice(0, 30)
    .map(
      (entry) => `
      <div class="activity-item">
        <p class="activity-summary">${esc(entry.summary)}</p>
        <div class="activity-meta">${esc(formatWitaFull(entry.timestamp))}</div>
      </div>
    `
    )
    .join('');
}

// ===== ADMIN ACTIONS =====
async function clearSignatorySignature(id) {
  const sig = state.signatories.find((s) => s.id === id);
  if (!sig) return;
  if (!window.confirm(`Hapus / reset tanda tangan ${sig.name}?`)) return;
  try {
    await apiFetch(`/api/admin/signatories/${encodeURIComponent(id)}/clear`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Reset Panitia' }),
    });
  } catch (err) {
    showToast(err.message || 'Gagal mereset tanda tangan.');
  }
}

async function deleteCustomSignatory(id) {
  const sig = state.signatories.find((s) => s.id === id);
  if (!sig) return;
  if (!window.confirm(`Hapus peserta tambahan "${sig.name}" dari daftar?`)) return;
  try {
    await apiFetch(`/api/admin/signatories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast(`Peserta ${sig.name} dihapus.`);
  } catch (err) {
    showToast(err.message || 'Gagal menghapus peserta.');
  }
}

function openEditModal(id) {
  const sig = state.signatories.find((s) => s.id === id);
  if (!sig) return;
  $('editSignatoryId').value = sig.id;
  $('editNameInput').value = sig.name;
  $('editRoleInput').value = sig.role;
  $('editError').classList.add('hidden');
  $('editModal').classList.remove('hidden');
}

async function exitAdminMode() {
  await fetch('/api/auth/logout-admin', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  state.isAdmin = false;
  state.editingDoc = false;
  state.adminToken = '';
  localStorage.removeItem(STORAGE_KEYS.adminToken);
  $('settingsModal').classList.add('hidden');
  renderAll();
  showToast('Keluar dari Mode Panitia.');
}

// ===== EVENTS =====
function bindEvents() {
  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('gateError');
    errEl.classList.add('hidden');
    const code = $('gateCodeInput').value.trim();

    const btn = $('gateSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Memeriksa...';
    try {
      const res = await apiFetch('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      state.sessionToken = res.token;
      localStorage.setItem(STORAGE_KEYS.sessionToken, res.token);
      await enterMainApp();
    } catch (err) {
      errEl.textContent = err.message || 'Kode Rapat tidak sesuai.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });

  // Export Dropdown
  $('exportMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('exportMenuPanel').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!$('exportDropdown').contains(e.target)) {
      $('exportMenuPanel').classList.add('hidden');
    }
  });
  $('exportMenuPanel').addEventListener('click', () => {
    $('exportMenuPanel').classList.add('hidden');
  });
  $('printDocBtn').addEventListener('click', () => {
    switchView('document');
    setTimeout(() => window.print(), 180);
  });

  // Primary View Tabs (Daftar Penandatangan vs Naskah Berita Acara)
  document.querySelectorAll('.primary-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Admin Login & Settings
  const openAdminLogin = () => {
    $('adminLoginError').classList.add('hidden');
    $('adminPinInput').value = '';
    $('adminLoginModal').classList.remove('hidden');
    setTimeout(() => $('adminPinInput').focus(), 50);
  };
  $('gateAdminLink').addEventListener('click', openAdminLogin);
  $('adminEnterBtn').addEventListener('click', openAdminLogin);
  // Direct In-Paper WYSIWYG Editor (Panitia only)
  bindInlinePaperEditor($('documentSheetContainer'));
  $('adminEditDocBtn').addEventListener('click', startInlineDocEdit);
  $('docStartEditBtn').addEventListener('click', startInlineDocEdit);
  $('cancelInlineEditBtn').addEventListener('click', cancelInlineDocEdit);
  $('saveInlineEditBtn').addEventListener('click', saveInlineDocEdit);
  $('closeAdminLoginBtn').addEventListener('click', () => $('adminLoginModal').classList.add('hidden'));
  $('cancelAdminLoginBtn').addEventListener('click', () => $('adminLoginModal').classList.add('hidden'));
  $('adminSettingsBtn').addEventListener('click', openSettingsModal);
  $('closeSettingsBtn').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('closeSettingsDoneBtn').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('adminExitBtn').addEventListener('click', exitAdminMode);

  $('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('adminLoginError');
    errEl.classList.add('hidden');
    try {
      const res = await apiFetch('/api/auth/verify-admin', {
        method: 'POST',
        body: JSON.stringify({ pin: $('adminPinInput').value.trim() }),
      });
      state.isAdmin = true;
      state.adminToken = res.adminToken;
      state.sessionToken = res.sessionToken;
      localStorage.setItem(STORAGE_KEYS.adminToken, res.adminToken);
      localStorage.setItem(STORAGE_KEYS.sessionToken, res.sessionToken);
      $('adminLoginModal').classList.add('hidden');
      if ($('appShell').classList.contains('hidden')) await enterMainApp();
      else renderAll();
      showToast('Mode Panitia aktif. Tombol Edit, Reset, dan Hapus sekarang tersedia.');
    } catch (err) {
      errEl.textContent = err.message || 'PIN Panitia tidak sesuai.';
      errEl.classList.remove('hidden');
    }
  });

  $('saveAdminSettingsBtn').addEventListener('click', async () => {
    const msgEl = $('adminSaveMsg');
    msgEl.classList.add('hidden');
    const payload = {
      meetingCode: $('adminMeetingCodeInput').value.trim(),
      daftarHadirUrl: $('adminDaftarHadirInput').value.trim(),
      qrCustomUrl: $('adminQrZoomInput').value.trim(),
      requireMeetingCode: $('adminRequireCodeToggle').checked,
      locked: $('adminLockToggle').checked,
    };
    const newPin = $('adminNewPinInput').value.trim();
    if (newPin) payload.adminPin = newPin;

    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (res.settings) {
        state.settings = { ...state.settings, ...res.settings };
      }
      if (res.adminToken) {
        state.adminToken = res.adminToken;
        localStorage.setItem(STORAGE_KEYS.adminToken, res.adminToken);
      }
      if (res.sessionToken) {
        state.sessionToken = res.sessionToken;
        localStorage.setItem(STORAGE_KEYS.sessionToken, res.sessionToken);
      }
      $('adminNewPinInput').value = '';
      renderChrome();
      msgEl.className = 'msg-inline msg-success';
      msgEl.textContent = 'Pengaturan (termasuk tautan Daftar Hadir & QR Zoom) tersimpan.';
      msgEl.classList.remove('hidden');
    } catch (err) {
      msgEl.className = 'msg-inline msg-error';
      msgEl.textContent = err.message || 'Gagal menyimpan pengaturan.';
      msgEl.classList.remove('hidden');
    }
  });

  $('resetAllDataBtn').addEventListener('click', async () => {
    if (!window.confirm('Yakin hapus SEMUA tanda tangan & peserta tambahan (kembali ke 0 / 55)?')) return;
    try {
      await apiFetch('/api/admin/reset-all', { method: 'POST' });
      $('settingsModal').classList.add('hidden');
    } catch (err) {
      showToast(err.message || 'Gagal mereset data.');
    }
  });

  // Search & Filter
  const searchInput = $('searchInput');
  const clearBtn = $('clearSearchBtn');
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value;
    clearBtn.classList.toggle('hidden', !state.searchQuery);
    renderList();
  });
  clearBtn.addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    clearBtn.classList.add('hidden');
    renderList();
    searchInput.focus();
  });

  $('instansiFilter').addEventListener('change', (e) => {
    state.instansiFilter = e.target.value;
    renderList();
  });

  $('statusFilterSelect').addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    renderList();
  });

  // Row & Document Clicks
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action]');
    if (trigger) {
      const { action, id } = trigger.dataset;
      if (action === 'sign') openSignModal(id);
      else if (action === 'clear') clearSignatorySignature(id);
      else if (action === 'edit') openEditModal(id);
      else if (action === 'delete') deleteCustomSignatory(id);
      return;
    }

    const docTrigger = e.target.closest('[data-doc-action]');
    if (docTrigger) {
      const { docAction, id } = docTrigger.dataset;
      if (docAction === 'sign') openSignModal(id);
    }
  });

  // QR Zoom Modal
  $('qrBtn').addEventListener('click', openQrModal);
  $('closeQrModalBtn').addEventListener('click', () => $('qrModal').classList.add('hidden'));
  $('closeQrDoneBtn').addEventListener('click', () => $('qrModal').classList.add('hidden'));
  $('saveQrUrlBtn').addEventListener('click', saveAdminQrSettings);
  $('copyQrUrlBtn').addEventListener('click', async () => {
    const toCopy = currentQrTargetUrl || $('qrUrlInput').value;
    try {
      await navigator.clipboard.writeText(toCopy);
    } catch {
      $('qrUrlInput').select();
      document.execCommand('copy');
    }
    showToast('Tautan QR disalin.');
  });

  // Signing Modal
  $('closeSignModalBtn').addEventListener('click', closeSignModal);
  $('cancelSignBtn').addEventListener('click', closeSignModal);
  $('submitSignBtn').addEventListener('click', submitSignature);

  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => setSignMode(btn.dataset.signMode));
  });
  document.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === sw));
      sigPad.setColor(sw.dataset.ink);
    });
  });
  document.querySelectorAll('[data-thickness]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-thickness]').forEach((c) => c.classList.toggle('active', c === chip));
      sigPad.setThickness(chip.dataset.thickness);
    });
  });
  $('padUndoBtn').addEventListener('click', () => sigPad.undo());
  $('padClearBtn').addEventListener('click', () => sigPad.clear());
  $('padFullscreenBtn').addEventListener('click', enterPadFullscreen);
  $('padExitFullscreenBtn').addEventListener('click', exitPadFullscreen);

  const dropzone = $('uploadDropzone');
  const fileInput = $('sigFileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files?.[0]) handleUpload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) handleUpload(fileInput.files[0]);
  });
  $('uploadChangeBtn').addEventListener('click', () => fileInput.click());

  $('removeBgToggle').addEventListener('change', () => {
    const on = $('removeBgToggle').checked;
    $('thresholdControl').classList.toggle('hidden', !on);
    imgCleaner.setOptions({ removeBg: on });
  });
  $('bgThresholdSlider').addEventListener('input', () => {
    const val = Number($('bgThresholdSlider').value);
    $('bgThresholdValue').textContent = String(val);
    imgCleaner.setOptions({ threshold: val });
  });
  document.querySelectorAll('[data-recolor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-recolor]').forEach((b) => b.classList.toggle('active', b === btn));
      imgCleaner.setOptions({ recolor: btn.dataset.recolor });
    });
  });

  async function handleUpload(file) {
    $('signError').classList.add('hidden');
    try {
      const info = await imgCleaner.loadFile(file);
      $('removeBgToggle').checked = info.removeBg;
      $('thresholdControl').classList.toggle('hidden', !info.removeBg);
      $('uploadDropzone').classList.add('hidden');
      $('uploadEditor').classList.remove('hidden');
    } catch (err) {
      $('signError').textContent = err.message || 'Gagal memproses gambar.';
      $('signError').classList.remove('hidden');
    }
  }

  // Add Participant Modal
  $('addParticipantBtn').addEventListener('click', () => {
    $('addError').classList.add('hidden');
    $('newPartName').value = '';
    $('newPartRole').value = '';
    $('newPartSignNow').checked = true;
    $('addModal').classList.remove('hidden');
    setTimeout(() => $('newPartName').focus(), 50);
  });
  $('closeAddModalBtn').addEventListener('click', () => $('addModal').classList.add('hidden'));
  $('cancelAddBtn').addEventListener('click', () => $('addModal').classList.add('hidden'));
  $('addParticipantForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('addError');
    errEl.classList.add('hidden');
    const btn = $('submitAddBtn');
    btn.disabled = true;
    try {
      const res = await apiFetch('/api/signatories', {
        method: 'POST',
        body: JSON.stringify({
          name: $('newPartName').value.trim(),
          role: $('newPartRole').value.trim(),
        }),
      });
      upsertSignatory(res.signatory);
      if (res.stats) state.stats = res.stats;
      $('addModal').classList.add('hidden');
      renderAll();
      if ($('newPartSignNow').checked) openSignModal(res.signatory.id);
    } catch (err) {
      errEl.textContent = err.message || 'Gagal menambah peserta.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  // Edit Modal
  $('closeEditModalBtn').addEventListener('click', () => $('editModal').classList.add('hidden'));
  $('cancelEditBtn').addEventListener('click', () => $('editModal').classList.add('hidden'));
  $('editSignatoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('editError');
    errEl.classList.add('hidden');
    try {
      await apiFetch(`/api/admin/signatories/${encodeURIComponent($('editSignatoryId').value)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: $('editNameInput').value.trim(),
          role: $('editRoleInput').value.trim(),
        }),
      });
      $('editModal').classList.add('hidden');
      showToast('Data diperbarui.');
    } catch (err) {
      errEl.textContent = err.message || 'Gagal menyimpan perubahan.';
      errEl.classList.remove('hidden');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('padCanvasWrap').classList.contains('is-fullscreen')) exitPadFullscreen();
    else if (!$('signModal').classList.contains('hidden')) closeSignModal();
    else if (!$('addModal').classList.contains('hidden')) $('addModal').classList.add('hidden');
    else if (!$('qrModal').classList.contains('hidden')) $('qrModal').classList.add('hidden');
    else if (!$('adminLoginModal').classList.contains('hidden')) $('adminLoginModal').classList.add('hidden');
    else if (!$('settingsModal').classList.contains('hidden')) $('settingsModal').classList.add('hidden');
    else if (state.editingDoc) cancelInlineDocEdit();
    else if (!$('editModal').classList.contains('hidden')) $('editModal').classList.add('hidden');
  });
}

bootstrap();
