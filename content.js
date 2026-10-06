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
    document.documentElement.dataset.bypassHelperEnabled = 'false';
    if (debugEnabled) console.log('[bypassHelper] Extension disabled via popup');
    return;
  }
  // Mirror the debug flag to a data-attr so the MAIN-world timerSpeedup (which
  // cannot read chrome.storage) can gate its own logging. Set before 'enabled'.
  document.documentElement.dataset.bypassHelperDebug = String(debugEnabled ?? false);
  document.documentElement.dataset.bypassHelperEnabled = 'true';

  const CONFIG = {
    DEBUG: debugEnabled ?? false,
    MAX_ACTIONS: 25,
    DETECTION_THRESHOLD: 2,
    ACTION_INTERVAL: 2000, // safety-net fallback (MutationObserver is primary)
    EXCLUDED_HOSTS: [],
    LOOP_LIMIT: 25,
    LOOP_WINDOW: 15000, // in ms (15 seconds)
    LOOP_PREVENTION_ENABLED: loopPreventionEnabled !== undefined ? loopPreventionEnabled : true,
    OVERLAY_Z_THRESHOLD: 999,
    MUTATION_DEBOUNCE: 300,
    ENGAGEMENT_WINDOW: 5000,
    CLICK_RESTORE_DELAY: 100,
    WARMUP_DELAY: 1000,
    CLICK_DELAY: 2000
  };

  // Guard against extension context invalidation (e.g. after extension reload/update)
  function isExtensionValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  
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
    document.documentElement.dataset.bypassHelperEnabled = 'false';
    log('Site disabled by user, exiting');
    return;
  }

  const currentHost = location.hostname.toLowerCase();
  const isExcluded = CONFIG.EXCLUDED_HOSTS.some(host => {
    const h = host.toLowerCase();
    return currentHost === h || currentHost.endsWith('.' + h);
  });

  if (isExcluded) {
    document.documentElement.dataset.bypassHelperEnabled = 'false';
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
        .some(e => /\d+\s*(sec|seconds|second|wait)/i.test(e.textContent) || (e.id && /time|count/i.test(e.id) && /\d+/.test(e.textContent)));
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
            return !isNaN(z) && z > CONFIG.OVERLAY_Z_THRESHOLD;
          }
          // Only call getComputedStyle if no inline z-index
          const z = parseInt(getComputedStyle(d).zIndex, 10);
          return !isNaN(z) && z > CONFIG.OVERLAY_Z_THRESHOLD;
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
          const isKnownId = el.id === 'btn6' || el.id === 'btn7' || el.id === 'btn1' || 
            el.id === 'startCountdownBtn' || el.id === 'cross-snp2' || el.id === 'get-link' || 
            el.id === 'link1s' || el.id === 'rtg-snp2' || el.id === 'getlink' || el.id === 'getlink1' || el.id === 'alt';
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
    if (actionCount > 0 && (Date.now() - lastActionAt) < CONFIG.ENGAGEMENT_WINDOW) {
      score += 3;
      gated = true;
    }

    // Check for visible action buttons
    if (detectors.actionButtons()) {
      score += 2;
      gated = true;
    }

    // Force gate if specific IDs exist (even if hidden)
    if (document.querySelector('#btn6, #btn7, #btn1, #startCountdownBtn, #cross-snp2, #get-link, #link1s, #rtg-snp2, #getlink, #getlink1, #alt')) {
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

  function isSecurityChallenge() {
    if (
      document.title.includes('Just a moment') || 
      document.title.includes('Just a second') || 
      document.title.includes('Checking your browser')
    ) {
      return true;
    }

    if (document.querySelector('.cf-browser-verification, .cf-turnstile, #turnstile-wrapper, #challenge-form')) {
      return true;
    }

    const scripts = document.scripts;
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src && (src.includes('cdn-cgi/challenge-platform/') || src.includes('recaptcha/api.js') || src.includes('hcaptcha.com/1/api.js'))) {
        return true;
      }
    }

    return !!(
      document.body &&
      (document.body.innerText.includes('Performing security verification') ||
       document.body.innerText.includes('Verify you are human'))
    );
  }

  /*****************************************************************
   * STATE-AWARE ACTIONS
   *****************************************************************/

  // -1) SUPREME PRIORITY: Bypass organic Google Search redirect traps (e.g. now.php with #wpsafe-time)
  function bypassOrganicSearchRedirect() {
    // Case 1: On now.php / wpsafe countdown page that attempts organic Google search redirection
    const wpsafeTime = document.getElementById('wpsafe-time');
    const isOrganicTrap = wpsafeTime || (window.location.pathname.includes('now.php') && window.location.search.includes('link='));
    if (isOrganicTrap && !document.documentElement.dataset.organicBypassed) {
      document.documentElement.dataset.organicBypassed = 'true';
      sessionStorage.setItem('bypassHelper_Organic', 'true');
      log('Detected organic Google redirect trap on:', window.location.href);
      // Directly fetch the site's homepage to grab the first post, avoiding Google CAPTCHA completely
      fetch(window.location.origin + '/')
        .then(res => res.text())
        .then(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const firstArticle = doc.querySelector('article a[href*="/20"], .post a[href*="/20"], h2.cm-entry-title a, h2.entry-title a, h2 a[href]');
          if (firstArticle && firstArticle.href) {
            log('Directly navigating to organic target article:', firstArticle.href);
            window.location.href = firstArticle.href;
          } else {
            window.location.href = window.location.origin + '/';
          }
        })
        .catch(() => {
          window.location.href = window.location.origin + '/';
        });
      return true;
    }

    // Case 2: Landing on blog homepage explicitly forwarded from an organic trap
    if (window.location.pathname === '/' || window.location.pathname === '') {
      if (sessionStorage.getItem('bypassHelper_Organic') === 'true') {
        const firstArticle = document.querySelector('article a[href*="/20"], .post a[href*="/20"], h2.cm-entry-title a, h2.entry-title a');
        if (firstArticle && firstArticle.href && !firstArticle.dataset.visited) {
          firstArticle.dataset.visited = 'true';
          sessionStorage.removeItem('bypassHelper_Organic');
          log('On blog landing page with active safelink cookie, navigating to first post:', firstArticle.href);
          window.location.href = firstArticle.href;
          return true;
        }
      }
    }
    return false;
  }

  // 0) HIGHEST PRIORITY: auto-redirect "Get Link" anchors to their href
  function autoRedirectGetLink() {
    // Match by id="get-link" or class containing "get-link" or direct link id
    const selectors = [
      'a#gt-link[href]',
      'a#gtelinkbtn[href]',
      'a#get-link[href]',
      'a.get-link[href]',
      'a[id*="get-link"][href]',
      'a[class*="get-link"][href]',
      'a#link1s[href]',
      'a[id^="link1"][href]'
    ];
    const candidateLinks = Array.from(document.querySelectorAll(selectors.join(',')));

    // Also check if an anchor wraps a "Get Link" / unlock button (e.g. <a id="link1s"><button id="get-link">Get Link</button></a>)
    const getLinkBtns = document.querySelectorAll('#get-link, #gt-link, button.get-link, button.btn-unlock, [id*="get-link" i]');
    for (const btn of getLinkBtns) {
      const a = btn.closest('a[href]') || btn.querySelector('a[href]');
      if (a && !candidateLinks.includes(a)) candidateLinks.push(a);
    }

    // Also check any anchor whose visible text is "Get Link"
    const allAnchors = document.querySelectorAll('a[href]');
    for (const a of allAnchors) {
      const text = (a.textContent || '').trim().toLowerCase();
      if ((text === 'get link' || text === 'go to link') && !text.includes('wait') && !candidateLinks.includes(a)) {
        candidateLinks.push(a);
      }
    }

    // Find the first valid, unlocked, non-javascript destination link
    const validLink = candidateLinks.find(link => {
      if (!link || !link.href || link.dataset.redirected) return false;
      const rawHref = link.getAttribute('href') || '';
      if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) return false;

      // If the link points to an external destination (e.g. t.me or different domain than the shortener),
      // it is the resolved destination link — even if visually hidden or marked disabled by a cosmetic timer!
      let isExternal = false;
      try {
        isExternal = new URL(link.href, window.location.href).hostname !== window.location.hostname;
      } catch { /* ignore */ }

      if (!isExternal) {
        if (link.classList.contains('disabled') || link.hasAttribute('disabled')) return false;
        if (link.style.display === 'none') return false;
      }

      const dest = link.href;
      if (dest === window.location.href || dest === window.location.href + '#') return false;
      return true;
    });

    if (validLink) {
      const dest = validLink.href;
      log('Auto-redirecting to Get Link destination:', dest);
      validLink.dataset.redirected = 'true';
      recordAction();
      window.location.href = dest;
      return true;
    }
    return false;
  }

  // Protect final external destination links against ad-hijacking scripts (e.g. wistfulseverely.com)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const rawHref = a.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#' || rawHref.startsWith('/')) return;

    // Never intercept elements that have custom JS onclick handlers
    if (a.hasAttribute('onclick') || a.querySelector('[onclick]')) return;

    let isExternal = false;
    try {
      isExternal = new URL(a.href, window.location.href).hostname !== window.location.hostname;
    } catch { return; }

    // Only protect recognized external destination links (e.g. #link1s, #gt-link, #get-link pointing to destination)
    if (isExternal && (a.id === 'link1s' || a.id === 'gt-link' || a.id === 'get-link' || a.classList.contains('get-link'))) {
      e.stopImmediatePropagation();
      e.preventDefault();
      log('Intercepted click on final external destination link, cleanly navigating to:', a.href);
      a.dataset.redirected = 'true';
      recordAction();
      window.location.href = a.href;
    }
  }, true);

  // 1) FINAL STATE: submit RTG/SafeLink form directly (button may be hidden)
  function submitSafeLinkFormOnce() {
    // 0. Warmup check: wait for page tokens/scripts to ready
    if (performance.now() < CONFIG.WARMUP_DELAY) {
      log('Waiting for page warmup...');
      return false;
    }

    // First priority: specifically look for RTG/SafeLink forms
    let form = document.querySelector("form#rtg, form#rtgForm, form[name='rtg'], form[id^='rtg']");

    const safeFormPatterns = [
      'wp-comments-post.php', 'contact-form',       // WordPress / contact
      '/login', '/signin', '/auth', '/register',     // Authentication
      '/search', '?q=', '?query=',                   // Search
      '/checkout', '/payment', '/billing', '/donate', // Payment
      '/subscribe', '/newsletter', '/signup',         // Newsletter / signup
      'links/go', 'go-link'                           // Server-validated timer forms
    ];

    // Fallback: look for other POST forms with hidden tokens, excluding known safe forms
    if (!form) {
      const allForms = Array.from(document.querySelectorAll("form[action][method='post']"));
      form = allForms.find(f => {
        const action = (f.getAttribute('action') || f.action || '').toLowerCase();
        const formId = (f.id || '').toLowerCase();
        if (formId.includes('go-link') || safeFormPatterns.some(p => action.includes(p))) return false;
        return !!f.querySelector("input[type='hidden']");
      });
    }

    if (!form) return false;

    // Fallback: If we clicked the submit button on a previous tick but are still on this page,
    // the page script likely intercepted and prevented the submit event. Submit directly.
    if (form.dataset.bypassHelperSubmitted === 'clicked') {
      log('Click did not navigate, performing direct programmatic form submission as fallback:', form.action);
      form.dataset.bypassHelperSubmitted = 'submitted';
      try {
        HTMLFormElement.prototype.submit.call(form);
      } catch (e) {
        log('Direct submission fallback failed:', e);
      }
      recordAction();
      return true;
    }

    if (form.dataset.bypassHelperSubmitted === 'submitted') return false;

    // Don't submit forms that are inside hidden containers (e.g. #rtg-btn1 with display:none)
    // They become visible only after a prior gate step is completed
    const hiddenParent = form.closest('[style*="display: none"], [style*="display:none"]');
    if (hiddenParent) {
      log('Form found but inside hidden container, skipping:', hiddenParent.id || 'unknown');
      return false;
    }

    const hasHiddenToken = !!form.querySelector("input[type='hidden']");
    if (!hasHiddenToken) return false;

    // Try to find the submit button first
    const sub = form.querySelector('button, input[type="submit"]');
    
    // If specific "Get Link" style text is found in the button, prioritize it
    // helpful for forms that have multiple buttons
    
    if (sub) {
      log('Found submit button, clicking it:', form.action);
      form.dataset.bypassHelperSubmitted = 'clicked';
      forceClick(sub);
      recordAction();
      return true;
    }

    // Fallback: requestSubmit() triggers event listeners (standard behavior)
    log('No submit button found, using requestSubmit:', form.action);
    form.dataset.bypassHelperSubmitted = 'submitted';
    
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
    element.style.setProperty('pointer-events', 'auto', 'important');
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

    // 3. If element is an anchor or has an anchor parent/child, prevent opening in new tabs that lose session
    const anchor = element.tagName === 'A' ? element : element.closest('a') || element.querySelector('a');
    if (anchor) {
      if (anchor.getAttribute('target') === '_blank') {
        anchor.removeAttribute('target');
      }
    }

    // 4. Native method call
    if (typeof element.click === 'function') {
      element.click();
    }
    if (anchor && anchor !== element && typeof anchor.click === 'function') {
      anchor.click();
    }

    // 5. If it's a direct navigation link and hasn't navigated, follow href
    if (anchor && anchor.href && !anchor.href.startsWith('javascript:') && !anchor.href.includes('#')) {
      const dest = anchor.href;
      setTimeout(() => {
        if (!stopped && window.location.href !== dest) {
          log('Anchor click did not navigate, following href:', dest);
          window.location.href = dest;
        }
      }, 300);
    }

    // 6. Restoration timer (optional, but keeps UI stable)
    setTimeout(() => {
      if (stopped) return;
      Object.assign(element.style, originalStyles);
    }, CONFIG.CLICK_RESTORE_DELAY);
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

    // Look for specific gate buttons by ID or class (find the first visible/uncompleted one)
    const gateIdSelectors = '#btn6, #btn7, #btn1, #startCountdownBtn, #cross-snp2, #get-link, #link1s, #rtg-snp2, #rtg-snp21, button.bt-success, button.btn-success, .btn.bt-success, button.button, #getlink, #getlink1, #ga, #gi, #notarobot, #ProFooterAdClose, #ProStickyAdClose, [id*="snp"], [id*="countdown" i], [class*="countdown-btn" i]';
    const idBtnCandidates = Array.from(document.querySelectorAll(gateIdSelectors));
    const multiTapIds = ['getlink', 'getlink1', 'btn6', 'btn7', 'btn1', 'startCountdownBtn', 'cross-snp2', 'get-link', 'rtg-snp2', 'rtg-snp21'];

    let idBtn = idBtnCandidates.find(el => {
      if (el.dataset.finalClicked === 'true') return false;
      const isHidden = el.style.display === 'none' || (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0);
      if (isHidden) return false;

      const btnId = el.id || '';
      const isMultiTap = multiTapIds.includes(btnId) || btnId.startsWith('rtg-snp') || btnId.includes('snp');

      // If already clicked:
      if (el.dataset.clicked === 'true') {
        if (!isMultiTap) return false;
        const text = (el.textContent || '').toLowerCase();

        // For getlink / getlink1: allow clicking again if downstream container is still hidden
        if (btnId === 'getlink1' || btnId === 'getlink') {
          const nextContainer = document.querySelector('#rtg-btn1, #rtg-snp21, #rtg-snp2, form#rtg');
          const isNextVisible = nextContainer && window.getComputedStyle(nextContainer).display !== 'none';
          if (isNextVisible) return false;
        } else if (el.dataset.lastText === text) {
          return false;
        }
      }
      return true;
    });

    // Also look for buttons by class (e.g. "GO TO LINK - CLICK OPEN" with class .bt-success)
    if (!idBtn) {
      const classBtn = document.querySelector('button.bt-success, button.btn-success, .btn.bt-success, button.button');
      if (classBtn) {
        const isHidden = classBtn.style.display === 'none' || (classBtn.offsetParent === null && classBtn.offsetWidth === 0 && classBtn.offsetHeight === 0);
        if (!isHidden && classBtn.dataset.finalClicked !== 'true') {
          idBtn = classBtn;
        }
      }
    }
    
    if (idBtn) {
      // If we matched a container DIV (like #rtg-snp21), drill down to find the actual button inside
      if (idBtn.tagName === 'DIV' || idBtn.tagName === 'SECTION') {
        const innerBtn = idBtn.querySelector('button, a, input[type="submit"]');
        if (innerBtn) {
          log('Found container', '#' + idBtn.id, '- drilling down to inner button');
          // Check if inner button's container is visible
          const hiddenParent = innerBtn.closest('[style*="display: none"], [style*="display:none"]');
          if (hiddenParent) {
            log('Inner button is hidden, skipping');
            return false;
          }
          idBtn = innerBtn;
        }
      }

      const btnId = idBtn.id || '';
      const isMultiTap = multiTapIds.includes(btnId) || btnId.startsWith('rtg-snp') || btnId.includes('snp');
      const btnText = (idBtn.textContent || '').toLowerCase();
      
      // 1. Skip if already finished
      if (idBtn.dataset.finalClicked === 'true') return false;

      // 2. Skip if "wait" state is active (timer is running)
      if (btnText.includes('wait')) return false;

      // 3. Handle clicking
      if (idBtn.dataset.clicked === 'true') {
        if (!isMultiTap) return false;
        
        // For multi-tap, only click again if the text changed from the previous click
        if (idBtn.dataset.lastText === btnText) return false;
        
        log('Multi-tap button state changed, clicking again:', '#' + idBtn.id || idBtn.className);
        idBtn.dataset.finalClicked = 'true'; 
      }

      log('Clicking specific gate:', '#' + (idBtn.id || idBtn.className), isMultiTap ? '(Multi-tap sequence)' : '');
      idBtn.dataset.clicked = 'true';
      idBtn.dataset.lastText = btnText;
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
        const text = (el.textContent || '').trim();
        if (text.length > 60) return false;

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

    // Click keyword-based gate button directly
    log('Clicking keyword-matched button:', helper.textContent.trim().substring(0, 30));
    helper.dataset.clicked = 'true';
    forceClick(helper);
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
    document.querySelectorAll('div, section, aside').forEach(d => {
      // Skip legitimate UI elements to avoid breaking normal websites
      if (d.closest('nav, header, footer, [role="dialog"], [role="navigation"], [role="banner"]')) return;
      if (d.closest('[class*="cookie"], [class*="consent"], [id*="cookie"], [id*="consent"]')) return;
      // Skip very small elements (likely tooltips/dropdowns, not full-page overlays)
      if (d.offsetWidth < 100 || d.offsetHeight < 100) return;

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
        if (!isNaN(z) && z > CONFIG.OVERLAY_Z_THRESHOLD) {
          log('Removing overlay element:', d.className, d.id);
          d.remove();
          return;
        }
      }

      const z = parseInt(getComputedStyle(d).zIndex, 10);
      if (!isNaN(z) && z > CONFIG.OVERLAY_Z_THRESHOLD) {
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
    } catch {
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
    } catch {
      actionCount++;
    }

    // Track bypass stats for popup display
    updateStats();
  }

  function updateStats() {
    if (!isExtensionValid()) return;
    try {
      chrome.storage.local.get('bypassStats', (result) => {
        const stats = result.bypassStats || { total: 0, today: 0, date: '' };
        const today = new Date().toISOString().slice(0, 10);
        if (stats.date !== today) {
          stats.today = 0;
          stats.date = today;
        }
        stats.total++;
        stats.today++;
        chrome.storage.local.set({ bypassStats: stats });
      });
    } catch (e) {
      log('Stats update failed:', e);
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
    document.documentElement.dataset.bypassHelperEnabled = 'false';
    log('Stopped:', reason);
  }

  function execute() {
    if (stopped || executing) return;
    executing = true;

    if (isSecurityChallenge()) {
      document.documentElement.dataset.bypassHelperEnabled = 'false';
      log('Security challenge detected, suspending timer speedup');
      // We don't stopAll here because the challenge might resolve and we might want to resume 
      // on the next page, but we definitely stop the current execution loop.
      executing = false;
      return; 
    }

    try {
      if (!checkLoop()) {
        stopAll('Execution paused to prevent infinite loop');
        return;
      }

      // Supreme priority: bypass organic Google redirect traps without triggering CAPTCHAs
      if (bypassOrganicSearchRedirect()) {
        stopAll('Bypassing organic Google redirect trap');
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
      }, CONFIG.MUTATION_DEBOUNCE);
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
    document.documentElement.dataset.bypassHelperEnabled = 'true';
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
   * EVENT LISTENERS (Communication with shortcuts.js & popup)
   *****************************************************************/
  window.addEventListener('bypassHelper:forceExecute', () => {
    log('Force bypass execution triggered via event');
    startAll('Force execute');
  });

  // Listen for force-bypass command from popup
  if (isExtensionValid()) {
    try {
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!isExtensionValid()) return;
        if (request.action === 'forceBypass') {
          log('Force bypass triggered from popup');
          stopped = false;
          actionCount = 0;
          executing = false;
          startAll('Force bypass from popup');
          sendResponse({ success: true });
        }
        return true;
      });
    } catch (e) {
      log('Failed to register message listener:', e);
    }
  }

  /*****************************************************************
   * LIVE TOGGLES (wrapped for context invalidation safety)
   *****************************************************************/
  if (isExtensionValid()) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isExtensionValid()) return;
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
          document.documentElement.dataset.bypassHelperDebug = String(CONFIG.DEBUG);
          log('Debug mode updated:', CONFIG.DEBUG);
        }
      });
    } catch (e) {
      log('Failed to register storage listener:', e);
    }
  }

})();
