'use strict';

const env = require('../core/state');
const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { blinkingCursorStyle } = require('./terminalPresentation');
const {
    isTextEntryTarget,
    resolveTerminalSelectionAfterPointer
} = require('./terminalKeybindings');
const { installTerminalInput, MAX_INPUT_BYTES } = require('./terminalInput');

const { dom, electron } = env;
const TERMINAL_VIEW_ID = 'tool-terminal';
const TERMINAL_FONT_STORAGE_KEY = 'boardstudio.terminal.font-points';
const TERMINAL_DEFAULT_FONT_POINTS = 11;
const TERMINAL_MIN_FONT_POINTS = 8;
const TERMINAL_MAX_FONT_POINTS = 28;
const TERMINAL_FONT_STEP_POINTS = 1;
const POINTS_TO_CSS_PIXELS = 96 / 72;
const MAX_PENDING_INPUT_BYTES = MAX_INPUT_BYTES + 64;

let capability = null;
let capabilityPromise = null;
let shellEl = null;
let stageEl = null;
let viewportEl = null;
let statusEl = null;
let statusMessageEl = null;
let statusButtonEl = null;
let terminal = null;
let fitAddon = null;
let resizeObserver = null;
let attached = false;
let attaching = false;
let terminalGeneration = 0;
let lastSequence = 0;
let pendingData = [];
let pendingInput = [];
let pendingInputBytes = 0;
let writeQueue = Promise.resolve();
let userIntent = false;
let terminalSurfaceSelected = false;
let terminalFontPoints = readStoredTerminalFontPoints();
let restartInFlight = false;
let terminalContextMenuEl = null;

function clampTerminalFontPoints(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return TERMINAL_DEFAULT_FONT_POINTS;
    }
    return Math.max(TERMINAL_MIN_FONT_POINTS, Math.min(TERMINAL_MAX_FONT_POINTS, Math.round(parsed)));
}

function readStoredTerminalFontPoints() {
    try {
        const stored = window.localStorage.getItem(TERMINAL_FONT_STORAGE_KEY);
        return stored === null ? TERMINAL_DEFAULT_FONT_POINTS : clampTerminalFontPoints(stored);
    } catch {
        return TERMINAL_DEFAULT_FONT_POINTS;
    }
}

function persistTerminalFontPoints(value) {
    try {
        window.localStorage.setItem(TERMINAL_FONT_STORAGE_KEY, String(clampTerminalFontPoints(value)));
    } catch {}
}

function terminalFontSizePixels(points = terminalFontPoints) {
    return clampTerminalFontPoints(points) * POINTS_TO_CSS_PIXELS;
}

function terminalTheme() {
    return {
        background: '#030405',
        foreground: '#FFE1ED',
        cursor: '#FF31C1',
        cursorAccent: '#030405',
        selectionBackground: '#6E0C27',
        black: '#733C85',
        red: '#C50F1F',
        green: '#56A190',
        yellow: '#C174AB',
        blue: '#7C69FF',
        magenta: '#4C1C98',
        cyan: '#2AEDE5',
        white: '#CCCCCC',
        brightBlack: '#767676',
        brightRed: '#E74856',
        brightGreen: '#5EC69D',
        brightYellow: '#F9D8EA',
        brightBlue: '#FF2C61',
        brightMagenta: '#784AB4',
        brightCyan: '#61D6D6',
        brightWhite: '#F2F2F2'
    };
}

function isTerminalViewActive() {
    return env.terminalPanel?.isOpen?.() === true;
}

function isTerminalSurfaceVisible() {
    return isTerminalViewActive()
        && !!shellEl?.isConnected
        && document.visibilityState !== 'hidden';
}

function updateTerminalPresentation() {
    if (shellEl) {
        shellEl.dataset.terminalSelected = isTerminalSurfaceVisible() && terminalSurfaceSelected ? 'true' : 'false';
    }
    if (terminal) {
        terminal.options.cursorBlink = true;
        terminal.options.cursorInactiveStyle = 'none';
    }
}

function showStatus(message, options = {}) {
    if (!statusEl || !statusMessageEl || !statusButtonEl) {
        return;
    }
    statusMessageEl.textContent = String(message || '');
    statusButtonEl.textContent = String(options.buttonLabel || 'Start terminal');
    statusButtonEl.hidden = options.action !== true;
    statusEl.hidden = false;
}

