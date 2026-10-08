/**
 * Module Manager
 * Manages module registration, lifecycle (init, enable, disable), and settings synchronization.
 */
import { StorageService } from './storage.js';

export class ModuleManager {
  constructor() {
    this.modules = new Map();
    this.enabledStates = new Map();
  }

  /**
   * Register a feature module
   * @param {Object} module
   * @param {string} module.id - Unique module identifier
   * @param {string} module.name - Human-readable name
   * @param {string} module.description - Brief description
   * @param {Function} [module.init] - Initialization hook
   * @param {Function} [module.enable] - Enabled hook
   * @param {Function} [module.disable] - Disabled hook
   */
  register(module) {
    if (!module || !module.id) {
      throw new Error('[ModuleManager] Module must have a valid id');
    }
    if (this.modules.has(module.id)) {
      console.warn(`[ModuleManager] Module "${module.id}" is already registered. Overwriting.`);
    }
    this.modules.set(module.id, module);
  }

  /**
   * Initialize all registered modules and sync with storage
   */
  async startAll() {
    const keys = Array.from(this.modules.keys()).map((id) => `module:${id}:enabled`);
    const stored = await StorageService.get(keys);

    for (const [id, module] of this.modules.entries()) {
      const storageKey = `module:${id}:enabled`;
      // Default to true if not explicitly set to false
      const isEnabled = stored[storageKey] !== false;
      this.enabledStates.set(id, isEnabled);

      try {
        if (typeof module.init === 'function') {
          await module.init();
        }
        if (isEnabled && typeof module.enable === 'function') {
          await module.enable();
        }
      } catch (err) {
        console.error(`[ModuleManager] Error initializing module "${id}":`, err);
      }
    }

    // Listen for toggle changes from popup or background
    StorageService.onChanged((changes) => {
      for (const [key, change] of Object.entries(changes)) {
        if (key.startsWith('module:') && key.endsWith(':enabled')) {
          const moduleId = key.split(':')[1];
          const module = this.modules.get(moduleId);
          if (module) {
            const shouldEnable = change.newValue !== false;
            const currentlyEnabled = this.enabledStates.get(moduleId);

            if (shouldEnable && !currentlyEnabled) {
              this.enabledStates.set(moduleId, true);
              if (typeof module.enable === 'function') {
                module.enable();
              }
            } else if (!shouldEnable && currentlyEnabled) {
              this.enabledStates.set(moduleId, false);
              if (typeof module.disable === 'function') {
                module.disable();
              }
            }
          }
        }
      }
    });
  }

  /**
   * Get list of all registered modules with their state
   */
  getModules() {
    return Array.from(this.modules.values()).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      enabled: this.enabledStates.get(m.id) ?? true
    }));
  }

  /**
   * Get specific module instance
   */
  getModule(id) {
    return this.modules.get(id);
  }
}

export const moduleManager = new ModuleManager();
