'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { resolveImageLoadingPolicy } = require('../blocks/imageLoadingPolicy');

test('image elements defer source assignment to the viewport controller', () => {
	assert.deepEqual(resolveImageLoadingPolicy(), {
		loading: 'eager',
		fetchPriority: 'low',
		decoding: 'async',
		deferred: true
	});
	assert.deepEqual(resolveImageLoadingPolicy(500), resolveImageLoadingPolicy(1));
});

test('all displayed raster tiers use consistent smooth sampling', () => {
	const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'blocks.css'), 'utf8');
	assert.match(css, /\.board-block\.type-image img \{[\s\S]*?image-rendering:\s*auto;/);
	assert.equal(css.includes('image-rendering: pixelated'), false);
});
