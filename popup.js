document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('enabled-toggle');
    const loopToggle = document.getElementById('loop-toggle');
    const debugToggle = document.getElementById('debug-toggle');
    const statusMsg = document.getElementById('status-msg');
    const siteToggleBtn = document.getElementById('site-toggle-btn');
    const siteToggleIcon = document.getElementById('site-toggle-icon');
    const siteToggleText = document.getElementById('site-toggle-text');
    const siteHostnameEl = document.getElementById('site-hostname');

    let currentHostname = '';

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

    // Get current tab hostname and set up the site toggle button
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url) {
            siteToggleBtn.style.display = 'none';
            return;
        }

        try {
            const url = new URL(tabs[0].url);
            // Hide button for chrome:// and extension pages
            if (!url.hostname || url.protocol === 'chrome:' || url.protocol === 'chrome-extension:') {
                siteToggleBtn.style.display = 'none';
                return;
            }
            currentHostname = url.hostname;
            siteHostnameEl.textContent = currentHostname;
            updateSiteButton();
        } catch (e) {
            siteToggleBtn.style.display = 'none';
        }
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

    // Per-site disable/enable button
    siteToggleBtn.addEventListener('click', () => {
        if (!currentHostname) return;

        chrome.storage.local.get('userExcludedSites', (result) => {
            let sites = result.userExcludedSites || [];
            const index = sites.indexOf(currentHostname);

            if (index === -1) {
                // Add to excluded list
                sites.push(currentHostname);
            } else {
                // Remove from excluded list
                sites.splice(index, 1);
            }

            chrome.storage.local.set({ userExcludedSites: sites }, () => {
                updateSiteButton();

                // Reload the tab so the content script picks up the change
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.reload(tabs[0].id);
                    }
                });
            });
        });
    });

    function updateSiteButton() {
        if (!currentHostname) return;

        chrome.storage.local.get('userExcludedSites', (result) => {
            const sites = result.userExcludedSites || [];
            const isDisabled = sites.includes(currentHostname);

            if (isDisabled) {
                siteToggleIcon.textContent = '✅';
                siteToggleText.textContent = 'Enable on this site';
                siteToggleBtn.classList.add('site-enabled');
            } else {
                siteToggleIcon.textContent = '🚫';
                siteToggleText.textContent = 'Disable on this site';
                siteToggleBtn.classList.remove('site-enabled');
            }
        });
    }

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
