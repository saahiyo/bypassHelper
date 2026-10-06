# bypassHelper — Code Audit

Scope: `content.js`, `background.js`, `popup.js`, `timerSpeedup.js`, `shortcuts.js`, `manifest.json`, docs.

## Fixed in this pass

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `content.js` (`forceClick`) | `setProperty('pointerEvents', …)` is a silent no-op — `setProperty` requires the CSS name `pointer-events`, so gate buttons were never actually made clickable via this path. | Use `'pointer-events'`. |
| 2 | `background.js` | `contextMenus.create` ran on every `onInstalled`, which also fires on **update/reload** → "duplicate id" runtime error each update. | Wrap in `contextMenus.removeAll(() => create(...))`. |
| 3 | `README.md`, `SUPPORTED_SITES.md` | Documented `Ctrl+Shift+B/T`, but the manifest binds `Ctrl/Cmd+Down` and `Ctrl/Cmd+Up`; no Shift bindings exist. | Docs now match manifest. |
| F-01 | `content.js` | Two different host-exclusion matchers. `content.js` built unanchored regexes (`evilgoogle.com` matching `google.com`). | Unified on exact match and subdomain `.endsWith('.' + host)` form. |
| F-02 | `test/regression.test.js` | Duplicated exclusion list in `timerSpeedup.js` had no guard against drift from `excluded_hosts.txt`. | Added automated drift guard test verifying list synchronization. |
| F-03 | `background.js`, `content.js`, `popup.js` | ESLint warnings for unused catch variables and uncleared `statsInterval` in `popup.js`. | Used optional catch bindings and registered `unload` listener to clear `statsInterval`. |
| F-04 | `content.js` | Layout thrashing in `isSecurityChallenge()`: read `document.body.innerText` on each run before fast selectors. | Prioritized cheap title, selector, and script tag checks before innerText fallback. |
| F-05 | `content.js` | Shorteners like `arolinks.com` failed to navigate multi-step gates due to `target="_blank"`, missing button IDs (`#btn7`, `#btn1`, `#gt-link`), and getting trapped on completed/hidden IDs. | Stripped `target="_blank"`, prioritized actionable uncompleted elements, added `#btn7`/`#btn1`/`#gt-link`, and bumped `MAX_ACTIONS` to 10. |

Tooling: `package.json`, `eslint.config.mjs` (flat config, webext globals), `test/regression.test.js` (Node built-in runner, zero deps). `npm run lint` → 0 errors, 0 warnings. `npm test` → 9/9 pass.

## Open issues (need a decision — manual-only)

1. **Full-DOM `getComputedStyle` scans (F-05).** `detectors.overlays()` and `removeOverlays()` iterate every `div` and can call `getComputedStyle` per element, on every mutation-debounce tick. On large pages this is costly. The inline-z fast path helps; consider bailing after N nodes or scoping to likely containers.

2. **Multi-tap caps at two clicks (F-06).** In `clickGateHelperOnce`, `dataset.finalClicked` is set before the second click, so a gate needing 3+ state advances via the same button won't complete. Confirm whether any supported site needs >2.

## Notes
- `.gitignore` ignores `node_modules/`.
- All fixes verified with `npm test` and `npm run lint`.
