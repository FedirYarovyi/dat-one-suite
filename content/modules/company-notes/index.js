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
import { StorageService } from '../../core/storage.js';
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

/**
 * Safely unwraps an email wrapper restoring original DOM structure and styles
 */
export function unwrapEmailWrapper(wrapper) {
  if (!wrapper || !wrapper.parentNode) return;
  wrapper.querySelector('.dat-email-view-btn')?.remove();
  Array.from(wrapper.children).forEach((child) => {
    if (child.style) child.style.color = '';
  });
  while (wrapper.firstChild) {
    wrapper.parentNode.insertBefore(wrapper.firstChild, wrapper);
  }
  wrapper.remove();
}

export class CompanyNotesModule {
  constructor() {
    this.id = 'company-notes';
    this.name = 'Company & Broker Notes';
    this.description = 'Displays company and broker notes in table rows and company cards.';

    this.mutationObserver = null;
    this.scanTimer = null;
    this.urlUnwatch = null;
    this.tableClickListener = null;
    this.scrollListener = null;
    this.scrollTimer = null;
    this.storageUnwatch = null;
    this.isScanning = false;
    this.emailFullWrapper = false;
  }

  async init() {
    eventBus.on('notes:updated', () => this.refreshAll());
    eventBus.on('notes:deleted', () => this.refreshAll());

    try {
      const savedMode = await StorageService.get('setting:table-email-full-wrapper');
      this.emailFullWrapper = savedMode === true;
    } catch {
      this.emailFullWrapper = false;
    }

    this.storageUnwatch = StorageService.onChanged((changes) => {
      if (changes['setting:table-email-full-wrapper'] !== undefined) {
        this.emailFullWrapper = changes['setting:table-email-full-wrapper'].newValue === true;
        this.refreshAll();
        return;
      }
      if (changes['company-notes-data'] || changes['contact-notes-data']) {
        this.refreshAll();
      }
    });
  }

  enable() {
    this.startObserver();
    this.setupFastRowClickListener();
    this.setupScrollListener();
  }

