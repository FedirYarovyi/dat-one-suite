/**
 * Sidebar Toggle Module
 * Allows collapsing and expanding the DAT One navigation sidebar to maximize screen space for load boards.
 */
import { StorageService } from '../../core/storage.js';

export class SidebarToggleModule {
  constructor() {
    this.id = 'sidebar-toggle';
    this.name = 'Скрытие боковой панели';
    this.description = 'Сворачивает боковое меню на DAT One для увеличения рабочей области (Alt+S).';

    this.toggleButton = null;
    this.isCollapsed = false;
    this.customSelector = '';
    this.keyListener = null;
    this.messageListener = null;
  }

  async init() {
    // Load persisted state
    const saved = await StorageService.get(['setting:sidebar-collapsed', 'setting:custom-sidebar-selector']);
    this.isCollapsed = Boolean(saved['setting:sidebar-collapsed']);
    this.customSelector = saved['setting:custom-sidebar-selector'] || '';

    // Watch for custom selector changes
    StorageService.onChanged((changes) => {
      if (changes['setting:custom-sidebar-selector']) {
        this.customSelector = changes['setting:custom-sidebar-selector'].newValue || '';
        this.applyCustomSelector();
      }
      if (changes['setting:sidebar-collapsed'] !== undefined) {
        const nextState = Boolean(changes['setting:sidebar-collapsed'].newValue);
        if (nextState !== this.isCollapsed) {
          this.setCollapsed(nextState, false);
        }
      }
    });
  }

  enable() {
    this.injectButton();
    this.setupListeners();
    this.applyCollapsedState();
    this.applyCustomSelector();
  }

  disable() {
    if (this.anchorObserver) {
      this.anchorObserver.disconnect();
      this.anchorObserver = null;
    }
    if (this.toggleButton) {
      this.toggleButton.remove();
      this.toggleButton = null;
    }
    this.removeListeners();
    document.body.classList.remove('dat-sidebar-collapsed');
    this.clearCustomSelectorStyles();
  }

  injectButton() {
    // Remove stale instance if exists
    const stale = document.getElementById('dat-nav-toggle-tab');
    if (stale) stale.remove();

    const btn = document.createElement('button');
    btn.id = 'dat-nav-toggle-tab';
    btn.className = 'dat-nav-toggle-tab dat-menu-toggle-tab';
    btn.title = this.isCollapsed ? 'Expand sidebar (Alt+S)' : 'Collapse sidebar (Alt+S)';
    btn.innerHTML = `<span class="dat-toggle-icon" style="font-size:12px;line-height:1;pointer-events:none;">${this.isCollapsed ? '▶' : '◀'}</span>`;

    // Direct inline styles to guarantee visibility regardless of CSS loading
    btn.style.cssText = `
      position: fixed !important;
      top: 50% !important;
      left: 0 !important;
      transform: translateY(-50%) !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 22px !important;
      height: 52px !important;
      padding: 0 !important;
      background: ${this.isCollapsed ? '#091e42' : '#0052cc'} !important;
      color: #ffffff !important;
      border: 1px solid rgba(255, 255, 255, 0.4) !important;
      border-left: none !important;
      border-radius: 0 8px 8px 0 !important;
      cursor: pointer !important;
      box-shadow: 2px 0 10px rgba(0, 0, 0, 0.3) !important;
      user-select: none !important;
      visibility: visible !important;
      opacity: 0.9 !important;
      pointer-events: auto !important;
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Always append as a direct child of document.body
    (document.body || document.documentElement).appendChild(btn);
    this.toggleButton = btn;
    this.updateButtonUI();

    // Guard: ensure button is always in document.body
    if (this.anchorObserver) this.anchorObserver.disconnect();
    this.anchorObserver = new MutationObserver(() => {
      const el = document.getElementById('dat-nav-toggle-tab');
      if (el && el.parentElement !== (document.body || document.documentElement)) {
        (document.body || document.documentElement).appendChild(el);
      }
    });
    this.anchorObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  setupListeners() {
    // Keyboard shortcut (Alt+S)
    this.keyListener = (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.keyListener);

    // Messages from background shortcut
    this.messageListener = (request) => {
      if (request.action === 'toggle-sidebar') {
        this.toggle();
      }
    };
    chrome.runtime.onMessage.addListener(this.messageListener);
  }

  removeListeners() {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.messageListener = null;
    }
  }

  async toggle() {
    await this.setCollapsed(!this.isCollapsed, true);
  }

  async setCollapsed(collapsed, persist = true) {
    this.isCollapsed = collapsed;
    this.applyCollapsedState();
    this.updateButtonUI();
    this.applyCustomSelector();

    if (persist) {
      await StorageService.set({ 'setting:sidebar-collapsed': this.isCollapsed });
    }
  }

  applyCollapsedState() {
    if (this.isCollapsed) {
      document.body.classList.add('dat-sidebar-collapsed');
    } else {
      document.body.classList.remove('dat-sidebar-collapsed');
    }
  }

  updateButtonUI() {
    if (!this.toggleButton) return;
    const icon = this.toggleButton.querySelector('.dat-toggle-icon');
    if (this.isCollapsed) {
      if (icon) icon.textContent = '▶';
      this.toggleButton.title = 'Expand sidebar (Alt+S)';
      this.toggleButton.style.setProperty('background', '#091e42', 'important');
    } else {
      if (icon) icon.textContent = '◀';
      this.toggleButton.title = 'Collapse sidebar (Alt+S)';
      this.toggleButton.style.setProperty('background', '#0052cc', 'important');
    }
  }

  applyCustomSelector() {
    this.clearCustomSelectorStyles();
    if (!this.customSelector || !this.isCollapsed) return;

    try {
      const elements = document.querySelectorAll(this.customSelector);
      elements.forEach((el) => {
        el.classList.add('dat-custom-hidden-sidebar');
      });
    } catch (err) {
      console.warn('[SidebarToggle] Invalid custom selector:', this.customSelector);
    }
  }

  clearCustomSelectorStyles() {
    const existing = document.querySelectorAll('.dat-custom-hidden-sidebar');
    existing.forEach((el) => el.classList.remove('dat-custom-hidden-sidebar'));
  }
}

export const sidebarToggleModule = new SidebarToggleModule();
