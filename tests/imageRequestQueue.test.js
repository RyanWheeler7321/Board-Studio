'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSerialImageRequestQueue, createImageRequestControl } = require('../blocks/imageRequestQueue');

test('image requests run serially in viewport priority order', async () => {
    const started = [];
    let activeCount = 0;
    let maxActiveCount = 0;
    const queue = createSerialImageRequestQueue({
        run: async (job) => {
            started.push(job.key);
            activeCount += 1;
            maxActiveCount = Math.max(maxActiveCount, activeCount);
            await new Promise((resolve) => setTimeout(resolve, 2));
            activeCount -= 1;
        }
    });

    queue.enqueue({ key: 'center' });
    queue.enqueue({ key: 'near' });
    queue.enqueue({ key: 'far' });
    await queue.whenIdle();

    assert.deepEqual(started, ['center', 'near', 'far']);
    assert.equal(maxActiveCount, 1);
});

test('canceled source requests are removed instead of delaying the final settled target', async () => {
    let paused = true;
    const started = [];
    const queue = createSerialImageRequestQueue({
        canStart: () => !paused,
        run: async (job) => started.push(job.key)
    });

    for (let index = 0; index < 400; index += 1) {
        queue.enqueue({ key: `stale-${index}`, resolution: 'source' });
    }
    const removed = queue.removeWhere((job) => job.resolution === 'source');
    queue.enqueue({ key: 'current-visible-image', resolution: 'source' });
    paused = false;
    queue.resume();
    await queue.whenIdle();

    assert.equal(removed.length, 400);
    assert.deepEqual(started, ['current-visible-image']);
    assert.equal(queue.getState().queuedCount, 0);
});

test('cancelActive releases a stalled decode so current work can start', async () => {
    const started = [];
    const queue = createSerialImageRequestQueue({
        run: async (job) => {
            started.push(job.key);
            await job.promise;
        }
    });

    let cancelActiveDecode;
    const stalledDecode = new Promise((resolve) => {
        cancelActiveDecode = resolve;
    });
    queue.enqueue({
        key: 'active-old-source',
        resolution: 'source',
        promise: stalledDecode,
        cancel: cancelActiveDecode
    });
    await new Promise((resolve) => setImmediate(resolve));
    queue.enqueue({
        key: 'current-visible-image',
        resolution: 'source',
        promise: Promise.resolve()
    });
    const canceled = queue.cancelActive();
    await queue.whenIdle();

    assert.equal(canceled.key, 'active-old-source');
    assert.deepEqual(started, ['active-old-source', 'current-visible-image']);
});

test('clearing queued work and canceling the active decode leaves the queue idle', async () => {
    let cancelActiveDecode;
    const stalledDecode = new Promise((resolve) => {
        cancelActiveDecode = resolve;
    });
    const queue = createSerialImageRequestQueue({
        run: async (job) => job.promise
    });

    queue.enqueue({
        key: 'active-source',
        resolution: 'source',
        promise: stalledDecode,
        cancel: cancelActiveDecode
    });
    await new Promise((resolve) => setImmediate(resolve));
    queue.enqueue({ key: 'queued-proxy', promise: Promise.resolve() });
    queue.clear();
    queue.cancelActive();
    await queue.whenIdle();

    assert.deepEqual(queue.getState(), {
        queuedCount: 0,
        active: null,
        running: false
    });
});

test('focus loss cancels the active decode and focus return starts only current work', async () => {
    let windowActive = true;
    let cancelStalledDecode;
    const stalledDecode = new Promise((resolve) => {
        cancelStalledDecode = resolve;
    });
    const started = [];
    const queue = createSerialImageRequestQueue({
        canStart: () => windowActive,
        run: async (job) => {
            started.push(job.key);
            await job.promise;
        }
    });

    queue.enqueue({
        key: 'source-before-blur',
        promise: stalledDecode,
        cancel: cancelStalledDecode
    });
    await new Promise((resolve) => setImmediate(resolve));

    windowActive = false;
    queue.clear();
    queue.cancelActive();
    await queue.whenIdle();
    queue.enqueue({ key: 'source-after-focus', promise: Promise.resolve() });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['source-before-blur']);

    windowActive = true;
    queue.resume();
    await queue.whenIdle();
    assert.deepEqual(started, ['source-before-blur', 'source-after-focus']);
});

test('focus loss releases a deferred proxy IPC and ignores its late result', async () => {
    const control = createImageRequestControl();
    let resolveProxyIpc;
    const proxyIpc = new Promise((resolve) => {
        resolveProxyIpc = resolve;
    });
    let appliedPath = '';
    const operation = Promise.race([
        proxyIpc.then((path) => ({ status: 'response', path })),
        control.cancellation
    ]).then((outcome) => {
        if (outcome.status === 'response' && !control.canceled) {
            appliedPath = outcome.path;
        }
        return outcome.status;
    });

    control.cancel();
    assert.equal(await operation, 'canceled');
    resolveProxyIpc('stale-proxy.png');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(appliedPath, '');
});

test('clearing the queue discards proxy and source work before the settled viewport rebuild', async () => {
    let paused = true;
    const started = [];
    const queue = createSerialImageRequestQueue({
        canStart: () => !paused,
        run: async (job) => started.push(job.key)
    });

    queue.enqueue({ key: 'stale-proxy', resolution: 'proxy' });
    queue.enqueue({ key: 'stale-source', resolution: 'source' });
    const removed = queue.clear();
    queue.enqueue({ key: 'settled-center-source', resolution: 'source' });
    paused = false;
    queue.resume();
    await queue.whenIdle();

    assert.deepEqual(removed.map((job) => job.key), ['stale-proxy', 'stale-source']);
    assert.deepEqual(started, ['settled-center-source']);
});