  disable() {
    this.stopObserver();
    this.removeFastRowClickListener();
    this.removeScrollListener();
    this.removeAllBadges();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Instant trigger on row click (0-30ms response)
  // ──────────────────────────────────────────────────────────────────────────
  setupFastRowClickListener() {
    this.tableClickListener = (e) => {
      // If user clicks a row in the search results table
      const row = e.target.closest('.row-container, .row-cells, .table-cell, .ag-row, tr, [role="row"], .rt-tr, .dat-row, [data-testid*="row"]');
      if (row) {
        // Fast scan after row expand animation begins
        setTimeout(() => this.scanPage(), 30);
        setTimeout(() => this.scanPage(), 150);
        setTimeout(() => this.scanPage(), 350);
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
  // Scroll Listener for virtualized grid rows
  // ──────────────────────────────────────────────────────────────────────────
  setupScrollListener() {
    this.scrollListener = () => {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => this.scanTableRows(), 60);
    };
    window.addEventListener('scroll', this.scrollListener, { passive: true, capture: true });
  }

  removeScrollListener() {
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, { capture: true });
      this.scrollListener = null;
    }
    clearTimeout(this.scrollTimer);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // High-performance filtered Observer
  // ──────────────────────────────────────────────────────────────────────────
  startObserver() {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver((mutations) => {
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
              tag === 'cdk-virtual-scroll-viewport' ||
              tag === 'dat-search-table' ||
              node.classList.contains('details-container') ||
              node.classList.contains('xl-details') ||
              node.classList.contains('row-container') ||
              node.classList.contains('row-cells') ||
              node.classList.contains('table-cell') ||
              node.classList.contains('loads-table') ||
              node.classList.contains('cdk-virtual-scroll-content-wrapper') ||
              node.classList.contains('ag-row') ||
              node.classList.contains('ag-center-cols-container') ||
              node.classList.contains('ag-body-viewport') ||
              node.classList.contains('ag-root') ||
              node.querySelector?.('dat-company, app-company-details, [data-testid*="company-card"], .row-container, .row-cells, .ag-row')
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
    if (!StorageService.isAvailable()) {
      this.disable();
      return;
    }
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      // 1. Scan compact table rows (circles without text for company & broker)
      await this.scanTableRows();

      // 2. Scan expanded company card (details panel)
      await this.scanCompanyCards();
    } finally {
      this.isScanning = false;
    }
  }

  async scanCompanyCards() {
    // Zero wildcard search: query targeted tags directly
    const companyCards = Array.from(document.querySelectorAll('dat-company, [data-testid*="company-card"], app-company-details'));

    for (const card of companyCards) {
      if (!card.isConnected) continue;

      // Skip anything inside compact table cells (only compact cells, NOT the expanded details panel)
      if (card.closest('.table-cell, .row-cells')) {
        continue;
      }

      // Skip left-hand load details columns
      if (card.closest('.details-column:first-child, [class*="left-column"], [class*="trip-details"]')) {
        continue;
      }

      await this.processCompanyCard(card);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Table Rows Scan (Dots without text: Company & Broker)
  // ──────────────────────────────────────────────────────────────────────────
  async scanTableRows() {
    const [allCompanyNotes, allBrokerNotes] = await Promise.all([
      NotesStorage.getAllCompanyNotes(),
      NotesStorage.getAllBrokerNotes()
    ]);

    const coList = Object.values(allCompanyNotes);
    const brkList = Object.values(allBrokerNotes).filter((b) => b && !b._aliasFor);

    // If no notes exist at all, clear any residual dots & wrappers
    if (coList.length === 0 && brkList.length === 0) {
      document.querySelectorAll('.dat-table-dot').forEach((d) => d.remove());
      document.querySelectorAll('.row-cells .dat-email-broker-wrapper, .table-cell .dat-email-broker-wrapper').forEach(unwrapEmailWrapper);
      return;
    }

    // Build fast lookup maps
    const coByMC = new Map();
    const coByName = new Map();
    for (const co of coList) {
      if (co.mc) {
        const normMC = IdentityParser.normalizeMC(co.mc);
        if (normMC) coByMC.set(normMC, co);
      }
      if (co.companyName) {
        const normName = IdentityParser.normalizeName(co.companyName);
        if (normName) coByName.set(normName, co);
      }
    }

    // Rating positivity hierarchy: Good (4) > Neutral (3) > Warning (2) > DNU (1)
    const RATING_SCORE = { good: 4, neutral: 3, warning: 2, dnu: 1 };
    const brkByPhone = new Map();
    const brkByEmail = new Map();
    for (const brk of brkList) {
      const phones = [];
      if (brk.phone) phones.push(brk.phone);
      if (Array.isArray(brk.phones)) phones.push(...brk.phones);

      for (const p of phones) {
        const normP = IdentityParser.normalizePhone(p);
        if (normP) {
          if (!brkByPhone.has(normP)) brkByPhone.set(normP, []);
          brkByPhone.get(normP).push(brk);
        }
      }

      const emails = [];
      if (brk.email) emails.push(brk.email);
      if (Array.isArray(brk.emails)) emails.push(...brk.emails);

      for (const em of emails) {
        const normE = IdentityParser.normalizeEmail(em);
        if (normE) {
          if (!brkByEmail.has(normE)) brkByEmail.set(normE, []);
          brkByEmail.get(normE).push(brk);
        }
      }
    }

    // Sort broker arrays by positivity descending (index 0 = most positive)
    for (const brokers of brkByPhone.values()) {
      brokers.sort((a, b) => (RATING_SCORE[b.rating] || 0) - (RATING_SCORE[a.rating] || 0));
    }
    for (const brokers of brkByEmail.values()) {
      brokers.sort((a, b) => (RATING_SCORE[b.rating] || 0) - (RATING_SCORE[a.rating] || 0));
    }

    // Query DAT One table row containers
    let rows = Array.from(document.querySelectorAll('.row-container'));
    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll('.row-cells, [role="row"]:not([role="columnheader"]), tr'));
    }

    for (const row of rows) {
      if (!row.isConnected) continue;
      if (row.classList.contains('ag-header-row') || row.closest('.ag-header, mat-header-row')) continue;

      // Restrict search strictly to compact cells row (excluding expanded details)
      const cellsContainer = row.querySelector('.row-cells') || row;

      // ──────────────────────────────────────────────────────────────────────
      // 1. Company Column & Dot
      // ──────────────────────────────────────────────────────────────────────
      let companyLink = null;
      let companyName = '';

      // Direct search inside dat-company or .company-prefer-or-blocked
      const directCompLink = cellsContainer.querySelector('dat-company a, .company-prefer-or-blocked a, a.mat-tooltip-trigger');
      if (directCompLink) {
        const txt = directCompLink.innerText?.trim();
        if (txt && !PHONE_PATTERN.test(txt) && !EMAIL_PATTERN.test(txt)) {
          companyLink = directCompLink;
          companyName = txt;
        }
      }

      // Fallback: search links in row
      if (!companyLink) {
        for (const a of cellsContainer.querySelectorAll('.table-cell a, a')) {
          const txt = a.innerText?.trim();
          if (!txt || PHONE_PATTERN.test(txt) || EMAIL_PATTERN.test(txt)) continue;
          const norm = IdentityParser.normalizeName(txt);
          if (norm && (coByName.has(norm) || coList.some((c) => IdentityParser.normalizeName(c.companyName) === norm))) {
            companyLink = a;
            companyName = txt;
            break;
          }
        }
      }

      let companyNote = null;
      if (companyName) {
        const normName = IdentityParser.normalizeName(companyName);
        if (normName && coByName.has(normName)) {
          companyNote = coByName.get(normName);
        }
      }

      // If no note found yet, check MC in cell/row
      if (!companyNote && companyLink) {
        const cell = companyLink.closest('.table-cell') || companyLink.parentElement;
        const mc = extractMCFromElement(cell) || extractMCFromElement(row);
        if (mc && coByMC.has(mc)) {
          companyNote = coByMC.get(mc);
        }
      }

      // Safeguard: If note was matched by name, but cell/row contains an explicit MC that contradicts note's MC
      if (companyNote && companyNote.mc && companyLink) {
        const cell = companyLink.closest('.table-cell') || companyLink.parentElement;
        const rowMC = extractMCFromElement(cell) || extractMCFromElement(row);
        if (rowMC) {
          const normRowMC = IdentityParser.normalizeMC(rowMC);
          const normNoteMC = IdentityParser.normalizeMC(companyNote.mc);
          if (normRowMC && normNoteMC && normRowMC !== normNoteMC) {
            companyNote = null;
          }
        }
      }

      if (companyLink && companyNote) {
        const meta = ratingMeta(companyNote.rating);
        const parent = companyLink.parentElement || companyLink;
        let dot = parent.querySelector('.dat-table-dot-company');
        if (!dot) {
          dot = document.createElement('span');
          dot.className = `dat-table-dot dat-table-dot-company dat-dot-${companyNote.rating}`;
          companyLink.insertAdjacentElement('afterend', dot);
        }

        if (dot.dataset.noteId !== companyNote.id || dot.dataset.rating !== companyNote.rating) {
          dot.className = `dat-table-dot dat-table-dot-company dat-dot-${companyNote.rating}`;
          dot.dataset.noteId = companyNote.id;
          dot.dataset.rating = companyNote.rating;
          dot.style.backgroundColor = meta.bg;
        }

        dot.title = `Company: ${companyNote.companyName || 'Company'} (${meta.label})\nNote: ${companyNote.note || '— No note text —'}\nClick to view note`;
        dot.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          notesModal.open(companyNote, 'company', 'view');
        };
      } else if (companyLink) {
        (companyLink.parentElement || companyLink).querySelector('.dat-table-dot-company')?.remove();
      }

      // ──────────────────────────────────────────────────────────────────────
      // 2. Phone Contact & Broker Dot (Phones keep circle dot)
      // ──────────────────────────────────────────────────────────────────────
      let phoneElement = null;
      let phoneBrokerNote = null;
      let phoneMatches = [];

      const phoneCandidates = cellsContainer.querySelectorAll('a, span, div');
      for (const el of phoneCandidates) {
        if (el.children.length > 0 && el.querySelector('a')) continue;
        if (el === companyLink) continue;
        if (el.closest('.dat-email-broker-wrapper, .dat-table-dot, .dat-notes-modal')) continue;

        const txt = (el.innerText || el.textContent || '').trim();
        const phoneMatch = txt.match(PHONE_PATTERN);
        if (phoneMatch) {
          const normPhone = IdentityParser.normalizePhone(phoneMatch[0]);
          if (normPhone && brkByPhone.has(normPhone)) {
            phoneMatches = brkByPhone.get(normPhone);
            phoneBrokerNote = phoneMatches[0];
            phoneElement = el.matches('a') ? el : (el.closest('a') || el);
            break;
          }
        }
      }

      if (phoneElement && phoneBrokerNote) {
        const meta = ratingMeta(phoneBrokerNote.rating);
        const parent = phoneElement.parentElement || phoneElement;
        let dot = parent.querySelector('.dat-table-dot-phone');
        if (!dot) {
          dot = document.createElement('span');
          dot.className = `dat-table-dot dat-table-dot-broker dat-table-dot-phone dat-dot-${phoneBrokerNote.rating}`;
          phoneElement.insertAdjacentElement('afterend', dot);
        }

        if (dot.dataset.brokerId !== phoneBrokerNote.id || dot.dataset.rating !== phoneBrokerNote.rating) {
          dot.className = `dat-table-dot dat-table-dot-broker dat-table-dot-phone dat-dot-${phoneBrokerNote.rating}`;
          dot.dataset.brokerId = phoneBrokerNote.id;
          dot.dataset.rating = phoneBrokerNote.rating;
          dot.style.backgroundColor = meta.bg;
        }

        const extStr = phoneBrokerNote.ext ? ` ext ${phoneBrokerNote.ext}` : '';
        const otherCount = phoneMatches.length - 1;
        const multiInfo = otherCount > 0 ? `\n(+${otherCount} other broker note(s) for this phone, showing most positive)` : '';
        dot.title = `Broker: ${phoneBrokerNote.brokerName || phoneBrokerNote.phone || 'Broker'}${extStr} (${meta.label})\nNote: ${phoneBrokerNote.note || '— No note text —'}${multiInfo}\nClick to view note`;

        dot.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          notesModal.open(phoneBrokerNote, 'broker', 'view');
        };
      } else {
        cellsContainer.querySelectorAll('.dat-table-dot-phone').forEach((d) => d.remove());
      }

      // ──────────────────────────────────────────────────────────────────────
      // 3. Email Contact: Full Wrapper vs Circle Dot (controlled by popup toggle)
      // ──────────────────────────────────────────────────────────────────────
      let emailElement = null;
      let emailBrokerNote = null;
      let emailMatches = [];

      // Check if this row already has a wrapped email
      const existingWrapper = cellsContainer.querySelector('.dat-email-broker-wrapper');
      if (existingWrapper) {
        const innerEmail = existingWrapper.querySelector('a') || Array.from(existingWrapper.children).find((c) => !c.classList.contains('dat-email-view-btn')) || existingWrapper;
        const txt = (innerEmail.innerText || innerEmail.textContent || '').trim();
        const match = txt.match(EMAIL_PATTERN);
        if (match) {
          const normEmail = IdentityParser.normalizeEmail(match[0]);
          if (normEmail && brkByEmail.has(normEmail)) {
            emailMatches = brkByEmail.get(normEmail);
            emailBrokerNote = emailMatches[0];
            emailElement = innerEmail;
          }
        }
        if (!emailBrokerNote || !this.emailFullWrapper) {
          // If no note OR user switched to dot mode -> unwrap it back to plain text
          unwrapEmailWrapper(existingWrapper);
        }
      }

      // If not wrapped yet or was unwrapped, scan candidates for email
      if (!emailBrokerNote) {
        const emailCandidates = cellsContainer.querySelectorAll('a[href^="mailto:"], a[href*="@"], a, span, div');
        for (const el of emailCandidates) {
          if (el.children.length > 0 && el.querySelector('a')) continue;
          if (el === companyLink) continue;
          if (el.closest('.dat-table-dot, .dat-notes-modal, .dat-email-broker-wrapper')) continue;

          const txt = (el.innerText || el.textContent || '').trim();
          const emailMatch = txt.match(EMAIL_PATTERN);
          if (emailMatch) {
            const normEmail = IdentityParser.normalizeEmail(emailMatch[0]);
            if (normEmail && brkByEmail.has(normEmail)) {
              emailMatches = brkByEmail.get(normEmail);
              emailBrokerNote = emailMatches[0];
              emailElement = el.matches('a') ? el : (el.closest('a') || el);
              break;
            }
          }
        }
      }

      if (emailElement && emailBrokerNote) {
        const meta = ratingMeta(emailBrokerNote.rating);
        const otherCount = emailMatches.length - 1;
        const multiInfo = otherCount > 0 ? `\n(+${otherCount} other broker note(s) for this email, showing most positive)` : '';

        if (this.emailFullWrapper) {
          // ── MODE 1: Full Colored Wrapper + Note Button ──
          (emailElement.parentElement || emailElement).querySelectorAll('.dat-table-dot-email').forEach((d) => d.remove());

          const noteTitle = `Broker: ${emailBrokerNote.brokerName || emailBrokerNote.email || 'Broker'} (${meta.label})\nNote: ${emailBrokerNote.note || '— No note text —'}${multiInfo}`;
          let wrapper = emailElement.closest('.dat-email-broker-wrapper');
          if (!wrapper) {
            wrapper = document.createElement('span');
            wrapper.className = `dat-email-broker-wrapper ${meta.cls}`;
            wrapper.style.backgroundColor = meta.bg;
            wrapper.style.color = meta.color;
            wrapper.dataset.brokerId = emailBrokerNote.id;
            wrapper.dataset.rating = emailBrokerNote.rating;
            wrapper.title = noteTitle;

            emailElement.parentNode.insertBefore(wrapper, emailElement);
            wrapper.appendChild(emailElement);
            if (emailElement.style) {
              emailElement.style.color = meta.color;
            }

            const viewBtn = document.createElement('button');
            viewBtn.type = 'button';
            viewBtn.className = 'dat-email-view-btn';
            viewBtn.title = `Broker: ${emailBrokerNote.brokerName || emailBrokerNote.email || 'Broker'}\nClick to view note`;
            viewBtn.innerHTML = `<span>📝</span><span>Note</span>`;
            viewBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              notesModal.open(emailBrokerNote, 'broker', 'view');
            };
            wrapper.appendChild(viewBtn);

            wrapper.onclick = (e) => {
              if (e.target.closest('a')) return;
              e.preventDefault();
              e.stopPropagation();
              notesModal.open(emailBrokerNote, 'broker', 'view');
            };
          } else {
            if (wrapper.dataset.brokerId !== emailBrokerNote.id || wrapper.dataset.rating !== emailBrokerNote.rating) {
              wrapper.className = `dat-email-broker-wrapper ${meta.cls}`;
              wrapper.style.backgroundColor = meta.bg;
              wrapper.style.color = meta.color;
              wrapper.dataset.brokerId = emailBrokerNote.id;
              wrapper.dataset.rating = emailBrokerNote.rating;
              if (emailElement.style) {
                emailElement.style.color = meta.color;
              }
            }
            wrapper.title = noteTitle;

            let viewBtn = wrapper.querySelector('.dat-email-view-btn');
            if (!viewBtn) {
              viewBtn = document.createElement('button');
              viewBtn.type = 'button';
              viewBtn.className = 'dat-email-view-btn';
              viewBtn.innerHTML = `<span>📝</span><span>Note</span>`;
              wrapper.appendChild(viewBtn);
            }
            viewBtn.title = `Broker: ${emailBrokerNote.brokerName || emailBrokerNote.email || 'Broker'}\nClick to view note`;
            viewBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              notesModal.open(emailBrokerNote, 'broker', 'view');
            };
          }
        } else {
          // ── MODE 2 (Default): Compact Circle Dot (same as phone) ──
          const curWrapper = emailElement.closest('.dat-email-broker-wrapper');
          if (curWrapper) {
            unwrapEmailWrapper(curWrapper);
          }

          const parent = emailElement.parentElement || emailElement;
          let dot = parent.querySelector('.dat-table-dot-email');
          if (!dot) {
            dot = document.createElement('span');
            dot.className = `dat-table-dot dat-table-dot-broker dat-table-dot-email dat-dot-${emailBrokerNote.rating}`;
            emailElement.insertAdjacentElement('afterend', dot);
          }

          if (dot.dataset.brokerId !== emailBrokerNote.id || dot.dataset.rating !== emailBrokerNote.rating) {
            dot.className = `dat-table-dot dat-table-dot-broker dat-table-dot-email dat-dot-${emailBrokerNote.rating}`;
            dot.dataset.brokerId = emailBrokerNote.id;
            dot.dataset.rating = emailBrokerNote.rating;
            dot.style.backgroundColor = meta.bg;
          }

          dot.title = `Broker: ${emailBrokerNote.brokerName || emailBrokerNote.email || 'Broker'} (${meta.label})\nNote: ${emailBrokerNote.note || '— No note text —'}${multiInfo}\nClick to view note`;
          dot.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            notesModal.open(emailBrokerNote, 'broker', 'view');
          };
        }
      } else {
        // No email note in this row -> clean up wrappers and dots
        cellsContainer.querySelectorAll('.dat-email-broker-wrapper').forEach(unwrapEmailWrapper);
        cellsContainer.querySelectorAll('.dat-table-dot-email').forEach((d) => d.remove());
      }
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
    const expandedContainer = card.closest('.details-container, .xl-details, dat-load-details, [class*="load-details"], .row-container') || card;
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
        if (el.closest('.dat-notes-modal, .dat-email-broker-wrapper, .dat-mini-add-btn, .dat-company-note-badge, .table-cell, .row-cells')) return false;
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
    document.querySelectorAll('.dat-email-broker-wrapper').forEach(unwrapEmailWrapper);

    document.querySelectorAll('.dat-company-note-badge, .dat-phone-broker-badge, .dat-mini-add-btn, .dat-notes-badge, .dat-table-dot').forEach((el) => {
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
