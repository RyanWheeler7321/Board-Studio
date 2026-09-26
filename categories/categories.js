'use strict';

const env = require('../core/state');
const boardDisplay = require('../automation/boardDisplay');

const { dom, state, constants, data } = env;
const CATEGORY_OPEN_DELAY_MS = 150;
const CATEGORY_CLOSE_DELAY_MS = 260;
const CATEGORY_DRAG_EDGE_PX = 22;
const CATEGORY_EDGE_EXIT_MARGIN_PX = 96;
let lastPointerClientX = Number.NaN;
let lastPointerAt = 0;

function dataTransferHasFiles(dataTransfer) {
    const types = Array.from(dataTransfer?.types || []);
    return types.includes('Files');
}

function clearOpenTimer() {
    if (state.categoryDrawerOpenTimer) {
        clearTimeout(state.categoryDrawerOpenTimer);
        state.categoryDrawerOpenTimer = null;
    }
}

function clearCloseTimer() {
    if (state.categoryDrawerCloseTimer) {
        clearTimeout(state.categoryDrawerCloseTimer);
        state.categoryDrawerCloseTimer = null;
    }
}

function setDrawerOpen(open, reason = '') {
    const next = open === true;
    clearOpenTimer();
    clearCloseTimer();
    state.categoryDrawerOpen = next;
    dom.categoryDrawer?.classList.toggle('is-open', next);
    dom.categoryDrawer?.setAttribute('aria-hidden', next ? 'false' : 'true');
    dom.workspace?.classList.toggle('is-category-drawer-open', next);
    if (!next) {
        clearDropTargetIndicator();
    }
    if (reason) {
        console.info('Category drawer visibility changed', { open: next, reason });
    }
}

function openDrawer(reason = 'mouse-edge', options = {}) {
    clearCloseTimer();
    if (state.categoryDrawerOpen) {
        return;
    }
    if (state.categoryDrawerOpenTimer && options.immediate !== true) {
        return;
    }
    const delay = options.immediate === true ? 0 : CATEGORY_OPEN_DELAY_MS;
    clearOpenTimer();
    state.categoryDrawerOpenTimer = setTimeout(() => {
        state.categoryDrawerOpenTimer = null;
        setDrawerOpen(true, reason);
    }, delay);
}

function closeDrawer(reason = 'pointer-leave', options = {}) {
    clearOpenTimer();
    if (!state.categoryDrawerOpen) {
        return;
    }
    if (state.categoryDrawerCloseTimer && options.immediate !== true) {
        return;
    }
    const delay = options.immediate === true ? 0 : CATEGORY_CLOSE_DELAY_MS;
    clearCloseTimer();
    state.categoryDrawerCloseTimer = setTimeout(() => {
        state.categoryDrawerCloseTimer = null;
        setDrawerOpen(false, reason);
    }, delay);
}

function getCategoryRecords() {
    const boards = state.boardData?.boards || {};
    return boardDisplay.getCategoryBoardIds()
        .map((boardId) => boards[boardId])
        .filter((board) => !!board);
}

function applyCategoryPreview(board, preview) {
    if (!board || !preview) {
        return;
    }
    if (typeof env.management?.applyBoardIconToElement === 'function') {
        env.management.applyBoardIconToElement(board.id, preview);
    }
}

function activateBoard(boardId, options = {}) {
    const normalizedId = String(boardId || '').trim().toLowerCase();
    if (!state.boardData?.boards?.[normalizedId]) {
        return false;
    }
    if (normalizedId === state.currentBoardId) {
        if (options.closeDrawer !== false) {
            closeDrawer('category-current', { immediate: true });
        }
        sync();
        return true;
    }
    env.management?.navigateToBoard?.(normalizedId, {
        direction: 'swap',
        immediate: options.immediate === true,
        saveReason: options.reason || 'category-switch'
    });
    if (options.closeDrawer !== false) {
        closeDrawer(options.reason || 'category-selected', { immediate: true });
    }
    sync(normalizedId);
    console.info('Board category activated', {
        boardId: normalizedId,
        source: options.reason || 'category-selected',
        immediate: options.immediate === true
    });
    return true;
}

function activateCategory(boardId, options = {}) {
    if (!boardDisplay.isCategoryBoardId(boardId)) {
        return false;
    }
    return activateBoard(boardId, options);
}

