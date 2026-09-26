'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    CTRL_V,
    CTRL_W,
    isTextEntryTarget,
    resolveBoardBackquoteAction,
    resolveTerminalHistoryKey,
    TERMINAL_HISTORY,
    resolveTerminalSelectionAfterPointer,
    resolveTerminalPasteRoute,
    resolveTerminalWheelScroll,
    shouldCopyTerminalSelection,
    terminalInputOverride
} = require('../tools/terminalKeybindings');

test('plain backquote toggles the terminal outside editable fields', () => {
    assert.equal(resolveBoardBackquoteAction({
        code: 'Backquote',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false
    }, {
        isEditable: false,
        terminalOwns: false
    }), 'toggle-terminal');
});

test('plain backquote still toggles while the terminal owns input', () => {
    assert.equal(resolveBoardBackquoteAction({
        code: 'Backquote',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false
    }, {
        isEditable: true,
        terminalOwns: true
    }), 'toggle-terminal');
});

test('plain backquote remains typeable in ordinary editable fields', () => {
    assert.equal(resolveBoardBackquoteAction({
        code: 'Backquote',
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false
    }, {
        isEditable: true,
        terminalOwns: false
    }), '');
});

test('Ctrl+Backquote toggles the Board console', () => {
    assert.equal(resolveBoardBackquoteAction({
        code: 'Backquote',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false
    }), 'toggle-console');
});

test('Ctrl+Backspace matches Windows Terminal previous-word deletion', () => {
    assert.equal(terminalInputOverride({
        type: 'keydown',
        key: 'Backspace',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false
    }), CTRL_W);
    assert.equal(CTRL_W.codePointAt(0), 0x17);
});

test('page keys scroll terminal history', () => {
    const pageUp = {
        type: 'keydown',
        key: 'PageUp',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false
    };
    const pageDown = { ...pageUp, key: 'PageDown' };
    assert.equal(resolveTerminalHistoryKey(pageUp), TERMINAL_HISTORY.pageUp);
    assert.equal(resolveTerminalHistoryKey(pageDown), TERMINAL_HISTORY.pageDown);
    assert.equal(resolveTerminalHistoryKey({ ...pageUp, shiftKey: true }), TERMINAL_HISTORY.pageUp);
    assert.equal(resolveTerminalHistoryKey({ ...pageUp, ctrlKey: true }), '');
    assert.equal(resolveTerminalHistoryKey({ ...pageUp, altKey: true }), '');
});

test('plain terminal wheel normalizes pixels and preserves modified chords', () => {
    assert.deepEqual(resolveTerminalWheelScroll({
        deltaY: 96,
        deltaMode: 0
    }), {
        handled: true,
        lines: 3,
        pixelRemainder: 0
    });
    assert.deepEqual(resolveTerminalWheelScroll({
        deltaY: 16,
        deltaMode: 0
    }), {
        handled: true,
        lines: 0,
        pixelRemainder: 16
    });
    assert.deepEqual(resolveTerminalWheelScroll({
        deltaY: 16,
        deltaMode: 0
    }, 16), {
        handled: true,
        lines: 1,
        pixelRemainder: 0
    });
    assert.equal(resolveTerminalWheelScroll({
        deltaY: 96,
        deltaMode: 0,
        ctrlKey: true
    }).handled, false);
    assert.equal(resolveTerminalWheelScroll({
        deltaY: -3,
        deltaMode: 1
    }).lines, -3);
});

test('Ctrl+C copies only when the terminal has a selection', () => {
    const ctrlC = {
        type: 'keydown',
        key: 'c',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false
    };
    assert.equal(shouldCopyTerminalSelection(ctrlC, true), true);
    assert.equal(shouldCopyTerminalSelection(ctrlC, false), false);
});

