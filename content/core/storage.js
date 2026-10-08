/**
 * Unified Storage Service
 * Wraps chrome.storage.local with async/await and helper methods.
 */
export class StorageService {
  /**
   * Get single or multiple keys
   * @param {string|string[]} keys
   * @returns {Promise<any>}
   */
  static async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        if (typeof keys === 'string') {
          resolve(result[keys]);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Set multiple key-value pairs
   * @param {Record<string, any>} data
   * @returns {Promise<void>}
   */
  static async set(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Remove key or keys
   * @param {string|string[]} keys
   * @returns {Promise<void>}
   */
  static async remove(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  /**
   * Listen for changes to specific keys
   * @param {(changes: Record<string, {oldValue: any, newValue: any}>) => void} callback
   * @returns {() => void} unsubscribe function
   */
  static onChanged(callback) {
    const listener = (changes, areaName) => {
      if (areaName === 'local') {
        callback(changes);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
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
