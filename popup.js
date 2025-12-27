document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('extensionEnabled');
  const forceBtn = document.getElementById('forceBypass');
  const statusMsg = document.getElementById('status-msg');

  // Load current state
  const data = await chrome.storage.local.get({ enabled: true });
  toggle.checked = data.enabled;

  // Handle toggle change
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.local.set({ enabled: isEnabled });
    statusMsg.textContent = isEnabled ? 'Auto-bypass active' : 'Auto-bypass paused';
  });

  // Handle manual bypass
  forceBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      statusMsg.textContent = 'Triggering bypass...';
      
      // Send message to content script
      await chrome.tabs.sendMessage(tab.id, { action: 'forceBypass' });
      
      statusMsg.textContent = 'Bypass triggered!';
      setTimeout(() => {
        statusMsg.textContent = toggle.checked ? 'Auto-bypass active' : 'Auto-bypass paused';
      }, 2000);
    } catch (err) {
      console.error(err);
      statusMsg.textContent = 'Error: Refresh page and try again';
    }
  });
});
