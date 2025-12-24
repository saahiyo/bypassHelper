# Supported Sites & Capabilities

## Overview

**bypassHelper** is a dynamic browser extension that automatically detects and bypasses various types of intermediate pages, link shorteners, and ad-based gateways across the web. Unlike traditional extensions that rely on hardcoded site lists, bypassHelper uses intelligent pattern detection to identify and handle gate mechanisms on virtually any website.

---

## How It Works

The extension automatically detects the following patterns on **any website** (except excluded domains):

### Detection Methods

1. **Countdown Timers**
   - Detects text patterns like "10 seconds", "wait 5 sec", etc.
   - Automatically bypasses or removes countdown delays

2. **Disabled Buttons**
   - Identifies disabled buttons that require waiting or interaction
   - Re-enables them for immediate access

3. **JavaScript Redirects**
   - Detects `location.href`, `window.open`, and `setTimeout` redirects
   - Intercepts and processes them automatically

4. **Overlays & Popups**
   - Identifies high z-index overlay elements (z-index > 999)
   - Removes blocking overlays and restores page scroll

5. **Gate Forms (SafeLink/RTG)**
   - Detects hidden form submissions used by link shorteners
   - Submits forms directly to skip intermediate steps

---

## Types of Sites Supported

### Link Shorteners
The extension can bypass various link shorteners including:
- URL shorteners with intermediate pages
- Ad-supported shorteners
- Multi-step redirect shorteners
- SafeLink and RTG-based systems

### File Download Pages
- Pages with countdown timers before download links appear
- Sites requiring button clicks to reveal download links
- Pages with overlay ads blocking download buttons

### Content Unlocks
- Sites that gate content behind "verify human" buttons
- Pages requiring multiple clicks to access content
- Sites with "wait X seconds" messages before content appears

### Ad-Filled Intermediate Pages
- Pages loaded with ads before redirecting to final destination
- Sites with overlay ads blocking navigation
- Pages with disabled buttons that become enabled after waiting

---

## Blocked Ad Networks

The extension automatically blocks resources from known ad networks:

| Ad Network | Domain |
|------------|--------|
| Google DoubleClick | `doubleclick.net` |
| Google AdSense | `googlesyndication.com` |

This blocking applies to:
- Scripts
- Images
- XMLHttpRequests
- Sub-frames (for DoubleClick)

---

## Excluded Sites

### Never Touch (Major Platforms)
The extension completely bypasses these major platforms to avoid interference:

- `google.com`
- `bing.com`
- `duckduckgo.com`
- `yahoo.com`
- `facebook.com`
- `twitter.com` / `x.com`
- `instagram.com`
- `youtube.com`
- `reddit.com`

### Excluded Link Shorteners
These specific shortener domains are excluded from automation:

- `arolinks.com`
- `urllinkshort.in`
- `shortxlinks.com`
- `nowshort.com`
- `inshorturl.com`
- `makelinks.in`

---

## Technical Capabilities

### Automated Actions
The extension performs these actions in priority order:

1. **Submit Gate Forms** - Submits hidden forms directly (bypasses button visibility)
2. **Click Helper Buttons** - Clicks "verify", "human", "start", "next", or "continue" buttons
3. **Unlock Disabled Buttons** - Re-enables all disabled buttons on the page
4. **Remove Overlays** - Removes high z-index overlays and restores scrolling

### Execution Limits
- Maximum actions per page: 5
- Detection threshold: 6 points (must meet certain criteria to act)
- Action interval: 900ms (prevents rapid-fire actions)

### Safety Features
- Won't interfere with navigation, header, footer, article, or main content elements
- Avoids clicking anchor links starting with `#`
- Skips elements with text longer than 60 characters
- Only interacts with elements that are visible in the DOM

---

## How to Use

1. **Install the Extension**
   - Load the extension in your browser (Chrome/Edge/Brave/etc.)

2. **Browse Normally**
   - The extension runs automatically in the background
   - No configuration needed

3. **Automatic Bypass**
   - When you encounter a link shortener or intermediate page
   - The extension detects the gate mechanism
   - Automatically bypasses it and takes you to the final destination

---

## Examples of Supported Scenarios

### Example 1: Link Shortener with Countdown
```
User clicks: https://short.xyz/abc123
↓
Extension detects: "Please wait 10 seconds..."
↓
Extension bypasses: Removes countdown, submits form
↓
User arrives: Final destination URL
```

### Example 2: File Download with Ad Overlay
```
User visits: https://download-site.com/file/123
↓
Extension detects: Overlay blocking download button
↓
Extension bypasses: Removes overlay, enables button
↓
User clicks: Download immediately available
```

### Example 3: Multi-Step Redirect
```
User clicks: Shortened link
↓
Extension detects: RTG/SafeLink form with hidden token
↓
Extension bypasses: Submits form directly
↓
User arrives: Final destination (skips intermediate page)
```

---

## Limitations

- Cannot bypass sites that require server-side verification (CAPTCHAs, etc.)
- Won't work on excluded domains listed above
- May not work on very complex custom gate implementations
- Some legitimate sites with countdowns may be affected (extension tries to be conservative)

---

## Version

Current version: 1.1.0

---

## Contributing

If you encounter sites that should be supported or have issues with specific sites, please report them. The extension is designed to be general-purpose and pattern-based, so improvements to detection logic benefit all users.
