/**
 * DOM Observer and SPA Navigation Tracker
 * Monitors DOM mutations and URL changes efficiently with debouncing.
 */
export class DOMObserver {
  constructor() {
    this.mutationObserver = null;
    this.elementWatchers = new Map(); // selector -> Set<callback>
    this.urlChangeCallbacks = new Set();
    this.currentUrl = window.location.href;
    this.debounceTimer = null;
  }

  /**
   * Start observing DOM and URL mutations
   */
  start() {
    if (this.mutationObserver) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });

    // Monitor SPA navigation (pushState, replaceState, popstate, hashchange)
    this.setupUrlWatcher();
  }

  /**
   * Handle debounced DOM mutations
   */
  handleMutations(mutations) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      this.checkElementWatchers();
    }, 150);
  }

  /**
   * Watch for elements matching a CSS selector as they appear in the DOM
   * @param {string} selector
   * @param {(element: HTMLElement) => void} callback
   * @returns {() => void} unwatch function
   */
  watch(selector, callback) {
    if (!this.elementWatchers.has(selector)) {
      this.elementWatchers.set(selector, new Set());
    }
    this.elementWatchers.get(selector).add(callback);

    // Immediate check if element already exists
    const existing = document.querySelectorAll(selector);
    existing.forEach((el) => {
      try {
        callback(el);
      } catch (err) {
        console.error(`[DOMObserver] Error in watcher for "${selector}":`, err);
      }
    });

    return () => {
      const watchers = this.elementWatchers.get(selector);
      if (watchers) {
        watchers.delete(callback);
        if (watchers.size === 0) {
          this.elementWatchers.delete(selector);
        }
      }
    };
  }

  checkElementWatchers() {
    for (const [selector, callbacks] of this.elementWatchers.entries()) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach((el) => {
          for (const cb of callbacks) {
            try {
              cb(el);
            } catch (err) {
              console.error(`[DOMObserver] Error in watcher check for "${selector}":`, err);
            }
          }
        });
      }
    }
  }

  /**
   * Watch for SPA URL changes
   * @param {(newUrl: string, oldUrl: string) => void} callback
   */
  onUrlChange(callback) {
    this.urlChangeCallbacks.add(callback);
    return () => this.urlChangeCallbacks.delete(callback);
  }

  setupUrlWatcher() {
    const notifyUrlChange = () => {
      const newUrl = window.location.href;
      if (newUrl !== this.currentUrl) {
        const oldUrl = this.currentUrl;
        this.currentUrl = newUrl;
        for (const cb of this.urlChangeCallbacks) {
          try {
            cb(newUrl, oldUrl);
          } catch (err) {
            console.error('[DOMObserver] Error in URL change callback:', err);
          }
        }
      }
    };

    // Patch history pushState and replaceState
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      notifyUrlChange();
      return result;
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
      notifyUrlChange();
      return result;
    };

    window.addEventListener('popstate', notifyUrlChange);
    window.addEventListener('hashchange', notifyUrlChange);
  }

  /**
   * Stop observing
   */
  stop() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    this.elementWatchers.clear();
    this.urlChangeCallbacks.clear();
  }
}

export const domObserver = new DOMObserver();
