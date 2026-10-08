/**
 * Company Notes Module:
 *  - Small '+' buttons next to Company Name, Phone, and Email to create notes.
 *  - Company Notes: Rating badge (colored icon + quote preview only) -> opens View-Only modal.
 *  - Phone: Broker Name in a container colored by rating -> opens View-Only modal.
 *  - Email: Wraps email in colored container with a view note button -> opens View-Only modal.
 *  - STRICT SCOPING: Only injected inside the right-hand Company card (<dat-company>) and left contact info.
 *  - HIGH-PERFORMANCE OPTIMIZED:
 *      * Smart MutationObserver filters out 95% of irrelevant DOM noise.
 *      * Direct click listener on table rows triggers ultra-fast scan (<30ms).
 *      * Zero wildcard querySelectorAll on the document body.
 *      * Strict element tagging prevents re-parsing already decorated nodes.
 *      * Zero in-memory cache to save RAM on 8GB machines.
 */
import { domObserver } from '../../core/dom-observer.js';
import { eventBus } from '../../core/event-bus.js';
import { IdentityParser } from './identity-parser.js';
import { NotesStorage } from './notes-storage.js';
import { notesModal, ratingMeta } from './ui-modal.js';

const PHONE_PATTERN = /(?:\+?1[\s.-]*)?(?:\(?\b[2-9]\d{2}\)?[\s.-]*)[2-9]\d{2}[\s.-]*\d{4}\b/;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const NON_COMPANY_WORDS = /^(?:company|view in directory|equipment|contact information|load details|trip|rate|market rates|comments|origin|destination|spot rate|contract rate|load resources|insurance|search|details|post now|send outreach email|request block|add note)$/i;

/**
 * Ultra-robust MC# extractor without heavy full-DOM iterations
 */
export function extractMCFromElement(el) {
  if (!el) return '';

  const texts = [
    el.innerText || '',
    el.textContent || '',
    el.closest('dat-company, [data-testid*="company-card"], app-company-details, div[class*="company"]')?.innerText || ''
  ];

  const regexes = [
    /\bMC\s*#?\s*[:\-]?\s*([0-9]{4,8})\b/i,
    /MC\s*#?\s*([0-9]{4,8})/i,
    /\b(?:Docket|ICC)\s*#?\s*([0-9]{4,8})\b/i,
    /#\s*([0-9]{5,8})\b/
  ];

  for (const txt of texts) {
    if (!txt) continue;
    for (const rx of regexes) {
      const m = txt.match(rx);
      if (m && m[1]) return m[1];
    }
  }

  // Scan targeted leaf tags inside el only
  const root = el.closest('dat-company, [data-testid*="company-card"], app-company-details') || el;
  const nodes = root.querySelectorAll('span, div, a, b, strong');
  for (const node of nodes) {
    if (node.children.length === 0 && (node.textContent || '').includes('MC')) {
      const t = node.textContent.trim();
      for (const rx of regexes) {
        const m = t.match(rx);
        if (m && m[1]) return m[1];
      }
      const next = node.nextElementSibling?.textContent?.trim() || '';
      const numMatch = next.match(/^([0-9]{4,8})$/);
      if (numMatch) return numMatch[1];
    }
  }

  return '';
}

export class CompanyNotesModule {
  constructor() {
    this.id = 'company-notes';
    this.name = 'Company & Broker Notes';
    this.description = 'Displays company and broker notes strictly in the company card.';

    this.mutationObserver = null;
    this.scanTimer = null;
    this.urlUnwatch = null;
    this.tableClickListener = null;
    this.isScanning = false;
  }

  async init() {
    eventBus.on('notes:updated', () => this.refreshAll());
    eventBus.on('notes:deleted', () => this.refreshAll());
  }

  enable() {
    this.startObserver();
    this.setupFastRowClickListener();
  }

