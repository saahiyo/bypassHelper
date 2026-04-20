(function() {
    'use strict';

    // 1. Exclusion logic (Main World cannot access chrome.storage, so we use a list of major platforms)
    const EXCLUDED_HOSTS = [
        'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
        'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
        'youtube.com', 'reddit.com', 'mega.nz'
    ];

    const currentHost = window.location.hostname;
    const isExcluded = EXCLUDED_HOSTS.some(host => {
        return currentHost === host || currentHost.endsWith('.' + host);
    });

    if (isExcluded) {
        return;
    }

    // 2. Aggressive timing logic
    const origST = window.setTimeout;
    const origSI = window.setInterval;
    const origNow = Date.now;
    const origPerf = window.performance;
    const origPerfNow = origPerf ? origPerf.now.bind(origPerf) : null;
    
    const startTime = origNow();
    const perfStartTime = origPerfNow ? origPerfNow() : 0;
    const clockFactor = 100; // 100x speedup for clock sync
    
    // Helper to detect security challenges (Cloudflare, ReCAPTCHA, etc.)
    const isSecurityChallenge = () => {
        // Check title
        const title = document.title;
        if (title.includes('Just a moment') || title.includes('Just a second') || title.includes('Checking your browser')) return true;

        // Check for Cloudflare/Turnstile elements or text
        if (document.querySelector('.cf-browser-verification, .cf-turnstile, #turnstile-wrapper, #challange-form')) return true;
        if (document.body && (document.body.innerText.includes('Performing security verification') || document.body.innerText.includes('Verify you are human'))) return true;

        // Check for security scripts
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].src;
            if (src.includes('cdn-cgi/challenge-platform/') || src.includes('recaptcha/api.js') || src.includes('hcaptcha.com/1/api.js')) return true;
        }

        return false;
    };

    // Helper to check if speedup should be active
    const isEnabled = () => {
        if (document.documentElement.dataset.bypassHelperEnabled !== 'true') return false;
        if (isSecurityChallenge()) return false;
        return true;
    };

    // Force almost instant execution for timeouts
    window.setTimeout = function(fn, delay, ...args) {
        return origST(fn, isEnabled() ? 10 : delay, ...args);
    };

    // Force rapid execution for intervals
    window.setInterval = function(fn, delay, ...args) {
        return origSI(fn, isEnabled() ? 50 : delay, ...args);
    };

    // Override requestAnimationFrame to run at max speed
    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(callback) {
        if (isEnabled()) {
            // Run immediately via setTimeout instead of waiting for next paint
            return origST(callback, 1);
        }
        return origRAF(callback);
    };

    // Override Date.now() to match accelerated time
    Date.now = function() {
        if (!isEnabled()) return origNow();
        return startTime + (origNow() - startTime) * clockFactor;
    };

    // Override performance.now()
    if (origPerf && origPerfNow) {
        try {
            Object.defineProperty(origPerf, 'now', {
                value: function() {
                    if (!isEnabled()) return origPerfNow();
                    return perfStartTime + (origPerfNow() - perfStartTime) * clockFactor;
                },
                configurable: true,
                writable: true
            });
        } catch (e) {
            // Silently fail if performance.now is immutable
        }
    }

    console.log('[bypassHelper] Aggressive timer speedup initialized (Ready)');
})();
