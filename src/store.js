'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { DOCUMENT_META, classifyCategory, createInitialSignatories } = require('./seed');
const { computeVerificationHash } = require('./utils/pngTools');
const { normalizeCode } = require('./utils/formatters');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const SIGNATURES_DIR = path.join(DATA_DIR, 'signatures');
const STATE_FILE = path.join(DATA_DIR, 'store.json');

class ForumStore {
  constructor() {
    this.mode = process.env.DATABASE_URL ? 'postgres' : 'file';
    this.pgPool = null;
    this.state = null;
    this.signatureCache = new Map(); // id -> Buffer
    this.writeQueue = Promise.resolve();
  }

  _defaultState() {
    return {
      version: 1,
      documentMeta: DOCUMENT_META,
      settings: {
        meetingCode: normalizeCode(process.env.MEETING_CODE || 'SDI2026'),
        adminPin: String(process.env.ADMIN_PIN || '202600').trim(),
        locked: false,
        allowSelfAdd: false,
        requireMeetingCode: true,
        updatedAt: new Date().toISOString(),
      },
      signatories: createInitialSignatories(),
      auditLogs: [
        {
          id: `log-init-${Date.now()}`,
          type: 'system',
          timestamp: new Date().toISOString(),
          summary: 'Ruang penandatanganan Berita Acara Forum Satu Data Kabupaten Berau 2026 diinisialisasi.',
        },
      ],
    };
  }

  async init() {
    if (this.mode === 'postgres') {
      await this._initPostgres();
    } else {
      await this._initFileStore();
    }
    this._syncEnvOverrides();
  }

  _syncEnvOverrides() {
    // Allow environment variables to override initial defaults only if state is fresh,
    // while keeping runtime admin updates persisted.
    if (!this.state.settings.meetingCode) {
      this.state.settings.meetingCode = normalizeCode(process.env.MEETING_CODE || 'SDI2026');
    }
    if (!this.state.settings.adminPin) {
      this.state.settings.adminPin = String(process.env.ADMIN_PIN || '202600').trim();
    }
  }

