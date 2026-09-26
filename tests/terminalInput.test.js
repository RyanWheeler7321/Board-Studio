'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { inputChunks, installTerminalInput, MAX_INPUT_BYTES } = require('../tools/terminalInput');
const { resolveTerminalWheelScroll } = require('../tools/terminalKeybindings');

function fixture() {
    const writes = [], errors = [], copied = [], scrolled = [], events = {};
    const terminal = {
        selection: '', image: false, text: 'one\ntwo',
        onData(fn) { this.data = fn; },
        attachCustomKeyEventHandler(fn) { this.key = fn; },
        attachCustomWheelEventHandler(fn) { this.wheel = fn; },
        clearSelection() { this.selection = ''; },
        getSelection() { return this.selection; },
        hasSelection() { return !!this.selection; },
        scrollLines(lines) { scrolled.push(lines); },
        scrollPages(pages) { scrolled.push(`page:${pages}`); },
        scrollToTop() { scrolled.push('top'); },
        scrollToBottom() { scrolled.push('bottom'); },
        paste(text) { this.data('\x1b[200~' + text.replace(/\r?\n/g, '\r') + '\x1b[201~'); }
    };
    installTerminalInput({
        terminal,
        stage: { addEventListener(name, fn) { events[name] = fn; } },
        clipboard: {
            writeText(text) { copied.push(text); },
            readText() { return terminal.text; },
            readImage() { return { isEmpty: () => !terminal.image }; }
        },
        write(text) { writes.push(text); return true; }, zoom() {}, onError: (error) => errors.push(error)
    });
    const key = (value, options = {}) => {
        const event = { type: 'keydown', key: value, ctrlKey: true,
            preventDefault() { this.prevented = true; },
            stopImmediatePropagation() { this.stopped = true; }, ...options };
        const result = terminal.key(event);
        return { event, result };
    };
    return { terminal, writes, errors, copied, scrolled, events, key };
}

test('copy cancels native defaults, clears selection, and leaves Ctrl+C without selection to xterm', () => {
    const f = fixture();
    f.terminal.selection = 'selected';
    const copied = f.key('c');
    assert.equal(copied.result, false);
    assert.equal(copied.event.prevented, true);
    assert.equal(copied.event.stopped, true);
    assert.deepEqual(f.copied, ['selected']);
    assert.deepEqual(f.writes, []);
    assert.equal(f.key('c').result, true);
    assert.equal(f.key('C', { shiftKey: true }).result, false);
    assert.equal(f.key('Insert').result, false);
});

test('text, image, image-only and text-only paste routes emit once', () => {
    const f = fixture();
    assert.equal(f.key('v').event.prevented, true);
    assert.deepEqual(f.writes, ['\x1b[200~one\rtwo\x1b[201~']);
    f.writes.length = 0;
    f.terminal.image = true;
    f.key('v');
    f.key('v', { altKey: true });
    assert.deepEqual(f.writes, ['\x16', '\x16']);
    f.writes.length = 0;
    f.key('V', { shiftKey: true });
    f.key('Insert', { ctrlKey: false, shiftKey: true });
    assert.equal(f.writes.length, 2);
    assert.ok(f.writes.every((text) => text.includes('\x1b[200~one\rtwo')));
    f.writes.length = 0;
    f.terminal.image = false;
    f.key('v', { altKey: true });
    assert.deepEqual(f.writes, []);
});

test('wheel scrolls xterm and never sends arrows; large deltas stay bounded', () => {
    const f = fixture();
    f.events.wheel({ deltaY: -96 });
    assert.deepEqual(f.scrolled, [-3]);
    assert.deepEqual(f.writes, []);
    assert.equal(f.terminal.wheel({ deltaY: -96 }), false);
    assert.equal(resolveTerminalWheelScroll({ deltaY: 10000 }).pixelRemainder, 16);
    assert.equal(resolveTerminalWheelScroll({ deltaY: -32 }, 16).lines, -1);
    f.events.wheel({ deltaY: -96, altKey: true });
    assert.deepEqual(f.scrolled, [-3]);
});

test('history keys scroll xterm and never reach the shell', () => {
    const f = fixture();
    assert.equal(f.key('ArrowUp', { shiftKey: true }).result, false);
    f.key('PageDown', { ctrlKey: false });
    f.key('Home', { shiftKey: true });
    f.key('End', { shiftKey: true });
    assert.deepEqual(f.scrolled, [-1, 'page:1', 'top', 'bottom']);
    assert.deepEqual(f.writes, []);
});

test('word-delete is one Ctrl+W; composition and ordinary editing keys remain xterm-owned', () => {
    const f = fixture();
    f.key('Backspace');
    assert.deepEqual(f.writes, ['\x17']);
    assert.equal(f.key('v', { isComposing: true }).result, true);
    assert.equal(f.key('ArrowLeft').result, true);
    assert.equal(f.key('Tab', { ctrlKey: false }).result, true);
});

test('large Unicode paste is chunked losslessly under the host limit', () => {
    const f = fixture();
    const text = '\x1b[200~' + 'a😀漢'.repeat(30000) + '\x1b[201~';
    f.terminal.data(text);
    assert.equal(f.writes.join(''), text);
    assert.ok(f.writes.length > 1);
    assert.ok(f.writes.every((chunk) => Buffer.byteLength(chunk) < 65536));
    assert.ok(inputChunks(text).every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk)));
    f.writes.length = 0;
    f.terminal.data('x'.repeat(MAX_INPUT_BYTES + 1));
    assert.equal(f.writes.length, 0);
    assert.equal(f.errors.length, 1);
});

test('native paste and right-click share single paste/copy handling', () => {
    const f = fixture();
    f.events.paste({ clipboardData: { getData: () => 'external\npaste' } });
    assert.equal(f.writes.length, 1);
    f.terminal.selection = 'copied';
    f.events.contextmenu({});
    assert.deepEqual(f.copied, ['copied']);
    assert.equal(f.writes.length, 1);
    f.events.contextmenu({});
    assert.equal(f.writes.length, 2);
});
