'use strict';

const {
    CTRL_V, TERMINAL_HISTORY, resolveTerminalHistoryKey, resolveTerminalPasteRoute,
    resolveTerminalWheelScroll, shouldCopyTerminalSelection, terminalInputOverride
} = require('./terminalKeybindings');

const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function consume(event) {
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
}

// IPC's host guard is 64 KiB. Keep Unicode and bracketed paste intact.
function inputChunks(text) {
    const chunks = [];
    for (let start = 0; start < text.length;) {
        let end = Math.min(text.length, start + 16384);
        const last = text.charCodeAt(end - 1);
        if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
        chunks.push(text.slice(start, end));
        start = end;
    }
    return chunks;
}

// Scrollback stays in xterm, so history keys scroll the buffer instead of reaching the shell.
function scrollTerminalHistory(terminal, key) {
    if (key === TERMINAL_HISTORY.up) terminal.scrollLines(-1);
    else if (key === TERMINAL_HISTORY.down) terminal.scrollLines(1);
    else if (key === TERMINAL_HISTORY.pageUp) terminal.scrollPages(-1);
    else if (key === TERMINAL_HISTORY.pageDown) terminal.scrollPages(1);
    else if (key === TERMINAL_HISTORY.top) terminal.scrollToTop();
    else if (key === TERMINAL_HISTORY.bottom) terminal.scrollToBottom();
}

function installTerminalInput({ terminal, stage, clipboard, write, canWrite = () => true, zoom, onError }) {
    let wheelRemainder = 0;
    const fail = (operation) => onError?.(`Terminal ${operation} failed.`);
    const send = (text) => {
        if (!text) return;
        const byteLength = Buffer.byteLength(text, 'utf8');
        if (byteLength > MAX_INPUT_BYTES) {
            onError?.('Terminal input exceeds the 8 MiB limit; nothing was sent.');
            return;
        }
        if (!canWrite(byteLength)) {
            onError?.('Terminal is not ready or its input queue is full; nothing was sent.');
            return;
        }
        terminal.clearSelection();
        terminal.scrollToBottom();
        for (const chunk of inputChunks(text)) {
            if (!write(chunk)) {
                fail('input delivery');
                break;
            }
        }
    };
    const copy = () => {
        try {
            if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard-unavailable');
            clipboard.writeText(terminal.getSelection());
            terminal.clearSelection();
        } catch {
            fail('copy');
        }
    };
    const hasImage = () => {
        try {
            const image = clipboard?.readImage?.();
            return !!image && !image.isEmpty();
        } catch {
            fail('clipboard inspection');
            return false;
        }
    };
    const pasteText = (providedText) => {
        try {
            if (providedText === undefined && typeof clipboard?.readText !== 'function') {
                throw new Error('clipboard-unavailable');
            }
            const text = providedText ?? clipboard.readText();
            if (text) terminal.paste(text);
        } catch {
            fail('paste');
        }
    };
    terminal.onData(send);
    terminal.attachCustomKeyEventHandler((event) => {
        if (event.isComposing || event.keyCode === 229) return true;
        const history = resolveTerminalHistoryKey(event);
        if (history) {
            consume(event);
            terminal.clearSelection();
            scrollTerminalHistory(terminal, history);
            return false;
        }
        if (event.type !== 'keydown') return true;
        if (shouldCopyTerminalSelection(event, terminal.hasSelection())) {
            consume(event);
            copy();
            return false;
        }
        if (event.ctrlKey && !event.altKey && !event.metaKey
            && ((event.shiftKey && String(event.key).toLowerCase() === 'c')
                || (!event.shiftKey && event.key === 'Insert'))) {
            consume(event);
            return false;
        }
        const override = terminalInputOverride(event);
        if (override) {
            consume(event);
            send(override);
            return false;
        }
        if (resolveTerminalPasteRoute(event, false)) {
            consume(event);
            // An image on the clipboard passes Ctrl+V through so CLI tools can read it themselves.
            const route = resolveTerminalPasteRoute(event, !event.shiftKey && hasImage());
            if (route === 'image-pty') send(CTRL_V);
            else if (route === 'text') pasteText();
            return false;
        }
        return true;
    });
    // Never let alternate-screen wheel gestures become prompt-history arrows.
    terminal.attachCustomWheelEventHandler(() => false);
    stage.addEventListener('wheel', (event) => {
        consume(event);
        if (event.ctrlKey || event.metaKey) {
            wheelRemainder = 0;
            zoom(event.deltaY);
            return;
        }
        const scroll = resolveTerminalWheelScroll(event, wheelRemainder);
        if (!scroll.handled) return;
        wheelRemainder = scroll.pixelRemainder;
        if (!scroll.lines) return;
        terminal.scrollLines(scroll.lines);
    }, { passive: false, capture: true });
    stage.addEventListener('paste', (event) => {
        consume(event);
        pasteText(event.clipboardData?.getData('text/plain'));
    }, true);
    stage.addEventListener('copy', (event) => {
        if (!terminal.hasSelection()) return;
        consume(event);
        copy();
    }, true);
    stage.addEventListener('contextmenu', (event) => {
        consume(event);
        if (terminal.hasSelection()) copy();
        else pasteText();
    }, true);
    return { send, pasteText };
}

module.exports = { installTerminalInput, inputChunks, MAX_INPUT_BYTES };
