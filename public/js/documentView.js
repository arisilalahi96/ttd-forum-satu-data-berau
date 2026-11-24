function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders the live F4/Folio official Berita Acara document sheet preview.
 * Every signature appears immediately in-place, and clicking any slot triggers signing or detail view.
 */
export function renderOfficialDocument({ container, documentMeta, signatories, locks, clientId, locked }) {
  if (!container || !documentMeta) return;

  const leader = signatories.find((s) => s.isLeader);
  const tableRows = signatories.filter((s) => !s.isLeader).sort((a, b) => a.rowNumber - b.rowNumber);

  const leaderLock = leader ? locks[leader.id] : null;
  const leaderBusy = leaderLock && leaderLock.clientId !== clientId;

  let leaderSlotHtml = '';
  if (leader && leader.signed && leader.signatureUrl) {
    const repHtml =
      leader.representedBy && leader.representedBy.name
        ? `<div class="paper-sig-rep">a.n. ${esc(leader.representedBy.name)}${
            leader.representedBy.role ? ` (${esc(leader.representedBy.role)})` : ''
          }</div>`
        : '';
    leaderSlotHtml = `
      <div class="paper-leader-sig-slot" data-doc-action="detail" data-id="${esc(leader.id)}" title="Klik untuk melihat bukti verifikasi">
        <img src="${esc(leader.signatureUrl)}" alt="Tanda tangan ${esc(leader.name)}" />
        ${repHtml}
      </div>
    `;
  } else if (leaderBusy) {
    leaderSlotHtml = `
      <div class="paper-leader-sig-slot is-unsigned" data-doc-action="sign" data-id="${esc(leader.id)}">
        <span style="color:#B45309;font-size:12px;font-weight:600">Sedang diisi oleh ${esc(leaderLock.holderName)}...</span>
      </div>
    `;
  } else {
    leaderSlotHtml = `
      <div class="paper-leader-sig-slot is-unsigned" data-doc-action="sign" data-id="${esc(leader ? leader.id : 'bupati')}" title="Klik untuk menandatangani">
        ${locked ? '<span class="paper-dots">(Dokumen dikunci)</span>' : '<span class="paper-click-hint">Klik untuk membubuhkan tanda tangan</span>'}
      </div>
    `;
  }

  const page1Html = `
    <article class="paper-sheet">
      <div class="paper-title">
        ${documentMeta.titleLines.map((l) => `<div>${esc(l)}</div>`).join('')}
      </div>

      ${documentMeta.paragraphsBeforePoints.map((p) => `<p class="paper-p">${esc(p)}</p>`).join('')}

      <ol class="paper-ol">
        ${documentMeta.agreementPoints.map((pt) => `<li>${esc(pt)}</li>`).join('')}
      </ol>

      <p class="paper-p">${esc(documentMeta.closingParagraph)}</p>

      <div class="paper-leader-block">
        <div class="paper-leader-lines">
          ${documentMeta.leaderBlock.lines.map((l) => `<p>${esc(l)}</p>`).join('')}
        </div>
        ${leaderSlotHtml}
        <p class="paper-leader-name">${esc(leader ? leader.name : documentMeta.leaderBlock.name)}</p>
      </div>
    </article>
  `;

  const rowsHtml = tableRows
    .map((s) => {
      const rowLock = locks[s.id];
      const isBusy = rowLock && rowLock.clientId !== clientId;

      let sigCellHtml = '';
      if (s.signed && s.signatureUrl) {
        const rep =
          s.representedBy && s.representedBy.name
            ? `<div class="paper-sig-rep">a.n. ${esc(s.representedBy.name)}</div>`
            : '';
        sigCellHtml = `
          <td class="paper-sig-cell" data-doc-action="detail" data-id="${esc(s.id)}" title="Klik untuk detail &amp; unduh bukti individual">
            <img class="paper-sig-img" src="${esc(s.signatureUrl)}" alt="TTD ${esc(s.name)}" loading="lazy" />
            ${rep}
          </td>
        `;
      } else if (isBusy) {
        sigCellHtml = `
          <td class="paper-sig-cell cell-busy" data-doc-action="sign" data-id="${esc(s.id)}">
            <span style="font-size:11px;color:#B45309;font-weight:600">Sedang diisi...</span>
          </td>
        `;
      } else {
        sigCellHtml = `
          <td class="paper-sig-cell" data-doc-action="sign" data-id="${esc(s.id)}" title="Klik untuk menandatangani">
            <span class="paper-dots">…………………………</span>
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
      <p class="paper-table-heading">PIHAK-PIHAK YANG MENYEPAKATI :</p>
      <table class="paper-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Nama</th>
            <th>Jabatan/Instansi</th>
            <th>Tanda tangan</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </article>
  `;

  container.innerHTML = page1Html + page2Html;
}
