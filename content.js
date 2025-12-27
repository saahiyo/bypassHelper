(() => {
  'use strict';

  /*****************************************************************
   * CONFIG
   *****************************************************************/
  const CONFIG = {
    DEBUG: false,
    MAX_ACTIONS: 5,
    DETECTION_THRESHOLD: 5,
    ACTION_INTERVAL: 900,
    EXCLUDED_HOSTS: [
      'arolinks.com',
      'urllinkshort.in',
      'shortxlinks.com',
      'nowshort.com',
      'inshorturl.*',
      'makelinks.in',
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
    },
    knownGates() {
      const gatePatterns = /ad-container|blockcont|contntblock|closeis|ad-text/i;
      return [...document.querySelectorAll('div, section, aside')]
        .some(el => gatePatterns.test(el.className) || gatePatterns.test(el.id));
    },
    actionButtons() {
      const keywords = /(verify|human|start|next|verify|continue|scroll\s*down|tab\s*scroll\s*down)/i;
      return [...document.querySelectorAll('a,button,div')]
        .some(el => el.offsetParent && keywords.test(el.textContent));
    }
  };

  function detectGate() {
    let score = 0;
    let gated = false;

    if (detectors.countdown()) { score += 3; gated = true; }
    if (detectors.disabledButtons()) { score += 3; gated = true; }

    if (!gated) {
      if (detectors.knownGates()) { score += 5; gated = true; }
    }

    // Retain engagement if we've already started acting
    if (actionCount > 0) {
      score += 3;
      gated = true;
    }

    // Check for visible action buttons
    if (detectors.actionButtons()) {
      score += 2;
      gated = true;
    }

    if (!gated) return false;

    if (detectors.jsRedirectHints()) score += 4;
    if (detectors.overlays()) score += 2;
    if (detectors.knownGates() && gated) score += 2; // Extra score if already gated

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
        // avoid nav/footer (allow main/article as content often lives there)
        if (el.closest('nav,header,footer')) return false;
        if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('#')) return false;
        if ((el.textContent || '').length > 60) return false;

        return true;
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
    document.querySelectorAll('div, section, aside').forEach(d => {
      const z = parseInt(getComputedStyle(d).zIndex, 10);
      const isKnownGate = gatePatterns.test(d.className) || gatePatterns.test(d.id);
      
      if (isKnownGate || (!isNaN(z) && z > 999)) {
        log('Removing overlay element:', d.className, d.id);
        d.remove();
      }
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
   * EVENT LISTENERS (Communication with shortcuts.js)
   *****************************************************************/
  window.addEventListener('bypassHelper:forceExecute', () => {
    log('Force bypass execution triggered via event');
    stopped = false;
    execute();
  });

})();
