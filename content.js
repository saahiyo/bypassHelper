(async () => {
  'use strict';

  /*****************************************************************
   * CONFIG
   *****************************************************************/
  
  // Check if extension is enabled
  const { extensionEnabled, loopPreventionEnabled, debugEnabled } = await chrome.storage.local.get([
    'extensionEnabled', 'loopPreventionEnabled', 'debugEnabled'
  ]);
  if (extensionEnabled === false) {
    console.log('[bypassHelper] Extension disabled via popup');
    return;
  }

  const CONFIG = {
    DEBUG: debugEnabled ?? false,
    MAX_ACTIONS: 5,
    DETECTION_THRESHOLD: 2,
    ACTION_INTERVAL: 900,
    EXCLUDED_HOSTS: [],
    LOOP_LIMIT: 10, // max actions (relaxed)
    LOOP_WINDOW: 10000, // in ms (10 seconds)
    LOOP_PREVENTION_ENABLED: loopPreventionEnabled !== undefined ? loopPreventionEnabled : true
  };

  
  // Hoisted regexes (avoid re-compilation per call)
  const KEYWORDS_RE = /(verify|human|start|next|continue|scroll\s*down|tab\s*scroll\s*down|get\s*link|get\s*started|go\s*to\s*link|dual\s*tap)/i;
  const GATE_PATTERNS_RE = /ad-container|blockcont|contntblock|closeis|ad-text|overlay|gcont/i;
  
  const log = (...a) => CONFIG.DEBUG && console.log('[bypassHelper]', ...a);
  
  log('Extension enabled:', extensionEnabled);

  // Load excluded hosts from storage (populated by background.js on install)
  try {
    const cached = await chrome.storage.local.get('cachedExcludedHosts');
    if (cached.cachedExcludedHosts) {
      CONFIG.EXCLUDED_HOSTS = cached.cachedExcludedHosts;
    }
  } catch (err) {
    log('Error loading excluded hosts:', err);
  }

  // Load user-excluded sites (added via popup "Disable on this site" button)
  let userExcludedSites = [];
  try {
    const userData = await chrome.storage.local.get('userExcludedSites');
    if (userData.userExcludedSites) {
      userExcludedSites = userData.userExcludedSites;
    }
  } catch (err) {
    log('Error loading user-excluded sites:', err);
  }

  // Check user-excluded sites first (exact hostname match)
  if (userExcludedSites.includes(location.hostname)) {
    log('Site disabled by user, exiting');
    return;
  }

  // Pre-compile built-in excluded host regexes once
  const excludedRegexes = CONFIG.EXCLUDED_HOSTS.map(pattern => {
    const regexSource = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape all regex chars
      .replace(/\\\*/g, '.*'); // turn escaped \* back to .*
    return new RegExp(`${regexSource}$`, 'i');
  });

  const isExcluded = excludedRegexes.some(re => re.test(location.hostname));

  if (isExcluded) {
    log('Excluded host, exiting');
    return;
  }

  let actionCount = 0;
  let lastActionAt = 0;
  let stopped = false;
  let executing = false; // execution lock to prevent double-runs
  let observer = null;
  let timer = null;
  let mutationTimer = null;

  /*****************************************************************
   * DETECTORS (gate presence)
   *****************************************************************/
  const detectors = {
    countdown() {
      return [...document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, li, td, label, strong, em, b, i, a, button')]
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
          // Check inline style first (cheap) before falling back to getComputedStyle (expensive)
          const inlineZ = d.style.zIndex;
          if (inlineZ) {
            const z = parseInt(inlineZ, 10);
            return !isNaN(z) && z > 999;
          }
          // Only call getComputedStyle if no inline z-index
          const z = parseInt(getComputedStyle(d).zIndex, 10);
          return !isNaN(z) && z > 999;
        });
    },
    knownGates() {
      return [...document.querySelectorAll('div, section, aside')]
        .some(el => GATE_PATTERNS_RE.test(el.className) || GATE_PATTERNS_RE.test(el.id));
    },
    actionButtons() {
      return [...document.querySelectorAll('a,button,div')]
        .some(el => {
          // Relaxed visibility check for known IDs or if it's high priority
          const isKnownId = el.id === 'btn6' || el.id === 'rtg-snp2' || el.id === 'alt';
          return (el.offsetParent || isKnownId) && KEYWORDS_RE.test(el.textContent);
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

    // Retain engagement only briefly after acting (avoid forcing gate forever)
    if (actionCount > 0 && (Date.now() - lastActionAt) < 5000) {
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

  // 0) HIGHEST PRIORITY: auto-redirect "Get Link" anchors to their href
  function autoRedirectGetLink() {
    // Match by id="get-link" or class containing "get-link"
    const selectors = [
      'a#gtelinkbtn[href]',
      'a#get-link[href]',
      'a.get-link[href]',
      'a[id*="get-link"][href]',
      'a[class*="get-link"][href]'
    ];
    const link = document.querySelector(selectors.join(','));

    if (link && link.href && !link.dataset.redirected) {
      const dest = link.href;
      // Avoid redirecting to same page or empty/javascript links
      if (
        dest &&
        !dest.startsWith('javascript:') &&
        dest !== window.location.href &&
        dest !== window.location.href + '#'
      ) {
        log('Auto-redirecting to Get Link destination:', dest);
        link.dataset.redirected = 'true';
        recordAction();
        window.location.href = dest;
        return true;
      }
    }
    return false;
  }

  // 1) FINAL STATE: submit RTG/SafeLink form directly (button may be hidden)
  function submitSafeLinkFormOnce() {
    // 0. Warmup check: wait 3 seconds for page tokens/scripts to ready
    if (performance.now() < 3000) {
      log('Waiting for page warmup...');
      return false;
    }

    const form = document.querySelector(
      "form#rtgForm, form[name='rtg'], form[action][method='post']"
    );
    if (!form || form.dataset.submitted) return false;

    // Filter out common non-gate forms (like WordPress comments)
    const action = form.getAttribute('action') || '';
    if (action.includes('wp-comments-post.php') || action.includes('contact-form')) return false;
    
    // User requested exclusion for this specific path
    if (action.includes('links/go')) return false;

    const hasHiddenToken = !!form.querySelector("input[type='hidden']");
    if (!hasHiddenToken) return false;

    // Try to find the submit button first
    const sub = form.querySelector('button[type="submit"], input[type="submit"]');
    
    // If specific "Get Link" style text is found in the button, prioritize it
    // helpful for forms that have multiple buttons
    
    if (sub) {
      log('Found submit button, clicking it:', form.action);
      form.dataset.submitted = 'true';
      forceClick(sub);
      recordAction();
      return true;
    }

    // Fallback: requestSubmit() triggers event listeners (standard behavior)
    log('No submit button found, using requestSubmit:', form.action);
    form.dataset.submitted = 'true';
    
    try {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        // Absolute fallback
        HTMLFormElement.prototype.submit.call(form);
      }
    } catch (e) {
      log('Submission failed:', e);
      // Last resort
      HTMLFormElement.prototype.submit.call(form);
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
    const CLICK_DELAY = 2000; // 2 seconds delay
    
    // Helper for delayed clicks
    const scheduleClick = (el, desc) => {
      log(`Scheduling click for ${desc} in ${CLICK_DELAY}ms`);
      el.dataset.clicked = 'true';
      setTimeout(() => {
        if (stopped) return;
        forceClick(el);
        recordAction();
      }, CLICK_DELAY);
    };

    const altBtn = document.querySelector('#alt');
    
    if (altBtn && !altBtn.dataset.clicked) {
      log('Clicking specific gate: #alt');
      altBtn.dataset.clicked = 'true';
      forceClick(altBtn);
      recordAction();
      return true;
    }

    const idBtn = document.querySelector(
      '#btn6, #rtg-snp2, #bt-success, #getlink1, #ga, #gi, #notarobot, #ProFooterAdClose, #ProStickyAdClose'
    );
    
    if (idBtn && !idBtn.dataset.clicked) {
      log('Clicking specific gate:', '#' + idBtn.id);
      idBtn.dataset.clicked = 'true';
      forceClick(idBtn);
      recordAction();
      return true;
    }

    const keywords = KEYWORDS_RE;

    const candidates = [...document.querySelectorAll('a,button,div')]
      .filter(el => {
        if (el.dataset.clicked) return false;
        if (!keywords.test(el.textContent || '')) return false;

        // avoid nav/footer (allow main/article as content often lives there)
        if (el.closest('nav,header,footer,h1,h2,h3,h4,h5,h6')) return false;
        if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('#')) return false;
        if ((el.textContent || '').length > 20) return false;

        return true;
      });

    let helper = candidates[0];

    // Priority logic: if 'verify' and 'continue' coexist, click 'continue'
    const hasVerify = candidates.some(el => /verify/i.test(el.textContent));
    const hasContinue = candidates.some(el => /continue/i.test(el.textContent));

    if (hasVerify && hasContinue) {
      log('Both Verify and Continue found, prioritizing Continue');
      helper = candidates.find(el => /continue/i.test(el.textContent));
    }

    if (!helper) return false;

    // Apply delay for these keyword-based buttons
    scheduleClick(helper, helper.textContent.trim().substring(0, 15));
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
    document.querySelectorAll('div, section, aside').forEach(d => {
      const isKnownGate = GATE_PATTERNS_RE.test(d.className) || GATE_PATTERNS_RE.test(d.id);
      
      if (isKnownGate) {
        log('Removing overlay element:', d.className, d.id);
        d.remove();
        return;
      }

      // Check inline z-index first (cheap) before getComputedStyle (expensive)
      const inlineZ = d.style.zIndex;
      if (inlineZ) {
        const z = parseInt(inlineZ, 10);
        if (!isNaN(z) && z > 999) {
          log('Removing overlay element:', d.className, d.id);
          d.remove();
          return;
        }
      }

      const z = parseInt(getComputedStyle(d).zIndex, 10);
      if (!isNaN(z) && z > 999) {
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
    if (!CONFIG.LOOP_PREVENTION_ENABLED) return true;

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
      lastActionAt = now;
      
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
    if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }
    if (observer) { observer.disconnect(); observer = null; }
    if (timer) { clearInterval(timer); timer = null; }
    log('Stopped:', reason);
  }

  function execute() {
    if (stopped || executing) return;
    executing = true;

    try {
      if (!checkLoop()) {
        stopAll('Execution paused to prevent infinite loop');
        return;
      }

      // Highest priority: auto-redirect Get Link anchors (runs before gate detection)
      if (autoRedirectGetLink()) {
        stopAll('Auto-redirected to Get Link destination');
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
    } finally {
      executing = false;
    }
  }

  function startAll(reason) {
    if (!stopped && observer && timer) return;
    stopped = false;
    if (mutationTimer) { clearTimeout(mutationTimer); mutationTimer = null; }

    observer = new MutationObserver(() => {
      if (stopped || mutationTimer) return;
      mutationTimer = setTimeout(() => {
        mutationTimer = null;
        if (!stopped) execute();
      }, 300);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributeFilter: ['disabled', 'style', 'class', 'href'] // only watch relevant attributes
    });

    timer = setInterval(() => {
      if (!stopped) execute();
      else if (timer) { clearInterval(timer); timer = null; }
    }, CONFIG.ACTION_INTERVAL);

    log('Started:', reason);
    execute();
  }

  /*****************************************************************
   * BOOTSTRAP — wait for DOM before first execution
   *****************************************************************/
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startAll('Initial load'));
  } else {
    startAll('Initial load');
  }

  /*****************************************************************
   * EVENT LISTENERS (Communication with shortcuts.js)
   *****************************************************************/
  window.addEventListener('bypassHelper:forceExecute', () => {
    log('Force bypass execution triggered via event');
    startAll('Force execute');
  });

  /*****************************************************************
   * LIVE TOGGLES
   *****************************************************************/
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (Object.prototype.hasOwnProperty.call(changes, 'extensionEnabled')) {
      const enabled = changes.extensionEnabled.newValue;
      if (enabled === false) stopAll('Disabled via popup');
      else startAll('Enabled via popup');
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'loopPreventionEnabled')) {
      const enabled = changes.loopPreventionEnabled.newValue;
      CONFIG.LOOP_PREVENTION_ENABLED = enabled !== undefined ? enabled : true;
      log('Loop prevention updated:', CONFIG.LOOP_PREVENTION_ENABLED);
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'debugEnabled')) {
      CONFIG.DEBUG = changes.debugEnabled.newValue ?? false;
      log('Debug mode updated:', CONFIG.DEBUG);
    }
  });

})();
