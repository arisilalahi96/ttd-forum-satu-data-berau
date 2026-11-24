function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the live A4 Berita Acara Hasil Kesepakatan Forum Satu Data Kabupaten Berau 2026.
 * Matches BERITA ACARA HASIL KESEPAKATAN_Baru.docx with live clickable signature slots for both
 * the 2x2 "Mewakili unsur peserta" grid and the LAMPIRAN I table.
 */
export function renderOfficialDocument({ container, documentMeta, signatories, locks, clientId, locked }) {
  if (!container || !documentMeta) return;

  const reps = signatories
    .filter((s) => s.isRepresentative)
    .sort((a, b) => (a.repOrder || 0) - (b.repOrder || 0));
  const lampiran = signatories
    .filter((s) => !s.isRepresentative)
    .sort((a, b) => a.rowNumber - b.rowNumber);

  const eventRowsHtml = (documentMeta.eventDetails || [])
    .map(
      (r) => `
      <tr>
        <td class="kv-lbl">${esc(r.label)}</td>
        <td class="kv-colon">:</td>
        <td class="kv-val">${esc(r.value)}</td>
      </tr>
    `
    )
    .join('');

  const agreeRowsHtml = (documentMeta.agreements || [])
    .map(
      (r) => `
      <tr>
        <td class="kv-lbl kv-lbl-sm">${esc(r.label)}</td>
        <td class="kv-colon">:</td>
        <td class="kv-val">${esc(r.value)}</td>
      </tr>
    `
    )
    .join('');

  const repsGridHtml = reps
    .map((rep) => {
      const lock = locks[rep.id];
      const isBusy = lock && lock.clientId !== clientId;
      const roleLines =
        Array.isArray(rep.roleLines) && rep.roleLines.length ? rep.roleLines : [rep.role];

      let slotHtml = '';
      if (rep.signed && rep.signatureUrl) {
        slotHtml = `
          <div class="rep-sig-slot" data-doc-action="detail" data-id="${esc(rep.id)}" title="Klik untuk melihat bukti">
            <img src="${esc(rep.signatureUrl)}" alt="TTD ${esc(rep.name)}" />
          </div>
        `;
      } else if (isBusy) {
        slotHtml = `
          <div class="rep-sig-slot is-unsigned cell-busy" data-doc-action="sign" data-id="${esc(rep.id)}">
            <span style="color:#B45309;font-size:11.5px;font-weight:500">Sedang diisi...</span>
          </div>
        `;
      } else {
        slotHtml = `
          <div class="rep-sig-slot is-unsigned" data-doc-action="sign" data-id="${esc(rep.id)}" title="Klik untuk menandatangani">
            ${locked ? '<span class="paper-dots">(Dikunci)</span>' : '<span class="paper-click-hint">Klik untuk TTD</span>'}
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

  const page1Html = `
    <article class="paper-sheet">
      <div class="paper-title">
        ${(documentMeta.titleLines || []).map((l) => `<div>${esc(l)}</div>`).join('')}
      </div>
      ${documentMeta.documentNumber ? `<p class="paper-doc-num">${esc(documentMeta.documentNumber)}</p>` : ''}

      <p class="paper-p">${esc(documentMeta.openingParagraph)}</p>

      ${documentMeta.considerationsHeading ? `<p class="paper-p" style="margin-bottom:6px">${esc(documentMeta.considerationsHeading)}</p>` : ''}
      <ol class="paper-ol">
        ${(documentMeta.considerations || []).map((pt) => `<li>${esc(pt)}</li>`).join('')}
      </ol>

      ${documentMeta.eventLead ? `<p class="paper-p" style="margin-bottom:6px">${esc(documentMeta.eventLead)}</p>` : ''}
      <table class="paper-kv-table">${eventRowsHtml}</table>

      ${documentMeta.agreementLead ? `<p class="paper-p" style="margin-top:14px;margin-bottom:6px">${esc(documentMeta.agreementLead)}</p>` : ''}
      ${documentMeta.agreementHeading ? `<p class="paper-center-bold">${esc(documentMeta.agreementHeading)}</p>` : ''}
      <table class="paper-kv-table">${agreeRowsHtml}</table>

      <p class="paper-p" style="margin-top:14px">${esc(documentMeta.closingParagraph)}</p>

      <div class="rep-section">
        <p class="paper-center-bold">${esc(documentMeta.representativesHeading || 'Mewakili unsur peserta Forum Satu Data Tahun 2026')}</p>
        <div class="rep-grid-2x2">${repsGridHtml}</div>
      </div>
    </article>
  `;

  const lampiranRowsHtml = lampiran
    .map((s) => {
      const lock = locks[s.id];
      const isBusy = lock && lock.clientId !== clientId;

      let sigCellHtml = '';
      if (s.signed && s.signatureUrl) {
        sigCellHtml = `
          <td class="paper-sig-cell" data-doc-action="detail" data-id="${esc(s.id)}" title="Klik untuk melihat bukti">
            <img class="paper-sig-img" src="${esc(s.signatureUrl)}" alt="TTD ${esc(s.name)}" loading="lazy" />
          </td>
        `;
      } else if (isBusy) {
        sigCellHtml = `
          <td class="paper-sig-cell cell-busy" data-doc-action="sign" data-id="${esc(s.id)}">
            <span style="font-size:11px;color:#B45309;font-weight:500">Sedang diisi...</span>
          </td>
        `;
      } else {
        sigCellHtml = `
          <td class="paper-sig-cell" data-doc-action="sign" data-id="${esc(s.id)}" title="Klik untuk menandatangani">
            ${locked ? '' : '<span class="paper-click-hint">Klik untuk TTD</span>'}
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
    <article class="paper-sheet">
      <p class="paper-table-heading">${esc(documentMeta.lampiranHeading || 'LAMPIRAN I')}</p>
      <p class="paper-p" style="margin-bottom:14px">${esc(documentMeta.lampiranSubheading || '')}</p>
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
