import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codexNotifyLine,
  stripVibemeterFromCodexNotifyLine,
  updateCodexNotifyLine,
} from '../src/lib/notify-installer.ts';

const skyClient = '/Users/hanlu/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient';

function notifyArgs(line: string): string[] {
  const raw = line.replace(/^\s*notify\s*=\s*/, '');
  return JSON.parse(raw);
}

test('updates Vibemeter inside a Codex turn-ended wrapper without removing the wrapper', () => {
  const previousNotify = JSON.stringify([
    'sh',
    '-c',
    'VIBEMETER_NOTIFY_LOCALE=zh /Users/hanlu/codes/vibemeter/bin/vibemeter-notify.sh Codex complete',
  ]);
  const original = `notify = ${JSON.stringify([skyClient, 'turn-ended', '--previous-notify', previousNotify])}`;

  const updated = updateCodexNotifyLine(original, 'zh', 'beep');

  assert.ok(updated);
  const args = notifyArgs(updated);
  assert.deepEqual(args.slice(0, 3), [skyClient, 'turn-ended', '--previous-notify']);

  const inner = JSON.parse(args[3]);
  assert.deepEqual(inner.slice(0, 2), ['sh', '-c']);
  assert.match(inner[2], /VIBEMETER_NOTIFY_SOUND_MODE=beep/);
  assert.match(inner[2], /vibemeter-notify\.sh Codex complete/);
});

test('leaves non-Vibemeter Codex notify commands alone', () => {
  const previousNotify = JSON.stringify(['sh', '-c', 'echo done']);
  const original = `notify = ${JSON.stringify([skyClient, 'turn-ended', '--previous-notify', previousNotify])}`;

  assert.equal(updateCodexNotifyLine(original, 'zh', 'beep'), null);
});

test('updates a direct Vibemeter Codex notify line', () => {
  const original = codexNotifyLine('zh', 'voice');
  const updated = updateCodexNotifyLine(original, 'zh', 'off');

  assert.ok(updated);
  const args = notifyArgs(updated);
  assert.deepEqual(args.slice(0, 2), ['sh', '-c']);
  assert.match(args[2], /VIBEMETER_NOTIFY_SOUND_MODE=off/);
});

test('removes only the Vibemeter previous-notify pair from a Codex wrapper', () => {
  const previousNotify = JSON.stringify([
    'sh',
    '-c',
    'VIBEMETER_NOTIFY_LOCALE=zh /Users/hanlu/codes/vibemeter/bin/vibemeter-notify.sh Codex complete',
  ]);
  const original = `notify = ${JSON.stringify([skyClient, 'turn-ended', '--previous-notify', previousNotify])}`;

  const stripped = stripVibemeterFromCodexNotifyLine(original);

  assert.ok(stripped);
  assert.deepEqual(notifyArgs(stripped), [skyClient, 'turn-ended']);
});

test('removes a direct Vibemeter Codex notify line on uninstall', () => {
  assert.equal(stripVibemeterFromCodexNotifyLine(codexNotifyLine('zh', 'beep')), null);
});
