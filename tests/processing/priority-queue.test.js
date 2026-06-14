// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../../src/processing/worker-pool.js';

describe('PriorityQueue', () => {
  it('dequeues highest priority first', () => {
    const pq = new PriorityQueue();
    pq.enqueue('low', 1);
    pq.enqueue('high', 10);
    pq.enqueue('mid', 5);
    assert.equal(pq.dequeue().item, 'high');
    assert.equal(pq.dequeue().item, 'mid');
    assert.equal(pq.dequeue().item, 'low');
  });

  it('returns null when empty', () => {
    assert.equal(new PriorityQueue().dequeue(), null);
    assert.equal(new PriorityQueue().peek(), null);
  });

  it('peek without removing', () => {
    const pq = new PriorityQueue();
    pq.enqueue('a', 5);
    pq.enqueue('b', 10);
    assert.equal(pq.peek().item, 'b');
    assert.equal(pq.size, 2);
  });

  it('isEmpty correct', () => {
    const pq = new PriorityQueue();
    assert.ok(pq.isEmpty());
    pq.enqueue('x', 1);
    assert.ok(!pq.isEmpty());
  });

  it('drain processes in priority order', async () => {
    const pq = new PriorityQueue();
    pq.enqueue('c', 1);
    pq.enqueue('a', 3);
    pq.enqueue('b', 2);
    const order = [];
    await pq.drain((item) => order.push(item));
    assert.deepEqual(order, ['a', 'b', 'c']);
  });

  it('peekAbove filters by min priority', () => {
    const pq = new PriorityQueue();
    pq.enqueue('low', 1);
    pq.enqueue('high', 10);
    pq.enqueue('mid', 5);
    assert.equal(pq.peekAbove(5).length, 2);
  });

  it('clear empties queue', () => {
    const pq = new PriorityQueue();
    pq.enqueue('a', 1);
    pq.clear();
    assert.ok(pq.isEmpty());
  });

  it('handles many items in correct order', () => {
    const pq = new PriorityQueue();
    for (let i = 0; i < 100; i++) pq.enqueue(i, Math.random() * 100);
    let prev = Infinity;
    while (!pq.isEmpty()) {
      const { priority } = pq.dequeue();
      assert.ok(priority <= prev);
      prev = priority;
    }
  });

  it('supports custom comparator (min-heap)', () => {
    const pq = new PriorityQueue({ comparator: (a, b) => b.priority - a.priority });
    pq.enqueue('low', 1);
    pq.enqueue('high', 10);
    assert.equal(pq.dequeue().item, 'low');
  });
});
