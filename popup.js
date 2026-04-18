document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('enabled-toggle');
    const loopToggle = document.getElementById('loop-toggle');
    const debugToggle = document.getElementById('debug-toggle');
    const statusMsg = document.getElementById('status-msg');

    // Load saved state
    chrome.storage.local.get(['extensionEnabled', 'loopPreventionEnabled', 'debugEnabled'], (result) => {
        // Default to true if not set (except debug which defaults to false)
        const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : true;
        const isLoopEnabled = result.loopPreventionEnabled !== undefined ? result.loopPreventionEnabled : true;
        const isDebugEnabled = result.debugEnabled !== undefined ? result.debugEnabled : false;
        
        toggle.checked = isEnabled;
        loopToggle.checked = isLoopEnabled;
        debugToggle.checked = isDebugEnabled;
        updateStatus(isEnabled);
    });

    // Listen for changes — main toggle
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
            updateStatus(isEnabled);
        });
    });

    // Loop prevention toggle
    loopToggle.addEventListener('change', () => {
        const isLoopEnabled = loopToggle.checked;
        chrome.storage.local.set({ loopPreventionEnabled: isLoopEnabled });
    });

    // Debug logging toggle
    debugToggle.addEventListener('change', () => {
        const isDebugEnabled = debugToggle.checked;
        chrome.storage.local.set({ debugEnabled: isDebugEnabled });
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
});
