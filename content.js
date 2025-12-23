'use strict';

/* ================================
   CONFIGURATION
================================ */

const MAX_CLICKS_PER_RUN = 10;
let clickCount = 0;

const BLOCKED_HOSTS = [
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adnxs.com",
    "taboola.com",
    "outbrain.com",
    "revcontent.com",
    "popads.net",
    "propellerads.com",
    "adsterra.com",
    "mgid.com",
    "trafficstars.com",
    "pushads.net",
    "popcash.net",
    "hilltopads.net",
    "exoclick.com",
    "juicyads.com",
    "cloudflare.com"
];

const ALLOWED_SELECTORS = [
    "#tp-snp2",
    "#btn7", "#btn7 button", "#btn7 .ce-btn",
    "#btn6",
    "#wpsafelink-landing",
    "#wpsafe-link", "#wpsafe-link a", "#wpsafe-link img", "#image3",
    "a[onclick*='safelink_redirect']",
    ".ce-btn.ce-blue",
    "center a button.ce-btn",
    "center a .ce-blue",
    "a:has(.ce-btn)",
    "center a",
    "[id*='getlink'], [id*='continue'], [id*='proceed']",
    "[class*='getlink'], [class*='continue'], [class*='proceed']",
    ".BR-Footer-Ads-close",
    ".close, .close-btn, .ad-close, .close-ad",
    "[class*='close'] svg, [class*='Close']",
    "button[aria-label='Close'], .modal-close",
    "#link",
    "#rtg button", "#rtg .button",
    "form#rtg"
];

const UNWANTED_SELECTORS = [
    "#adblock-modal",
    ".popup, .pop-up",
    ".ad-banner, .ads-banner",
    ".ad-container, .ads-container",
    ".newsletter-popup, .subscribe-popup",
    ".modal-backdrop, .overlay",
    "iframe[src*='ads'], iframe[src*='googleads'], iframe[src*='doubleclick']",
    ".countdown, #timer",
    "#BR-Footer-Ads",
    ".BR-Overlay",
    ".footer-ad, .bottom-ad, .sticky-ad",
    ".comment-form, #comment-form, .comments-area, #comments",
    ".comment-respond, .leave-comment"
];

    /* ================================
    EXTENSION INITIALIZATION
    ================================ */

console.log("Auto Clicker Extension Loaded");

/* ================================
   UTILITY FUNCTIONS
================================ */

function isBlocked(url) {
    try {
        const u = new URL(url, location.href);
        if (u.hostname === location.hostname) return false;
        const host = u.hostname.toLowerCase();
        return BLOCKED_HOSTS.some(b => host === b || host.endsWith("." + b));
    } catch {
        return false;
    }
}

function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        window.getComputedStyle(el).visibility !== "hidden" &&
        window.getComputedStyle(el).display !== "none"
    );
}

/* ================================
   NETWORK BLOCKING
================================ */

(function patchFetch() {
    const original = window.fetch;
    window.fetch = function(url, options) {
        const u = typeof url === "string" ? url : url.url || url;
        if (isBlocked(u)) {
            console.warn("Blocked fetch:", u);
            return new Promise(() => {}); // never resolves
        }
        return original.apply(this, arguments);
    };
})();

(function patchXHR() {
    const original = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        if (isBlocked(url)) {
            console.warn("Blocked XHR:", url);
            return;
        }
        return original.apply(this, arguments);
    };
})();

/* ================================
   DOM CLEANUP
================================ */

function removeUnwanted() {
    for (const sel of UNWANTED_SELECTORS) {
        document.querySelectorAll(sel).forEach(e => e.remove());
    }
}

/* ================================
   AUTO CLICK HANDLER
================================ */

function autoClickMain() {
    if (clickCount >= MAX_CLICKS_PER_RUN) return false;

    let clicked = false;

    for (const sel of ALLOWED_SELECTORS) {
        const elements = document.querySelectorAll(sel);
        if (!elements.length) continue;

        elements.forEach(el => {
            if (clickCount >= MAX_CLICKS_PER_RUN) return;
            if (!el || !isVisible(el)) return;

            // If inside an <a>, prefer clicking the <a>
            let target = el.closest("a") || el;

            // Prevent duplicate clicks
            if (target.dataset.autoClicked === "true") return;

            // For forms
            if (target.tagName === "FORM") {
                if (!target.dataset.autoSubmitted) {
                    target.dataset.autoSubmitted = "true";
                    console.log("Auto-submitting form:", target.id);
                    target.submit();
                    clickCount++;
                    clicked = true;
                }
                return;
            }

            // Button disabling workaround
            if (target.disabled) {
                target.disabled = false;
            }

            target.dataset.autoClicked = "true";
            target.click();
            console.log("Auto-click:", sel);

            clickCount++;
            clicked = true;
        });
    }

    return clicked;
}

/* ================================
   EXECUTION LOOP
================================ */

function runAll() {
    removeUnwanted();
    autoClickMain();
}

// Reset click count on full reload
if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
    clickCount = 0;
}

runAll();

/* ================================
   MUTATION OBSERVER (Optimized)
================================ */

// Debounce to reduce CPU load
let moTimeout = null;
const mo = new MutationObserver(() => {
    if (moTimeout) return;
    moTimeout = setTimeout(() => {
        moTimeout = null;
        runAll();
    }, 250);
});

mo.observe(document.documentElement, {
    childList: true,
    subtree: true
});

/* ================================
   SAFETY INTERVAL (Failsafe)
================================ */

const interval = setInterval(() => {
    if (clickCount >= MAX_CLICKS_PER_RUN) {
        clearInterval(interval);
        return;
    }
    runAll();
}, 1000);
