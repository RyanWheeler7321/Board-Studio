'use strict';

// MARK: TERMINAL PANEL
// Left-side panel that holds the terminal. Backquote toggles it.
const env = require('../core/state');

const { dom, state, utils } = env;
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 1400;
const PANEL_DEFAULT_WIDTH = 720;
const WIDTH_STORAGE_KEY = 'boardstudio.terminal.width';
// sessionStorage survives an in-place renderer reload but not a new Board window.
const OPEN_SESSION_KEY = 'boardstudio.terminal.open';

function panelState() {
    if (!state.terminalPanel) {
        state.terminalPanel = { isOpen: false, width: PANEL_DEFAULT_WIDTH, resize: null };
    }
    return state.terminalPanel;
}

function isOpen() {
    return panelState().isOpen === true;
}

function readStoredWidth() {
    try {
        const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
        return stored > 0 ? stored : PANEL_DEFAULT_WIDTH;
    } catch {
        return PANEL_DEFAULT_WIDTH;
    }
}

function applyWidth(width) {
    const maxWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, window.innerWidth - 160));
    const clamped = utils.clamp(Number(width) || PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, maxWidth);
    panelState().width = clamped;
    dom.terminalPanel?.style.setProperty('--terminal-panel-width', `${Math.round(clamped)}px`);
}

function rememberOpen(open) {
    try {
        if (open) {
            window.sessionStorage.setItem(OPEN_SESSION_KEY, '1');
        } else {
            window.sessionStorage.removeItem(OPEN_SESSION_KEY);
        }
    } catch {}
}

function updateDom() {
    const open = isOpen();
    dom.terminalPanel?.classList.toggle('is-collapsed', !open);
    dom.terminalPanel?.setAttribute('aria-hidden', open ? 'false' : 'true');
    dom.terminalDivider?.classList.toggle('is-hidden', !open);
    dom.terminalEdge?.classList.toggle('is-panel-open', open);
}

function setOpen(open, options = {}) {
    const panel = panelState();
    if (open && env.terminalView?.isAvailable?.() === false) {
        return false;
    }
    if (panel.isOpen === !!open) {
        if (open && options.focus !== false) {
            env.terminalView?.activate?.();
        }
        return true;
    }
    panel.isOpen = !!open;
    rememberOpen(panel.isOpen);
    updateDom();
    console.info('Terminal panel', { open: panel.isOpen });
    if (panel.isOpen) {
        env.terminalView?.render?.(dom.terminalHost);
        env.terminalView?.setVisible?.(true);
        if (options.focus !== false) {
            env.terminalView?.activate?.();
        }
    } else {
        env.terminalView?.setVisible?.(false);
        env.terminalView?.deactivate?.();
    }
    return true;
}

function toggle() {
    return setOpen(!isOpen());
}

function beginResize(event) {
    if (event.button !== 0 || !isOpen() || !dom.terminalDivider) {
        return;
    }
    event.preventDefault();
    panelState().resize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: dom.terminalPanel?.getBoundingClientRect().width || panelState().width
    };
    dom.terminalDivider.classList.add('is-dragging');
    dom.terminalPanel?.classList.add('is-resizing');
    try {
        dom.terminalDivider.setPointerCapture(event.pointerId);
    } catch {}
}

function moveResize(event) {
    const resize = panelState().resize;
    if (!resize || event.pointerId !== resize.pointerId) {
        return;
    }
    applyWidth(resize.startWidth + event.clientX - resize.startX);
}

function endResize(event) {
    const resize = panelState().resize;
    if (!resize || event.pointerId !== resize.pointerId) {
        return;
    }
    panelState().resize = null;
    dom.terminalDivider?.classList.remove('is-dragging');
    dom.terminalPanel?.classList.remove('is-resizing');
    try {
        dom.terminalDivider?.releasePointerCapture(resize.pointerId);
    } catch {}
    try {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(panelState().width)));
    } catch {}
    env.terminalView?.fit?.();
}

function initialize() {
    if (!dom.terminalPanel) {
        return;
    }
    applyWidth(readStoredWidth());
    dom.terminalDivider?.addEventListener('pointerdown', beginResize);
    dom.terminalDivider?.addEventListener('contextmenu', (event) => env.terminalView?.openContextMenu?.(event));
    dom.terminalEdge?.addEventListener('click', () => setOpen(true));
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    updateDom();
    let reopen = false;
    try {
        reopen = window.sessionStorage.getItem(OPEN_SESSION_KEY) === '1';
    } catch {}
    if (reopen) {
        setOpen(true, { focus: false });
    }
}

env.terminalPanel = env.terminalPanel || {};
env.terminalPanel.isOpen = isOpen;
env.terminalPanel.setOpen = setOpen;
env.terminalPanel.toggle = toggle;

initialize();

module.exports = env.terminalPanel;
