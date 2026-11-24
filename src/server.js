'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');

const { ForumStore } = require('./store');
const { RealtimeHub } = require('./realtime');
const { parseAndValidatePngDataUrl } = require('./utils/pngTools');
const { normalizeCode } = require('./utils/formatters');
const { generateBeritaAcaraDocx } = require('./exporters/docxBeritaAcara');
const { generateBeritaAcaraPdf } = require('./exporters/pdfBeritaAcara');
const { generateRekapCsv } = require('./exporters/zipArchive');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN_SECRET = crypto
  .createHash('sha256')
  .update(String(process.env.SESSION_SECRET || 'forum-satu-data-berau-2026-secret-key'))
  .digest();

function signToken(role, scopeValue) {
  const payload = `${role}:${scopeValue}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${role}.${sig}`).toString('base64url');
}

function safeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyToken(token, expectedRole, scopeValue) {
  if (!token || typeof token !== 'string') return false;
  return safeEqualStr(token, signToken(expectedRole, scopeValue));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `fsd_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
  );
}

function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', 'fsd_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

async function startServer() {
  const store = new ForumStore();
  await store.init();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '4mb' }));

  const server = http.createServer(app);
  const hub = new RealtimeHub(server, store);

  function extractSessionToken(req) {
    return req.headers['x-session-token'] || req.query.token || '';
  }

  function extractAdminToken(req) {
    const cookies = parseCookies(req);
    return req.headers['x-admin-token'] || req.query.adminToken || cookies.fsd_admin || '';
  }

  function isValidAdmin(req) {
    const settings = store.getSettings();
    return verifyToken(extractAdminToken(req), 'admin', settings.adminPin);
  }

  function isValidParticipant(req) {
    const settings = store.getSettings();
    if (!settings.requireMeetingCode) return true;
    if (isValidAdmin(req)) return true;
    return verifyToken(extractSessionToken(req), 'participant', settings.meetingCode);
  }

  function requireParticipant(req, res, next) {
    if (!isValidParticipant(req)) {
      return res.status(401).json({
        error: 'Kode Rapat diperlukan atau sudah berubah. Silakan masukkan Kode Rapat untuk melanjutkan.',
        code: 'MEETING_CODE_REQUIRED',
      });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!isValidAdmin(req)) {
      return res.status(403).json({
        error: 'Akses khusus Panitia. Silakan masukkan PIN Panitia.',
        code: 'ADMIN_REQUIRED',
      });
    }
    next();
  }

  // ===== HEALTH CHECK =====
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      storageMode: store.mode,
      onlineCount: hub.clients.size,
      stats: store.getStats(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // ===== BOOTSTRAP & AUTH =====
  app.get('/api/bootstrap', (req, res) => {
    const publicState = store.getPublicState();
    res.json({
      documentMeta: publicState.documentMeta,
      settings: publicState.settings,
      stats: publicState.stats,
      authorized: isValidParticipant(req),
      isAdmin: isValidAdmin(req),
      onlineCount: hub.clients.size,
      storageMode: store.mode,
    });
  });

  app.post('/api/auth/verify-code', (req, res) => {
    const settings = store.getSettings();
    if (!settings.requireMeetingCode) {
      return res.json({
        ok: true,
        token: signToken('participant', settings.meetingCode),
      });
    }
    const provided = normalizeCode(req.body && req.body.code);
    if (!provided || provided !== settings.meetingCode) {
      return res.status(401).json({
        error: 'Kode Rapat tidak sesuai. Periksa kode yang diberikan oleh Panitia.',
      });
    }
    return res.json({
      ok: true,
      token: signToken('participant', settings.meetingCode),
    });
  });

  app.post('/api/auth/verify-admin', (req, res) => {
    const settings = store.getSettings();
    const provided = String((req.body && req.body.pin) || '').trim();
    if (!provided || provided !== settings.adminPin) {
      return res.status(401).json({ error: 'PIN Panitia tidak sesuai.' });
    }
    const adminToken = signToken('admin', settings.adminPin);
    setAdminCookie(res, adminToken);
    return res.json({
      ok: true,
      adminToken,
      sessionToken: signToken('participant', settings.meetingCode),
    });
  });

  app.post('/api/auth/logout-admin', (_req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  // ===== SHARED REALTIME STATE & SIGNATURES (OPEN TO ALL MEETING PARTICIPANTS) =====
  app.get('/api/state', requireParticipant, (req, res) => {
    res.json({
      ...store.getPublicState(),
      isAdmin: isValidAdmin(req),
      locks: hub.getSerializableLocks(),
      onlineCount: hub.clients.size,
    });
  });

  app.get('/api/signatures/:id.png', (req, res) => {
    const buf = store.getSignatureBuffer(req.params.id);
    if (!buf) return res.status(404).send('Signature not found');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(buf);
  });

  app.post('/api/signatories/:id/sign', requireParticipant, async (req, res) => {
    try {
      const id = req.params.id;
      const { signatureDataUrl, method, representedBy } = req.body || {};
      const { buffer, width, height } = parseAndValidatePngDataUrl(signatureDataUrl);

      const result = await store.saveSignature(id, {
        pngBuffer: buffer,
        width,
        height,
        method,
        representedBy,
        allowOverwrite: isValidAdmin(req),
      });

      hub.releaseLockForSignatory(id);
      hub.broadcast({
        type: 'signature_saved',
        signatory: result.signatory,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });

      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message || 'Gagal menyimpan tanda tangan.' });
    }
  });

  app.post('/api/signatories', requireAdmin, async (req, res) => {
    try {
      const { name, role } = req.body || {};
      const result = await store.addSignatory({
        name,
        role,
        isAdmin: true,
      });

      hub.broadcast({
        type: 'signatory_added',
        signatory: result.signatory,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });

      return res.status(201).json({ ok: true, ...result });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message || 'Gagal menambah peserta.' });
    }
  });

  // ===== QR ZOOM ACARA (PESERTA CAN VIEW QR ONLY; ONLY PANITIA CAN CHANGE ZOOM LINK) =====
  app.get('/api/qr', requireParticipant, async (req, res) => {
    try {
      const admin = isValidAdmin(req);
      const settings = store.getSettings();
      const targetUrl = settings.qrCustomUrl || 'https://zoom.us/';

      const svg = await QRCode.toString(targetUrl, {
        type: 'svg',
        margin: 2,
        color: { dark: '#14263D', light: '#FFFFFF' },
      });

      res.json({
        svg,
        url: admin ? targetUrl : null,
        baseUrl: admin ? (settings.qrCustomUrl || '') : null,
        isCustomUrl: Boolean(settings.qrCustomUrl),
      });
    } catch {
      res.status(500).json({ error: 'Gagal membuat QR Code.' });
    }
  });

  // ===== EXPORTS: FULL BERITA ACARA & INDIVIDUAL (OPEN TO ALL MEETING PARTICIPANTS) =====
  app.get('/api/export/berita-acara.docx', requireParticipant, async (_req, res) => {
    try {
      const buf = await generateBeritaAcaraDocx(store);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="BERITA_ACARA_Kesepakatan_Forum_Satu_Data_Berau_2026.docx"'
      );
      return res.send(buf);
    } catch (err) {
      console.error('DOCX export error:', err);
      return res.status(500).json({ error: 'Gagal menyusun file Word Berita Acara.' });
    }
  });

  app.get('/api/export/berita-acara.pdf', requireParticipant, async (_req, res) => {
    try {
      const buf = await generateBeritaAcaraPdf(store);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="BERITA_ACARA_Kesepakatan_Forum_Satu_Data_Berau_2026.pdf"'
      );
      return res.send(buf);
    } catch (err) {
      console.error('PDF export error:', err);
      return res.status(500).json({ error: 'Gagal menyusun file PDF Berita Acara.' });
    }
  });

  // ===== PANITIA-ONLY EXPORT: CSV REKAP =====
  app.get('/api/export/rekap.csv', requireAdmin, (_req, res) => {
    const csvBuf = generateRekapCsv(store);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Rekap_Penandatanganan_FSD_Berau_2026.csv"'
    );
    return res.send(csvBuf);
  });

  // ===== ADMIN / PANITIA CONTROLS =====
  app.get('/api/admin/settings', requireAdmin, (_req, res) => {
    const s = store.getSettings();
    res.json({
      meetingCode: s.meetingCode,
      locked: s.locked,
      allowSelfAdd: s.allowSelfAdd,
      requireMeetingCode: s.requireMeetingCode,
      daftarHadirUrl: s.daftarHadirUrl || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI',
      qrCustomUrl: s.qrCustomUrl || '',
      updatedAt: s.updatedAt,
      storageMode: store.mode,
    });
  });

  app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
      const result = await store.updateSettings(req.body || {});
      const freshAdminToken = signToken('admin', result.settings.adminPin);
      setAdminCookie(res, freshAdminToken);

      hub.broadcast({
        type: 'settings_updated',
        settings: result.publicSettings,
        auditEntry: result.auditEntry,
      });

      res.json({
        ok: true,
        settings: {
          meetingCode: result.settings.meetingCode,
          locked: result.settings.locked,
          allowSelfAdd: result.settings.allowSelfAdd,
          requireMeetingCode: result.settings.requireMeetingCode,
          daftarHadirUrl: result.settings.daftarHadirUrl || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI',
          qrCustomUrl: result.settings.qrCustomUrl || '',
          updatedAt: result.settings.updatedAt,
        },
        adminToken: freshAdminToken,
        sessionToken: signToken('participant', result.settings.meetingCode),
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Gagal memperbarui pengaturan.' });
    }
  });

  app.post('/api/admin/signatories/:id/clear', requireAdmin, async (req, res) => {
    try {
      const reason = String((req.body && req.body.reason) || '').slice(0, 120);
      const result = await store.clearSignature(req.params.id, reason);
      hub.broadcast({
        type: 'signature_cleared',
        signatory: result.signatory,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Gagal mereset tanda tangan.' });
    }
  });

  app.patch('/api/admin/signatories/:id', requireAdmin, async (req, res) => {
    try {
      const { name, role } = req.body || {};
      const result = await store.updateSignatory(req.params.id, { name, role });
      hub.broadcast({
        type: 'signatory_updated',
        signatory: result.signatory,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Gagal mengubah data peserta.' });
    }
  });

  app.delete('/api/admin/signatories/:id', requireAdmin, async (req, res) => {
    try {
      const result = await store.deleteSignatory(req.params.id);
      hub.broadcast({
        type: 'signatory_deleted',
        deletedId: result.deletedId,
        signatories: result.signatories,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || 'Gagal menghapus peserta.' });
    }
  });

  app.post('/api/admin/reset-all', requireAdmin, async (_req, res) => {
    try {
      const result = await store.resetAllData();
      hub.broadcast({
        type: 'full_reset',
        signatories: result.signatories,
        auditEntry: result.auditEntry,
        stats: result.stats,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Gagal mereset data.' });
    }
  });

  app.patch('/api/admin/document', requireAdmin, async (req, res) => {
    try {
      const result = await store.updateDocumentMeta(req.body || {});
      hub.broadcast({
        type: 'document_updated',
        documentMeta: result.documentMeta,
        auditEntry: result.auditEntry,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Gagal menyimpan teks naskah.' });
    }
  });

  // ===== STATIC FRONTEND =====
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  server.listen(PORT, HOST, () => {
    const settings = store.getSettings();
    console.log('');
    console.log('===============================================================');
    console.log('  e-TTD Berita Acara — Forum Satu Data Kabupaten Berau 2026');
    console.log('===============================================================');
    console.log(`  URL Lokal     : http://localhost:${PORT}`);
    console.log(`  Penyimpanan   : ${store.mode === 'postgres' ? 'PostgreSQL (Cloud)' : 'File Lokal (data/)'}`);
    console.log(`  Kode Rapat    : ${settings.meetingCode}`);
    console.log(`  PIN Panitia   : ${settings.adminPin}`);
    console.log('===============================================================');
    console.log('');
  });

  function shutdown() {
    hub.close();
    server.close(() => process.exit(0));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
