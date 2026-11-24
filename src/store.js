'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { cloneDefaultDocumentMeta, createInitialSignatories, classifyInstansiGroup } = require('./seed');
const { computeVerificationHash } = require('./utils/pngTools');
const { normalizeCode } = require('./utils/formatters');

const SCHEMA_VERSION = 3;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const SIGNATURES_DIR = path.join(DATA_DIR, 'signatures');
const STATE_FILE = path.join(DATA_DIR, 'store.json');

class ForumStore {
  constructor() {
    this.mode = process.env.DATABASE_URL ? 'postgres' : 'file';
    this.pgPool = null;
    this.state = null;
    this.signatureCache = new Map();
    this.writeQueue = Promise.resolve();
  }

  _upgradeSignatoriesAndMeta(parsed) {
    const freshSignatories = createInitialSignatories();
    const freshById = new Map(freshSignatories.map((s) => [s.id, s]));
    const oldList = Array.isArray(parsed.signatories) ? parsed.signatories : [];

    const upgraded = oldList.map((oldSig) => {
      const fresh = freshById.get(oldSig.id);
      if (!fresh) return oldSig;
      return {
        ...oldSig,
        name: fresh.name,
        role: fresh.role,
        roleLines: fresh.roleLines,
        instansiGroup: fresh.instansiGroup,
      };
    });

    return {
      ...parsed,
      version: SCHEMA_VERSION,
      documentMeta: cloneDefaultDocumentMeta(),
      signatories: upgraded.length ? upgraded : freshSignatories,
    };
  }

