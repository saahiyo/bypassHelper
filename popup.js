document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('enabled-toggle');
    const loopToggle = document.getElementById('loop-toggle');
    const statusMsg = document.getElementById('status-msg');

    // Load saved state
    chrome.storage.local.get(['extensionEnabled', 'loopPreventionEnabled'], (result) => {
        // Default to true if not set
        const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : true;
        const isLoopEnabled = result.loopPreventionEnabled !== undefined ? result.loopPreventionEnabled : true;
        
        toggle.checked = isEnabled;
        loopToggle.checked = isLoopEnabled;
        updateStatus(isEnabled);
    });

    // Listen for changes
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
            updateStatus(isEnabled);
        });
    });

    loopToggle.addEventListener('change', () => {
        const isLoopEnabled = loopToggle.checked;
        chrome.storage.local.set({ loopPreventionEnabled: isLoopEnabled });
    });

    function updateStatus(enabled) {
        if (enabled) {
            statusMsg.textContent = 'Extension is active';
            statusMsg.className = 'status-message visible';
        } else {
            statusMsg.textContent = 'Extension is disabled';
            statusMsg.className = 'status-message visible disabled';
        }
    }
    
    // Settings link handling (optional implementation for now)
    document.getElementById('open-settings').addEventListener('click', (e) => {
        e.preventDefault();
        // You could open an options page here if you have one
        // chrome.runtime.openOptionsPage();
        alert('Settings page coming soon!');
    });
});
