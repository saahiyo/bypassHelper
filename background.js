// background.js - Service worker for handling keyboard shortcuts

chrome.commands.onCommand.addListener((command) => {
  if (command === 'go-to-bottom') {
    // Query all tabs and send message to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'goToBottom' })
          .catch(err => {
            console.log('Could not send message to content script:', err);
          });
      }
    });
  } else if (command === 'go-to-top') {
    // Query all tabs and send message to the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'goToTop' })
          .catch(err => {
            console.log('Could not send message to content script:', err);
          });
      }
    });
  }
});
