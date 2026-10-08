/**
 * Background Service Worker
 * Handles commands, initial storage setup, and messaging.
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[DAT One Suite] Extension installed/updated:', details.reason);

  // Initialize default configuration if not set
  const defaults = {
    'module:sidebar-toggle:enabled': true,
    'module:company-notes:enabled': true,
    'setting:sidebar-collapsed': false,
    'setting:custom-sidebar-selector': '',
    'company-notes-data': {}
  };

  const existing = await chrome.storage.local.get(Object.keys(defaults));
  const toSet = {};
  for (const [key, val] of Object.entries(defaults)) {
    if (existing[key] === undefined) {
      toSet[key] = val;
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
});

// Handle keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === 'toggle-sidebar') {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle-sidebar' }).catch(() => {});
  } else if (command === 'quick-note') {
    chrome.tabs.sendMessage(tab.id, { action: 'quick-note' }).catch(() => {});
  }
});
