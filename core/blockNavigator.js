'use strict';

// MARK: BLOCK NAVIGATOR OVERLAY
const env = require('./state');
const { state, data, management, constants } = env;

let overlayEl = null;
let listEl = null;
let isVisible = false;

function ensureOverlay() {
    if (overlayEl) {
        return;
    }
    overlayEl = document.createElement('div');
    overlayEl.className = 'block-navigator-overlay hidden';

    const panel = document.createElement('div');
    panel.className = 'block-navigator-panel';

    const header = document.createElement('div');
    header.className = 'block-navigator-header';

    const title = document.createElement('h2');
    title.textContent = 'Blocks on this Board';
    header.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'block-navigator-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => toggle(false));
    header.appendChild(closeButton);

    panel.appendChild(header);

    listEl = document.createElement('div');
    listEl.className = 'block-navigator-list';
    panel.appendChild(listEl);

    overlayEl.appendChild(panel);

    overlayEl.addEventListener('click', (event) => {
        if (event.target === overlayEl) {
            toggle(false);
        }
    });

    document.body.appendChild(overlayEl);
}

function formatBlockLabel(block) {
    const title = String(block.title || '').trim();
    if (title) {
        return `${block.type} – ${title}`;
    }
    if (block.type === 'board-link' && block.targetBoardId) {
        const target = state.boardData?.boards?.[block.targetBoardId];
        if (target?.title) {
            return `${block.type} – ${target.title}`;
        }
    }
    return `${block.type} – ${block.id}`;
}

function resetBlockPosition(block) {
    block.x = 0;
    block.y = 0;
    block.updatedAt = new Date().toISOString();
    data.queueSave('block-reset-position');
    if (typeof management.renderBoard === 'function') {
        management.renderBoard();
    }
    renderList();
}

function renderList() {
    if (!listEl) {
        return;
    }
    listEl.innerHTML = '';
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (!board || !Array.isArray(board.blocks) || board.blocks.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'block-navigator-empty';
        empty.textContent = 'No blocks on this board.';
        listEl.appendChild(empty);
        return;
    }
    board.blocks.forEach((block) => {
        const row = document.createElement('div');
        row.className = 'block-navigator-row';

        const info = document.createElement('div');
        info.className = 'block-navigator-info';
        info.textContent = formatBlockLabel(block);
        row.appendChild(info);

        const position = document.createElement('div');
        position.className = 'block-navigator-position';
        position.textContent = `(${block.x}, ${block.y})`;
        row.appendChild(position);

        const actions = document.createElement('div');
        actions.className = 'block-navigator-actions';

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.textContent = 'Reset to 0,0';
        resetButton.addEventListener('click', () => resetBlockPosition(block));
        actions.appendChild(resetButton);

        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

function toggle(force) {
    ensureOverlay();
    const next = typeof force === 'boolean' ? force : !isVisible;
    isVisible = next;
    overlayEl.classList.toggle('hidden', !next);
    document.body.classList.toggle('block-navigator-open', next);
    if (next) {
        renderList();
    }
}

function handleKeydown(event) {
    if (event.defaultPrevented) {
        return;
    }
    if (state.paintModeActive) {
        return;
    }
    const paintHotkeyBlockUntil = Number(state.paintModeHotkeyBlockUntil) || 0;
    if (paintHotkeyBlockUntil > Date.now()) {
        return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (key !== 'e') {
        return;
    }
    const active = document.activeElement;
    if (active && (active.isContentEditable || ['input', 'textarea'].includes((active.tagName || '').toLowerCase()))) {
        return;
    }
    event.preventDefault();
    toggle();
}

function init() {
    ensureOverlay();
    document.addEventListener('keydown', handleKeydown);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

env.blockNavigator = { toggle };

module.exports = env.blockNavigator;