function activateRoot(options = {}) {
    return activateBoard(boardDisplay.ROOT_BOARD_ID, {
        ...options,
        reason: options.reason || 'category-return-root'
    });
}

function renderCards() {
    const list = dom.categoryDrawerList;
    if (!list) {
        return;
    }
    list.innerHTML = '';
    getCategoryRecords().forEach((board) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-card';
        button.dataset.categoryBoardId = board.id;
        button.setAttribute('aria-label', `Load ${board.title}`);

        const preview = document.createElement('span');
        preview.className = 'category-card-preview';
        preview.setAttribute('aria-hidden', 'true');
        applyCategoryPreview(board, preview);

        const name = document.createElement('span');
        name.className = 'category-card-name';
        name.textContent = board.title;

        button.append(preview, name);
        button.addEventListener('click', () => {
            activateCategory(board.id, { reason: 'category-card-click' });
        });
        button.addEventListener('dragenter', (event) => {
            if (dataTransferHasFiles(event.dataTransfer)) {
                event.preventDefault();
                button.classList.add('is-drop-target');
                openDrawer('category-file-drag', { immediate: true });
            }
        });
        button.addEventListener('dragover', (event) => {
            if (dataTransferHasFiles(event.dataTransfer)) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
                button.classList.add('is-drop-target');
            }
        });
        button.addEventListener('dragleave', () => {
            button.classList.remove('is-drop-target');
        });
        button.addEventListener('drop', (event) => {
            const files = Array.from(event.dataTransfer?.files || []);
            if (!files.length) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            button.classList.remove('is-drop-target');
            activateCategory(board.id, {
                immediate: true,
                closeDrawer: true,
                reason: 'category-card-file-drop'
            });
            const basePosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
            Promise.resolve(env.imports?.processFiles?.(files, basePosition, { arrange: true, append: true }))
                .catch((error) => {
                    console.error('Category file drop failed', error);
                    env.utils?.showToast?.('Category import failed');
                });
        });
        list.appendChild(button);
    });
    sync();
}

function sync(activeBoardId = state.currentBoardId) {
    const activeId = String(activeBoardId || '').trim().toLowerCase();
    dom.categoryDrawerList?.querySelectorAll?.('.category-card').forEach((card) => {
        const isActive = card.dataset.categoryBoardId === activeId;
        card.classList.toggle('is-active', isActive);
        card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        const board = state.boardData?.boards?.[card.dataset.categoryBoardId];
        const preview = card.querySelector('.category-card-preview');
        applyCategoryPreview(board, preview);
    });
}

function clearDropTargetIndicator() {
    dom.categoryDrawerList?.querySelectorAll?.('.category-card.is-drop-target').forEach((card) => {
        card.classList.remove('is-drop-target');
    });
}

function resolveBlockDropTarget(clientX, clientY) {
    clearDropTargetIndicator();
    if (!state.categoryDrawerOpen || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return null;
    }
    const node = document.elementFromPoint(clientX, clientY);
    const card = node?.closest?.('.category-card[data-category-board-id]');
    if (!card) {
        return null;
    }
    const boardId = String(card.dataset.categoryBoardId || '').trim().toLowerCase();
    if (!boardId || boardId === state.currentBoardId || !state.boardData?.boards?.[boardId]) {
        return null;
    }
    card.classList.add('is-drop-target');
    return boardId;
}

function getCategoryRightEdge() {
    const rect = dom.categoryEdgeTrigger?.getBoundingClientRect?.()
        || dom.workspace?.getBoundingClientRect?.();
    if (rect && Number.isFinite(rect.right) && rect.width > 0) {
        return rect.right;
    }
    return document.documentElement?.clientWidth || window.innerWidth || 0;
}

function isInsideWorkspace(node) {
    if (!node || !dom.workspace || typeof dom.workspace.contains !== 'function') {
        return false;
    }
    try {
        return dom.workspace.contains(node);
    } catch {
        return false;
    }
}

