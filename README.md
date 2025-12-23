# bypassHelper

A browser extension to automatically bypass link shorteners, block advertisements/trackers, and remove on-page annoyances.

## How It Works

The extension is built around a single content script (`content.js`) that is injected into all web pages. It operates in three main ways:

1.  **Network Blocking**: It intercepts and blocks `fetch` and `XHR` requests to a predefined list of ad and tracker domains.
2.  **DOM Cleanup**: It removes unwanted visual elements from the page, such as popups, ad banners, and overlays, based on a list of CSS selectors.
3.  **Auto-Bypassing**: It identifies and automatically clicks "continue" or "get link" buttons on link shortener websites.

To handle dynamic websites, the extension uses a `MutationObserver` to react to changes on the page, with a `setInterval` as a fallback.

## Installation

To install this extension, you can load it as an unpacked extension in your browser.

**Chrome:**
1.  Navigate to `chrome://extensions`.
2.  Enable "Developer mode".
3.  Click "Load unpacked".
4.  Select the directory containing this repository's files.

**Firefox:**
1.  Navigate to `about:debugging`.
2.  Click "This Firefox".
3.  Click "Load Temporary Add-on...".
4.  Select the `manifest.json` file in this repository's directory.
