// background.js - Service worker for handling keyboard shortcuts, badge, and excluded hosts

/*****************************************************************
 * KEYBOARD SHORTCUTS (simplified)
 *****************************************************************/
const COMMAND_MAP = {
  'go-to-bottom': 'goToBottom',
  'go-to-top': 'goToTop'
};

chrome.commands.onCommand.addListener((command) => {
  const action = COMMAND_MAP[command];
  if (!action) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action }).catch(() => {});
    }
  });
});

/*****************************************************************
 * EXCLUDED HOSTS — load from bundled file on install/update
 *****************************************************************/
async function loadExcludedHosts() {
  try {
    const response = await fetch(chrome.runtime.getURL('excluded_hosts.txt'));
    const text = await response.text();
    const hosts = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    await chrome.storage.local.set({ cachedExcludedHosts: hosts });
    console.log('[bypassHelper:bg] Loaded excluded hosts:', hosts.length);
  } catch (err) {
    console.error('[bypassHelper:bg] Error loading excluded hosts:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  loadExcludedHosts();
});

// Also reload on service worker startup (in case storage was cleared)
loadExcludedHosts();

/*****************************************************************
 * BADGE — visual feedback for extension state
 *****************************************************************/
function updateBadge(enabled) {
  if (enabled === false) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#475569' });
  } else {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
  }
}

// Set initial badge state
chrome.storage.local.get('extensionEnabled', (result) => {
  updateBadge(result.extensionEnabled);
});

// Listen for toggle changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.prototype.hasOwnProperty.call(changes, 'extensionEnabled')) {
    updateBadge(changes.extensionEnabled.newValue);
  }
});