function isRightEdgeExit(event) {
    if (!event || isInsideWorkspace(event.relatedTarget)) {
        return false;
    }
    const rightEdge = getCategoryRightEdge();
    if (!(rightEdge > 0)) {
        return false;
    }
    const eventX = Number(event.clientX);
    const recentPointerX = Date.now() - lastPointerAt <= 250
        ? lastPointerClientX
        : Number.NEGATIVE_INFINITY;
    const furthestKnownX = Math.max(
        Number.isFinite(eventX) ? eventX : Number.NEGATIVE_INFINITY,
        Number.isFinite(recentPointerX) ? recentPointerX : Number.NEGATIVE_INFINITY
    );
    return furthestKnownX >= rightEdge - CATEGORY_EDGE_EXIT_MARGIN_PX;
}

function isCategorySurfaceTarget(target) {
    return !!target?.closest?.('.category-drawer, .category-edge-trigger');
}

function handleEdgePointerLeave(event) {
    if (isRightEdgeExit(event)) {
        openDrawer('mouse-edge-exit');
        return;
    }
    closeDrawer('edge-leave');
}

function handleDrawerPointerLeave(event) {
    if (isRightEdgeExit(event)) {
        openDrawer('drawer-edge-exit');
        return;
    }
    closeDrawer('drawer-leave');
}

function handleDocumentPointerMove(event) {
    if (!Number.isFinite(event.clientX)) {
        return;
    }
    lastPointerClientX = event.clientX;
    lastPointerAt = Date.now();
    if (!state.dragState && !state.categoryDrawerOpen && !state.categoryDrawerOpenTimer) {
        return;
    }
    const rightEdge = getCategoryRightEdge();
    const isNearRightEdge = rightEdge > 0 && event.clientX >= rightEdge - CATEGORY_EDGE_EXIT_MARGIN_PX;
    if (!isNearRightEdge && !isCategorySurfaceTarget(event.target)) {
        if (state.categoryDrawerOpenTimer) {
            clearOpenTimer();
        }
        if (state.categoryDrawerOpen) {
            closeDrawer('pointer-return-away');
        }
    }
    if (state.dragState && rightEdge > 0 && event.clientX >= rightEdge - CATEGORY_DRAG_EDGE_PX) {
        openDrawer('category-block-drag-edge');
    }
}

function handleDocumentPointerOut(event) {
    if (isRightEdgeExit(event)) {
        openDrawer('mouse-edge-exit');
    }
}

function handleWindowBlur() {
    closeDrawer('window-blur', { immediate: true });
}

function prepareRootForDisplay() {
    if (!state.boardData?.boards?.[boardDisplay.ROOT_BOARD_ID]) {
        return { success: false, error: 'root-unavailable' };
    }
    const previousBoardId = state.currentBoardId;
    try {
        data.persistBoardData?.(true, 'display-preflight');
        activateRoot({ immediate: true, closeDrawer: true, reason: 'display-preflight-root' });
        data.persistBoardData?.(true, 'display-root-ready');
        return {
            success: true,
            previousBoardId,
            boardId: state.currentBoardId,
            changed: previousBoardId !== state.currentBoardId
        };
    } catch (error) {
        console.error('Display Root preparation failed', error);
        return { success: false, error: error?.message || 'display-root-prepare-failed' };
    }
}

function initialize() {
    if (!dom.categoryDrawer || !dom.categoryEdgeTrigger || !dom.categoryDrawerList) {
        return;
    }
    dom.categoryEdgeTrigger.addEventListener('pointerenter', () => openDrawer('mouse-edge'));
    dom.categoryEdgeTrigger.addEventListener('pointerleave', handleEdgePointerLeave);
    dom.categoryEdgeTrigger.addEventListener('dragenter', (event) => {
        if (dataTransferHasFiles(event.dataTransfer)) {
            openDrawer('category-file-drag', { immediate: true });
        }
    });
    dom.categoryDrawer.addEventListener('pointerenter', () => {
        clearCloseTimer();
        openDrawer('drawer-enter', { immediate: true });
    });
    dom.categoryDrawer.addEventListener('pointerleave', handleDrawerPointerLeave);
    document.addEventListener('pointermove', handleDocumentPointerMove, { passive: true });
    document.addEventListener('pointerout', handleDocumentPointerOut, { passive: true });
    window.addEventListener('blur', handleWindowBlur);
    renderCards();
}

env.categories = {
    ...(env.categories || {}),
    initialize,
    renderCards,
    sync,
    openDrawer,
    closeDrawer,
    activateCategory,
    activateRoot,
    resolveBlockDropTarget,
    clearDropTargetIndicator,
    prepareRootForDisplay
};

initialize();

module.exports = env.categories;
