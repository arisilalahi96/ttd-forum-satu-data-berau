import { SignaturePad } from './signaturePad.js';
import { SignatureImageCleaner } from './imageCleaner.js';
import { renderOfficialDocument } from './documentView.js';

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

  activeView: 'list', // 'list' | 'document' | 'settings'
  searchQuery: '',
  statusFilter: 'all',
  recentlySignedIds: new Set(),

  signingSignatoryId: null,
  signingMode: 'draw',
  detailSignatoryId: null,
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
  }, 3600);
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

    $('gateEventDate').textContent = boot.documentMeta.eventDateLabel;
    $('gateProgress').textContent = `${boot.stats.signed} / ${boot.stats.total} pihak`;
    if (state.displayName) $('gateDisplayName').value = state.displayName;

    if (boot.authorized) {
      await enterMainApp();
    } else {
      showAccessGate();
    }
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
    if (!state.isAdmin && state.activeView === 'settings') state.activeView = 'list';
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
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
      if (state.activeView === 'document') renderDocumentTab();
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
      showToast(`Tanda tangan ${msg.signatory.name} diatur ulang.`);
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

    case 'settings_updated':
      if (msg.settings) state.settings = msg.settings;
      if (msg.auditEntry) state.auditLogs.unshift(msg.auditEntry);
      renderAll();
      showToast(state.settings.locked ? 'Dokumen dikunci oleh Panitia.' : 'Pengaturan diperbarui.');
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
  if (state.activeView === 'document') renderDocumentTab();
  if (state.activeView === 'settings' && state.isAdmin) renderSettingsTab();
}

function renderChrome() {
  const admin = state.isAdmin;
  $('adminBadge').classList.toggle('hidden', !admin);
  $('lockedBadge').classList.toggle('hidden', !state.settings.locked);
  $('adminSettingsTab').classList.toggle('hidden', !admin);
  $('adminSettingsMobileTab').classList.toggle('hidden', !admin);
  $('adminEnterBtn').classList.toggle('hidden', admin);
  $('adminExitBtn').classList.toggle('hidden', !admin);

  const canAdd = admin || (state.settings.allowSelfAdd && !state.settings.locked);
  $('addParticipantBtn').classList.toggle('hidden', !canAdd);

  $('quickDocxLink').href = buildDownloadUrl('/api/export/berita-acara.docx');
  $('quickPdfLink').href = buildDownloadUrl('/api/export/berita-acara.pdf');
}

function renderSummary() {
  const st = state.stats;
  $('statSignedCount').textContent = st.signed;
  $('statTotalCount').textContent = st.total;
  $('statPct').textContent = `${st.percentage}%`;
  $('progressBarFill').style.width = `${st.percentage}%`;
  $('progressBarTrack').setAttribute('aria-valuenow', String(st.percentage));

  const signedAll = state.signatories.filter((s) => s.signed).length;
  $('countSigned').textContent = signedAll;
  $('countUnsigned').textContent = state.signatories.length - signedAll;
}

