document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('enabled-toggle');
    const loopToggle = document.getElementById('loop-toggle');
    const debugToggle = document.getElementById('debug-toggle');
    const statusMsg = document.getElementById('status-msg');
    const siteToggleBtn = document.getElementById('site-toggle-btn');
    const siteToggleIcon = document.getElementById('site-toggle-icon');
    const siteToggleText = document.getElementById('site-toggle-text');
    const siteHostnameEl = document.getElementById('site-hostname');
    const excludedTextarea = document.getElementById('excluded-textarea');
    const saveBtn = document.getElementById('save-excluded');
    const excludedCount = document.getElementById('excluded-count');
    const saveStatus = document.getElementById('save-status');

    let currentHostname = '';

    // Load saved state
    chrome.storage.local.get(['extensionEnabled', 'loopPreventionEnabled', 'debugEnabled'], (result) => {
        const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : true;
        const isLoopEnabled = result.loopPreventionEnabled !== undefined ? result.loopPreventionEnabled : true;
        const isDebugEnabled = result.debugEnabled !== undefined ? result.debugEnabled : false;
        
        toggle.checked = isEnabled;
        loopToggle.checked = isLoopEnabled;
        debugToggle.checked = isDebugEnabled;
        updateStatus(isEnabled);
    });

    // Load excluded sites into textarea
    loadExcludedSites();

    // Get current tab hostname and set up the site toggle button
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url) {
            siteToggleBtn.style.display = 'none';
            return;
        }

        try {
            const url = new URL(tabs[0].url);
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

    // Main toggle
    toggle.addEventListener('change', () => {
        const isEnabled = toggle.checked;
        chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
            updateStatus(isEnabled);
        });
    });

    // Loop prevention toggle
    loopToggle.addEventListener('change', () => {
        chrome.storage.local.set({ loopPreventionEnabled: loopToggle.checked });
    });

    // Debug logging toggle
    debugToggle.addEventListener('change', () => {
        chrome.storage.local.set({ debugEnabled: debugToggle.checked });
    });

    // Per-site disable/enable button
    siteToggleBtn.addEventListener('click', () => {
        if (!currentHostname) return;

        chrome.storage.local.get('userExcludedSites', (result) => {
            let sites = result.userExcludedSites || [];
            const index = sites.indexOf(currentHostname);

            if (index === -1) {
                sites.push(currentHostname);
            } else {
                sites.splice(index, 1);
            }

            chrome.storage.local.set({ userExcludedSites: sites }, () => {
                updateSiteButton();
                loadExcludedSites(); // refresh textarea

                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) chrome.tabs.reload(tabs[0].id);
                });
            });
        });
    });

    // Save button for textarea
    saveBtn.addEventListener('click', () => {
        const text = excludedTextarea.value;
        const sites = text
            .split('\n')
            .map(line => line.trim().toLowerCase())
            .filter(line => line && !line.startsWith('#'));

        // Remove duplicates
        const unique = [...new Set(sites)];

        chrome.storage.local.set({ userExcludedSites: unique }, () => {
            // Refresh textarea with cleaned data
            excludedTextarea.value = unique.join('\n');
            updateCount(unique.length);
            updateSiteButton();
            showSaveStatus('Saved!');
        });
    });

    // Update count on typing
    excludedTextarea.addEventListener('input', () => {
        const lines = excludedTextarea.value
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        updateCount(lines.length);
    });

    /*****************************************************************
     * HELPERS
     *****************************************************************/
    function loadExcludedSites() {
        chrome.storage.local.get('userExcludedSites', (result) => {
            const sites = result.userExcludedSites || [];
            excludedTextarea.value = sites.join('\n');
            updateCount(sites.length);
        });
    }

    function updateCount(count) {
        excludedCount.textContent = count === 1 ? '1 site' : `${count} sites`;
    }

    function showSaveStatus(msg) {
        saveStatus.textContent = msg;
        saveStatus.classList.add('visible');
        setTimeout(() => {
            saveStatus.classList.remove('visible');
        }, 2000);
    }

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
