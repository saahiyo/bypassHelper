# bypassHelper

A browser extension to automatically bypass link shorteners, block advertisements/trackers, and remove on-page annoyances.

## How It Works

The extension is built around a single content script (`content.js`) that is injected into all web pages. It operates in two main ways:

1.  **DOM Cleanup**: It removes unwanted visual elements from the page, such as popups, ad banners, and overlays, based on a list of CSS selectors.
2.  **Auto-Bypassing**: It identifies and automatically clicks "continue" or "get link" buttons on link shortener websites.

To handle dynamic websites, the extension uses a `MutationObserver` to react to changes on the page, with a `setInterval` as a fallback.

## Features

- 🚀 Automatic link shortener bypass (Get Link, SafeLink, RTG forms)
- 🛡️ Ad network blocking (DoubleClick, AdSense, Taboola, Outbrain, etc.)
- 🔓 Countdown timer and disabled button bypass
- 🧹 Overlay and popup removal
- 🔄 Loop prevention to avoid infinite action cycles
- 🐛 Toggleable debug logging
- ⌨️ Keyboard shortcuts (`Ctrl+Shift+B` / `Ctrl+Shift+T`)
- 🟢 Badge icon showing ON/OFF state

## Installation

To install this extension, you can load it as an unpacked extension in your browser.

**Chrome / Edge / Brave (Recommended):**
1.  Navigate to `chrome://extensions` (or `edge://extensions`).
2.  Enable "Developer mode".
3.  Click "Load unpacked".
4.  Select the directory containing this repository's files.

> **Note:** Firefox has limited Manifest V3 support and does not fully support `declarativeNetRequest`. The ad-blocking feature may not work on Firefox. Content script features (auto-bypass, overlay removal) should work.

**Firefox (Partial Support):**
1.  Navigate to `about:debugging`.
2.  Click "This Firefox".
3.  Click "Load Temporary Add-on...".
4.  Select the `manifest.json` file in this repository's directory.
