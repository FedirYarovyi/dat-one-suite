/**
 * Popup Script — manages settings, notes list (company + broker), backup.
 */

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  await loadModulesSettings();
  await loadNotes('all');
  setupNotesManagement();
  setupBackupManagement();
});

// ──────────────────────────────────────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────────────────────────────────────
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(`tab-${tab.dataset.tab}`);
      if (content) content.classList.add('active');
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Module Settings
// ──────────────────────────────────────────────────────────────────────────────
async function loadModulesSettings() {
  const keys = [
    'module:sidebar-toggle:enabled',
    'module:company-notes:enabled',
    'setting:custom-sidebar-selector'
  ];
  chrome.storage.local.get(keys, (res) => {
    const sidebarToggle = document.getElementById('toggle-sidebar-module');
    const notesToggle = document.getElementById('toggle-notes-module');
    const customSelectorInput = document.getElementById('custom-sidebar-selector');

    if (sidebarToggle) {
      sidebarToggle.checked = res['module:sidebar-toggle:enabled'] !== false;
      sidebarToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ 'module:sidebar-toggle:enabled': e.target.checked });
      });
    }
    if (notesToggle) {
      notesToggle.checked = res['module:company-notes:enabled'] !== false;
      notesToggle.addEventListener('change', (e) => {
        chrome.storage.local.set({ 'module:company-notes:enabled': e.target.checked });
      });
    }
    if (customSelectorInput) {
      customSelectorInput.value = res['setting:custom-sidebar-selector'] || '';
      document.getElementById('btn-save-selector')?.addEventListener('click', () => {
        chrome.storage.local.set({ 'setting:custom-sidebar-selector': customSelectorInput.value.trim() }, () => {
          alert('Selector saved successfully!');
        });
      });
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Notes List
// ──────────────────────────────────────────────────────────────────────────────
let currentFilter = 'all';
let currentTypeFilter = 'all'; // 'all' | 'company' | 'contact'
let searchQuery = '';
let editingNote = null;

async function loadNotes() {
  const [companyData, contactData] = await Promise.all([
    new Promise((r) => chrome.storage.local.get(['company-notes-data'], (res) => r(res['company-notes-data'] || {}))),
    new Promise((r) => chrome.storage.local.get(['contact-notes-data'], (res) => r(res['contact-notes-data'] || {}))),
  ]);

  const companyList = Object.values(companyData);
  const contactList = Object.values(contactData).filter((n) => !n._aliasFor);

  const all = [...companyList, ...contactList];
  updateNotesCounter(all.length);
  renderNotesList(all);
}

function updateNotesCounter(count) {
  const counter = document.getElementById('notes-counter');
  if (counter) counter.textContent = count;
}

function renderNotesList(all) {
  const container = document.getElementById('notes-list-container');
  if (!container) return;

  const q = searchQuery.toLowerCase().trim();

  let filtered = all.filter((note) => {
    if (currentFilter !== 'all' && note.rating !== currentFilter) return false;
    if (currentTypeFilter !== 'all' && note.type !== currentTypeFilter) return false;
    if (q) {
      const name = (note.companyName || '').toLowerCase();
      const mc = (note.mc || '').toLowerCase();
      const text = (note.note || '').toLowerCase();
      const contact = (note.brokerName || note.contactName || '').toLowerCase();
      const phones = (note.phones || []).join(' ');
      const emails = (note.emails || []).join(' ').toLowerCase();
      const tags = (note.tags || []).join(' ').toLowerCase();
      if (![name, mc, text, contact, phones, emails, tags].some((s) => s.includes(q))) return false;
    }
    return true;
  });

  filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No notes found</p><small>Open DAT One or click "+ New"</small></div>`;
    return;
  }

  container.innerHTML = filtered.map((note) => {
    const isCompany = note.type === 'company' || (!note.type && note.mc);
    const typeIcon = isCompany ? '🏢' : '👤';
    const typeLabel = isCompany ? 'Company' : 'Broker';

    let chipClass = 'chip-neutral', chipText = '🔵 Neutral';
    if (note.rating === 'good') { chipClass = 'chip-good'; chipText = '🟢 Good'; }
    else if (note.rating === 'warning') { chipClass = 'chip-warning'; chipText = '🟡 Warning'; }
    else if (note.rating === 'dnu') { chipClass = 'chip-dnu'; chipText = '⛔ DNU'; }

    const title = isCompany
      ? (note.companyName || 'Unnamed Company')
      : (note.brokerName || note.contactName || note.email || note.emails?.[0] || 'Unnamed Broker');

    const idents = [];
    if (note.mc) idents.push(`MC: <strong>${esc(note.mc)}</strong>`);
    if (isCompany && note.dot) idents.push(`DOT: ${esc(note.dot)}`);
    if (!isCompany && note.companyName) idents.push(`Company: ${esc(note.companyName)}`);
    const ph = note.phone || note.phones?.[0];
    if (ph) {
      let phStr = `Phone: ${esc(formatPhone(ph))}`;
      if (note.ext) phStr += ` ext <strong>${esc(note.ext)}</strong>`;
      idents.push(phStr);
    }
    const em = note.email || note.emails?.[0];
    if (em) idents.push(`Email: ${esc(em)}`);

    return `
      <div class="note-card" data-id="${note.id}">
        <div class="note-card-header">
          <div class="note-card-title">${typeIcon} ${esc(title)}</div>
          <div style="display:flex;gap:4px;align-items:center;">
            <span style="font-size:9px;color:#8993a4;background:#f4f5f7;border-radius:3px;padding:1px 4px;">${typeLabel}</span>
            <span class="badge-chip ${chipClass}">${chipText}</span>
          </div>
        </div>
        <div class="note-card-idents">${idents.join(' &bull; ')}</div>
        ${note.note ? `<div class="note-card-body">${esc(note.note)}</div>` : ''}
        <div class="note-card-actions">
          <button type="button" class="btn btn-secondary btn-sm btn-edit-note" data-id="${note.id}" data-type="${note.type || 'company'}">Edit</button>
          <button type="button" class="btn btn-danger btn-sm btn-del-note" data-id="${note.id}" data-type="${note.type || 'company'}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-edit-note').forEach((btn) => {
    btn.addEventListener('click', () => {
      const allNotes = filtered;
      const note = allNotes.find((n) => n.id === btn.dataset.id);
      if (note) openEditModal(note);
    });
  });

  container.querySelectorAll('.btn-del-note').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      if (confirm('Delete this note?')) deleteNote(id, type);
    });
  });
}

