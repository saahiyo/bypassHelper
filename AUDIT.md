# bypassHelper — Code Audit

Scope: `content.js`, `background.js`, `popup.js`, `timerSpeedup.js`, `shortcuts.js`, `manifest.json`, docs.

## Fixed in this pass

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `content.js` (`forceClick`) | `setProperty('pointerEvents', …)` is a silent no-op — `setProperty` requires the CSS name `pointer-events`, so gate buttons were never actually made clickable via this path. | Use `'pointer-events'`. |
| 2 | `background.js` | `contextMenus.create` ran on every `onInstalled`, which also fires on **update/reload** → "duplicate id" runtime error each update. | Wrap in `contextMenus.removeAll(() => create(...))`. |
| 3 | `README.md`, `SUPPORTED_SITES.md` | Documented `Ctrl+Shift+B/T`, but the manifest binds `Ctrl/Cmd+Down` and `Ctrl/Cmd+Up`; no Shift bindings exist. | Docs now match manifest. |

Tooling added: `package.json`, `eslint.config.mjs` (flat config, webext globals), `test/regression.test.js` (Node built-in runner, zero deps). `npm run lint` → 0 errors. `npm test` → 5/5 pass.

## Open issues (need a decision — not auto-fixed)

1. **Two different host-exclusion matchers.** `content.js` builds `/pattern$/i` from `excluded_hosts.txt`, which is unanchored at the front — `google.com` also matches `evilgoogle.com`. `timerSpeedup.js` uses the correct `host === h || host.endsWith('.'+h)`. Recommend unifying on the `endsWith` form. Low risk today (over-exclusion just disables the extension) but surprising.

2. **Duplicated exclusion list.** `timerSpeedup.js` hardcodes the "major platforms" block because MAIN-world scripts can't read `chrome.storage`. It's currently in sync with `excluded_hosts.txt`, but there's no guard against drift. Options: generate one from the other at build time, or add a test asserting they match.

3. **Full-DOM `getComputedStyle` scans.** `detectors.overlays()` and `removeOverlays()` iterate every `div` and can call `getComputedStyle` per element, on every mutation-debounce tick. On large pages this is costly. The inline-z fast path helps; consider bailing after N nodes or scoping to likely containers.

4. **Multi-tap caps at two clicks.** In `clickGateHelperOnce`, `dataset.finalClicked` is set before the second click, so a gate needing 3+ state advances via the same button won't complete. Confirm whether any supported site needs >2.

5. **`isSecurityChallenge` reads `document.body.innerText`** every `execute()` — forces layout. Cheap checks (title, selectors) already precede it; consider gating the innerText read behind those.

6. **`popup.js` `statsInterval`** is created but never cleared (ESLint warning). Benign — the popup context is destroyed on close — but flagged for awareness.

## Notes
- `.gitignore` was added (ignores `node_modules/`).
- The working tree had pre-existing uncommitted changes reverting the ad-click blur/focus simulation; those were left untouched. No commits were made.
