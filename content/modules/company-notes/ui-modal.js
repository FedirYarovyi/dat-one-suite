/**
 * Notes Modal — View-Only by default with explicit Edit Mode (English UI):
 *   'company'  — note about the company (read-only company name/MC, editable note text)
 *   'broker'   — note about a specific broker (email, phone, ext, broker name, note text)
 */
import { NotesStorage } from './notes-storage.js';
import { IdentityParser } from './identity-parser.js';
import { eventBus } from '../../core/event-bus.js';

export function ratingMeta(rating) {
  switch (rating) {
    case 'good':    return { icon: '🟢', cls: 'dat-rating-good',    label: 'Good',     bg: '#2e7d32', color: '#ffffff' };
    case 'warning': return { icon: '🟡', cls: 'dat-rating-warning', label: 'Warning',  bg: '#f57c00', color: '#ffffff' };
    case 'dnu':     return { icon: '⛔', cls: 'dat-rating-dnu',     label: 'DNU',      bg: '#de350b', color: '#ffffff' };
    default:        return { icon: '🔵', cls: 'dat-rating-neutral', label: 'Neutral',  bg: '#0052cc', color: '#ffffff' };
  }
}

export class NotesModal {
  constructor() {
    this.overlay = null;
  }

  /**
   * Open the modal.
   * @param {object} data - note or prefill data
   * @param {'company'|'broker'|'contact'} [forceType]
   * @param {'view'|'edit'|'create'|'auto'} [mode]
   */
  async open(data = {}, forceType = null, mode = 'auto') {
    this.close();

    const isBrokerType = forceType === 'broker' || forceType === 'contact' || data.type === 'broker' || data.type === 'contact';
    const type = isBrokerType ? 'broker' : 'company';

    let note = null;
    if (data.id) {
      note = data;
    } else if (type === 'company') {
      note = await NotesStorage.findCompanyNote({ mc: data.mc, companyName: data.companyName });
    } else {
      const brokerRes = await NotesStorage.findBrokers({
        email: data.email || data.emails?.[0],
        phone: data.phone || data.phones?.[0],
        ext: data.ext
      });
      note = brokerRes.exact;
    }

    let resolvedMode = mode;
    if (mode === 'auto') {
      resolvedMode = (note && note.id) ? 'view' : 'create';
    }

    const active = note || data;

    if (type === 'company') {
      this.openCompanyModal(active, resolvedMode);
    } else {
      await this.openBrokerModal(active, resolvedMode);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Company Modal (View-Only & Edit)
  // ──────────────────────────────────────────────────────────────────────────
  openCompanyModal(data, mode = 'view') {
    this.close();
    const isView = mode === 'view' && Boolean(data.id);
    const isCreate = mode === 'create' || !data.id;
    const rating = data.rating || 'neutral';
    const meta = ratingMeta(rating);
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const tagsStr = tags.join(', ');

    if (isView) {
      // ── VIEW-ONLY MODE ──────────────────────────────────────────────────────
      const overlay = this.buildOverlay(`
        <div class="dat-notes-modal" role="dialog" aria-modal="true">
          <div class="dat-notes-modal-header">
            <div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:20px;">🏢</span>
                <h3 style="margin:0;font-size:17px;color:#091e42;">${esc(data.companyName || 'Company')}</h3>
              </div>
              <div style="font-size:12px;color:#5e6c84;margin-top:2px;">
                ${data.mc ? `<span style="font-weight:600;color:#172b4d;">MC# ${esc(data.mc)}</span>` : ''}
                ${data.dot ? `<span style="margin-left:8px;">DOT# ${esc(data.dot)}</span>` : ''}
              </div>
            </div>
            <button type="button" class="dat-notes-close-btn" id="dat-modal-close" title="Close">&times;</button>
          </div>

          <div class="dat-notes-modal-body">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span class="dat-view-rating-badge ${meta.cls}">${meta.icon} ${meta.label}</span>
              ${data.updatedAt ? `<span style="font-size:11px;color:#8993a4;">Updated: ${new Date(data.updatedAt).toLocaleDateString()}</span>` : ''}
            </div>

            <div class="dat-view-note-box">
              <div style="font-size:11px;font-weight:700;color:#5e6c84;text-transform:uppercase;margin-bottom:6px;">Company Note:</div>
              <div class="dat-view-note-content">${esc(data.note || '— No note text —')}</div>
            </div>

            ${tags.length > 0 ? `
              <div style="margin-top:12px;">
                <div style="font-size:11px;font-weight:700;color:#5e6c84;text-transform:uppercase;margin-bottom:4px;">Tags:</div>
                <div class="dat-view-tags-list">
                  ${tags.map(t => `<span class="dat-tag-chip">🏷️ ${esc(t)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div class="dat-notes-modal-footer">
            <div>
              <button type="button" class="dat-btn dat-btn-danger" id="dat-modal-delete">🗑️ Delete</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="dat-btn dat-btn-secondary" id="dat-modal-cancel">Close</button>
              <button type="button" class="dat-btn dat-btn-primary" id="dat-modal-to-edit">✏️ Edit</button>
            </div>
          </div>
        </div>
      `);

      this.attachCommonEvents(overlay);

      overlay.querySelector('#dat-modal-to-edit').addEventListener('click', () => {
        this.openCompanyModal(data, 'edit');
      });

      overlay.querySelector('#dat-modal-delete')?.addEventListener('click', async () => {
        if (confirm('Delete note for this company?')) {
          await NotesStorage.deleteCompanyNote(data.id);
          eventBus.emit('notes:deleted', data.id);
          this.close();
        }
      });
      return;
    }

    // ── EDIT / CREATE MODE ────────────────────────────────────────────────────
    const overlay = this.buildOverlay(`
      <div class="dat-notes-modal" role="dialog" aria-modal="true">
        <div class="dat-notes-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:20px;">🏢</span>
              <h3 style="margin:0;font-size:17px;color:#091e42;">${isCreate ? 'New Company Note' : 'Edit Company Note'}</h3>
            </div>
            <div style="font-size:12px;color:#5e6c84;margin-top:2px;">
              <span style="font-weight:600;color:#172b4d;">${esc(data.companyName || 'Company')}</span>
              ${data.mc ? `<span style="margin-left:8px;">MC# ${esc(data.mc)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="dat-notes-close-btn" id="dat-modal-close" title="Close">&times;</button>
        </div>

        <div class="dat-notes-modal-body">
          ${isCreate && (!data.companyName || !data.mc) ? `
            <div class="dat-field-group">
              <label class="dat-field-label">Company Name</label>
              <input type="text" id="dat-input-name" class="dat-input" value="${esc(data.companyName || '')}" placeholder="Company Name">
            </div>
            <div class="dat-field-row">
              <div class="dat-field-group">
                <label class="dat-field-label">MC #</label>
                <input type="text" id="dat-input-mc" class="dat-input" value="${esc(data.mc || '')}" placeholder="123456">
              </div>
              <div class="dat-field-group">
                <label class="dat-field-label">DOT #</label>
                <input type="text" id="dat-input-dot" class="dat-input" value="${esc(data.dot || '')}" placeholder="DOT#">
              </div>
            </div>
          ` : `
            <input type="hidden" id="dat-input-name" value="${esc(data.companyName || '')}">
            <input type="hidden" id="dat-input-mc" value="${esc(data.mc || '')}">
            <input type="hidden" id="dat-input-dot" value="${esc(data.dot || '')}">
          `}

          <div class="dat-field-group">
            <label class="dat-field-label">Company Status</label>
            ${ratingSelector(rating)}
          </div>

          <div class="dat-field-group">
            <label class="dat-field-label">Note Text</label>
            <textarea id="dat-input-note" class="dat-textarea" placeholder="Payment terms, factoring, company reliability..." rows="4">${esc(data.note || '')}</textarea>
          </div>

          <div class="dat-field-group">
            <label class="dat-field-label">Tags (comma separated)</label>
            <input type="text" id="dat-input-tags" class="dat-input" placeholder="QuickPay, Verified, Slow Pay" value="${esc(tagsStr)}">
          </div>
        </div>

        <div class="dat-notes-modal-footer">
          <div>
            ${!isCreate ? `<button type="button" class="dat-btn dat-btn-danger" id="dat-modal-delete">🗑️ Delete</button>` : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="dat-btn dat-btn-secondary" id="dat-modal-cancel">${!isCreate ? 'Back' : 'Cancel'}</button>
            <button type="button" class="dat-btn dat-btn-primary" id="dat-modal-save">💾 Save</button>
          </div>
        </div>
      </div>
    `);

    this.attachCommonEvents(overlay);

    overlay.querySelector('#dat-modal-cancel').addEventListener('click', () => {
      if (!isCreate) {
        this.openCompanyModal(data, 'view');
      } else {
        this.close();
      }
    });

    overlay.querySelector('#dat-modal-save').addEventListener('click', async () => {
      const companyName = (overlay.querySelector('#dat-input-name')?.value || data.companyName || '').trim();
      const mc = (overlay.querySelector('#dat-input-mc')?.value || data.mc || '').trim();
      const dot = (overlay.querySelector('#dat-input-dot')?.value || data.dot || '').trim();
      const noteText = overlay.querySelector('#dat-input-note').value.trim();
      const tagsRaw = overlay.querySelector('#dat-input-tags').value;
      const ratingVal = getSelectedRating(overlay);
      const newTags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

      if (!mc && !companyName) {
        alert('Please provide at least MC# or Company Name.');
        return;
      }

      const saved = await NotesStorage.saveCompanyNote({
        id: !isCreate ? data.id : undefined,
        companyName, mc, dot, rating: ratingVal, note: noteText, tags: newTags,
      });
      eventBus.emit('notes:updated', saved);
      this.openCompanyModal(saved, 'view');
    });

    if (!isCreate) {
      overlay.querySelector('#dat-modal-delete')?.addEventListener('click', async () => {
        if (confirm('Delete note for this company?')) {
          await NotesStorage.deleteCompanyNote(data.id);
          eventBus.emit('notes:deleted', data.id);
          this.close();
        }
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Broker Modal (View-Only & Edit)
  // ──────────────────────────────────────────────────────────────────────────
  async openBrokerModal(data, mode = 'view') {
    this.close();
    const isView = mode === 'view' && Boolean(data.id);
    const isCreate = mode === 'create' || !data.id;
    const rating = data.rating || 'neutral';
    const meta = ratingMeta(rating);
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const tagsStr = tags.join(', ');
    const phone = data.phone || data.phones?.[0] || '';
    const email = data.email || data.emails?.[0] || '';
    const ext = data.ext || '';
    const brokerName = data.brokerName || data.contactName || '';

    // Check other brokers on this phone
    let others = [];
    if (phone) {
      const brokerRes = await NotesStorage.findBrokers({ phone });
      others = brokerRes.matches.filter((b) => b.id !== data.id);
    }

    if (isView) {
      // ── BROKER VIEW-ONLY MODE ───────────────────────────────────────────────
      const otherBrokersHtml = `
        <div style="background:#f4f5f7;border-radius:6px;padding:8px 12px;margin-bottom:12px;">
          ${others.length > 0 ? `
            <div style="font-size:11px;font-weight:700;color:#5e6c84;margin-bottom:4px;text-transform:uppercase;">OTHER BROKERS ON THIS PHONE (${others.length}):</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
              ${others.map((b) => `
                <button type="button" class="dat-other-broker-chip" data-id="${b.id}" style="border:1px solid #dfe1e6;background:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">
                  👤 ${esc(b.brokerName || b.email || 'Broker')}${b.ext ? ` (ext ${esc(b.ext)})` : ''}
                </button>
              `).join('')}
            </div>
          ` : ''}
          <button type="button" id="dat-btn-add-another-broker" style="border:1px dashed #0052cc;background:transparent;color:#0052cc;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;width:100%;text-align:center;">
            ➕ Add another broker for this phone
          </button>
        </div>
      `;

      const overlay = this.buildOverlay(`
        <div class="dat-notes-modal" role="dialog" aria-modal="true">
          <div class="dat-notes-modal-header">
            <div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:20px;">👤</span>
                <h3 style="margin:0;font-size:17px;color:#091e42;">${esc(brokerName || 'Broker')}</h3>
              </div>
              <div style="font-size:12px;color:#5e6c84;margin-top:2px;">
                ${data.companyName ? `<span>${esc(data.companyName)}</span>` : ''}
                ${data.mc ? `<span style="margin-left:6px;font-weight:600;color:#172b4d;">MC# ${esc(data.mc)}</span>` : ''}
              </div>
            </div>
            <button type="button" class="dat-notes-close-btn" id="dat-modal-close" title="Close">&times;</button>
          </div>

          <div class="dat-notes-modal-body">
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
              ${phone ? `<div class="dat-contact-pill">📞 ${esc(IdentityParser.formatPhone(phone, ext))}</div>` : ''}
              ${email ? `<div class="dat-contact-pill">✉️ ${esc(email)}</div>` : ''}
            </div>

            ${phone ? otherBrokersHtml : ''}

            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <span class="dat-view-rating-badge ${meta.cls}">${meta.icon} ${meta.label}</span>
              ${data.updatedAt ? `<span style="font-size:11px;color:#8993a4;">Updated: ${new Date(data.updatedAt).toLocaleDateString()}</span>` : ''}
            </div>

            <div class="dat-view-note-box">
              <div style="font-size:11px;font-weight:700;color:#5e6c84;text-transform:uppercase;margin-bottom:6px;">Broker Note:</div>
              <div class="dat-view-note-content">${esc(data.note || '— No note text —')}</div>
            </div>

            ${tags.length > 0 ? `
              <div style="margin-top:12px;">
                <div style="font-size:11px;font-weight:700;color:#5e6c84;text-transform:uppercase;margin-bottom:4px;">Tags:</div>
                <div class="dat-view-tags-list">
                  ${tags.map(t => `<span class="dat-tag-chip">🏷️ ${esc(t)}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>

          <div class="dat-notes-modal-footer">
            <div>
              <button type="button" class="dat-btn dat-btn-danger" id="dat-modal-delete">🗑️ Delete</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="dat-btn dat-btn-secondary" id="dat-modal-cancel">Close</button>
              <button type="button" class="dat-btn dat-btn-primary" id="dat-modal-to-edit">✏️ Edit</button>
            </div>
          </div>
        </div>
      `);

      this.attachCommonEvents(overlay);

      overlay.querySelectorAll('.dat-other-broker-chip').forEach((chip) => {
        chip.addEventListener('click', async () => {
          const id = chip.dataset.id;
          const allBrokers = await NotesStorage.getAllBrokerNotes();
          if (allBrokers[id]) {
            this.openBrokerModal(allBrokers[id], 'view');
          }
        });
      });

      overlay.querySelector('#dat-btn-add-another-broker')?.addEventListener('click', () => {
        this.openBrokerModal({
          phone,
          companyName: data.companyName,
          mc: data.mc,
          ext: ''
        }, 'create');
      });

      overlay.querySelector('#dat-modal-to-edit').addEventListener('click', () => {
        this.openBrokerModal(data, 'edit');
      });

      overlay.querySelector('#dat-modal-delete')?.addEventListener('click', async () => {
        if (confirm('Delete note for this broker?')) {
          await NotesStorage.deleteBrokerNote(data.id);
          eventBus.emit('notes:deleted', data.id);
          this.close();
        }
      });
      return;
    }

    // ── BROKER EDIT / CREATE MODE ───────────────────────────────────────────
    const overlay = this.buildOverlay(`
      <div class="dat-notes-modal" role="dialog" aria-modal="true">
        <div class="dat-notes-modal-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:20px;">👤</span>
              <h3 style="margin:0;font-size:17px;color:#091e42;">${isCreate ? 'New Broker Note' : 'Edit Broker Note'}</h3>
            </div>
            <div style="font-size:12px;color:#5e6c84;margin-top:2px;">
              ${data.companyName ? `<span>${esc(data.companyName)}</span>` : ''}
              ${data.mc ? `<span style="margin-left:6px;">MC# ${esc(data.mc)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="dat-notes-close-btn" id="dat-modal-close" title="Close">&times;</button>
        </div>

        <div class="dat-notes-modal-body">
          <div class="dat-field-row">
            <div class="dat-field-group" style="flex:2;">
              <label class="dat-field-label">Broker Name <span style="color:#de350b">★</span></label>
              <input type="text" id="dat-input-broker-name" class="dat-input" placeholder="e.g. Jack M., Luis C." value="${esc(brokerName)}">
            </div>
            <div class="dat-field-group" style="flex:1;">
              <label class="dat-field-label">Ext.</label>
              <input type="text" id="dat-input-ext" class="dat-input" placeholder="102" value="${esc(ext)}">
            </div>
          </div>

          <div class="dat-field-row">
            <div class="dat-field-group">
              <label class="dat-field-label">Broker Email</label>
              <input type="text" id="dat-input-emails" class="dat-input" placeholder="jack@company.com" value="${esc(email)}">
            </div>
            <div class="dat-field-group">
              <label class="dat-field-label">Company Phone</label>
              <input type="text" id="dat-input-phones" class="dat-input" placeholder="(800) 555-0199" value="${esc(IdentityParser.formatPhone(phone))}">
            </div>
          </div>

          <div class="dat-field-group">
            <label class="dat-field-label">Broker Status</label>
            ${ratingSelector(rating)}
          </div>

          <div class="dat-field-group">
            <label class="dat-field-label">Broker Note</label>
            <textarea id="dat-input-note" class="dat-textarea" placeholder="Communication style, rates, negotiation notes..." rows="4">${esc(data.note || '')}</textarea>
          </div>

          <div class="dat-field-group">
            <label class="dat-field-label">Tags (comma separated)</label>
            <input type="text" id="dat-input-tags" class="dat-input" placeholder="Negotiates, Fast reply, Responsive" value="${esc(tagsStr)}">
          </div>
        </div>

        <div class="dat-notes-modal-footer">
          <div>
            ${!isCreate ? `<button type="button" class="dat-btn dat-btn-danger" id="dat-modal-delete">🗑️ Delete</button>` : ''}
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="dat-btn dat-btn-secondary" id="dat-modal-cancel">${!isCreate ? 'Back' : 'Cancel'}</button>
            <button type="button" class="dat-btn dat-btn-primary" id="dat-modal-save">💾 Save</button>
          </div>
        </div>
      </div>
    `);

    this.attachCommonEvents(overlay);

    overlay.querySelector('#dat-modal-cancel').addEventListener('click', () => {
      if (!isCreate) {
        this.openBrokerModal(data, 'view');
      } else {
        this.close();
      }
    });

    overlay.querySelector('#dat-modal-save').addEventListener('click', async () => {
      const brokerNameVal = overlay.querySelector('#dat-input-broker-name').value.trim();
      const extVal = overlay.querySelector('#dat-input-ext').value.trim();
      const emailsRaw = overlay.querySelector('#dat-input-emails').value.trim();
      const phonesRaw = overlay.querySelector('#dat-input-phones').value.trim();
      const noteText = overlay.querySelector('#dat-input-note').value.trim();
      const tagsRaw = overlay.querySelector('#dat-input-tags').value;
      const ratingVal = getSelectedRating(overlay);
      const newTags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);

      const phoneNorm = IdentityParser.normalizePhone(phonesRaw) || phone;
      const emailNorm = IdentityParser.normalizeEmail(emailsRaw) || email;

      if (!phoneNorm && !emailNorm && !brokerNameVal) {
        alert('Please provide broker name, phone or email.');
        return;
      }

      const saved = await NotesStorage.saveBrokerNote({
        id: !isCreate ? data.id : undefined,
        brokerName: brokerNameVal || emailNorm || 'Broker',
        ext: extVal,
        email: emailNorm,
        phone: phoneNorm,
        companyName: data.companyName,
        mc: data.mc,
        rating: ratingVal,
        note: noteText,
        tags: newTags,
      });

      eventBus.emit('notes:updated', saved);
      this.openBrokerModal(saved, 'view');
    });

    if (!isCreate) {
      overlay.querySelector('#dat-modal-delete')?.addEventListener('click', async () => {
        if (confirm('Delete note for this broker?')) {
          await NotesStorage.deleteBrokerNote(data.id);
          eventBus.emit('notes:deleted', data.id);
          this.close();
        }
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Shared helpers
  // ──────────────────────────────────────────────────────────────────────────
  buildOverlay(html) {
    const overlay = document.createElement('div');
    overlay.className = 'dat-notes-modal-overlay';
    overlay.id = 'dat-notes-modal-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const opts = overlay.querySelectorAll('.dat-rating-opt');
    opts.forEach((opt) => {
      opt.addEventListener('click', () => {
        opts.forEach((o) => o.className = 'dat-rating-opt');
        const val = opt.querySelector('input').value;
        opt.classList.add(`active-${val}`);
        opt.querySelector('input').checked = true;
      });
    });

    return overlay;
  }

  attachCommonEvents(overlay) {
    // Both close button (x) and cancel/close button close the modal by default
    overlay.querySelector('#dat-modal-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#dat-modal-cancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });

    const escH = (e) => { if (e.key === 'Escape') { this.close(); window.removeEventListener('keydown', escH); } };
    window.addEventListener('keydown', escH);
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

function esc(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSelectedRating(overlay) {
  const radio = overlay.querySelector('input[name="dat-rating"]:checked');
  return radio ? radio.value : 'neutral';
}

function ratingSelector(rating) {
  const opts = [
    { value: 'good', icon: '🟢', label: 'Good' },
    { value: 'neutral', icon: '🔵', label: 'Neutral' },
    { value: 'warning', icon: '🟡', label: 'Warning' },
    { value: 'dnu', icon: '⛔', label: 'DNU' },
  ];
  return `<div class="dat-rating-selector">${opts.map((o) => `
    <label class="dat-rating-opt ${rating === o.value ? `active-${o.value}` : ''}">
      <input type="radio" name="dat-rating" value="${o.value}" ${rating === o.value ? 'checked' : ''}>
      ${o.icon} ${o.label}
    </label>
  `).join('')}</div>`;
}

export const notesModal = new NotesModal();