function setupNotesManagement() {
  const searchInput = document.getElementById('notes-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      loadNotes();
    });
  }

  // Rating filter pills
  document.querySelectorAll('.filter-pills .pill[data-filter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill[data-filter]').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      loadNotes();
    });
  });

  // Type filter pills
  document.querySelectorAll('.type-pills .pill[data-type-filter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.type-pills .pill[data-type-filter]').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentTypeFilter = pill.dataset.typeFilter;
      loadNotes();
    });
  });

  document.getElementById('btn-new-company-note')?.addEventListener('click', () => openEditModal(null, 'company'));
  document.getElementById('btn-new-contact-note')?.addEventListener('click', () => openEditModal(null, 'contact'));

  document.getElementById('pm-btn-cancel')?.addEventListener('click', closeEditModal);
  document.getElementById('pm-btn-save')?.addEventListener('click', saveModalNote);

  const ratingSelect = document.getElementById('pm-input-rating');
  if (ratingSelect) {
    ratingSelect.addEventListener('change', () => {
      ratingSelect.className = `popup-input rating-${ratingSelect.value}`;
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Edit Modal (inside popup)
// ──────────────────────────────────────────────────────────────────────────────
let currentEditType = 'company';

function openEditModal(note, forceType) {
  const modal = document.getElementById('popup-note-modal');
  const title = document.getElementById('popup-modal-title');
  const companyFields = document.getElementById('pm-company-fields');
  const contactFields = document.getElementById('pm-contact-fields');

  editingNote = note;
  currentEditType = forceType || note?.type || 'company';

  title.textContent = note ? 'Edit Note' : (currentEditType === 'company' ? 'New Company Note' : 'New Broker Note');

  if (companyFields) companyFields.style.display = currentEditType === 'company' ? '' : 'none';
  if (contactFields) contactFields.style.display = currentEditType === 'company' ? 'none' : '';

  document.getElementById('pm-input-company-name').value = note?.companyName || '';
  document.getElementById('pm-input-mc').value = note?.mc || '';
  document.getElementById('pm-input-dot').value = note?.dot || '';

  document.getElementById('pm-input-contact-name').value = note?.brokerName || note?.contactName || '';
  const extEl = document.getElementById('pm-input-ext');
  if (extEl) extEl.value = note?.ext || '';

  document.getElementById('pm-input-contact-company').value = note?.companyName || '';
  document.getElementById('pm-input-contact-mc').value = note?.mc || '';
  document.getElementById('pm-input-phones').value = note?.phone ? formatPhone(note.phone) : (note?.phones || []).map(formatPhone).join(', ');
  document.getElementById('pm-input-emails').value = note?.email || (note?.emails || []).join(', ');

  document.getElementById('pm-input-rating').value = note?.rating || 'neutral';
  document.getElementById('pm-input-note').value = note?.note || '';

  modal.style.display = 'flex';
}

function closeEditModal() {
  const modal = document.getElementById('popup-note-modal');
  modal.style.display = 'none';
  editingNote = null;
}

async function saveModalNote() {
  const rating = document.getElementById('pm-input-rating').value;
  const noteText = document.getElementById('pm-input-note').value.trim();

  if (currentEditType === 'company') {
    const companyName = document.getElementById('pm-input-company-name').value.trim();
    const mc = document.getElementById('pm-input-mc').value.trim();
    const dot = document.getElementById('pm-input-dot').value.trim();

    if (!mc && !companyName) { alert('Please provide at least MC# or Company Name.'); return; }

    const id = editingNote?.id || (mc ? `co_mc_${mc}` : `co_name_${companyName.toLowerCase().replace(/\s+/g,'_')}`);
    const existing = editingNote || {};

    const updated = {
      ...existing, id, type: 'company',
      companyName, mc, dot, rating, note: noteText,
      updatedAt: Date.now(), createdAt: existing.createdAt || Date.now(),
    };

    chrome.storage.local.get(['company-notes-data'], (res) => {
      const all = res['company-notes-data'] || {};
      all[id] = updated;
      chrome.storage.local.set({ 'company-notes-data': all }, () => {
        closeEditModal();
        loadNotes();
      });
    });
  } else {
    const phonesRaw = document.getElementById('pm-input-phones').value;
    const emailsRaw = document.getElementById('pm-input-emails').value;
    const brokerName = document.getElementById('pm-input-contact-name').value.trim();
    const extVal = document.getElementById('pm-input-ext') ? document.getElementById('pm-input-ext').value.trim() : '';
    const companyName = document.getElementById('pm-input-contact-company').value.trim();
    const mc = document.getElementById('pm-input-contact-mc').value.trim();

    const phone = phonesRaw.replace(/\D/g, '').slice(-10);
    const email = emailsRaw.trim().toLowerCase();

    if (!phone && !email && !brokerName) { alert('Please provide broker name, phone or email.'); return; }

    const id = editingNote?.id || `brk_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const existing = editingNote || {};

    const updated = {
      ...existing,
      id,
      type: 'broker',
      brokerName: brokerName || email || 'Broker',
      contactName: brokerName || email || 'Broker',
      ext: extVal,
      companyName,
      mc,
      phone,
      phones: phone ? [phone] : [],
      email,
      emails: email ? [email] : [],
      rating,
      note: noteText,
      updatedAt: Date.now(),
      createdAt: existing.createdAt || Date.now(),
    };

    chrome.storage.local.get(['contact-notes-data'], (res) => {
      const all = res['contact-notes-data'] || {};
      all[id] = updated;
      chrome.storage.local.set({ 'contact-notes-data': all }, () => {
        closeEditModal();
        loadNotes();
      });
    });
  }
}

function deleteNote(id, type) {
  const key = type === 'contact' ? 'contact-notes-data' : 'company-notes-data';
  chrome.storage.local.get([key], (res) => {
    const all = res[key] || {};
    if (all[id]) {
      delete all[id];
      if (type === 'contact') {
        for (const k of Object.keys(all)) {
          if (all[k]._aliasFor === id) delete all[k];
        }
      }
      chrome.storage.local.set({ [key]: all }, () => loadNotes());
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Backup
// ──────────────────────────────────────────────────────────────────────────────
function setupBackupManagement() {
  document.getElementById('btn-export-backup')?.addEventListener('click', () => {
    chrome.storage.local.get(['company-notes-data', 'contact-notes-data'], (res) => {
      const data = JSON.stringify(res, null, 2);
      const url = 'data:text/json;charset=utf-8,' + encodeURIComponent(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dat_notes_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  const fileInput = document.getElementById('file-import-backup');
  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        chrome.storage.local.get(['company-notes-data', 'contact-notes-data'], (res) => {
          const mergedCompany = { ...(res['company-notes-data'] || {}), ...(imported['company-notes-data'] || {}) };
          const mergedContact = { ...(res['contact-notes-data'] || {}), ...(imported['contact-notes-data'] || {}) };
          chrome.storage.local.set({ 'company-notes-data': mergedCompany, 'contact-notes-data': mergedContact }, () => {
            alert('Notes imported successfully!');
            loadNotes();
          });
        });
      } catch (err) {
        alert('Import error: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-clear-all-notes')?.addEventListener('click', () => {
    if (confirm('Delete ALL notes (companies + brokers)?')) {
      if (confirm('Confirm permanent deletion — this cannot be undone.')) {
        chrome.storage.local.set({ 'company-notes-data': {}, 'contact-notes-data': {} }, () => {
          loadNotes();
          alert('All notes have been cleared.');
        });
      }
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
function formatPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').slice(-10);
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

function esc(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
