(function() {
    'use strict';

    // 1. Detection Helpers
    const isSecurityChallenge = () => {
        // Immediate detection of Cloudflare internal variables
        if (window._cf_chl_opt || window.cloudflare || window.__CF$cv$params) return true;
        
        // Title check (works very early)
        const title = document.title;
        if (title.includes('Just a moment') || title.includes('Just a second') || title.includes('Checking your browser')) return true;

        // Script source check
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].src;
            if (src.includes('cdn-cgi/challenge-platform/') || src.includes('recaptcha/api.js') || src.includes('hcaptcha.com/1/api.js')) return true;
        }

        // DOM elements (only if load state allows)
        if (document.querySelector('.cf-browser-verification, .cf-turnstile, #turnstile-wrapper, #challenge-form')) return true;
        if (document.body && (document.body.innerText.includes('Performing security verification') || document.body.innerText.includes('Verify you are human'))) return true;

        return false;
    };

    // NOTE: This list is duplicated from excluded_hosts.txt because MAIN world
    // scripts cannot access chrome.storage. Keep both lists in sync.
    const EXCLUDED_HOSTS = [
        'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
        'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
        'youtube.com', 'reddit.com', 'mega.nz'
    ];

    const currentHost = window.location.hostname;
    const isExcluded = EXCLUDED_HOSTS.some(host => {
        return currentHost === host || currentHost.endsWith('.' + host);
    });

    // Debug logging gate. MAIN world can't read chrome.storage, so content.js
    // mirrors the flag onto <html data-bypass-helper-debug>. Silent unless "true".
    const dbg = (...a) => {
        try {
            if (document.documentElement.dataset.bypassHelperDebug === 'true') {
                console.log('[bypassHelper]', ...a);
            }
        } catch { /* ignore */ }
    };

    // 2. Aggressive EARLY EXIT
    // If it's a security challenge or excluded host, we stop completely before overriding anything.
    if (isExcluded || isSecurityChallenge()) {
        if (isSecurityChallenge()) {
            dbg('Security challenge detected - Speedup suspended.');
        }
        return;
    }

    // 3. Timing logic
    const origST = window.setTimeout;
    const origSI = window.setInterval;
    const origRAF = window.requestAnimationFrame;
    const origNow = Date.now;
    const origPerf = window.performance;
    const origPerfNow = origPerf ? origPerf.now.bind(origPerf) : null;
    const origAlert = window.alert;
    const origOpen = window.open;
    
    // Helper to check if speedup should be active (dynamic fallback)
    const isEnabled = () => {
        if (document.documentElement.dataset.bypassHelperEnabled !== 'true') return false;
        if (isSecurityChallenge()) return false;
        return true;
    };

    // Accelerate only long countdown timeouts (>= 1000ms), leave small/network/debounce timeouts intact
    window.setTimeout = function(fn, delay, ...args) {
        if (typeof fn === 'function') {
            try {
                const fnStr = fn.toString();
                if (/wistfulseverely|alwingulla|highcpmgate|adsterra/i.test(fnStr)) {
                    dbg('Blocked ad redirect timer');
                    return -1;
                }
            } catch { /* ignore */ }
        }
        let d = delay;
        if (isEnabled() && typeof delay === 'number' && delay >= 1000) {
            d = Math.max(200, Math.floor(delay / 4));
        }
        return origST(fn, d, ...args);
    };

    // Accelerate long countdown intervals (>= 800ms) safely without triggering server-side premature errors
    window.setInterval = function(fn, delay, ...args) {
        let d = delay;
        if (isEnabled() && typeof delay === 'number' && delay >= 800) {
            d = Math.max(200, Math.floor(delay / 4));
        }
        return origSI(fn, d, ...args);
    };

    // Keep requestAnimationFrame native for UI stability
    window.requestAnimationFrame = function(callback) {
        return origRAF(callback);
    };

    // Do NOT warp Date.now() or performance.now() at runtime — anti-bot systems (Cloudflare,
    // Turnstile, reCAPTCHA) and server-side timestamps detect time distortion and return "Bad Request."
    Date.now = origNow;

    // Suppress blocking alert modals (such as "Bad Request.") that freeze the UI
    window.alert = function(msg) {
        dbg('Alert intercepted:', msg);
        if (typeof msg === 'string' && /bad\s*request/i.test(msg)) {
            return;
        }
        return origAlert(msg);
    };

    // Keep navigation inside current window and prevent opening multiple tabs or ad popups
    window.open = function(url, target, features) {
        dbg('window.open intercepted:', url, target);
        if (isEnabled() && url) {
            try {
                const u = new URL(url, window.location.href);
                const isAd = /(wistfulseverely|alwingulla|highcpmgate|onclick|popads|propellerads|adsterra|n6wxm)/i.test(u.hostname);
                if (isAd) {
                    dbg('Blocked ad popup window:', url);
                    return null;
                }
                // For gate links or relative/same-domain redirects, keep in current window
                window.location.href = url;
                return window;
            } catch { /* ignore parse error */ }
        }
        return origOpen.call(window, url, target, features);
    };

    // Fully remove every override so a disabled extension leaves zero footprint.
    let restored = false;
    const uninstall = () => {
        if (restored) return;
        restored = true;
        window.setTimeout = origST;
        window.setInterval = origSI;
        window.requestAnimationFrame = origRAF;
        Date.now = origNow;
        window.alert = origAlert;
        window.open = origOpen;
        if (origPerf && origPerfNow) {
            try {
                Object.defineProperty(origPerf, 'now', {
                    value: origPerfNow, configurable: true, writable: true
                });
            } catch { /* immutable */ }
        }
    };

    // content.js (isolated world) sets <html data-bypass-helper-enabled> asynchronously
    // after reading storage. Watch for the definitive state: if disabled, self-uninstall
    // so the page runs on native timers with no residual patching; if enabled, keep the
    // overrides and stop observing.
    const applyState = (state) => {
        if (state === 'false') { uninstall(); return true; }
        if (state === 'true') { dbg('Aggressive timer speedup active'); return true; }
        return false;
    };
    try {
        const stateObserver = new MutationObserver(() => {
            if (applyState(document.documentElement.dataset.bypassHelperEnabled)) {
                stateObserver.disconnect();
            }
        });
        stateObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-bypass-helper-enabled']
        });
        // Handle the case where the state was already set before we started observing.
        if (applyState(document.documentElement.dataset.bypassHelperEnabled)) {
            stateObserver.disconnect();
        }
    } catch { /* ignore */ }
})();