function getFilteredSignatories() {
  const q = state.searchQuery.trim().toLowerCase();
  return [...state.signatories]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .filter((s) => {
      if (state.statusFilter === 'signed' && !s.signed) return false;
      if (state.statusFilter === 'unsigned' && s.signed) return false;
      if (!q) return true;
      return [
        s.isLeader ? 'bupati pimpinan' : String(s.rowNumber),
        s.name,
        s.role,
        s.representedBy ? s.representedBy.name : '',
      ]
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
      const lock = state.locks[s.id];
      const isBusy = lock && lock.clientId !== state.clientId;
      const isFresh = state.recentlySignedIds.has(s.id);

      const classes = ['ledger-row'];
      if (s.isLeader) classes.push('is-leader');
      if (isBusy) classes.push('is-busy');
      if (isFresh) classes.push('row-flash');

      const noCell = s.isLeader
        ? `<div class="r-no-leader">Pimpinan</div>`
        : `<div class="r-no">${String(s.rowNumber).padStart(2, '0')}</div>`;

      const repHtml =
        s.representedBy && s.representedBy.name
          ? `<div class="r-rep">a.n. ${esc(s.representedBy.name)}${
              s.representedBy.role ? ` (${esc(s.representedBy.role)})` : ''
            }</div>`
          : '';

      let sigCell = '';
      if (s.signed && s.signatureUrl) {
        sigCell = `
          <div class="r-sig-cell">
            <button type="button" class="r-sig-btn" data-action="detail" data-id="${esc(s.id)}" title="Lihat detail &amp; unduh bukti">
              <img src="${esc(s.signatureUrl)}" alt="TTD ${esc(s.name)}" loading="lazy" />
            </button>
            <span class="r-sig-time">${esc(formatWitaTime(s.signedAt))}</span>
          </div>
        `;
      } else if (isBusy) {
        sigCell = `<div class="r-sig-busy">Sedang diisi...</div>`;
      } else {
        sigCell = `<div class="r-sig-empty">—</div>`;
      }

      let actionCell = '';
      if (s.signed) {
        const docxUrl = buildDownloadUrl(`/api/export/individual/${encodeURIComponent(s.id)}.docx`);
        const pdfUrl = buildDownloadUrl(`/api/export/individual/${encodeURIComponent(s.id)}.pdf`);
        actionCell = `
          <a class="text-btn" href="${esc(docxUrl)}">Word</a>
          <a class="text-btn" href="${esc(pdfUrl)}">PDF</a>
          ${
            state.isAdmin
              ? `<button type="button" class="text-btn" data-action="edit" data-id="${esc(s.id)}">Edit</button>
                 <button type="button" class="text-btn text-btn-danger" data-action="clear" data-id="${esc(s.id)}">Reset</button>
                 ${s.isCustom ? `<button type="button" class="text-btn text-btn-danger" data-action="delete" data-id="${esc(s.id)}">Hapus</button>` : ''}`
              : ''
          }
        `;
      } else {
        const disabled = (state.settings.locked && !state.isAdmin) || isBusy;
        actionCell = `
          <button type="button" class="btn btn-primary btn-xs" data-action="sign" data-id="${esc(s.id)}" ${disabled ? 'disabled' : ''}>
            ${isBusy ? 'Sedang diisi' : 'Tanda Tangani'}
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
            ${repHtml}
          </div>
          ${sigCell}
          <div class="r-actions">${actionCell}</div>
        </div>
      `;
    })
    .join('');
}

function renderDocumentTab() {
  $('dlFullDocx').href = buildDownloadUrl('/api/export/berita-acara.docx');
  $('dlFullPdf').href = buildDownloadUrl('/api/export/berita-acara.pdf');
  $('dlZipDocx').href = buildDownloadUrl('/api/export/bundle-docx.zip');
  $('dlZipPdf').href = buildDownloadUrl('/api/export/bundle-pdf.zip');
  $('dlRekapCsv').href = buildDownloadUrl('/api/export/rekap.csv');

  renderOfficialDocument({
    container: $('documentSheetContainer'),
    documentMeta: state.documentMeta,
    signatories: state.signatories,
    locks: state.locks,
    clientId: state.clientId,
    locked: state.settings.locked && !state.isAdmin,
  });
}

async function renderSettingsTab() {
  if (!state.isAdmin) return;
  renderAuditList();
  try {
    const s = await apiFetch('/api/admin/settings');
    $('adminMeetingCodeInput').value = s.meetingCode || '';
    $('adminRequireCodeToggle').checked = Boolean(s.requireMeetingCode);
    $('adminAllowSelfAddToggle').checked = Boolean(s.allowSelfAdd);
    $('adminLockToggle').checked = Boolean(s.locked);
  } catch {
    // ignore
  }
}

function renderAuditList() {
  const list = $('activityList');
  if (!list) return;
  if (!state.auditLogs.length) {
    list.innerHTML = `<div class="empty-state">Belum ada aktivitas.</div>`;
    return;
  }
  list.innerHTML = state.auditLogs
    .slice(0, 50)
    .map(
      (entry) => `
      <div class="activity-item">
        <p class="activity-summary">${esc(entry.summary)}</p>
        <div class="activity-meta">${esc(formatWitaFull(entry.timestamp))}${
          entry.verificationHash ? ` · <span class="mono">${esc(entry.verificationHash)}</span>` : ''
        }</div>
      </div>
    `
    )
    .join('');
}

function switchView(viewName) {
  if (viewName === 'settings' && !state.isAdmin) viewName = 'list';
  state.activeView = viewName;

  document.querySelectorAll('.nav-link, .mobile-tab').forEach((btn) => {
    const active = btn.dataset.view === viewName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  $('viewList').classList.toggle('hidden', viewName !== 'list');
  $('viewDocument').classList.toggle('hidden', viewName !== 'document');
  $('viewSettings').classList.toggle('hidden', viewName !== 'settings');

  if (viewName === 'document') renderDocumentTab();
  if (viewName === 'settings') renderSettingsTab();
}

// ===== READ DOCUMENT MODAL =====
function openReadDocModal() {
  const m = state.documentMeta;
  if (!m) return;
  $('readDocBody').innerHTML = `
    <h4>${m.titleLines.map(esc).join('<br />')}</h4>
    ${m.paragraphsBeforePoints.map((p) => `<p>${esc(p)}</p>`).join('')}
    <ol>${m.agreementPoints.map((pt) => `<li>${esc(pt)}</li>`).join('')}</ol>
    <p>${esc(m.closingParagraph)}</p>
  `;
  $('readDocModal').classList.remove('hidden');
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
    openDetailModal(signatoryId);
    return;
  }
  const existingLock = state.locks[signatoryId];
  if (existingLock && existingLock.clientId !== state.clientId) {
    showToast('Baris ini sedang diisi oleh peserta lain.');
    return;
  }

  state.signingSignatoryId = signatoryId;
  wsSend({ type: 'lock_acquire', signatoryId });
  clearInterval(lockRenewTimer);
  lockRenewTimer = setInterval(() => {
    if (state.signingSignatoryId) wsSend({ type: 'lock_renew', signatoryId: state.signingSignatoryId });
  }, 45_000);

  $('signModalKicker').textContent = sig.isLeader
    ? 'Pimpinan Rapat · Bupati Berau'
    : `Penandatanganan · No. ${sig.rowNumber}`;
  $('signModalTitle').textContent = sig.name;
  $('signModalRole').textContent = sig.role;

  document.querySelector('input[name="attendanceMode"][value="direct"]').checked = true;
  $('representativeFields').classList.add('hidden');
  $('repNameInput').value = '';
  $('repRoleInput').value = '';
  $('signConsentCheck').checked = true;
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
  if (state.signingSignatoryId) {
    wsSend({ type: 'lock_release', signatoryId: state.signingSignatoryId });
    state.signingSignatoryId = null;
  }
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

  if (!$('signConsentCheck').checked) {
    errEl.textContent = 'Centang persetujuan Berita Acara terlebih dahulu.';
    errEl.classList.remove('hidden');
    return;
  }

  const attendanceMode = document.querySelector('input[name="attendanceMode"]:checked')?.value || 'direct';
  let representedBy = null;
  if (attendanceMode === 'representative') {
    const repName = $('repNameInput').value.trim();
    const repRole = $('repRoleInput').value.trim();
    if (repName.length < 2) {
      errEl.textContent = 'Masukkan nama lengkap perwakilan (a.n.).';
      errEl.classList.remove('hidden');
      $('repNameInput').focus();
      return;
    }
    representedBy = { name: repName, role: repRole };
  }

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
        representedBy,
      }),
    });

    upsertSignatory(res.signatory);
    if (res.stats) state.stats = res.stats;
    closeSignModal();
    renderAll();
    showToast(`Tanda tangan ${res.signatory.name} tersimpan.`);
    openDetailModal(res.signatory.id);
  } catch (err) {
    errEl.textContent = err.message || 'Gagal menyimpan tanda tangan.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

// ===== DETAIL & INDIVIDUAL DOWNLOAD MODAL =====
function openDetailModal(signatoryId) {
  const sig = state.signatories.find((s) => s.id === signatoryId);
  if (!sig || !sig.signed) return;
  state.detailSignatoryId = signatoryId;

  $('detailModalTitle').textContent = sig.name;
  $('detailModalRole').textContent = sig.role;

  const attendanceText =
    sig.representedBy && sig.representedBy.name
      ? `a.n. ${sig.representedBy.name}${sig.representedBy.role ? ` (${sig.representedBy.role})` : ''}`
      : 'Hadir langsung';

  const docxUrl = buildDownloadUrl(`/api/export/individual/${encodeURIComponent(sig.id)}.docx`);
  const pdfUrl = buildDownloadUrl(`/api/export/individual/${encodeURIComponent(sig.id)}.pdf`);
  const pngUrl = buildDownloadUrl(`/api/export/signature/${encodeURIComponent(sig.id)}.png`);

  $('detailModalBody').innerHTML = `
    <div class="detail-sig-box">
      <img src="${esc(sig.signatureUrl)}" alt="Tanda tangan ${esc(sig.name)}" />
    </div>
    <div class="detail-meta-list">
      <div class="detail-meta-row"><span>Nomor Urut</span><span class="mono">${sig.isLeader ? 'Pimpinan' : `No. ${sig.rowNumber}`}</span></div>
      <div class="detail-meta-row"><span>Waktu</span><span>${esc(formatWitaFull(sig.signedAt))}</span></div>
      <div class="detail-meta-row"><span>Kehadiran</span><span>${esc(attendanceText)}</span></div>
      <div class="detail-meta-row"><span>Verifikasi</span><span class="mono">${esc(sig.verificationHash || '-')}</span></div>
    </div>
    <div class="detail-dl-row">
      <a class="btn btn-primary btn-sm" href="${esc(docxUrl)}">Word (.docx)</a>
      <a class="btn btn-primary btn-sm" href="${esc(pdfUrl)}">PDF (.pdf)</a>
      <a class="btn btn-outline btn-sm" href="${esc(pngUrl)}">PNG</a>
    </div>
  `;

  $('detailAdminActions').classList.toggle('hidden', !state.isAdmin);
  $('detailModal').classList.remove('hidden');
}

function closeDetailModal() {
  state.detailSignatoryId = null;
  $('detailModal').classList.add('hidden');
}

// ===== QR MODAL =====
async function openQrModal() {
  $('qrModal').classList.remove('hidden');
  $('qrAutoCodeOption').classList.toggle('hidden', !state.isAdmin);
  await loadQrCode();
}

async function loadQrCode() {
  const includeCode = state.isAdmin && $('qrIncludeCodeCheck').checked ? '1' : '0';
  try {
    const data = await apiFetch(`/api/qr?includeCode=${includeCode}`);
    $('qrSvgBox').innerHTML = data.svg;
    $('qrUrlInput').value = data.url;
    if (data.meetingCodeHint) {
      $('qrCodeHintVal').textContent = data.meetingCodeHint;
      $('qrCodeHintBox').classList.remove('hidden');
    } else {
      $('qrCodeHintBox').classList.add('hidden');
    }
  } catch {
    showToast('Gagal memuat QR Code.');
  }
}

// ===== ADMIN ACTIONS =====
async function clearSignatorySignature(id) {
  const sig = state.signatories.find((s) => s.id === id);
  if (!sig) return;
  if (!window.confirm(`Atur ulang tanda tangan ${sig.name}?`)) return;
  try {
    await apiFetch(`/api/admin/signatories/${encodeURIComponent(id)}/clear`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Reset Panitia' }),
    });
    closeDetailModal();
  } catch (err) {
    showToast(err.message || 'Gagal mereset tanda tangan.');
  }
}

