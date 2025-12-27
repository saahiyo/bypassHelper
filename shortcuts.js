(() => {
  'use strict';

  const log = (...a) => console.log('[bypassHelper:shortcuts]', ...a);

  /*****************************************************************
   * KEYBOARD SHORTCUT HANDLER
   *****************************************************************/
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'goToBottom') {
      log('Keyboard shortcut triggered - forcing bypass execution');
      
      // Notify content.js to force execute
      window.dispatchEvent(new CustomEvent('bypassHelper:forceExecute'));

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