  _defaultState(preserveSettings = null) {
    return {
      version: SCHEMA_VERSION,
      documentMeta: cloneDefaultDocumentMeta(),
      settings: preserveSettings || {
        meetingCode: normalizeCode(process.env.MEETING_CODE || 'SDI2026'),
        adminPin: String(process.env.ADMIN_PIN || '202600').trim(),
        locked: false,
        allowSelfAdd: false,
        requireMeetingCode: true,
        daftarHadirUrl: 'https://daftarhadir.web.bps.go.id/#/go/dw4LI',
        qrCustomUrl: '',
        qrIncludeCode: false,
        updatedAt: new Date().toISOString(),
      },
      signatories: createInitialSignatories(),
      auditLogs: [
        {
          id: `log-init-${Date.now()}`,
          type: 'system',
          timestamp: new Date().toISOString(),
          summary: 'Berita Acara Hasil Kesepakatan Forum Satu Data Kabupaten Berau 2026 siap digunakan.',
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
    if (!this.state.settings.meetingCode) {
      this.state.settings.meetingCode = normalizeCode(process.env.MEETING_CODE || 'SDI2026');
    }
    if (!this.state.settings.adminPin) {
      this.state.settings.adminPin = String(process.env.ADMIN_PIN || '202600').trim();
    }
    if (!this.state.settings.daftarHadirUrl) {
      this.state.settings.daftarHadirUrl = 'https://daftarhadir.web.bps.go.id/#/go/dw4LI';
    }
  }

  async _initFileStore() {
    await fsp.mkdir(SIGNATURES_DIR, { recursive: true });
    if (fs.existsSync(STATE_FILE)) {
      const raw = await fsp.readFile(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if ((parsed.version || 1) < 2) {
        this.state = this._defaultState(parsed.settings || null);
        this.signatureCache.clear();
        await this._persistStateImmediate();
      } else {
        this.state = (parsed.version || 1) < SCHEMA_VERSION ? this._upgradeSignatoriesAndMeta(parsed) : parsed;
        if ((parsed.version || 1) < SCHEMA_VERSION) {
          await this._persistStateImmediate();
        }
        for (const s of this.state.signatories) {
          if (s.signed) {
            const p = path.join(SIGNATURES_DIR, `${s.id}.png`);
            if (fs.existsSync(p)) {
              this.signatureCache.set(s.id, await fsp.readFile(p));
            }
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
      const parsed = res.rows[0].payload;
      if ((parsed.version || 1) < 2) {
        this.state = this._defaultState(parsed.settings || null);
        await this.pgPool.query(`DELETE FROM fsd_signatures`);
        await this._persistStateImmediate();
      } else {
        this.state = (parsed.version || 1) < SCHEMA_VERSION ? this._upgradeSignatoriesAndMeta(parsed) : parsed;
        if ((parsed.version || 1) < SCHEMA_VERSION) {
          await this._persistStateImmediate();
        }
        const sigRes = await this.pgPool.query(`SELECT signatory_id, png_base64 FROM fsd_signatures`);
        for (const row of sigRes.rows) {
          this.signatureCache.set(row.signatory_id, Buffer.from(row.png_base64, 'base64'));
        }
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

  getDocumentMeta() {
    return this.state.documentMeta;
  }

  getSettings() {
    return { ...this.state.settings };
  }

  getPublicSettings() {
    const { locked, allowSelfAdd, requireMeetingCode, daftarHadirUrl, updatedAt } = this.state.settings;
    return {
      locked,
      allowSelfAdd,
      requireMeetingCode,
      daftarHadirUrl: daftarHadirUrl || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI',
      updatedAt,
    };
  }

  getStats() {
    const all = this.state.signatories;
    const reps = all.filter((s) => s.isRepresentative);
    const lampiran = all.filter((s) => !s.isRepresentative);
    const signedTotal = all.filter((s) => s.signed).length;
    return {
      total: all.length,
      signed: signedTotal,
      repTotal: reps.length,
      repSigned: reps.filter((s) => s.signed).length,
      lampiranTotal: lampiran.length,
      lampiranSigned: lampiran.filter((s) => s.signed).length,
      percentage: all.length > 0 ? Math.round((signedTotal / all.length) * 100) : 0,
    };
  }

  getPublicSignatory(s) {
    return {
      ...s,
      instansiGroup:
        s.instansiGroup || classifyInstansiGroup(s.role, s.isRepresentative, s.isCustom),
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
    if (this.state.auditLogs.length > 500) this.state.auditLogs.length = 500;
    return full;
  }

  async saveSignature(id, { pngBuffer, width, height, method, allowOverwrite = false }) {
    const signatory = this.getSignatory(id);
    if (!signatory) {
      const err = new Error('Data penandatangan tidak ditemukan.');
      err.status = 404;
      throw err;
    }
    if (this.state.settings.locked && !allowOverwrite) {
      const err = new Error('Dokumen telah dikunci oleh Panitia.');
      err.status = 423;
      throw err;
    }
    if (signatory.signed && !allowOverwrite) {
      const err = new Error(`Baris ${signatory.name} sudah ditandatangani.`);
      err.status = 409;
      throw err;
    }

    const signedAt = new Date().toISOString();
    const hash = computeVerificationHash({
      documentId: this.state.documentMeta.id,
      signatoryId: signatory.id,
      name: signatory.name,
      representedBy: null,
      signedAt,
      pngBuffer,
    });

    signatory.signed = true;
    signatory.signatureMethod = method === 'upload' ? 'upload' : 'draw';
    signatory.signedAt = signedAt;
    signatory.verificationHash = hash;
    signatory.signatureWidth = width;
    signatory.signatureHeight = height;
    signatory.signatureVersion = (signatory.signatureVersion || 0) + 1;

    this.signatureCache.set(signatory.id, pngBuffer);

    const methodLabel = signatory.signatureMethod === 'upload' ? 'unggah gambar' : 'goresan langsung';
    const auditEntry = this._pushAudit({
      type: 'signed',
      signatoryId: signatory.id,
      name: signatory.name,
      role: signatory.role,
      method: signatory.signatureMethod,
      verificationHash: hash,
      summary: `${signatory.name} menandatangani via ${methodLabel}.`,
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
    signatory.verificationHash = null;
    signatory.signatureWidth = null;
    signatory.signatureHeight = null;
    signatory.signatureVersion = (signatory.signatureVersion || 0) + 1;

    this.signatureCache.delete(signatory.id);

    const auditEntry = this._pushAudit({
      type: 'cleared',
      signatoryId: signatory.id,
      name: signatory.name,
      summary: `Panitia menghapus/mereset tanda tangan ${signatory.name}${reason ? ` (${reason})` : ''}.`,
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

  async addSignatory({ name, role }) {
    const cleanName = String(name || '').trim().slice(0, 160);
    const cleanRole = String(role || '').trim().slice(0, 220);
    if (cleanName.length < 2 || cleanRole.length < 2) {
      const err = new Error('Nama lengkap dan Lembaga/Instansi/Jabatan wajib diisi.');
      err.status = 400;
      throw err;
    }

    const maxRow = this.state.signatories
      .filter((s) => !s.isRepresentative)
      .reduce((max, s) => (s.rowNumber > max ? s.rowNumber : max), 46);
    const nextRow = maxRow + 1;
    const newId = `custom-${nextRow}-${crypto.randomBytes(2).toString('hex')}`;

    const entry = {
      id: newId,
      rowNumber: nextRow,
      repOrder: null,
      isRepresentative: false,
      isCustom: true,
      instansiGroup: classifyInstansiGroup(cleanRole, false, true),
      name: cleanName,
      role: cleanRole,
      roleLines: null,
      signed: false,
      signatureMethod: null,
      signedAt: null,
      verificationHash: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    };

    this.state.signatories.push(entry);

    const auditEntry = this._pushAudit({
      type: 'added',
      signatoryId: entry.id,
      name: entry.name,
      summary: `Panitia menambahkan peserta #${entry.rowNumber}: ${entry.name} (${entry.role}).`,
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
    const cleanName = String(name || '').trim().slice(0, 160);
    const cleanRole = String(role || '').trim().slice(0, 260);
    if (cleanName.length < 2 || cleanRole.length < 2) {
      const err = new Error('Nama dan Jabatan/Instansi tidak boleh kosong.');
      err.status = 400;
      throw err;
    }

    signatory.name = cleanName;
    signatory.role = cleanRole.replace(/\r?\n/g, ' — ');
    signatory.instansiGroup = classifyInstansiGroup(
      signatory.role,
      signatory.isRepresentative,
      signatory.isCustom
    );
    if (signatory.isRepresentative) {
      const lines = cleanRole
        .split(/\r?\n|—/)
        .map((l) => l.trim())
        .filter(Boolean);
      signatory.roleLines = lines.length ? lines : [signatory.role];
    }

    const auditEntry = this._pushAudit({
      type: 'updated',
      signatoryId: signatory.id,
      name: signatory.name,
      summary: `Panitia memperbarui data ${signatory.name}.`,
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
      const err = new Error('Baris bawaan Berita Acara tidak dapat dihapus, hanya dapat direset TTD-nya.');
      err.status = 400;
      throw err;
    }

    this.state.signatories.splice(idx, 1);
    this.signatureCache.delete(id);

    let seq = 47;
    for (const s of this.state.signatories) {
      if (s.isCustom) s.rowNumber = seq++;
    }

    const auditEntry = this._pushAudit({
      type: 'deleted',
      signatoryId: id,
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

  async updateDocumentMeta(patch) {
    const m = this.state.documentMeta;
    const str = (v, max = 1200) => String(v ?? '').trim().slice(0, max);

    if (Array.isArray(patch.titleLines)) {
      const lines = patch.titleLines.map((l) => str(l, 160)).filter(Boolean);
      if (lines.length) m.titleLines = lines;
    }
    if (typeof patch.documentNumber === 'string') m.documentNumber = str(patch.documentNumber, 160);
    if (typeof patch.openingParagraph === 'string') m.openingParagraph = str(patch.openingParagraph, 2000);
    if (typeof patch.considerationsHeading === 'string') m.considerationsHeading = str(patch.considerationsHeading, 300);
    if (Array.isArray(patch.considerations)) {
      m.considerations = patch.considerations.map((c) => str(c, 1000)).filter(Boolean);
    }
    if (typeof patch.eventLead === 'string') m.eventLead = str(patch.eventLead, 160);
    if (Array.isArray(patch.eventDetails)) {
      const rows = patch.eventDetails
        .map((r) => ({ label: str(r?.label, 100), value: str(r?.value, 500) }))
        .filter((r) => r.label || r.value);
      if (rows.length) m.eventDetails = rows;
    }
    if (typeof patch.agreementLead === 'string') m.agreementLead = str(patch.agreementLead, 300);
    if (typeof patch.agreementHeading === 'string') m.agreementHeading = str(patch.agreementHeading, 160);
    if (Array.isArray(patch.agreements)) {
      const rows = patch.agreements
        .map((r) => ({ label: str(r?.label, 80), value: str(r?.value, 1000) }))
        .filter((r) => r.label || r.value);
      if (rows.length) m.agreements = rows;
    }
    if (typeof patch.closingParagraph === 'string') m.closingParagraph = str(patch.closingParagraph, 1200);
    if (typeof patch.representativesHeading === 'string') m.representativesHeading = str(patch.representativesHeading, 240);
    if (typeof patch.lampiranHeading === 'string') m.lampiranHeading = str(patch.lampiranHeading, 120);
    if (typeof patch.lampiranSubheading === 'string') m.lampiranSubheading = str(patch.lampiranSubheading, 400);

    const auditEntry = this._pushAudit({
      type: 'settings',
      summary: 'Panitia memperbarui teks naskah Berita Acara.',
    });

    await this._enqueuePersist(() => this._persistStateImmediate());
    return { documentMeta: this.state.documentMeta, auditEntry };
  }

  async updateSettings(patch) {
    const s = this.state.settings;
    if (typeof patch.locked === 'boolean') s.locked = patch.locked;
    if (typeof patch.requireMeetingCode === 'boolean') s.requireMeetingCode = patch.requireMeetingCode;
    if (typeof patch.qrIncludeCode === 'boolean') s.qrIncludeCode = patch.qrIncludeCode;
    if (typeof patch.qrCustomUrl === 'string') {
      const rawUrl = patch.qrCustomUrl.trim().slice(0, 300);
      if (rawUrl && !/^https?:\/\/\S+$/i.test(rawUrl)) {
        throw new Error('Link QR harus diawali http:// atau https://');
      }
      s.qrCustomUrl = rawUrl;
    }
    if (typeof patch.daftarHadirUrl === 'string') {
      const rawDh = patch.daftarHadirUrl.trim().slice(0, 400);
      if (rawDh && !/^https?:\/\/\S+$/i.test(rawDh)) {
        throw new Error('Link Daftar Hadir harus diawali http:// atau https://');
      }
      s.daftarHadirUrl = rawDh || 'https://daftarhadir.web.bps.go.id/#/go/dw4LI';
    }
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
