'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSingleActiveRuntimeLifecycle } = require('../blocks/animated3dLifecycle');

test('single active lifecycle disposes the previous runtime before activation switches', () => {
    const disposed = [];
    const lifecycle = createSingleActiveRuntimeLifecycle();
    const first = { dispose(reason) { disposed.push(`first:${reason}`); } };
    const second = { dispose(reason) { disposed.push(`second:${reason}`); } };

    lifecycle.activate(first);
    assert.equal(lifecycle.isActive(first), true);
    lifecycle.activate(second);
    assert.deepEqual(disposed, ['first:superseded']);
    assert.equal(lifecycle.isActive(first), false);
    assert.equal(lifecycle.isActive(second), true);

    assert.equal(lifecycle.disposeActive('board-rerender'), true);
    assert.deepEqual(disposed, ['first:superseded', 'second:board-rerender']);
    assert.equal(lifecycle.getActive(), null);
});

test('releasing an inactive runtime cannot dislodge the active runtime', () => {
    const lifecycle = createSingleActiveRuntimeLifecycle();
    const first = { dispose() {} };
    const second = { dispose() {} };
    lifecycle.activate(first);
    lifecycle.activate(second);

    assert.equal(lifecycle.release(first), false);
    assert.equal(lifecycle.getActive(), second);
    assert.equal(lifecycle.release(second), true);
    assert.equal(lifecycle.getActive(), null);
});