async function deleteCustomSignatory(id) {
  const sig = state.signatories.find((s) => s.id === id);
  if (!sig) return;
  if (!window.confirm(`Hapus peserta tambahan "${sig.name}"?`)) return;
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
  state.adminToken = '';
  localStorage.removeItem(STORAGE_KEYS.adminToken);
  if (state.activeView === 'settings') switchView('list');
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
    const displayName = $('gateDisplayName').value.trim();
    if (displayName) {
      state.displayName = displayName;
      localStorage.setItem(STORAGE_KEYS.displayName, displayName);
    }

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

  const openAdminLogin = () => {
    $('adminLoginError').classList.add('hidden');
    $('adminPinInput').value = '';
    $('adminLoginModal').classList.remove('hidden');
    setTimeout(() => $('adminPinInput').focus(), 50);
  };
  $('gateAdminLink').addEventListener('click', openAdminLogin);
  $('adminEnterBtn').addEventListener('click', openAdminLogin);
  $('closeAdminLoginBtn').addEventListener('click', () => $('adminLoginModal').classList.add('hidden'));
  $('cancelAdminLoginBtn').addEventListener('click', () => $('adminLoginModal').classList.add('hidden'));
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
      showToast('Mode Panitia aktif.');
    } catch (err) {
      errEl.textContent = err.message || 'PIN Panitia tidak sesuai.';
      errEl.classList.remove('hidden');
    }
  });

  document.querySelectorAll('.nav-link, .mobile-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('readDocBtn').addEventListener('click', openReadDocModal);
  $('closeReadDocBtn').addEventListener('click', () => $('readDocModal').classList.add('hidden'));
  $('closeReadDocDoneBtn').addEventListener('click', () => $('readDocModal').classList.add('hidden'));

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

  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.statusFilter = btn.dataset.status;
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderList();
    });
  });

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-action]');
    if (trigger) {
      const { action, id } = trigger.dataset;
      if (action === 'sign') openSignModal(id);
      else if (action === 'detail') openDetailModal(id);
      else if (action === 'clear') clearSignatorySignature(id);
      else if (action === 'edit') openEditModal(id);
      else if (action === 'delete') deleteCustomSignatory(id);
      return;
    }

    const docTrigger = e.target.closest('[data-doc-action]');
    if (docTrigger) {
      const { docAction, id } = docTrigger.dataset;
      if (docAction === 'sign') openSignModal(id);
      else if (docAction === 'detail') openDetailModal(id);
    }
  });

  $('printDocBtn').addEventListener('click', () => window.print());

  // QR Modal
  $('qrBtn').addEventListener('click', openQrModal);
  $('closeQrModalBtn').addEventListener('click', () => $('qrModal').classList.add('hidden'));
  $('closeQrDoneBtn').addEventListener('click', () => $('qrModal').classList.add('hidden'));
  $('qrIncludeCodeCheck').addEventListener('change', loadQrCode);
  $('copyQrUrlBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('qrUrlInput').value);
    } catch {
      $('qrUrlInput').select();
      document.execCommand('copy');
    }
    showToast('Tautan disalin.');
  });

  // Save Panitia Settings
  $('saveAdminSettingsBtn').addEventListener('click', async () => {
    const msgEl = $('adminSaveMsg');
    msgEl.classList.add('hidden');
    const payload = {
      meetingCode: $('adminMeetingCodeInput').value.trim(),
      requireMeetingCode: $('adminRequireCodeToggle').checked,
      allowSelfAdd: $('adminAllowSelfAddToggle').checked,
      locked: $('adminLockToggle').checked,
    };
    const newPin = $('adminNewPinInput').value.trim();
    if (newPin) payload.adminPin = newPin;

    try {
      const res = await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (res.adminToken) {
        state.adminToken = res.adminToken;
        localStorage.setItem(STORAGE_KEYS.adminToken, res.adminToken);
      }
      if (res.sessionToken) {
        state.sessionToken = res.sessionToken;
        localStorage.setItem(STORAGE_KEYS.sessionToken, res.sessionToken);
      }
      $('adminNewPinInput').value = '';
      msgEl.className = 'msg-inline msg-success';
      msgEl.textContent = 'Pengaturan tersimpan.';
      msgEl.classList.remove('hidden');
    } catch (err) {
      msgEl.className = 'msg-inline msg-error';
      msgEl.textContent = err.message || 'Gagal menyimpan pengaturan.';
      msgEl.classList.remove('hidden');
    }
  });

  // Signing Modal Controls
  $('closeSignModalBtn').addEventListener('click', closeSignModal);
  $('cancelSignBtn').addEventListener('click', closeSignModal);
  $('submitSignBtn').addEventListener('click', submitSignature);

  document.querySelectorAll('input[name="attendanceMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isRep = radio.value === 'representative' && radio.checked;
      $('representativeFields').classList.toggle('hidden', !isRep);
      if (isRep) $('repNameInput').focus();
    });
  });

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

  $('closeDetailModalBtn').addEventListener('click', closeDetailModal);
  $('closeDetailDoneBtn').addEventListener('click', closeDetailModal);
  $('detailResetSigBtn').addEventListener('click', () => {
    if (state.detailSignatoryId) clearSignatorySignature(state.detailSignatoryId);
  });

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
    else if (!$('detailModal').classList.contains('hidden')) closeDetailModal();
    else if (!$('readDocModal').classList.contains('hidden')) $('readDocModal').classList.add('hidden');
    else if (!$('addModal').classList.contains('hidden')) $('addModal').classList.add('hidden');
    else if (!$('qrModal').classList.contains('hidden')) $('qrModal').classList.add('hidden');
    else if (!$('adminLoginModal').classList.contains('hidden')) $('adminLoginModal').classList.add('hidden');
    else if (!$('editModal').classList.contains('hidden')) $('editModal').classList.add('hidden');
  });
}

bootstrap();
