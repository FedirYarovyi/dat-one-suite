/**
 * Unified Storage Service
 * Wraps chrome.storage.local with async/await and helper methods.
 */
export class StorageService {
  /**
   * Check if extension context is alive and valid
   * @returns {boolean}
   */
  static isAvailable() {
    return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id) && Boolean(chrome?.storage?.local);
  }

  /**
   * Get single or multiple keys
   * @param {string|string[]} keys
   * @returns {Promise<any>}
   */
  static async get(keys) {
    if (!this.isAvailable()) {
      return typeof keys === 'string' ? undefined : {};
    }
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime?.lastError) {
            resolve(typeof keys === 'string' ? undefined : {});
          } else if (typeof keys === 'string') {
            resolve(result ? result[keys] : undefined);
          } else {
            resolve(result || {});
          }
        });
      } catch {
        resolve(typeof keys === 'string' ? undefined : {});
      }
    });
  }

  /**
   * Set multiple key-value pairs
   * @param {Record<string, any>} data
   * @returns {Promise<void>}
   */
  static async set(data) {
    if (!this.isAvailable()) return;
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(data, () => {
          if (chrome.runtime?.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch {
        resolve();
      }
    });
  }

  /**
   * Remove key or keys
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  static async remove(keys) {
    if (!this.isAvailable()) return;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  /**
   * Listen for changes to specific keys
   * @param {(changes: Record<string, {oldValue: any, newValue: any}>) => void} callback
   * @returns {() => void} unsubscribe function
   */
  static onChanged(callback) {
    if (!this.isAvailable() || !chrome.storage?.onChanged) {
      return () => {};
    }
    const listener = (changes, areaName) => {
      if (areaName === 'local') {
        callback(changes);
      }
    };
    try {
      chrome.storage.onChanged.addListener(listener);
      return () => {
        try {
          chrome.storage.onChanged.removeListener(listener);
        } catch {}
      };
    } catch {
      return () => {};
    }
  }

  /**
   * Export all data as a JSON string
   * @returns {Promise<string>}
   */
  static async exportAll() {
    const all = await this.get(null);
    return JSON.stringify(all, null, 2);
  }

  /**
   * Import data from JSON object
   * @param {Record<string, any>} data
   * @param {boolean} merge
   */
  static async importData(data, merge = true) {
    if (!merge) {
      await new Promise((resolve) => chrome.storage.local.clear(resolve));
    }
    await this.set(data);
  }
}