  async _initFileStore() {
    await fsp.mkdir(SIGNATURES_DIR, { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      const raw = await fsp.readFile(STATE_FILE, 'utf8');
      this.state = JSON.parse(raw);
      // Warm signature cache from disk
      for (const s of this.state.signatories) {
        if (s.signed) {
          const p = path.join(SIGNATURES_DIR, `${s.id}.png`);
          if (fs.existsSync(p)) {
            this.signatureCache.set(s.id, await fsp.readFile(p));
          }
        }
      }
    } else {
      this.state = this._defaultState();
      await this._persistStateImmediate();
    }
  }

  async _initPostgres() {
    const { Pool } = require('pg');
    const useSsl =
      process.env.DATABASE_SSL === 'true' ||
      (process.env.DATABASE_URL &&
        !process.env.DATABASE_URL.includes('localhost') &&
        !process.env.DATABASE_URL.includes('127.0.0.1'));

    this.pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    });

    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS fsd_app_state (
        key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS fsd_signatures (
        signatory_id TEXT PRIMARY KEY,
        png_base64 TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const res = await this.pgPool.query(`SELECT payload FROM fsd_app_state WHERE key = 'main'`);
    if (res.rows.length > 0) {
      this.state = res.rows[0].payload;
      const sigRes = await this.pgPool.query(`SELECT signatory_id, png_base64 FROM fsd_signatures`);
      for (const row of sigRes.rows) {
        this.signatureCache.set(row.signatory_id, Buffer.from(row.png_base64, 'base64'));
      }
    } else {
      this.state = this._defaultState();
      await this._persistStateImmediate();
    }
  }

  _enqueuePersist(fn) {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  async _persistStateImmediate() {
    if (this.mode === 'postgres') {
      await this.pgPool.query(
        `INSERT INTO fsd_app_state (key, payload, updated_at)
         VALUES ('main', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [JSON.stringify(this.state)]
      );
    } else {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${STATE_FILE}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      await fsp.rename(tmp, STATE_FILE);
    }
  }

  async _persistSignaturePng(id, pngBuffer) {
    if (this.mode === 'postgres') {
      if (pngBuffer) {
        await this.pgPool.query(
          `INSERT INTO fsd_signatures (signatory_id, png_base64, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (signatory_id) DO UPDATE SET png_base64 = EXCLUDED.png_base64, updated_at = NOW()`,
          [id, pngBuffer.toString('base64')]
        );
      } else {
        await this.pgPool.query(`DELETE FROM fsd_signatures WHERE signatory_id = $1`, [id]);
      }
    } else {
      await fsp.mkdir(SIGNATURES_DIR, { recursive: true });
      const target = path.join(SIGNATURES_DIR, `${id}.png`);
      if (pngBuffer) {
        const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fsp.writeFile(tmp, pngBuffer);
        await fsp.rename(tmp, target);
      } else if (fs.existsSync(target)) {
        await fsp.unlink(target);
      }
    }
  }

  getSettings() {
    return { ...this.state.settings };
  }

  getPublicSettings() {
    const { locked, allowSelfAdd, requireMeetingCode, updatedAt } = this.state.settings;
    return { locked, allowSelfAdd, requireMeetingCode, updatedAt };
  }

  getStats() {
    const all = this.state.signatories;
    const tableOnly = all.filter((s) => !s.isLeader);
    const leader = all.find((s) => s.isLeader);
    const signedTable = tableOnly.filter((s) => s.signed).length;
    const signedTotal = all.filter((s) => s.signed).length;
    return {
      total: all.length,
      signed: signedTotal,
      tableTotal: tableOnly.length,
      tableSigned: signedTable,
      leaderSigned: Boolean(leader && leader.signed),
      percentage: all.length > 0 ? Math.round((signedTotal / all.length) * 100) : 0,
    };
  }

  getPublicSignatory(s) {
    return {
      ...s,
      signatureUrl: s.signed ? `/api/signatures/${encodeURIComponent(s.id)}.png?v=${s.signatureVersion || 1}` : null,
    };
  }

  getPublicState() {
    return {
      documentMeta: this.state.documentMeta,
      settings: this.getPublicSettings(),
      stats: this.getStats(),
      signatories: this.state.signatories.map((s) => this.getPublicSignatory(s)),
      auditLogs: this.state.auditLogs.slice(0, 120),
      storageMode: this.mode,
    };
  }

  getSignatory(id) {
    return this.state.signatories.find((s) => s.id === id) || null;
  }

  getSignatureBuffer(id) {
    return this.signatureCache.get(id) || null;
  }

  getAllSignatories() {
    return this.state.signatories;
  }

  _pushAudit(entry) {
    const full = {
      id: `log-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.state.auditLogs.unshift(full);
    if (this.state.auditLogs.length > 500) {
      this.state.auditLogs.length = 500;
    }
    return full;
  }

  async saveSignature(id, { pngBuffer, width, height, method, representedBy, allowOverwrite = false }) {
    const signatory = this.getSignatory(id);
    if (!signatory) {
      const err = new Error('Data penandatangan tidak ditemukan.');
      err.status = 404;
      throw err;
    }
    if (this.state.settings.locked && !allowOverwrite) {
      const err = new Error('Dokumen telah dikunci oleh Panitia dan tidak menerima tanda tangan baru.');
      err.status = 423;
      throw err;
    }
    if (signatory.signed && !allowOverwrite) {
      const err = new Error(
        `Baris ${signatory.name} sudah ditandatangani. Hubungi Panitia jika perlu mengubah tanda tangan.`
      );
      err.status = 409;
      throw err;
    }

    const signedAt = new Date().toISOString();
    const cleanRep =
      representedBy && representedBy.name && representedBy.name.trim()
        ? {
            name: representedBy.name.trim().slice(0, 140),
            role: (representedBy.role || '').trim().slice(0, 160),
          }
        : null;

    const hash = computeVerificationHash({
      documentId: DOCUMENT_META.id,
      signatoryId: signatory.id,
      name: signatory.name,
      representedBy: cleanRep,
      signedAt,
      pngBuffer,
    });

    signatory.signed = true;
    signatory.signatureMethod = method === 'upload' ? 'upload' : 'draw';
    signatory.signedAt = signedAt;
    signatory.representedBy = cleanRep;
    signatory.verificationHash = hash;
    signatory.signatureWidth = width;
    signatory.signatureHeight = height;
    signatory.signatureVersion = (signatory.signatureVersion || 0) + 1;

    this.signatureCache.set(signatory.id, pngBuffer);

    const methodLabel = signatory.signatureMethod === 'upload' ? 'unggah gambar' : 'goresan langsung';
    const repLabel = cleanRep ? ` (diwakili a.n. ${cleanRep.name})` : '';
    const auditEntry = this._pushAudit({
      type: 'signed',
      signatoryId: signatory.id,
      rowNumber: signatory.rowNumber,
      name: signatory.name,
      role: signatory.role,
      representedBy: cleanRep,
      method: signatory.signatureMethod,
      verificationHash: hash,
      summary: `${signatory.name}${repLabel} menandatangani via ${methodLabel}.`,
    });

    await this._enqueuePersist(async () => {
      await this._persistSignaturePng(signatory.id, pngBuffer);
      await this._persistStateImmediate();
    });

    return {
      signatory: this.getPublicSignatory(signatory),
      auditEntry,
      stats: this.getStats(),
    };
  }

  async clearSignature(id, reason = '') {
    const signatory = this.getSignatory(id);
    if (!signatory) {
      const err = new Error('Data penandatangan tidak ditemukan.');
      err.status = 404;
      throw err;
    }

    signatory.signed = false;
    signatory.signatureMethod = null;
    signatory.signedAt = null;
    signatory.representedBy = null;
    signatory.verificationHash = null;
    signatory.signatureWidth = null;
    signatory.signatureHeight = null;
    signatory.signatureVersion = (signatory.signatureVersion || 0) + 1;

    this.signatureCache.delete(signatory.id);

    const auditEntry = this._pushAudit({
      type: 'cleared',
      signatoryId: signatory.id,
      name: signatory.name,
      role: signatory.role,
      summary: `Panitia mengatur ulang tanda tangan ${signatory.name}${reason ? ` (${reason})` : ''}.`,
    });

    await this._enqueuePersist(async () => {
      await this._persistSignaturePng(signatory.id, null);
      await this._persistStateImmediate();
    });

    return {
      signatory: this.getPublicSignatory(signatory),
      auditEntry,
      stats: this.getStats(),
    };
  }

  async addSignatory({ name, role, isAdmin = false }) {
    if (!isAdmin && (!this.state.settings.allowSelfAdd || this.state.settings.locked)) {
      const err = new Error('Penambahan peserta baru sedang dinonaktifkan oleh Panitia.');
      err.status = 403;
      throw err;
    }
    const cleanName = String(name || '').trim().slice(0, 140);
    const cleanRole = String(role || '').trim().slice(0, 180);
    if (cleanName.length < 2 || cleanRole.length < 2) {
      const err = new Error('Nama lengkap dan Jabatan/Instansi wajib diisi.');
      err.status = 400;
      throw err;
    }

    const maxRow = this.state.signatories.reduce(
      (max, s) => (s.rowNumber > max ? s.rowNumber : max),
      54
    );
    const nextRow = maxRow + 1;
    const newId = `custom-${nextRow}-${crypto.randomBytes(2).toString('hex')}`;

    const entry = {
      id: newId,
      rowNumber: nextRow,
      isLeader: false,
      isCustom: true,
      templateRowIndex: null,
      name: cleanName,
      role: cleanRole,
      category: classifyCategory(cleanRole, false, true),
      signed: false,
      signatureMethod: null,
      signedAt: null,
      representedBy: null,
      verificationHash: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    };

    this.state.signatories.push(entry);

    const auditEntry = this._pushAudit({
      type: 'added',
      signatoryId: entry.id,
      rowNumber: entry.rowNumber,
      name: entry.name,
      role: entry.role,
      summary: `Peserta tambahan #${entry.rowNumber} (${entry.name} — ${entry.role}) ditambahkan ke daftar.`,
    });

    await this._enqueuePersist(() => this._persistStateImmediate());

    return {
      signatory: this.getPublicSignatory(entry),
      auditEntry,
      stats: this.getStats(),
    };
  }

  async updateSignatory(id, { name, role }) {
    const signatory = this.getSignatory(id);
    if (!signatory) {
      const err = new Error('Data penandatangan tidak ditemukan.');
      err.status = 404;
      throw err;
    }
    const cleanName = String(name || '').trim().slice(0, 140);
    const cleanRole = String(role || '').trim().slice(0, 180);
    if (cleanName.length < 2 || cleanRole.length < 2) {
      const err = new Error('Nama dan Jabatan/Instansi tidak boleh kosong.');
      err.status = 400;
      throw err;
    }

    signatory.name = cleanName;
    signatory.role = cleanRole;
    if (!signatory.isLeader) {
      signatory.category = classifyCategory(cleanRole, false, signatory.isCustom);
    }

    const auditEntry = this._pushAudit({
      type: 'updated',
      signatoryId: signatory.id,
      name: signatory.name,
      role: signatory.role,
      summary: `Panitia memperbarui data ${signatory.name} (${signatory.role}).`,
    });

    await this._enqueuePersist(() => this._persistStateImmediate());

    return {
      signatory: this.getPublicSignatory(signatory),
      auditEntry,
      stats: this.getStats(),
    };
  }

  async deleteSignatory(id) {
    const idx = this.state.signatories.findIndex((s) => s.id === id);
    if (idx === -1) {
      const err = new Error('Data penandatangan tidak ditemukan.');
      err.status = 404;
      throw err;
    }
    const target = this.state.signatories[idx];
    if (!target.isCustom) {
      const err = new Error('Baris bawaan dari Berita Acara tidak dapat dihapus, hanya dapat diatur ulang tanda tangannya.');
      err.status = 400;
      throw err;
    }

    this.state.signatories.splice(idx, 1);
    this.signatureCache.delete(id);

    // Re-number custom rows sequentially after 54
    let seq = 55;
    for (const s of this.state.signatories) {
      if (s.isCustom) {
        s.rowNumber = seq++;
      }
    }

    const auditEntry = this._pushAudit({
      type: 'deleted',
      signatoryId: id,
      name: target.name,
      summary: `Panitia menghapus peserta tambahan ${target.name}.`,
    });

    await this._enqueuePersist(async () => {
      await this._persistSignaturePng(id, null);
      await this._persistStateImmediate();
    });

    return {
      deletedId: id,
      signatories: this.state.signatories.map((s) => this.getPublicSignatory(s)),
      auditEntry,
      stats: this.getStats(),
    };
  }

  async updateSettings(patch) {
    const s = this.state.settings;
    if (typeof patch.locked === 'boolean') s.locked = patch.locked;
    if (typeof patch.allowSelfAdd === 'boolean') s.allowSelfAdd = patch.allowSelfAdd;
    if (typeof patch.requireMeetingCode === 'boolean') s.requireMeetingCode = patch.requireMeetingCode;
    if (typeof patch.meetingCode === 'string' && patch.meetingCode.trim().length >= 3) {
      s.meetingCode = normalizeCode(patch.meetingCode).slice(0, 20);
    }
    if (typeof patch.adminPin === 'string' && patch.adminPin.trim().length >= 4) {
      s.adminPin = patch.adminPin.trim().slice(0, 24);
    }
    s.updatedAt = new Date().toISOString();

    const auditEntry = this._pushAudit({
      type: 'settings',
      summary: `Panitia memperbarui pengaturan ruang rapat (${s.locked ? 'Dokumen Dikunci' : 'Dokumen Terbuka'}).`,
    });

    await this._enqueuePersist(() => this._persistStateImmediate());
    return {
      settings: this.getSettings(),
      publicSettings: this.getPublicSettings(),
      auditEntry,
    };
  }

  async resetAllData() {
    const existingIds = this.state.signatories.map((s) => s.id);
    this.state.signatories = createInitialSignatories();
    this.signatureCache.clear();

    const auditEntry = this._pushAudit({
      type: 'cleared',
      summary: 'Panitia mereset seluruh tanda tangan & peserta tambahan kembali ke kondisi awal.',
    });

    await this._enqueuePersist(async () => {
      for (const id of existingIds) {
        await this._persistSignaturePng(id, null);
      }
      await this._persistStateImmediate();
    });

    return {
      signatories: this.state.signatories.map((s) => this.getPublicSignatory(s)),
      auditEntry,
      stats: this.getStats(),
    };
  }
}

module.exports = { ForumStore };
