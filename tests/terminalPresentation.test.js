'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { blinkingCursorStyle } = require('../tools/terminalPresentation');

test('application cursor requests keep their shape but always blink', () => {
    assert.equal(blinkingCursorStyle([]), 'block');
    assert.equal(blinkingCursorStyle([2]), 'block');
    assert.equal(blinkingCursorStyle([4]), 'underline');
    assert.equal(blinkingCursorStyle([6]), 'bar');
});
