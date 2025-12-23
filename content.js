(() => {
  'use strict';

  /*****************************************************************
   * CONFIG
   *****************************************************************/
  const CONFIG = {
    DEBUG: true,
    MAX_ACTIONS: 15,
    DETECTION_THRESHOLD: 6,
    ACTION_INTERVAL: 900,
    EXCLUDED_HOSTS: [
      'arolinks.com',
      'urllinkshort.in',
      'shortxlinks.com',
      'nowshort.com'
    ]
  };

  const NEVER_TOUCH_HOSTS = [
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
];

if (NEVER_TOUCH_HOSTS.some(h => location.hostname.includes(h))) {
  return;
}

  const log = (...a) => CONFIG.DEBUG && console.log('[bypassHelper]', ...a);

  if (CONFIG.EXCLUDED_HOSTS.some(h => location.hostname.endsWith(h))) {
    log('Excluded host, exiting');
    return;
  }

  let actionCount = 0;
  let stopped = false;

  /*****************************************************************
   * SHORTENER DETECTION
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
    suspiciousUrl() {
      return location.search.length > 40;
    }
  };

  function detectShortener() {
    let score = 0;
    if (detectors.countdown()) score += 3;
    if (detectors.disabledButtons()) score += 3;
    if (detectors.jsRedirectHints()) score += 4;
    if (detectors.overlays()) score += 2;
    if (detectors.suspiciousUrl()) score += 1;
    log('Detection score:', score);
    return score >= CONFIG.DETECTION_THRESHOLD;
  }

  /*****************************************************************
   * STRATEGIES
   *****************************************************************/
  const strategies = [
    function unlockButtons() {
      document.querySelectorAll('button:disabled').forEach(b => {
        b.disabled = false;
        b.style.opacity = '1';
      });
    },

    function removeOverlays() {
      document.querySelectorAll('div').forEach(d => {
        const z = parseInt(getComputedStyle(d).zIndex, 10);
        if (!isNaN(z) && z > 999) d.remove();
      });
      if (document.body) document.body.style.overflow = 'auto';
    },

    function clickPrimaryButtons() {
      const keywords = /(get|continue|proceed|skip|link|next)/i;
      document.querySelectorAll('a,button').forEach(el => {
        if (
          keywords.test(el.textContent || '') &&
          el.offsetParent &&
          !el.dataset.bypassed &&
          actionCount < CONFIG.MAX_ACTIONS
        ) {
          el.dataset.bypassed = '1';
          log('Click:', el.textContent.trim());
          el.click();
          actionCount++;
        }
      });
    }
  ];

  /*****************************************************************
   * EXECUTION LOOP
   *****************************************************************/
  function execute() {
    if (stopped) return;
    if (!detectShortener()) return;

    strategies.forEach(fn => fn());

    if (actionCount >= CONFIG.MAX_ACTIONS) {
      stopped = true;
      observer.disconnect();
      clearInterval(timer);
      log('Max actions reached, stopping');
    }
  }

  execute();

  const observer = new MutationObserver(() => {
    if (!stopped) execute();
    else observer.disconnect();
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

})();