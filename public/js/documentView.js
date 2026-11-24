function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escWithItalics(str) {
  return esc(str).replace(/\b(online|Zoom Meeting)\b/g, '<em>$1</em>');
}

function editableAttrs(field, singleLine = false) {
  return `contenteditable="true" spellcheck="false" class="inline-editable" data-edit-field="${field}" ${
    singleLine ? 'data-single-line="1"' : ''
  }`;
}

/**
 * Renders the live A4 Berita Acara Hasil Kesepakatan Forum Satu Data Kabupaten Berau 2026.
 * Supports direct in-paper WYSIWYG editing when editMode=true (Panitia only).
 */
export function renderOfficialDocument({
  container,
  documentMeta,
  signatories,
  locks,
  clientId,
  locked,
  editMode = false,
}) {
  if (!container || !documentMeta) return;

  const reps = signatories
    .filter((s) => s.isRepresentative)
    .sort((a, b) => (a.repOrder || 0) - (b.repOrder || 0));
  const lampiran = signatories
    .filter((s) => !s.isRepresentative)
    .sort((a, b) => a.rowNumber - b.rowNumber);

  // ===== TITLE LINES =====
  const titleHtml = editMode
    ? `<div class="paper-title inline-editable" contenteditable="true" spellcheck="false" data-edit-field="titleLines">${(
        documentMeta.titleLines || []
      )
        .map((l) => esc(l))
        .join('\n')}</div>`
    : `<div class="paper-title">${(documentMeta.titleLines || []).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;

  // ===== DOCUMENT NUMBER =====
  const docNumHtml = editMode
    ? `<p class="paper-doc-num"><span ${editableAttrs('documentNumber', true)}>${esc(
        documentMeta.documentNumber || 'Nomor :             /       /Bapp-II/2026'
      )}</span></p>`
    : documentMeta.documentNumber
      ? `<p class="paper-doc-num">${esc(documentMeta.documentNumber)}</p>`
      : '';

  // ===== CONSIDERATIONS LIST =====
  const considerationsHtml = (documentMeta.considerations || [])
    .map((pt, idx) =>
      editMode
        ? `<li class="editable-li" data-consideration-row="${idx}">
             <span class="inline-editable editable-li-text" contenteditable="true" spellcheck="false" data-edit-consideration="1">${esc(pt)}</span>
             <button type="button" class="inline-del-btn" data-remove-row="consideration" title="Hapus poin">&times;</button>
           </li>`
        : `<li>${escWithItalics(pt)}</li>`
    )
    .join('');

  const addConsiderationBtn = editMode
    ? `<div class="inline-add-wrap"><button type="button" class="inline-add-btn" data-add-row="consideration">+ Tambah poin pertimbangan</button></div>`
    : '';

  // ===== EVENT DETAILS TABLE =====
  const eventRowsHtml = (documentMeta.eventDetails || [])
    .map((r) =>
      editMode
        ? `<tr data-event-row="1">
             <td class="kv-lbl"><span class="inline-editable" contenteditable="true" spellcheck="false" data-single-line="1" data-ev-label="1">${esc(r.label)}</span></td>
             <td class="kv-colon">:</td>
             <td class="kv-val"><span class="inline-editable" contenteditable="true" spellcheck="false" data-ev-value="1">${esc(r.value)}</span></td>
           </tr>`
        : `<tr>
             <td class="kv-lbl">${esc(r.label)}</td>
             <td class="kv-colon">:</td>
             <td class="kv-val">${escWithItalics(r.value)}</td>
           </tr>`
    )
    .join('');

  // ===== AGREEMENTS TABLE (KESATU, KEDUA, ...) =====
  const agreeRowsHtml = (documentMeta.agreements || [])
    .map((r) =>
      editMode
        ? `<tr data-agree-row="1">
             <td class="kv-lbl kv-lbl-sm"><span class="inline-editable" contenteditable="true" spellcheck="false" data-single-line="1" data-ag-label="1">${esc(r.label)}</span></td>
             <td class="kv-colon">:</td>
             <td class="kv-val">
               <div class="editable-kv-val-wrap">
                 <span class="inline-editable" contenteditable="true" spellcheck="false" data-ag-value="1">${esc(r.value)}</span>
                 <button type="button" class="inline-del-btn" data-remove-row="agreement" title="Hapus kesepakatan">&times;</button>
               </div>
             </td>
           </tr>`
        : `<tr>
             <td class="kv-lbl kv-lbl-sm">${esc(r.label)}</td>
             <td class="kv-colon">:</td>
             <td class="kv-val">${esc(r.value)}</td>
           </tr>`
    )
    .join('');

  const addAgreementBtn = editMode
    ? `<div class="inline-add-wrap"><button type="button" class="inline-add-btn" data-add-row="agreement">+ Tambah poin kesepakatan</button></div>`
    : '';

  // ===== 4 REPRESENTATIVES 2x2 GRID =====
  const repsGridHtml = reps
    .map((rep) => {
      const roleLines =
        Array.isArray(rep.roleLines) && rep.roleLines.length ? rep.roleLines : [rep.role];

      let slotHtml = '';
      if (rep.signed && rep.signatureUrl) {
        slotHtml = `
          <div class="rep-sig-slot is-signed">
            <img src="${esc(rep.signatureUrl)}" alt="TTD ${esc(rep.name)}" />
          </div>
        `;
      } else {
        slotHtml = `
          <div class="rep-sig-slot is-unsigned" ${editMode ? '' : `data-doc-action="sign" data-id="${esc(rep.id)}"`} title="Klik untuk menandatangani">
            ${locked || editMode ? '' : '<span class="paper-click-hint">Klik untuk TTD</span>'}
          </div>
        `;
      }

      return `
        <div class="rep-cell">
          <div class="rep-role-lines">${roleLines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
          ${slotHtml}
          <div class="rep-name">${esc(rep.name)}</div>
        </div>
      `;
    })
    .join('');

  const sheetClass = editMode ? 'paper-sheet is-editing-paper' : 'paper-sheet';

  const page1Html = `
    <article class="${sheetClass}">
      ${titleHtml}
      ${docNumHtml}

      <p class="paper-p">
        ${
          editMode
            ? `<span ${editableAttrs('openingParagraph')}>${esc(documentMeta.openingParagraph)}</span>`
            : escWithItalics(documentMeta.openingParagraph)
        }
      </p>

      <p class="paper-p" style="margin-bottom:6px">
        ${
          editMode
            ? `<span ${editableAttrs('considerationsHeading', true)}>${esc(documentMeta.considerationsHeading)}</span>`
            : esc(documentMeta.considerationsHeading)
        }
      </p>
      <ol class="paper-ol" id="docConsiderationsList">${considerationsHtml}</ol>
      ${addConsiderationBtn}

      <p class="paper-p" style="margin-bottom:6px">
        ${
          editMode
            ? `<span ${editableAttrs('eventLead', true)}>${esc(documentMeta.eventLead || 'Maka pada:')}</span>`
            : esc(documentMeta.eventLead)
        }
      </p>
      <table class="paper-kv-table" id="docEventTable">${eventRowsHtml}</table>

      <p class="paper-p" style="margin-top:14px;margin-bottom:6px">
        ${
          editMode
            ? `<span ${editableAttrs('agreementLead', true)}>${esc(documentMeta.agreementLead)}</span>`
            : esc(documentMeta.agreementLead)
        }
      </p>
      <p class="paper-center-bold">
        ${
          editMode
            ? `<span ${editableAttrs('agreementHeading', true)}>${esc(documentMeta.agreementHeading || 'MENYEPAKATI')}</span>`
            : esc(documentMeta.agreementHeading)
        }
      </p>
      <table class="paper-kv-table" id="docAgreeTable">${agreeRowsHtml}</table>
      ${addAgreementBtn}

      <p class="paper-p" style="margin-top:14px">
        ${
          editMode
            ? `<span ${editableAttrs('closingParagraph')}>${esc(documentMeta.closingParagraph)}</span>`
            : esc(documentMeta.closingParagraph)
        }
      </p>

      <div class="rep-section">
        <p class="paper-center-bold">
          ${
            editMode
              ? `<span ${editableAttrs('representativesHeading', true)}>${esc(documentMeta.representativesHeading)}</span>`
              : esc(documentMeta.representativesHeading || 'Mewakili unsur peserta Forum Satu Data Tahun 2026')
          }
        </p>
        <div class="rep-grid-2x2">${repsGridHtml}</div>
      </div>
    </article>
  `;

  // ===== PAGE 2: LAMPIRAN I =====
  const lampiranRowsHtml = lampiran
    .map((s) => {
      let sigCellHtml = '';
      if (s.signed && s.signatureUrl) {
        sigCellHtml = `
          <td class="paper-sig-cell is-signed">
            <img class="paper-sig-img" src="${esc(s.signatureUrl)}" alt="TTD ${esc(s.name)}" loading="lazy" />
          </td>
        `;
      } else {
        sigCellHtml = `
          <td class="paper-sig-cell" ${editMode ? '' : `data-doc-action="sign" data-id="${esc(s.id)}"`}>
            ${locked || editMode ? '' : '<span class="paper-click-hint">Klik untuk TTD</span>'}
          </td>
        `;
      }

      return `
        <tr>
          <td>${esc(s.rowNumber)}</td>
          <td>${esc(s.name)}</td>
          <td>${esc(s.role)}</td>
          ${sigCellHtml}
        </tr>
      `;
    })
    .join('');

  const page2Html = `
    <article class="${sheetClass}">
      <p class="paper-table-heading">
        ${
          editMode
            ? `<span ${editableAttrs('lampiranHeading', true)}>${esc(documentMeta.lampiranHeading || 'LAMPIRAN I')}</span>`
            : esc(documentMeta.lampiranHeading || 'LAMPIRAN I')
        }
      </p>
      <p class="paper-p" style="margin-bottom:14px">
        ${
          editMode
            ? `<span ${editableAttrs('lampiranSubheading')}>${esc(documentMeta.lampiranSubheading || '')}</span>`
            : esc(documentMeta.lampiranSubheading || '')
        }
      </p>
      <table class="paper-table">
        <thead>
          <tr>
            <th>NO</th>
            <th>NAMA</th>
            <th>LEMBAGA/INSTANSI/JABATAN</th>
            <th>TANDA TANGAN</th>
          </tr>
        </thead>
        <tbody>
          ${lampiranRowsHtml}
        </tbody>
      </table>
    </article>
  `;

  container.innerHTML = page1Html + page2Html;
}

/**
 * Extracts all inline-edited text directly from the A4 paper DOM back into a clean documentMeta patch.
 */
export function extractEditedDocumentMeta(container) {
  const getText = (field) => {
    const el = container.querySelector(`[data-edit-field="${field}"]`);
    return el ? el.innerText.replace(/\r/g, '').trim() : '';
  };

  const titleRaw = getText('titleLines');
  const titleLines = titleRaw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const considerations = Array.from(container.querySelectorAll('[data-edit-consideration="1"]'))
    .map((el) => el.innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const eventDetails = Array.from(container.querySelectorAll('[data-event-row="1"]'))
    .map((tr) => ({
      label: tr.querySelector('[data-ev-label="1"]')?.innerText.trim() || '',
      value: tr.querySelector('[data-ev-value="1"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    }))
    .filter((r) => r.label || r.value);

  const agreements = Array.from(container.querySelectorAll('[data-agree-row="1"]'))
    .map((tr) => ({
      label: tr.querySelector('[data-ag-label="1"]')?.innerText.trim() || '',
      value: tr.querySelector('[data-ag-value="1"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
    }))
    .filter((r) => r.label || r.value);

  return {
    titleLines,
    documentNumber: getText('documentNumber'),
    openingParagraph: getText('openingParagraph').replace(/\s+/g, ' '),
    considerationsHeading: getText('considerationsHeading').replace(/\s+/g, ' '),
    considerations,
    eventLead: getText('eventLead').replace(/\s+/g, ' '),
    eventDetails,
    agreementLead: getText('agreementLead').replace(/\s+/g, ' '),
    agreementHeading: getText('agreementHeading').replace(/\s+/g, ' '),
    agreements,
    closingParagraph: getText('closingParagraph').replace(/\s+/g, ' '),
    representativesHeading: getText('representativesHeading').replace(/\s+/g, ' '),
    lampiranHeading: getText('lampiranHeading').replace(/\s+/g, ' '),
    lampiranSubheading: getText('lampiranSubheading').replace(/\s+/g, ' '),
  };
}

/**
 * Bind delegated inline WYSIWYG helpers (plain-text paste, single-line Enter guard, add/remove rows).
 */
export function bindInlinePaperEditor(container) {
  // Strip rich HTML formatting on paste so Word/WhatsApp pastes stay clean Calibri text
  container.addEventListener('paste', (e) => {
    const editable = e.target.closest('[contenteditable="true"]');
    if (!editable) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const clean = editable.dataset.singleLine ? text.replace(/\r?\n/g, ' ') : text;
    document.execCommand('insertText', false, clean);
  });

  // Prevent accidental line breaks inside single-line fields
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const editable = e.target.closest('[contenteditable="true"]');
    if (!editable) return;
    if (editable.dataset.singleLine === '1') {
      e.preventDefault();
      editable.blur();
    }
  });

  // Add / Remove list items directly on the A4 sheet
  container.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add-row]');
    if (addBtn) {
      const kind = addBtn.dataset.addRow;
      if (kind === 'consideration') {
        const list = container.querySelector('#docConsiderationsList');
        if (!list) return;
        const li = document.createElement('li');
        li.className = 'editable-li';
        li.innerHTML = `
          <span class="inline-editable editable-li-text" contenteditable="true" spellcheck="false" data-edit-consideration="1">Poin pertimbangan baru;</span>
          <button type="button" class="inline-del-btn" data-remove-row="consideration" title="Hapus poin">&times;</button>
        `;
        list.appendChild(li);
        li.querySelector('[contenteditable]').focus();
      } else if (kind === 'agreement') {
        const tbl = container.querySelector('#docAgreeTable');
        if (!tbl) return;
        const count = tbl.querySelectorAll('[data-agree-row="1"]').length + 1;
        const labels = ['Kesatu', 'Kedua', 'Ketiga', 'Keempat', 'Kelima'];
        const tr = document.createElement('tr');
        tr.dataset.agreeRow = '1';
        tr.innerHTML = `
          <td class="kv-lbl kv-lbl-sm"><span class="inline-editable" contenteditable="true" spellcheck="false" data-single-line="1" data-ag-label="1">${labels[count - 1] || `Poin ${count}`}</span></td>
          <td class="kv-colon">:</td>
          <td class="kv-val">
            <div class="editable-kv-val-wrap">
              <span class="inline-editable" contenteditable="true" spellcheck="false" data-ag-value="1">Isi kesepakatan baru;</span>
              <button type="button" class="inline-del-btn" data-remove-row="agreement" title="Hapus kesepakatan">&times;</button>
            </div>
          </td>
        `;
        tbl.appendChild(tr);
        tr.querySelector('[data-ag-value="1"]').focus();
      }
      return;
    }

    const delBtn = e.target.closest('[data-remove-row]');
    if (delBtn) {
      const kind = delBtn.dataset.removeRow;
      if (kind === 'consideration') {
        const li = delBtn.closest('li');
        if (li) li.remove();
      } else if (kind === 'agreement') {
        const tr = delBtn.closest('tr');
        if (tr) tr.remove();
      }
    }
  });
}
