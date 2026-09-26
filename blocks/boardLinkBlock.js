'use strict';

// MARK: BOARD LINK BLOCK
const env = require('../core/state');
const { state, movement } = env;

function render(block, element) {
    if (!block || !element) {
        return;
    }
    element.dataset.targetBoardId = block.targetBoardId || '';
    element.innerHTML = '';

    const iconButton = document.createElement('button');
    iconButton.type = 'button';
    iconButton.classList.add('board-link-icon-button');

    const icon = document.createElement('span');
    icon.classList.add('board-link-icon');
    const targetBoard = state.boardData?.boards?.[block.targetBoardId];
    icon.textContent = '';
    if (targetBoard && typeof env.management.applyBoardIconToElement === 'function') {
        env.management.applyBoardIconToElement(targetBoard.id, icon);
    }
    iconButton.appendChild(icon);

    const clickState = { x: 0, y: 0, moved: false };
    const dragThreshold = 6;

    iconButton.addEventListener('pointerdown', (event) => {
        clickState.x = event.clientX;
        clickState.y = event.clientY;
        clickState.moved = false;
        if (movement && typeof movement.selectBlock === 'function') {
            movement.selectBlock(block.id);
        }
    });

    iconButton.addEventListener('pointermove', (event) => {
        if (clickState.moved) {
            return;
        }
        const dx = event.clientX - clickState.x;
        const dy = event.clientY - clickState.y;
        if (Math.hypot(dx, dy) >= dragThreshold) {
            clickState.moved = true;
        }
    });

    iconButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (state.pendingDrag || state.dragState || clickState.moved) {
            return;
        }

        if (block.targetBoardId && typeof env.management.navigateToBoard === 'function') {
            env.management.navigateToBoard(block.targetBoardId, { direction: 'in' });
        }
    });

    const titleEl = document.createElement('div');
    titleEl.classList.add('board-link-title');
    const resolvedTitle = targetBoard ? targetBoard.title : (block.title || 'Board');
    titleEl.textContent = resolvedTitle;
    if (!resolvedTitle || !resolvedTitle.trim()) {
        titleEl.classList.add('empty');
    }
    titleEl.setAttribute('tabindex', '0');

    const startRename = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (movement && typeof movement.selectBlock === 'function') {
            movement.selectBlock(block.id);
        }
        if (typeof env.management.beginInlineBoardRename === 'function') {
            env.management.beginInlineBoardRename(block.targetBoardId, titleEl, {
                iconElement: icon
            });
        }
    };

    titleEl.addEventListener('click', startRename);
    titleEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            startRename(event);
        }
    });

    // Apply size scaling based on block dimensions (width/height)
    try {
        const base = 96; // px
        const w = Math.max(1, Number(block.width) || base);
        const scale = Math.max(0.6, Math.min(3, w / base));
        titleEl.style.fontSize = `${Math.round(18 * scale)}px`;
    } catch {}

    element.appendChild(iconButton);
    element.appendChild(titleEl);
}

const api = {
    render
};

env.blocks.boardLink = {
    ...(env.blocks.boardLink || {}),
    ...api
};

env.boardLinks = env.blocks.boardLink;

module.exports = env.blocks.boardLink;
