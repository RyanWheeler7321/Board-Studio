'use strict';

// MARK: CONSOLE PANEL
const env = require('../core/state');
const { dom, state, utils } = env;

const STORAGE_KEY = 'workboard.console.width';

function readStoredWidth() {
    try {
        return Number(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        return NaN;
    }
}

function persistPanelWidth(width) {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
    } catch {}
}

function applyPanelWidth(width) {
    const panel = dom.consolePanel;
    if (!panel) {
        return;
    }
    const clamped = utils.clamp(Number(width) || 360, 240, 760);
    panel.style.width = `${clamped}px`;
    state.console.currentWidth = clamped;
    if (env.windowMode === 'paint-editor' && dom.consoleDivider) {
        dom.consoleDivider.style.left = `${16 + clamped}px`;
    }
}

function formatDuration(durationMs) {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) {
        return '';
    }
    if (ms >= 1000) {
        return ` +${(ms / 1000).toFixed(2)}s`;
    }
    return ` +${Math.round(ms)}ms`;
}

function extractDurationMs(args) {
    if (!Array.isArray(args)) {
        return null;
    }
    const keys = ['durationMs', 'elapsedMs', 'ms', 'timeMs', 'duration', 'elapsed'];
    for (const arg of args) {
        if (!arg || typeof arg !== 'object') {
            continue;
        }
        for (const key of keys) {
            const value = arg[key];
            if (Number.isFinite(value)) {
                return Number(value);
            }
        }
    }
    return null;
}

function normalizeLevel(level) {
    const value = String(level || 'info').toLowerCase();
    if (value === 'warn' || value === 'warning') {
        return 'WARN';
    }
    if (value === 'error') {
        return 'ERROR';
    }
    if (value === 'debug') {
        return 'DEBUG';
    }
    return 'INFO';
}

function buildTimestamp(now = new Date()) {
    const time = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    return `${time}.${ms}`;
}

function formatArgs(args) {
    if (!Array.isArray(args) || args.length === 0) {
        return '';
    }
    const formatter = typeof env.utils.formatDebugArgument === 'function'
        ? env.utils.formatDebugArgument
        : (value) => {
            if (value instanceof Error) {
                return value.stack || value.message || String(value);
            }
            if (typeof value === 'object') {
                try {
                    return JSON.stringify(value);
                } catch {
                    return String(value);
                }
            }
            return String(value);
        };
    return args.map((arg) => formatter(arg)).join(' ');
}

function rebuildConsoleText() {
    const log = dom.consoleLog;
    if (!log) {
        return;
    }
    const shouldStickBottom = (log.scrollTop + log.clientHeight) >= (log.scrollHeight - 8);
    log.value = state.console.entries.join('\n');
    if (shouldStickBottom) {
        log.scrollTop = log.scrollHeight;
    }
}

function appendEntry(level, args) {
    const log = dom.consoleLog;
    if (!log) {
        return;
    }
    const timestamp = buildTimestamp(new Date());
    const duration = formatDuration(extractDurationMs(args));
    const line = `[${normalizeLevel(level)} ${timestamp}${duration}] ${formatArgs(args)}`.trim();
    state.console.entries.push(line);
    while (state.console.entries.length > state.console.maxEntries) {
        state.console.entries.shift();
    }
    rebuildConsoleText();
}

function clearConsole() {
    state.console.entries = [];
    if (dom.consoleLog) {
        dom.consoleLog.value = '';
        dom.consoleLog.scrollTop = 0;
    }
}

function setConsoleVisibility(visible, options = {}) {
    const panel = dom.consolePanel;
    if (!panel) {
        return;
    }
    const divider = dom.consoleDivider;
    state.console.isVisible = !!visible;
    panel.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (divider) {
        divider.classList.toggle('is-hidden', !visible);
        divider.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (visible) {
        applyPanelWidth(state.console.currentWidth || 360);
        if (!options.skipScroll && dom.consoleLog) {
            dom.consoleLog.scrollTop = dom.consoleLog.scrollHeight;
        }
    } else {
        state.console.isDragging = false;
    }
}

function showConsole(options = {}) {
    setConsoleVisibility(true, options);
}

function hideConsole(options = {}) {
    setConsoleVisibility(false, options);
}

function toggleConsole() {
    if (state.console.isVisible) {
        hideConsole({ force: true, skipScroll: true });
        return;
    }
    showConsole({ force: true });
}

function handleDividerPointerDown(event) {
    if (!state.console.isVisible || state.console.isDragging) {
        return;
    }
    const divider = dom.consoleDivider;
    const panel = dom.consolePanel;
    if (!divider || !panel) {
        return;
    }
    state.console.isDragging = true;
    state.console.dragStartX = event.clientX;
    state.console.dragStartWidth = panel.getBoundingClientRect().width;
    divider.classList.add('is-dragging');
    try {
        divider.setPointerCapture(event.pointerId);
    } catch {}
}

function handleDividerPointerMove(event) {
    if (!state.console.isVisible || !state.console.isDragging) {
        return;
    }
    const delta = event.clientX - state.console.dragStartX;
    applyPanelWidth(state.console.dragStartWidth + delta);
}

function handleDividerPointerUp(event) {
    if (!state.console.isDragging) {
        return;
    }
    state.console.isDragging = false;
    if (dom.consoleDivider) {
        dom.consoleDivider.classList.remove('is-dragging');
        try {
            dom.consoleDivider.releasePointerCapture(event.pointerId);
        } catch {}
    }
    persistPanelWidth(state.console.currentWidth || 360);
}

function initializeConsolePanel() {
    const panel = dom.consolePanel;
    const log = dom.consoleLog;
    if (!panel || !log) {
        return;
    }
    const storedWidth = readStoredWidth();
    applyPanelWidth(Number.isFinite(storedWidth) ? storedWidth : 360);
    if (dom.consoleTitle) {
        dom.consoleTitle.textContent = env.windowMode === 'paint-editor' ? 'Paint Studio Console' : 'Board Studio Console';
    }
    if (dom.consoleClearButton) {
        dom.consoleClearButton.addEventListener('click', () => {
            clearConsole();
            appendEntry('info', ['Console cleared']);
        });
    }
    if (dom.consoleDivider) {
        dom.consoleDivider.addEventListener('pointerdown', handleDividerPointerDown);
        dom.consoleDivider.addEventListener('pointermove', handleDividerPointerMove);
        dom.consoleDivider.addEventListener('pointerup', handleDividerPointerUp);
        dom.consoleDivider.addEventListener('pointercancel', handleDividerPointerUp);
    }
    log.setAttribute('wrap', 'off');
    hideConsole({ force: true, skipScroll: true });
    appendEntry('info', [`${env.windowMode === 'paint-editor' ? 'Paint Studio' : 'Board Studio'} console ready`]);
}

env.consoleUi.initialize = initializeConsolePanel;
env.consoleUi.appendEntry = appendEntry;
env.consoleUi.clear = clearConsole;
env.consoleUi.clearFocus = () => {};
env.consoleUi.show = showConsole;
env.consoleUi.hide = hideConsole;
env.consoleUi.toggle = toggleConsole;
env.consoleUi.isVisible = () => state.console.isVisible;
env.consoleUi.log = (level, message, detail) => {
    if (detail === undefined) {
        appendEntry(level, [message]);
        return;
    }
    appendEntry(level, [message, detail]);
};

env.consoleUi.initialize();

module.exports = env;
