'use strict';
// Lightweight source-level regression guards for previously-fixed bugs.
// No DOM/browser deps — asserts on source text so it runs anywhere via `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('forceClick uses the CSS property name "pointer-events" (setProperty requires kebab-case)', () => {
  const src = read('content.js');
  assert.ok(
    src.includes(`setProperty('pointer-events'`),
    'pointer-events must use kebab-case or setProperty silently no-ops'
  );
  assert.ok(
    !src.includes(`setProperty('pointerEvents'`),
    'camelCase pointerEvents in setProperty is a silent no-op'
  );
});

test('context menu creation is guarded by removeAll (no duplicate-id throw on update)', () => {
  const src = read('background.js');
  const removeAllIdx = src.indexOf('contextMenus.removeAll');
  const createIdx = src.indexOf('contextMenus.create');
  assert.ok(removeAllIdx !== -1, 'expected contextMenus.removeAll guard');
  assert.ok(createIdx > removeAllIdx, 'create must run inside/after removeAll callback');
});

test('manifest commands match documented shortcuts (Down/Up, not Shift+B/T)', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.commands['go-to-bottom'], 'go-to-bottom command missing');
  assert.ok(manifest.commands['go-to-top'], 'go-to-top command missing');
  const readme = read('README.md');
  const supported = read('SUPPORTED_SITES.md');
  assert.ok(!/Ctrl\+Shift\+[BT]/.test(readme), 'README references stale Ctrl+Shift shortcuts');
  assert.ok(!/Ctrl\+Shift\+[BT]/.test(supported), 'SUPPORTED_SITES references stale Ctrl+Shift shortcuts');
});

test('manifest.json is valid JSON and MV3', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
});

test('disabled state produces no page-world logs (all logs gated)', () => {
  const content = read('content.js');
  // The "Extension disabled" log must be behind a debug guard.
  assert.ok(
    /if \(debugEnabled\) console\.log\('\[bypassHelper\] Extension disabled/.test(content),
    'disabled-branch log must be gated behind debugEnabled'
  );
  // No bare console.log in timerSpeedup/shortcuts — must route through a debug-gated helper.
  const timer = read('timerSpeedup.js');
  const shortcuts = read('shortcuts.js');
  const bareLog = (src) => src
    .split('\n')
    .filter((l) => /console\.log/.test(l) && !/bypassHelperDebug|\.\.\.a\)/.test(l));
  assert.deepEqual(bareLog(timer), [], 'timerSpeedup has ungated console.log');
  assert.deepEqual(bareLog(shortcuts), [], 'shortcuts has ungated console.log');
});

test('timerSpeedup self-uninstalls its global overrides when disabled', () => {
  const timer = read('timerSpeedup.js');
  assert.ok(timer.includes('const uninstall ='), 'expected uninstall() helper');
  assert.ok(timer.includes('window.setTimeout = origST'), 'must restore setTimeout');
  assert.ok(timer.includes('window.setInterval = origSI'), 'must restore setInterval');
  assert.ok(timer.includes('window.requestAnimationFrame = origRAF'), 'must restore rAF');
  assert.ok(timer.includes('Date.now = origNow'), 'must restore Date.now');
  assert.ok(
    /data-bypass-helper-enabled/.test(timer),
    'must observe the enabled data-attr to decide uninstall'
  );
});

test('background syncs the adblock ruleset with extensionEnabled', () => {
  const bg = read('background.js');
  assert.ok(bg.includes('function syncAdblockRuleset'), 'expected syncAdblockRuleset helper');
  assert.ok(bg.includes('updateEnabledRulesets'), 'must call updateEnabledRulesets');
  // Must be wired to the toggle change handler.
  assert.ok(
    /syncAdblockRuleset\(changes\.extensionEnabled\.newValue\)/.test(bg),
    'ruleset sync must fire on extensionEnabled change'
  );
});

test('rules/adblock.json is valid JSON with unique rule ids', () => {
  const rules = JSON.parse(read('rules/adblock.json'));
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate declarativeNetRequest rule ids');
});