function hideStatus() {
    if (statusEl) {
        statusEl.hidden = true;
    }
}

function queueTerminalWrite(data) {
    const text = typeof data === 'string' ? data : String(data || '');
    if (!terminal || !text) {
        return writeQueue;
    }
    writeQueue = writeQueue.then(() => new Promise((resolve) => {
        terminal.write(text, resolve);
    })).catch(() => {});
    return writeQueue;
}

function applyTerminalData(payload = {}) {
    const generation = Math.max(0, Math.round(Number(payload.generation) || 0));
    const sequence = Math.max(0, Math.round(Number(payload.sequence) || 0));
    const data = typeof payload.data === 'string' ? payload.data : '';
    if (!data || !generation || !sequence) {
        return;
    }
    if (generation < terminalGeneration) {
        return;
    }
    if (generation > terminalGeneration) {
        terminal?.reset();
        terminalGeneration = generation;
        lastSequence = 0;
    }
    if (sequence <= lastSequence) {
        return;
    }
    lastSequence = sequence;
    queueTerminalWrite(data);
}

function handleTerminalData(_event, payload = {}) {
    if (attaching) {
        pendingData.push(payload);
        return;
    }
    applyTerminalData(payload);
}

function handleTerminalState(_event, payload = {}) {
    if (String(payload.status || '') === 'exited') {
        attached = false;
        attaching = false;
        clearPendingInput();
        showStatus('Terminal session ended.', { action: true, buttonLabel: 'Start terminal' });
    }
}

function terminalDimensions() {
    return {
        cols: Math.max(20, Math.round(Number(terminal?.cols) || 88)),
        rows: Math.max(6, Math.round(Number(terminal?.rows) || 30))
    };
}

function fitTerminal(options = {}) {
    if (!terminal || !fitAddon || !isTerminalSurfaceVisible() || !viewportEl?.clientWidth || !viewportEl?.clientHeight) {
        return false;
    }
    try {
        fitAddon.fit();
        if (attached && electron?.ipcRenderer?.send) {
            electron.ipcRenderer.send('boardstudio:terminal-resize', terminalDimensions());
        }
        if (options.focus === true && terminalSurfaceSelected) {
            terminal.focus();
        }
        return true;
    } catch {
        return false;
    }
}

function scheduleFit(options = {}) {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => fitTerminal(options));
    });
}

function setTerminalFontPoints(points) {
    const nextPoints = clampTerminalFontPoints(points);
    if (nextPoints === terminalFontPoints) {
        return false;
    }
    terminalFontPoints = nextPoints;
    persistTerminalFontPoints(nextPoints);
    if (terminal) {
        terminal.options.fontSize = terminalFontSizePixels(nextPoints);
        scheduleFit({ focus: true });
    }
    return true;
}

function handleTerminalZoom(deltaY) {
    const delta = Number(deltaY);
    if (!Number.isFinite(delta) || delta === 0) {
        return false;
    }
    const direction = delta < 0 ? 1 : -1;
    return setTerminalFontPoints(terminalFontPoints + (direction * TERMINAL_FONT_STEP_POINTS));
}

function clearPendingInput() {
    pendingInput = [];
    pendingInputBytes = 0;
}

function sendOrQueueTerminalInput(data) {
    const text = typeof data === 'string' ? data : '';
    if (!text || !electron?.ipcRenderer?.send) {
        return false;
    }
    if (attached) {
        electron.ipcRenderer.send('boardstudio:terminal-input', text);
        return true;
    }
    if (!attaching) {
        return false;
    }
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (byteLength <= 0 || pendingInputBytes + byteLength > MAX_PENDING_INPUT_BYTES) {
        return false;
    }
    pendingInput.push(text);
    pendingInputBytes += byteLength;
    return true;
}

function flushPendingInput() {
    if (!attached || pendingInput.length === 0) {
        return;
    }
    const queued = pendingInput;
    clearPendingInput();
    queued.forEach((data) => {
        electron.ipcRenderer.send('boardstudio:terminal-input', data);
    });
}

