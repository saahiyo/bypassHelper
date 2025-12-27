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

  /*****************************************************************
   * DETECTORS (gate presence)
   *****************************************************************/
  const detectors = {
    countdown() {
      return [...document.querySelectorAll('*')]
        .some(e => /\b\d+\s*(sec|seconds|wait)\b/i.test(e.textContent));
    },
    disabledButtons() {
      return document.querySelectorAll('button:disabled').length > 0;
    },
    jsRedirectHints() {
      return [...document.scripts]
        .some(s => /location\.href|window\.open|setTimeout\s*\(/i.test(s.textContent));
    },
    overlays() {
      return [...document.querySelectorAll('div')]
        .some(d => {
          const z = parseInt(getComputedStyle(d).zIndex, 10);
          return !isNaN(z) && z > 999;
        });
    }
  };

  function detectGate() {
    let score = 0;
    let gated = false;

    if (detectors.countdown()) { score += 3; gated = true; }
    if (detectors.disabledButtons()) { score += 3; gated = true; }

    if (!gated) return false;

    if (detectors.jsRedirectHints()) score += 4;
    if (detectors.overlays()) score += 2;

    log('Detection score:', score);
    return score >= CONFIG.DETECTION_THRESHOLD;
  }

  /*****************************************************************
   * STATE-AWARE ACTIONS
   *****************************************************************/

  // 1) FINAL STATE: submit RTG/SafeLink form directly (button may be hidden)
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
    document.querySelectorAll('div').forEach(d => {
      const z = parseInt(getComputedStyle(d).zIndex, 10);
      if (!isNaN(z) && z > 999) d.remove();
    });
    if (document.body) document.body.style.overflow = 'auto';
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
    if (stopped) return;
    if (!detectGate()) return;

    // Final state first (works even if button is hidden)
    if (submitSafeLinkFormOnce()) {
      stopAll('Gate completed (form submitted)');
      return;
    }

    // Mid state: advance the gate
    if (clickGateHelperOnce()) {
      return; // wait for DOM mutation to unlock next state
    }

    // Cleanup
    unlockButtons();
    removeOverlays();

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
   * KEYBOARD SHORTCUT HANDLER
   *****************************************************************/
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'goToBottom') {
      log('Keyboard shortcut triggered - forcing bypass execution');
      // Reset stopped state to allow bypass to run
      stopped = false;
      // Force execute bypass actions
      execute();
      // Scroll to bottom of page
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
      sendResponse({ success: true });
    } else if (request.action === 'goToTop') {
      log('Keyboard shortcut triggered - scrolling to top');
      // Scroll to top of page
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
      sendResponse({ success: true });
    }
  });

})();
