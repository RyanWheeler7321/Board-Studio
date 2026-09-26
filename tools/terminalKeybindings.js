'use strict';

const CTRL_V = '\x16';
const CTRL_W = '\x17';
// Scrollback keys, handled by xterm in terminalInput.js and never sent to the shell.
const TERMINAL_HISTORY = Object.freeze({
    up: '\x1b[1;6A', down: '\x1b[1;6B',
    pageUp: '\x1b[5;2~', pageDown: '\x1b[6;2~',
    top: '\x1b[1;6H', bottom: '\x1b[1;6F'
});
const TEXT_INPUT_TYPES = new Set([
    '',
    'email',
    'number',
    'password',
    'search',
    'tel',
    'text',
    'url'
]);

function resolveBoardBackquoteAction(event = {}, options = {}) {
    if (event.code !== 'Backquote' || event.altKey || event.metaKey || event.shiftKey) {
        return '';
    }
    if (event.ctrlKey) {
        return 'toggle-console';
    }
    if (options.terminalOwns === true || options.isEditable !== true) {
        return 'toggle-terminal';
    }
    return '';
}

function terminalInputOverride(event = {}) {
    if (
        event.type === 'keydown'
        && event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey
        && String(event.key || '').toLowerCase() === 'backspace'
    ) {
        return CTRL_W;
    }
    return '';
}

function resolveTerminalHistoryKey(event = {}) {
    if (event.type !== 'keydown' || event.altKey || event.metaKey || event.isComposing) return '';
    if (event.ctrlKey && event.shiftKey) {
        return ({
            ArrowUp: TERMINAL_HISTORY.up, ArrowDown: TERMINAL_HISTORY.down,
            Home: TERMINAL_HISTORY.top, End: TERMINAL_HISTORY.bottom,
            PageUp: TERMINAL_HISTORY.pageUp, PageDown: TERMINAL_HISTORY.pageDown
        })[event.key] || '';
    }
    if (event.ctrlKey) return '';
    if (event.key === 'PageUp') return TERMINAL_HISTORY.pageUp;
    if (event.key === 'PageDown') return TERMINAL_HISTORY.pageDown;
    return '';
}

function resolveTerminalWheelScroll(event = {}, pixelRemainder = 0) {
    const remainder = Number.isFinite(Number(pixelRemainder))
        ? Number(pixelRemainder)
        : 0;
    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
        return { handled: false, lines: 0, pixelRemainder: remainder };
    }

    const deltaY = Number(event.deltaY);
    if (!Number.isFinite(deltaY) || deltaY === 0) {
        return { handled: false, lines: 0, pixelRemainder: remainder };
    }

    const deltaMode = Math.round(Number(event.deltaMode) || 0);
    if (deltaMode === 1) {
        const lines = Math.sign(deltaY) * Math.max(1, Math.min(12, Math.round(Math.abs(deltaY))));
        return { handled: true, lines, pixelRemainder: 0 };
    }
    if (deltaMode === 2) {
        return { handled: true, lines: Math.sign(deltaY) * 12, pixelRemainder: 0 };
    }

    const totalPixels = (Math.sign(remainder) === Math.sign(deltaY) ? remainder : 0) + deltaY;
    const lines = Math.max(-12, Math.min(12, Math.trunc(totalPixels / 32)));
    return {
        handled: true,
        lines,
        pixelRemainder: totalPixels % 32
    };
}

function shouldCopyTerminalSelection(event = {}, hasSelection = false) {
    return (
        event.type === 'keydown'
        && event.ctrlKey
        && !event.altKey
        && !event.metaKey
        && (String(event.key || '').toLowerCase() === 'c'
            || (!event.shiftKey && event.key === 'Insert'))
        && hasSelection === true
    );
}

function resolveTerminalPasteRoute(event = {}, hasClipboardImage = false) {
    if (event.type === 'keydown' && event.key === 'Insert' && event.shiftKey
        && !event.ctrlKey && !event.altKey && !event.metaKey) return 'text';
    if (
        event.type !== 'keydown'
        || !event.ctrlKey
        || event.metaKey
        || String(event.key || '').toLowerCase() !== 'v'
    ) {
        return '';
    }
    if (event.altKey) {
        if (event.shiftKey) {
            return '';
        }
        return hasClipboardImage === true ? 'image-pty' : 'image-blocked';
    }
    if (!event.shiftKey && hasClipboardImage === true) return 'image-pty';
    return 'text';
}

function isTextEntryTarget(target) {
    const field = target?.closest?.('textarea, input, [contenteditable="true"], [role="textbox"]');
    if (!field) {
        return false;
    }
    const tagName = String(field.tagName || '').toLowerCase();
    if (tagName !== 'input') {
        return true;
    }
    const inputType = String(field.getAttribute?.('type') || field.type || '').toLowerCase();
    return TEXT_INPUT_TYPES.has(inputType);
}

function resolveTerminalSelectionAfterPointer(event = {}, currentSelection = false) {
    if (isTextEntryTarget(event.target) || Number(event.button) !== 1) {
        return false;
    }
    return currentSelection === true;
}

module.exports = {
    CTRL_V,
    CTRL_W,
    TERMINAL_HISTORY,
    isTextEntryTarget,
    resolveBoardBackquoteAction,
    resolveTerminalHistoryKey,
    resolveTerminalSelectionAfterPointer,
    resolveTerminalPasteRoute,
    resolveTerminalWheelScroll,
    shouldCopyTerminalSelection,
    terminalInputOverride
};
