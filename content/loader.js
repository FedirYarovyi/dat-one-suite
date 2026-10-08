/**
 * Content Script Loader
 * Dynamically loads the ES6 module entry point.
 */
(async () => {
  try {
    const src = chrome.runtime.getURL('content/content-main.js');
    await import(src);
    console.log('[DAT One Suite] Modular suite loaded successfully.');
  } catch (err) {
    console.error('[DAT One Suite] Failed to load modular suite:', err);
  }
})();
