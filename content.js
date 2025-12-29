(async () => {
  'use strict';

  /*****************************************************************
   * CONFIG
   *****************************************************************/
  const CONFIG = {
    DEBUG: true,
    MAX_ACTIONS: 5,
    DETECTION_THRESHOLD: 2,
    ACTION_INTERVAL: 900,
    EXCLUDED_HOSTS: [],
    LOOP_LIMIT: 4, // max actions
    LOOP_WINDOW: 15000 // in ms (15 seconds)
  };

  const log = (...a) => CONFIG.DEBUG && console.log('[bypassHelper]', ...a);

  try {
    const response = await fetch(chrome.runtime.getURL('excluded_hosts.txt'));
    const text = await response.text();
    CONFIG.EXCLUDED_HOSTS = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (err) {
    log('Error loading excluded_hosts.txt:', err);
  }

  const isExcluded = CONFIG.EXCLUDED_HOSTS.some(pattern => {
    // Escape dots and replace * with .*
    const regexSource = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape all regex chars
      .replace(/\\\*/g, '.*'); // turn escaped \* back to .*
    const regex = new RegExp(`${regexSource}$`, 'i');
    return regex.test(location.hostname);
  });

  if (isExcluded) {
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
      const keywords = /(verify|human|start|next|verify|continue|scroll\s*down|tab\s*scroll\s*down|get\s*link|get\s*started|get\s*started)/i;
      return [...document.querySelectorAll('a,button,div')]
        .some(el => {
          // Relaxed visibility check for known IDs or if it's high priority
          const isKnownId = el.id === 'btn6' || el.id === 'rtg-snp2' || el.id === 'alt';
          return (el.offsetParent || isKnownId) && keywords.test(el.textContent);
        });
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

    // Force gate if specific IDs exist (even if hidden)
    if (document.querySelector('#btn6, #rtg-snp2, #alt')) {
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

    // Filter out common non-gate forms (like WordPress comments)
    const action = form.getAttribute('action') || '';
    if (action.includes('wp-comments-post.php') || action.includes('contact-form')) return false;

    const hasHiddenToken = !!form.querySelector("input[type='hidden']");
    if (!hasHiddenToken) return false;

    form.dataset.submitted = 'true';
    log('Submitting gate form directly:', form.action);
    
    // Use prototype to avoid errors where an input is named "submit"
    try {
      HTMLFormElement.prototype.submit.call(form);
    } catch (e) {
      log('Native submit failed, trying fallback click', e);
      const sub = form.querySelector('button[type="submit"], input[type="submit"]');
      if (sub) sub.click(); else form.submit();
    }

    recordAction();
    return true;
  }

  function forceClick(element) {
    if (!element) return;
    log('Force clicking:', element.textContent.trim() || element.id || 'unknown');

    // 1. Force visibility and pointer events
    const originalStyles = {
      display: element.style.display,
      visibility: element.style.visibility,
      opacity: element.style.opacity,
      pointerEvents: element.style.pointerEvents
    };

    element.style.setProperty('display', 'block', 'important');
    element.style.setProperty('visibility', 'visible', 'important');
    element.style.setProperty('opacity', '1', 'important');
    element.style.setProperty('pointerEvents', 'auto', 'important');
    element.disabled = false;
    element.removeAttribute('disabled');
    
    // 2. Dispatch a sequence of events
    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
      const event = new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        buttons: 1
      });
      element.dispatchEvent(event);
    });

    // 3. Native method call
    if (typeof element.click === 'function') {
      element.click();
    }

    // 4. Restoration timer (optional, but keeps UI stable)
    setTimeout(() => {
      Object.assign(element.style, originalStyles);
    }, 100);
  }

  // 2) MID STATE: click helper/state-advance button ONCE
  function clickGateHelperOnce() {
    const altBtn = document.querySelector('#alt');
    
    if (altBtn && !altBtn.dataset.clicked) {
      log('Clicking specific gate: #alt');
      altBtn.dataset.clicked = 'true';
      forceClick(altBtn);
      recordAction();
      return true;
    }

    const idBtn = document.querySelector('#btn6, #rtg-snp2');
    console.log(idBtn, 'idBtn');
    
    if (idBtn && !idBtn.dataset.clicked) {
      log('Clicking specific gate: #btn6 #rtg-snp2');
      idBtn.dataset.clicked = 'true';
      forceClick(idBtn);
      recordAction();
      return true;
    }

    const keywords = /(verify|human|start|next|continue|scroll\s*down|tab\s*scroll\s*down|get\s*link|get\s*started|get\s*started)/i;

    const helper = [...document.querySelectorAll('a,button,div')]
      .find(el => {
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
    forceClick(helper); // Use forceClick instead of helper.click()
    recordAction();
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
    const gatePatterns = /ad-container|blockcont|contntblock|closeis|ad-text|overlay|gcont/i;
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
   * LOOP CONTROL (sessionStorage)
   *****************************************************************/
  function checkLoop() {
    try {
      const data = JSON.parse(sessionStorage.getItem('bypassHelper_Loop') || '{}');
      const now = Date.now();
      const host = location.hostname;

      if (!data[host]) return true;

      const recentActions = data[host].filter(ts => (now - ts) < CONFIG.LOOP_WINDOW);
      
      if (recentActions.length >= CONFIG.LOOP_LIMIT) {
        log('Loop detected! Too many actions on this host recently. Pausing automation.');
        return false;
      }
      return true;
    } catch (e) {
      return true;
    }
  }

  function recordAction() {
    try {
      const data = JSON.parse(sessionStorage.getItem('bypassHelper_Loop') || '{}');
      const now = Date.now();
      const host = location.hostname;

      if (!data[host]) data[host] = [];
      data[host].push(now);
      
      // Cleanup old entries
      data[host] = data[host].filter(ts => (now - ts) < (CONFIG.LOOP_WINDOW * 2));
      
      sessionStorage.setItem('bypassHelper_Loop', JSON.stringify(data));
      actionCount++;
    } catch (e) {
      actionCount++;
    }
  }

  /*****************************************************************
   * EXECUTION LOOP (priority order)
   *****************************************************************/
  function stopAll(reason) {
    stopped = true;
    if (typeof observer !== 'undefined') observer.disconnect();
    if (typeof timer !== 'undefined') clearInterval(timer);
    log('Stopped:', reason);
  }

  function execute() {
    if (stopped) return;
    if (!checkLoop()) {
      stopAll('Execution paused to prevent infinite loop');
      return;
    }
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

  // Initial execution AFTER setup
  execute();

  /*****************************************************************
   * EVENT LISTENERS (Communication with shortcuts.js)
   *****************************************************************/
  window.addEventListener('bypassHelper:forceExecute', () => {
    log('Force bypass execution triggered via event');
    stopped = false;
    execute();
  });

})();