test('Ctrl+Shift+C keeps selection copy and rejects modified chords', () => {
    const ctrlShiftC = {
        type: 'keydown',
        key: 'C',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false
    };
    assert.equal(shouldCopyTerminalSelection(ctrlShiftC, true), true);
    assert.equal(shouldCopyTerminalSelection({ ...ctrlShiftC, altKey: true }, true), false);
    assert.equal(shouldCopyTerminalSelection({ ...ctrlShiftC, metaKey: true }, true), false);
    assert.equal(shouldCopyTerminalSelection({ ...ctrlShiftC, type: 'keyup' }, true), false);
});

test('Ctrl+V owns text paste rather than relying on Chromium default actions', () => {
    const ctrlV = {
        type: 'keydown',
        key: 'v',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false
    };
    assert.equal(resolveTerminalPasteRoute(ctrlV, false), 'text');
    assert.equal(resolveTerminalPasteRoute({ ...ctrlV, shiftKey: true }, false), 'text');
    assert.equal(resolveTerminalPasteRoute({ ...ctrlV, type: 'keyup' }, false), '');
    assert.equal(resolveTerminalPasteRoute({ ...ctrlV, metaKey: true }, false), '');
});

test('plain Ctrl+V passes image paste through only for an image clipboard', () => {
    const ctrlV = {
        type: 'keydown',
        key: 'V',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false
    };
    assert.equal(resolveTerminalPasteRoute(ctrlV, true), 'image-pty');
    assert.equal(resolveTerminalPasteRoute({ ...ctrlV, shiftKey: true }, true), 'text');
});

test('Ctrl+Alt+V is image-only and maps to one Ctrl+V byte', () => {
    const ctrlAltV = {
        type: 'keydown',
        key: 'v',
        ctrlKey: true,
        shiftKey: false,
        altKey: true,
        metaKey: false
    };
    assert.equal(resolveTerminalPasteRoute(ctrlAltV, false), 'image-blocked');
    assert.equal(resolveTerminalPasteRoute(ctrlAltV, true), 'image-pty');
    assert.equal(resolveTerminalPasteRoute({ ...ctrlAltV, shiftKey: true }, true), '');
    assert.equal(CTRL_V.codePointAt(0), 0x16);
});

function targetFor(field) {
    return {
        closest() {
            return field;
        }
    };
}

test('terminal selection yields only to real text-entry targets', () => {
    assert.equal(isTextEntryTarget(targetFor({
        tagName: 'TEXTAREA',
        getAttribute: () => null
    })), true);
    assert.equal(isTextEntryTarget(targetFor({
        tagName: 'DIV',
        getAttribute: (name) => name === 'role' ? 'textbox' : null
    })), true);
    assert.equal(isTextEntryTarget(targetFor({
        tagName: 'INPUT',
        getAttribute: (name) => name === 'type' ? 'text' : null
    })), true);
    assert.equal(isTextEntryTarget(targetFor({
        tagName: 'INPUT',
        getAttribute: (name) => name === 'type' ? 'range' : null
    })), false);
    assert.equal(isTextEntryTarget(targetFor(null)), false);
    assert.equal(isTextEntryTarget({}), false);
});

test('left click hands selection to the Board while middle click preserves terminal selection', () => {
    const boardTarget = targetFor(null);
    assert.equal(resolveTerminalSelectionAfterPointer({
        button: 0,
        target: boardTarget
    }, true), false);
    assert.equal(resolveTerminalSelectionAfterPointer({
        button: 2,
        target: boardTarget
    }, true), false);
    assert.equal(resolveTerminalSelectionAfterPointer({
        button: 1,
        target: boardTarget
    }, true), true);
    assert.equal(resolveTerminalSelectionAfterPointer({
        button: 1,
        target: boardTarget
    }, false), false);
    assert.equal(resolveTerminalSelectionAfterPointer({
        button: 1,
        target: targetFor({
            tagName: 'TEXTAREA',
            getAttribute: () => null
        })
    }, true), false);
});