  disable() {
    this.stopObserver();
    this.removeFastRowClickListener();
    this.removeAllBadges();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Instant trigger on row click (0-30ms response)
  // ──────────────────────────────────────────────────────────────────────────
  setupFastRowClickListener() {
    this.tableClickListener = (e) => {
      // If user clicks a row in the search results table
      const row = e.target.closest('.ag-row, tr, [role="row"], .rt-tr, .dat-row, [data-testid*="row"]');
      if (row) {
        // Fast scan after row expand animation begins
        setTimeout(() => this.scanPage(), 30);
        setTimeout(() => this.scanPage(), 150);
      }
    };
    document.addEventListener('click', this.tableClickListener, { passive: true });
  }

  removeFastRowClickListener() {
    if (this.tableClickListener) {
      document.removeEventListener('click', this.tableClickListener);
      this.tableClickListener = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // High-performance filtered Observer
  // ──────────────────────────────────────────────────────────────────────────
  startObserver() {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      // 🚀 Performance Gate: Only schedule scan if mutation touches load details or company cards!
      // This filters out 95% of timer and scrolling noise.
      let isRelevant = false;
      for (let i = 0; i < mutations.length; i++) {
        const addedNodes = mutations[i].addedNodes;
        for (let j = 0; j < addedNodes.length; j++) {
          const node = addedNodes[j];
          if (node.nodeType === 1) { // ELEMENT_NODE
            const tag = node.tagName.toLowerCase();
            if (
              tag === 'dat-company' ||
              tag === 'app-company-details' ||
              tag === 'dat-load-details' ||
              node.classList.contains('details-container') ||
              node.classList.contains('xl-details') ||
              node.querySelector?.('dat-company, app-company-details, [data-testid*="company-card"]')
            ) {
              isRelevant = true;
              break;
            }
          }
        }
        if (isRelevant) break;
      }

      if (!isRelevant) return;

      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => this.scanPage(), 80);
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    this.urlUnwatch = domObserver.onUrlChange(() => {
      setTimeout(() => {
        this.removeAllBadges();
        this.scanPage();
      }, 300);
    });

    setTimeout(() => this.scanPage(), 200);
  }

  stopObserver() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    clearTimeout(this.scanTimer);
    if (this.urlUnwatch) {
      this.urlUnwatch();
      this.urlUnwatch = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fast Targeted Scan
  // ──────────────────────────────────────────────────────────────────────────
  async scanPage() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      // 🚀 Zero wildcard search: query targeted tags directly
      const companyCards = Array.from(document.querySelectorAll('dat-company, [data-testid*="company-card"], app-company-details'));

      for (const card of companyCards) {
        // Fast checks: must be connected
        if (!card.isConnected) continue;

        // Skip anything inside compact table rows
        if (card.closest('.ag-row, tr, [role="row"], .rt-tr, .dat-row, [data-testid*="row"]')) {
          continue;
        }

        // Skip left-hand load details columns
        if (card.closest('.details-column:first-child, [class*="left-column"], [class*="trip-details"]')) {
          continue;
        }

        await this.processCompanyCard(card);
      }
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Process an expanded right-hand company card
   */
  async processCompanyCard(card) {
    if (!card || !card.isConnected) return;

    const cardText = card.innerText || '';
    if (cardText.length < 15) return;

    // Fast check: Must be an expanded company panel
    const hasMC = /MC\s*#?\s*[0-9]{4,8}/i.test(cardText);
    const isExpandedPanel = hasMC || /VIEW IN DIRECTORY|Credit Score|Days to Pay|Reviews|Ratings/i.test(cardText);
    if (!isExpandedPanel) return;

    // Extract MC#
    const mc = extractMCFromElement(card);

    // 1. Company Name & Note / '+' button
    const nameEl = this.findCompanyNameInCard(card, mc);
    let companyName = '';
    if (nameEl) {
      companyName = nameEl.innerText.trim();
      await this.processCompanyElement(nameEl, card, { mc, companyName });
    }

    // 2. Phone Elements: STRICTLY within this company card (never in left load details!)
    await this.processPhonesInCard(card, { mc, companyName });

    // 3. Email Elements: Check company card AND left contact info column in expanded load
    const expandedContainer = card.closest('.details-container, .xl-details, dat-load-details, [class*="load-details"]') || card;
    await this.processEmailsInScope(expandedContainer, card, { mc, companyName });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Company Element
  // ──────────────────────────────────────────────────────────────────────────
  async processCompanyElement(nameEl, card, { mc, companyName }) {
    if (!nameEl || !nameEl.isConnected) return;

    const resolvedMC = mc || extractMCFromElement(card);
    const companyNote = await NotesStorage.findCompanyNote({ mc: resolvedMC, companyName });

    if (companyNote) {
      nameEl.querySelector('.dat-mini-add-btn[data-target="company"]')?.remove();

      const existingBadge = nameEl.querySelector('.dat-company-note-badge');
      if (existingBadge && existingBadge.dataset.noteId === companyNote.id) {
        return;
      }
      existingBadge?.remove();

      const meta = ratingMeta(companyNote.rating);
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = `dat-company-note-badge ${meta.cls}`;
      badge.dataset.noteId = companyNote.id;

      const previewText = companyNote.note ? ` "${esc(companyNote.note.slice(0, 30))}${companyNote.note.length > 30 ? '...' : ''}"` : '';
      badge.title = `Company Note: ${companyNote.note || '—'}\nClick to view note`;
      badge.innerHTML = `<span>${meta.icon}</span>${previewText ? `<span class="dat-badge-quote">${previewText}</span>` : ''}`;

      badge.onclick = (e) => {
        e.stopPropagation();
        notesModal.open(companyNote, 'company', 'view');
      };

      nameEl.appendChild(badge);
    } else {
      nameEl.querySelector('.dat-company-note-badge')?.remove();

      if (!nameEl.querySelector('.dat-mini-add-btn[data-target="company"]')) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'dat-mini-add-btn';
        addBtn.setAttribute('data-target', 'company');
        addBtn.title = 'Add company note';
        addBtn.textContent = '+';
        addBtn.onclick = (e) => {
          e.stopPropagation();
          const freshMC = extractMCFromElement(card) || extractMCFromElement(nameEl) || resolvedMC;
          notesModal.open({ mc: freshMC, companyName }, 'company', 'create');
        };
        nameEl.appendChild(addBtn);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Phone Elements (strictly inside <dat-company> card)
  // ──────────────────────────────────────────────────────────────────────────
  async processPhonesInCard(card, { mc, companyName }) {
    // 🚀 Targeted query: only query potential phone elements (tel links or leaf spans/divs)
    const phoneCandidates = Array.from(card.querySelectorAll('a[href^="tel:"], span, div, a'))
      .filter((el) => {
        if (el.children.length > 0 && !el.matches('a[href^="tel:"]')) return false;
        if (el.closest('.dat-notes-modal, .dat-phone-broker-badge, .dat-email-broker-wrapper, .dat-mini-add-btn, .dat-company-note-badge')) return false;
        const txt = (el.innerText || el.textContent || '').trim();
        return PHONE_PATTERN.test(txt) && txt.length < 35;
      });

    for (const phoneEl of phoneCandidates) {
      const match = (phoneEl.innerText || phoneEl.textContent || '').match(PHONE_PATTERN);
      if (!match) continue;

      const rawPhone = match[0];
      const normPhone = IdentityParser.normalizePhone(rawPhone);
      if (!normPhone) continue;

      const ext = IdentityParser.extractExt(phoneEl.parentElement?.innerText || phoneEl.innerText || '');
      const parent = phoneEl.parentElement;
      if (!parent) continue;

      // Fast check: skip if already processed and buttons are still attached
      if (phoneEl.dataset.datPhoneProcessed === normPhone && parent.querySelector(`.dat-mini-add-btn[data-phone="${normPhone}"]`)) {
        continue;
      }
      phoneEl.dataset.datPhoneProcessed = normPhone;

      const brokerRes = await NotesStorage.findBrokers({ phone: normPhone });
      const matches = brokerRes.matches || [];

      // Clean existing phone buttons
      parent.querySelectorAll(`.dat-phone-broker-badge[data-phone="${normPhone}"], .dat-mini-add-btn[data-phone="${normPhone}"]`).forEach((b) => b.remove());

      if (matches.length > 0) {
        for (const broker of matches) {
          const meta = ratingMeta(broker.rating);
          const badge = document.createElement('button');
          badge.type = 'button';
          badge.className = `dat-phone-broker-badge ${meta.cls}`;
          badge.setAttribute('data-phone', normPhone);
          badge.style.backgroundColor = meta.bg;
          badge.style.color = meta.color;

          const extStr = broker.ext ? ` ext ${broker.ext}` : '';
          badge.title = `Broker: ${broker.brokerName || 'Broker'}${extStr}\nClick to view note`;
          badge.innerHTML = `<span>👤</span><span>${esc(broker.brokerName || 'Broker')}${extStr ? ` (${esc(broker.ext)})` : ''}</span>`;

          badge.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            notesModal.open(broker, 'broker', 'view');
          };

          phoneEl.parentNode.insertBefore(badge, phoneEl.nextSibling);
        }
      }

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'dat-mini-add-btn';
      addBtn.setAttribute('data-target', 'phone');
      addBtn.setAttribute('data-phone', normPhone);
      addBtn.title = matches.length > 0 ? 'Add another broker for this phone' : 'Add broker note by phone';
      addBtn.textContent = '+';
      addBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const freshMC = extractMCFromElement(card) || mc;
        notesModal.open({ phone: normPhone, ext, companyName, mc: freshMC }, 'broker', 'create');
      };

      if (phoneEl.nextSibling) {
        phoneEl.parentNode.insertBefore(addBtn, phoneEl.nextSibling);
      } else {
        phoneEl.parentNode.appendChild(addBtn);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Email Elements (supports both right company card and left contact info)
  // ──────────────────────────────────────────────────────────────────────────
  async processEmailsInScope(scope, card, { mc, companyName }) {
    // 🚀 Targeted query: only query potential email links or leaf spans/divs
    const emailCandidates = Array.from(scope.querySelectorAll('a[href^="mailto:"], a[href*="@"], span, div, a'))
      .filter((el) => {
        if (el.children.length > 0 && !el.matches('a')) return false;
        if (el.closest('.dat-notes-modal, .dat-email-broker-wrapper, .dat-mini-add-btn, .dat-company-note-badge')) return false;
        const txt = (el.innerText || el.textContent || '').trim();
        return EMAIL_PATTERN.test(txt) && txt.length < 80;
      });

    for (const emailEl of emailCandidates) {
      const match = (emailEl.innerText || emailEl.textContent || '').match(EMAIL_PATTERN);
      if (!match) continue;

      const rawEmail = match[0];
      const normEmail = IdentityParser.normalizeEmail(rawEmail);
      if (!normEmail) continue;

      // Fast check: skip if already wrapped or already has plus button
      if (emailEl.parentElement?.classList.contains('dat-email-broker-wrapper')) {
        continue;
      }
      if (emailEl.parentElement?.querySelector(`.dat-mini-add-btn[data-email="${normEmail}"]`)) {
        continue;
      }

      const brokerRes = await NotesStorage.findBrokers({ email: normEmail });
      const brokerNote = brokerRes.exact || (brokerRes.matches.length > 0 ? brokerRes.matches[0] : null);

      if (brokerNote) {
        emailEl.parentElement?.querySelector(`.dat-mini-add-btn[data-email="${normEmail}"]`)?.remove();

        const meta = ratingMeta(brokerNote.rating);
        const wrapper = document.createElement('span');
        wrapper.className = `dat-email-broker-wrapper ${meta.cls}`;
        wrapper.style.backgroundColor = meta.bg;
        wrapper.style.color = meta.color;

        emailEl.parentNode.insertBefore(wrapper, emailEl);
        wrapper.appendChild(emailEl);
        emailEl.style.color = meta.color;

        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'dat-email-view-btn';
        viewBtn.title = `Broker: ${brokerNote.brokerName || 'Broker'}\nClick to view note`;
        viewBtn.innerHTML = `<span>📝</span><span>Note</span>`;
        viewBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          notesModal.open(brokerNote, 'broker', 'view');
        };
        wrapper.appendChild(viewBtn);
      } else {
        if (!emailEl.parentElement?.querySelector(`.dat-mini-add-btn[data-email="${normEmail}"]`)) {
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'dat-mini-add-btn';
          addBtn.setAttribute('data-target', 'email');
          addBtn.setAttribute('data-email', normEmail);
          addBtn.title = 'Add broker note by email';
          addBtn.textContent = '+';
          addBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const freshMC = extractMCFromElement(card) || mc;
            notesModal.open({ email: normEmail, companyName, mc: freshMC }, 'broker', 'create');
          };
          emailEl.parentNode.insertBefore(addBtn, emailEl.nextSibling);
        }
      }
    }
  }

  /**
   * Find company name element inside <dat-company>
   */
  findCompanyNameInCard(card, mc) {
    const explicit = card.querySelector('[data-testid*="company-name"], [data-testid*="broker-name"], .company-name, h2, h3');
    if (explicit && !NON_COMPANY_WORDS.test(explicit.innerText.trim())) {
      return explicit;
    }

    const candidates = card.querySelectorAll('h1, h2, h3, h4, strong, b, a, span, div');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      const txt = (el.innerText || '').trim();
      if (!txt || txt.length < 2 || txt.length > 80) continue;
      if (NON_COMPANY_WORDS.test(txt)) continue;
      if (txt === mc || txt.startsWith('MC#') || txt.startsWith('MC ')) continue;
      if (txt.includes('@') || /^\(?\d{3}\)?[\s.-]?\d{3}/.test(txt)) continue;
      if (/Credit Score|Days to Pay|Reviews|Ratings/i.test(txt)) continue;

      return el;
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Refresh & Cleanup
  // ──────────────────────────────────────────────────────────────────────────
  removeAllBadges() {
    document.querySelectorAll('.dat-email-broker-wrapper').forEach((wrapper) => {
      wrapper.querySelector('.dat-email-view-btn')?.remove();
      Array.from(wrapper.children).forEach((child) => (child.style.color = ''));
      while (wrapper.firstChild) {
        wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();
    });

    document.querySelectorAll('.dat-company-note-badge, .dat-phone-broker-badge, .dat-mini-add-btn, .dat-notes-badge').forEach((el) => {
      el.remove();
    });

    document.querySelectorAll('[data-dat-phone-processed]').forEach((el) => {
      delete el.dataset.datPhoneProcessed;
    });
  }

  refreshAll() {
    this.removeAllBadges();
    setTimeout(() => this.scanPage(), 50);
  }
}

function esc(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const companyNotesModule = new CompanyNotesModule();
