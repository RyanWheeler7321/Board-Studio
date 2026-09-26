'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { calculatePixelDemand, selectProxyMaxEdge, allocateProxyCandidates, IMAGE_PROXY_TIERS } = require('../blocks/imageResolutionPolicy');

test('pixel demand follows rendered size and device scale', () => {
  assert.deepEqual(calculatePixelDemand({ width: 400, height: 225 }, 1.25), { longEdge: 500, pixels: 140625 });
});
test('tiers fit screen demand and remain compatible with live proxy backend', () => {
  assert.deepEqual(IMAGE_PROXY_TIERS, [768, 1536, 2048]);
  assert.equal(selectProxyMaxEdge({ strictlyVisible: true, pixelDemand: 1000 }), 1536);
  assert.equal(selectProxyMaxEdge({ strictlyVisible: true, pixelDemand: 1900 }), 2048);
  assert.equal(selectProxyMaxEdge({ strictlyVisible: false, pixelDemand: 3000 }), 768);
});
test('tier hysteresis retains quality near boundaries', () => {
  assert.equal(selectProxyMaxEdge({ strictlyVisible: true, pixelDemand: 760, currentProxyMaxEdge: 1536 }), 1536);
  assert.equal(selectProxyMaxEdge({ strictlyVisible: true, pixelDemand: 500, currentProxyMaxEdge: 1536 }), 768);
  assert.equal(selectProxyMaxEdge({ strictlyVisible: true, pixelDemand: 780, currentProxyMaxEdge: 768 }), 768);
});
test('an oversized candidate does not starve a later smaller fitting image', () => {
  const allocation = allocateProxyCandidates([
    { id: 'large', strictlyVisible: true, pixelDemand: 2000 },
    { id: 'small', strictlyVisible: true, pixelDemand: 1000, sourcePixels: 1_000_000 }
  ], { pixelBudget: 2_000_000 });
  assert.equal(allocation.selected.get('large'), 768);
  assert.equal(allocation.selected.get('small'), 1536);
});