function closeTerminalContextMenu() {
    if (!terminalContextMenuEl) {
        return;
    }
    terminalContextMenuEl.classList.remove('is-open');
    terminalContextMenuEl.hidden = true;
}

async function requestTerminalRestart() {
    if (restartInFlight || !electron?.ipcRenderer?.invoke) {
        return false;
    }
    restartInFlight = true;
    clearPendingInput();
    pendingData = [];
    terminal?.reset();
    lastSequence = 0;
    if (isTerminalSurfaceVisible()) {
        showStatus('Restarting terminal...');
    }
    try {
        const response = await electron.ipcRenderer.invoke('boardstudio:terminal-restart', terminalDimensions());
        if (!response?.success) {
            throw new Error(response?.error || 'terminal-restart-failed');
        }
        const generation = Math.max(0, Math.round(Number(response.generation) || 0));
        terminal?.reset();
        terminalGeneration = generation;
        lastSequence = Math.max(0, Math.round(Number(response.lastSequence) || 0));
        attached = true;
        attaching = false;
        hideStatus();
        console.info('Terminal restarted', { generation });
        return true;
    } catch (error) {
        showStatus(error?.message || 'Terminal restart failed.', { action: true, buttonLabel: 'Retry' });
        console.error('Terminal restart failed', error);
        return false;
    } finally {
        restartInFlight = false;
    }
}

function openTerminalContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!terminalContextMenuEl) {
        terminalContextMenuEl = document.createElement('div');
        terminalContextMenuEl.className = 'terminal-context-menu';
        terminalContextMenuEl.hidden = true;
        const restartButton = document.createElement('button');
        restartButton.type = 'button';
        restartButton.className = 'terminal-context-menu-item danger';
        restartButton.textContent = 'Restart terminal';
        restartButton.addEventListener('click', () => {
            closeTerminalContextMenu();
            requestTerminalRestart();
        });
        terminalContextMenuEl.appendChild(restartButton);
        document.body.appendChild(terminalContextMenuEl);
    }
    terminalContextMenuEl.style.left = `${Math.round(event.clientX)}px`;
    terminalContextMenuEl.style.top = `${Math.round(event.clientY)}px`;
    terminalContextMenuEl.hidden = false;
    terminalContextMenuEl.classList.add('is-open');
    const rect = terminalContextMenuEl.getBoundingClientRect();
    const padding = 8;
    terminalContextMenuEl.style.left = `${Math.max(padding, Math.min(
        Math.round(event.clientX),
        window.innerWidth - rect.width - padding
    ))}px`;
    terminalContextMenuEl.style.top = `${Math.max(padding, Math.min(
        Math.round(event.clientY),
        window.innerHeight - rect.height - padding
    ))}px`;
}

