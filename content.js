(() => {
  'use strict';

  /*****************************************************************
   * CONFIG
   *****************************************************************/
  const CONFIG = {
    DEBUG: false,
    MAX_ACTIONS: 5,
    DETECTION_THRESHOLD: 6,
    ACTION_INTERVAL: 900,
    EXCLUDED_HOSTS: [
      'arolinks.com',
      'urllinkshort.in',
      'shortxlinks.com',
      'nowshort.com',
      'inshorturl.com',
      'link.get2short.com',
      'google.com',
      'bing.com',
      'duckduckgo.com',
      'yahoo.com',
      'facebook.com',
      'twitter.com',
      'x.com',
      'instagram.com',
      'youtube.com',
      'reddit.com'
    ]
  };

  const log = (...a) => CONFIG.DEBUG && console.log('[bypassHelper]', ...a);

  if (CONFIG.EXCLUDED_HOSTS.some(h => location.hostname.endsWith(h))) {
    log('Excluded host, exiting');
    return;
  }

  let actionCount = 0;
  let stopped = false;
  let isEnabled = true;

  // Initialize state from storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get({ enabled: true }, (data) => {
      isEnabled = data.enabled;
      log('Initial state:', isEnabled ? 'Enabled' : 'Disabled');
    });

    // Listen for storage changes (toggle from popup)
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabled) {
        isEnabled = changes.enabled.newValue;
        log('State changed to:', isEnabled ? 'Enabled' : 'Disabled');
        if (isEnabled) {
          execute(); // Resume if enabled
        }
      }
    });

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'forceBypass') {
        log('Force bypass requested via popup');
        stopped = false;
        execute();
      }
    });
  }

  /*****************************************************************
   * ACTIONS
   *****************************************************************/

  function submitSafeLinkFormOnce() {
    const form = document.querySelector(
      "form#rtgForm, form[name='rtg'], form[action][method='post']"
    );
    if (!form || form.dataset.submitted) return false;

    const hasHiddenToken = !!form.querySelector("input[type='hidden']");
    if (!hasHiddenToken) return false;

    form.dataset.submitted = 'true';
    log('Submitting gate form directly:', form.action);
    form.submit();

    actionCount++;
    return true;
  }

  // 2) MID STATE: click helper/state-advance button ONCE (must be visible)
  function clickGateHelperOnce() {
    const keywords = /(verify|human|start|next|continue|scroll\s*down|tab\s*scroll\s*down)/i;

    const helper = [...document.querySelectorAll('a,button,div')]
      .find(el => {
        if (!el.offsetParent) return false; // must be visible
        if (el.dataset.clicked) return false;
        if (!keywords.test(el.textContent || '')) return false;

        // avoid nav/content
        if (el.closest('nav,header,footer,article,main')) return false;
        if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('#')) return false;
        if ((el.textContent || '').length > 60) return false;

        // often tied to forms/lockers
        return !!el.closest('form, .gate, .locker, #rtg, #wpsafelink');
      });

    if (!helper) return false;

    helper.dataset.clicked = 'true';
    log('Clicked gate helper:', helper.textContent.trim());
    helper.click();
    actionCount++;
    return true;
  }

  // 3) Cleanup helpers (non-destructive)
  function unlockButtons() {
    document.querySelectorAll('button:disabled').forEach(b => {
      b.disabled = false;
      b.style.opacity = '1';
    });
  }

  function removeOverlays() {
    const gatePatterns = /ad-container|blockcont|contntblock|closeis|ad-text/i;
    const antiAdblockKeywords = /ads?\s*blocker\s*detected|disable\s*your\s*ad\s*blocker/i;

    document.querySelectorAll('div, section, aside').forEach(d => {
      const z = parseInt(getComputedStyle(d).zIndex, 10);
      const isKnownGate = gatePatterns.test(d.className) || gatePatterns.test(d.id);
      const isAntiAdblockModal = antiAdblockKeywords.test(d.textContent || '') && (!isNaN(z) && z > 100);
      
      if (isKnownGate || isAntiAdblockModal || (!isNaN(z) && z > 999)) {
        log('Removing overlay/anti-adblock element:', d.className, d.id);
        d.remove();
      }
    });

    // Remove fixed position overlays that might be blocking interaction
    document.querySelectorAll('*').forEach(el => {
      if (antiAdblockKeywords.test(el.textContent || '')) {
        const style = getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute') {
          log('Removing fixed anti-adblock element');
          el.remove();
        }
      }
    });

    if (document.body) {
      document.body.style.overflow = 'auto';
      document.body.style.setProperty('overflow', 'auto', 'important');
    }
  }

  /*****************************************************************
   * EXECUTION LOOP (priority order)
   *****************************************************************/
  function stopAll(reason) {
    stopped = true;
    observer.disconnect();
    clearInterval(timer);
    log('Stopped:', reason);
  }

  function execute() {
    if (stopped || !isEnabled) return;

    // Cleanup and Anti-Adblock
    unlockButtons();
    removeOverlays();

    // Final state first (works even if button is hidden)
    if (submitSafeLinkFormOnce()) {
      stopAll('Gate completed (form submitted)');
      return;
    }

    // Mid state: advance the gate
    if (clickGateHelperOnce()) {
      return; // wait for DOM mutation to unlock next state
    }

    if (actionCount >= CONFIG.MAX_ACTIONS) {
      stopAll('Max actions reached');
    }
  }

  /*****************************************************************
   * BOOTSTRAP
   *****************************************************************/
  execute();

  const observer = new MutationObserver(() => {
    if (!stopped) execute();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true
  });

  const timer = setInterval(() => {
    if (!stopped) execute();
    else clearInterval(timer);
  }, CONFIG.ACTION_INTERVAL);

  /*****************************************************************
   * EVENT LISTENERS (Communication with shortcuts.js)
   *****************************************************************/
  window.addEventListener('bypassHelper:forceExecute', () => {
    log('Force bypass execution triggered via event');
    stopped = false;
    execute();
  });

})();
