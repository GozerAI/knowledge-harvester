// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isTerminal,
  HarvestPoller,
  cancelAllPollers,
} from '../../src/api/long-polling.js';

describe('isTerminal', () => {
  it('completed is terminal', () => assert.ok(isTerminal('completed')));
  it('failed is terminal', () => assert.ok(isTerminal('failed')));
  it('aborted is terminal', () => assert.ok(isTerminal('aborted')));
  it('running is NOT terminal', () => assert.ok(!isTerminal('running')));
  it('pending is NOT terminal', () => assert.ok(!isTerminal('pending')));
  it('empty string is NOT terminal', () => assert.ok(!isTerminal('')));
});

describe('HarvestPoller', () => {
  it('can be cancelled', () => {
    const poller = new HarvestPoller('run-1', 'running', 5000);
    poller.cancel();
    assert.ok(poller._cancelled);
  });

  it('cleans up timers on cancel', () => {
    const poller = new HarvestPoller('run-1', 'running', 5000);
    poller._timer = setTimeout(() => {}, 99999);
    poller._interval = setInterval(() => {}, 99999);
    poller.cancel();
    assert.equal(poller._timer, null);
    assert.equal(poller._interval, null);
  });
});

describe('cancelAllPollers', () => {
  it('does not throw when called with no active pollers', () => {
    assert.doesNotThrow(() => cancelAllPollers());
  });
});