function createTerminalSurface() {
    if (shellEl) {
        return shellEl;
    }
    shellEl = document.createElement('div');
    shellEl.className = 'terminal-shell';

    stageEl = document.createElement('div');
    stageEl.className = 'terminal-stage';
    stageEl.setAttribute('aria-label', 'Terminal');
    viewportEl = document.createElement('div');
    viewportEl.className = 'terminal-viewport';
    stageEl.appendChild(viewportEl);

    statusEl = document.createElement('div');
    statusEl.className = 'terminal-status';
    statusEl.hidden = true;
    statusMessageEl = document.createElement('div');
    statusMessageEl.className = 'terminal-status-message';
    statusButtonEl = document.createElement('button');
    statusButtonEl.type = 'button';
    statusButtonEl.className = 'terminal-status-button';
    statusButtonEl.textContent = 'Start terminal';
    statusButtonEl.addEventListener('click', () => {
        if (attached) {
            hideStatus();
            return;
        }
        ensureAttached({ focus: true, force: true });
    });
    statusEl.append(statusMessageEl, statusButtonEl);
    shellEl.append(stageEl, statusEl);

    terminal = new Terminal({
        allowProposedApi: true,
        cursorBlink: true,
        cursorStyle: 'block',
        cursorInactiveStyle: 'none',
        fontFamily: 'Consolas, monospace',
        // Font size is kept in points like most terminals; xterm.js expects CSS pixels.
        fontSize: terminalFontSizePixels(),
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        letterSpacing: 0,
        lineHeight: 1,
        minimumContrastRatio: 1,
        scrollback: 10000,
        theme: terminalTheme()
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(viewportEl);
    terminal.parser.registerCsiHandler({ intermediates: ' ', final: 'q' }, (params) => {
        terminal.options.cursorStyle = blinkingCursorStyle(params);
        terminal.options.cursorBlink = true;
        return true;
    });

    installTerminalInput({
        terminal, stage: stageEl, clipboard: electron?.clipboard,
        write: sendOrQueueTerminalInput, zoom: handleTerminalZoom,
        canWrite: (bytes) => attached || (attaching && pendingInputBytes + bytes <= MAX_PENDING_INPUT_BYTES),
        onError: (message) => {
            console.warn(message);
            showStatus(message, { action: true, buttonLabel: attached ? 'Dismiss' : 'Retry' });
        }
    });
    terminal.onResize(({ cols, rows }) => {
        if (attached && electron?.ipcRenderer?.send) {
            electron.ipcRenderer.send('boardstudio:terminal-resize', { cols, rows });
        }
    });
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(viewportEl);
    shellEl.addEventListener('pointerdown', () => {
        terminalSurfaceSelected = true;
        terminal?.focus();
        updateTerminalPresentation();
    });
    shellEl.addEventListener('paste', (event) => event.stopPropagation());
    updateTerminalPresentation();
    return shellEl;
}

async function ensureCapability() {
    if (capability) {
        return capability;
    }
    if (capabilityPromise) {
        return capabilityPromise;
    }
    capabilityPromise = electron?.ipcRenderer?.invoke
        ? electron.ipcRenderer.invoke('boardstudio:terminal-capability').catch((error) => ({
            available: false,
            error: error?.message || 'terminal-capability-failed'
        }))
        : Promise.resolve({ available: false, error: 'terminal-ipc-unavailable' });
    capability = await capabilityPromise;
    capabilityPromise = null;
    if (dom.terminalEdge) {
        dom.terminalEdge.hidden = capability?.available !== true;
    }
    if (capability?.available !== true && env.terminalPanel?.isOpen?.()) {
        env.terminalPanel.setOpen(false);
    }
    return capability;
}

async function ensureAttached(options = {}) {
    if (attached || attaching || !isTerminalSurfaceVisible()) {
        if (options.focus === true) {
            scheduleFit({ focus: true });
        }
        return;
    }
    if (!options.force && typeof document.hasFocus === 'function' && !document.hasFocus()) {
        return;
    }
    createTerminalSurface();
    if (options.focus === true) {
        terminal?.focus();
    }
    attaching = true;
    pendingData = [];
    clearPendingInput();
    showStatus('Starting terminal...');
    try {
        const resolvedCapability = await ensureCapability();
        if (resolvedCapability?.available !== true) {
            throw new Error('Terminal is unavailable, node-pty did not load.');
        }
        fitTerminal({ focus: options.focus === true });
        const response = await electron.ipcRenderer.invoke('boardstudio:terminal-start', terminalDimensions());
        if (!response?.success) {
            throw new Error(response?.error || 'terminal-start-failed');
        }
        const generation = Math.max(0, Math.round(Number(response.generation) || 0));
        if (generation !== terminalGeneration) {
            terminal.reset();
            terminalGeneration = generation;
            lastSequence = 0;
        }
        const replay = typeof response.replay === 'string' ? response.replay : '';
        if (replay) {
            await queueTerminalWrite(replay);
        }
        lastSequence = Math.max(lastSequence, Math.round(Number(response.lastSequence) || 0));
        const queued = pendingData;
        pendingData = [];
        attached = true;
        attaching = false;
        queued.forEach(applyTerminalData);
        flushPendingInput();
        hideStatus();
        scheduleFit({ focus: options.focus !== false });
    } catch (error) {
        attached = false;
        attaching = false;
        pendingData = [];
        clearPendingInput();
        showStatus(error?.message || 'Terminal failed to start.', { action: true, buttonLabel: 'Retry' });
    }
}

function render(root) {
    if (!root) {
        return;
    }
    const surface = createTerminalSurface();
    if (surface.parentElement !== root) {
        root.appendChild(surface);
    }
    terminal.options.theme = terminalTheme();
    updateTerminalPresentation();
    ensureCapability().then(() => {
        if (isTerminalSurfaceVisible()) {
            const focus = typeof document.hasFocus !== 'function' || document.hasFocus();
            scheduleFit({ focus });
            // A panel restored after a reload reattaches even while the window is unfocused.
            ensureAttached({ focus, force: true });
        }
    });
}

function deactivate() {
    terminalSurfaceSelected = false;
    if (shellEl?.isConnected) {
        shellEl.remove();
    }
    const active = document.activeElement;
    if (active && shellEl?.contains(active) && typeof active.blur === 'function') {
        active.blur();
    }
    updateTerminalPresentation();
}

function setVisible(visible) {
    if (!visible) {
        terminalSurfaceSelected = false;
        updateTerminalPresentation();
        return;
    }
    terminalSurfaceSelected = true;
    createTerminalSurface();
    terminal?.focus();
    scheduleFit({ focus: true });
    ensureAttached({ focus: true, force: userIntent });
    updateTerminalPresentation();
}

function activate() {
    userIntent = true;
    terminalSurfaceSelected = true;
    if (isTerminalSurfaceVisible()) {
        createTerminalSurface();
        terminal?.focus();
        scheduleFit({ focus: true });
        ensureAttached({ focus: true, force: true });
    }
    updateTerminalPresentation();
}

function ownsKeyboardEvent(event) {
    const target = event?.target;
    const active = document.activeElement;
    return !!(
        target?.closest?.('.terminal-shell')
        || active?.closest?.('.terminal-shell')
    );
}

function blurTerminalKeyboardFocus() {
    const active = document.activeElement;
    if (active && shellEl?.contains(active) && typeof active.blur === 'function') {
        active.blur();
    }
}

function initialize() {
    console.info('Board terminal ready');
    if (electron?.ipcRenderer?.on) {
        electron.ipcRenderer.on('boardstudio:terminal-data', handleTerminalData);
        electron.ipcRenderer.on('boardstudio:terminal-state', handleTerminalState);
    }
    document.addEventListener('pointerdown', (event) => {
        if (terminalContextMenuEl && !terminalContextMenuEl.hidden && !terminalContextMenuEl.contains(event.target)) {
            closeTerminalContextMenu();
        }
        if (!isTerminalSurfaceVisible() || shellEl?.contains(event.target)) {
            return;
        }
        terminalSurfaceSelected = resolveTerminalSelectionAfterPointer(event, terminalSurfaceSelected);
        blurTerminalKeyboardFocus();
        updateTerminalPresentation();
    }, true);
    document.addEventListener('focusin', (event) => {
        if (!isTerminalSurfaceVisible()) {
            return;
        }
        if (shellEl?.contains(event.target)) {
            terminalSurfaceSelected = true;
        } else if (isTextEntryTarget(event.target)) {
            terminalSurfaceSelected = false;
        }
        updateTerminalPresentation();
    });
    window.addEventListener('focus', () => {
        if (isTerminalSurfaceVisible() && terminalSurfaceSelected) {
            terminal?.focus();
            ensureAttached({ focus: true });
        }
        updateTerminalPresentation();
    });
    window.addEventListener('blur', updateTerminalPresentation);
    document.addEventListener('visibilitychange', () => {
        if (isTerminalSurfaceVisible()) {
            scheduleFit();
            ensureAttached({ focus: false });
        }
        updateTerminalPresentation();
    });
    ensureCapability();
}

env.terminalView = env.terminalView || {};
env.terminalView.render = render;
env.terminalView.deactivate = deactivate;
env.terminalView.setVisible = setVisible;
env.terminalView.activate = activate;
env.terminalView.fit = fitTerminal;
env.terminalView.ownsKeyboardEvent = ownsKeyboardEvent;
env.terminalView.ensureAttached = ensureAttached;
env.terminalView.restart = requestTerminalRestart;
env.terminalView.openContextMenu = openTerminalContextMenu;
env.terminalView.isAvailable = () => (capability ? capability.available === true : null);
env.terminalView.viewId = TERMINAL_VIEW_ID;

initialize();

module.exports = env.terminalView;
