'use strict';

// MARK: BOARD MANAGEMENT
const env = require('./state');
const { dom, state, data, movement, utils, constants, menus, imports } = env;
const { TEXT_BASE_WIDTH, TEXT_BASE_HEIGHT } = env.blockMetrics;

const WORKBOARD_BLOCKS_CLIPBOARD_FORMAT = 'application/x-workboard-blocks';
const WORKBOARD_BLOCKS_CLIPBOARD_VERSION = 1;
const consumedCutClipboardIds = new Set();
const CREATION_FIELD_KEYS = ['conception', 'combination', 'contradiction', 'circumstance', 'counterplay', 'condition', 'clue'];
let pendingTextRefreshFrame = null;
let pendingTextRefreshFontTicket = 0;
let pendingViewportRestoreTask = null;

function clearPendingViewportRestoreTimers() {
    if (!pendingViewportRestoreTask) {
        return;
    }
    const { timeoutId, frameId } = pendingViewportRestoreTask;
    if (timeoutId !== null) {
        clearTimeout(timeoutId);
    }
    if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
    }
    pendingViewportRestoreTask = null;
}

function scheduleSettledViewportRestore(viewport, reason) {
    if (!env.movement?.restoreViewport) {
        return;
    }
    clearPendingViewportRestoreTimers();
    const safeViewport = data.sanitizeViewport ? data.sanitizeViewport(viewport || {}) : (viewport || {});
    const task = {
        timeoutId: null,
        frameId: null,
        startedAt: performance.now(),
        lastWidth: -1,
        lastHeight: -1,
        stableSamples: 0
    };
    const minDelayMs = 120;
    const maxDelayMs = 240;
    const pollDelayMs = 24;
    const tick = () => {
        if (pendingViewportRestoreTask !== task) {
            return;
        }
        task.frameId = null;
        const container = dom.boardContainer;
        const width = Math.max(0, Number(container?.clientWidth) || 0);
        const height = Math.max(0, Number(container?.clientHeight) || 0);
        if (width > 0 && height > 0 && width === task.lastWidth && height === task.lastHeight) {
            task.stableSamples += 1;
        } else {
            task.lastWidth = width;
            task.lastHeight = height;
            task.stableSamples = 0;
        }
        const elapsedMs = performance.now() - task.startedAt;
        if ((elapsedMs >= minDelayMs && task.stableSamples >= 1) || elapsedMs >= maxDelayMs) {
            pendingViewportRestoreTask = null;
            env.movement.restoreViewport({
                skipSave: true,
                viewport: safeViewport,
                reason: `${reason || 'settle'}-settled`
            });
            return;
        }
        task.timeoutId = setTimeout(() => {
            if (pendingViewportRestoreTask !== task) {
                return;
            }
            task.timeoutId = null;
            task.frameId = window.requestAnimationFrame(tick);
        }, pollDelayMs);
    };
    pendingViewportRestoreTask = task;
    task.timeoutId = setTimeout(() => {
        if (pendingViewportRestoreTask !== task) {
            return;
        }
        task.timeoutId = null;
        task.frameId = window.requestAnimationFrame(tick);
    }, pollDelayMs);
}

// MARK: INITIALIZATION
function hasVisibleBlockInViewport(board) {
    const container = dom.boardContainer;
    if (!container || typeof movement.getCanvasPad !== 'function') {
        return true;
    }
    if ((container.clientWidth || 0) < 50 || (container.clientHeight || 0) < 50) {
        return true;
    }
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    if (blocks.length === 0) {
        return true;
    }
    const pad = movement.getCanvasPad();
    const scale = utils.clamp(state.boardScale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
    if (!Number.isFinite(scale) || scale <= 0) {
        return true;
    }
    const viewLeft = (container.scrollLeft - pad) / scale;
    const viewTop = (container.scrollTop - pad) / scale;
    const viewRight = viewLeft + (container.clientWidth / scale);
    const viewBottom = viewTop + (container.clientHeight / scale);

    for (const block of blocks) {
        if (!block) {
            continue;
        }
        const left = Number(block.x);
        const top = Number(block.y);
        const width = Number(block.width);
        const height = Number(block.height);
        if (!Number.isFinite(left) || !Number.isFinite(top)) {
            continue;
        }
        const right = left + (Number.isFinite(width) ? width : 0);
        const bottom = top + (Number.isFinite(height) ? height : 0);
        const intersects = right >= viewLeft && left <= viewRight && bottom >= viewTop && top <= viewBottom;
        if (intersects) {
            return true;
        }
    }

    return false;
}

function initializeBoard() {
    console.info('Initializing board workspace');
    if (state.dataDirectoryNeedsSetup) {
        enterSplashMode();
        if (env.dataSetup && typeof env.dataSetup.show === 'function') {
            env.dataSetup.show();
        }
        return;
    }
    data.ensureDataDirectories();
    state.boardData = data.loadBoardData();
    if (data.loadClipboardSnapshot) {
        state.copiedBlocks = data.loadClipboardSnapshot();
        state.pendingWorkboardPaste = !!state.copiedBlocks;
    }
    const container = dom.boardContainer;
    if (container) {
        container.hidden = false;
    }
    const workspace = container ? container.closest('.workspace') : null;
    if (workspace) {
        workspace.classList.remove('is-splash');
    }
    const requested = state.launchBoardRequest;
    let requestedBoardId = '';
    if (requested) {
        const boards = state.boardData?.boards;
        if (boards) {
            const byId = String(requested.boardId || requested.board || '').trim();
            if (byId && boards[byId]) {
                requestedBoardId = byId;
            }
            if (!requestedBoardId) {
                const wantedTitle = String(requested.boardTitle || requested.board || '').trim().toLowerCase();
                if (wantedTitle) {
                    const ids = Object.keys(boards);
                    for (const id of ids) {
                        const title = String(boards[id]?.title || '').trim().toLowerCase();
                        if (title && title === wantedTitle) {
                            requestedBoardId = id;
                            break;
                        }
                    }
                }
            }
        }
    }
    state.currentBoardId = requestedBoardId || data.resolveInitialBoardId(state.boardData);
    const activeBoard = state.boardData.boards[state.currentBoardId];
    const initialViewport = data.sanitizeViewport
        ? data.sanitizeViewport((activeBoard && activeBoard.viewport) ? activeBoard.viewport : (state.boardData.viewport || { scale: 1, scrollX: 0, scrollY: 0 }))
        : ((activeBoard && activeBoard.viewport) ? activeBoard.viewport : (state.boardData.viewport || { scale: 1, scrollX: 0, scrollY: 0 }));
    state.boardScale = utils.clamp(initialViewport.scale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
    state.boardData.viewport = { ...initialViewport };
    if (activeBoard) {
        activeBoard.viewport = { ...initialViewport };
    }
    console.debug('Initializing board viewport', {
        boardId: state.currentBoardId,
        viewport: initialViewport
    });
    env.utils.forwardDebugLog('debug', ['management.initializeBoard Document Object Model refs', { hasBoardContainer: !!dom.boardContainer, hasBoardGrid: !!dom.boardGrid }]);
    if (dom.contextMenuEl) {
        dom.contextMenuEl.hidden = true;
        dom.contextMenuEl.classList.remove('is-visible');
    }
    state.contextMenuTargetBlockId = null;
    hideSettingsPanel({ skipFocus: true });
    initializeSettingsControls();
    renderBoard({ initial: true, targetViewport: initialViewport, skipViewportCommit: true });
    attachGlobalEvents();
    scheduleSettledViewportRestore(initialViewport, 'startup');
    console.info('Board workspace ready', { boardId: state.currentBoardId, blockCount: state.boardData.boards[state.currentBoardId]?.blocks.length || 0 });

    try {
        const wantsFit = !!requested?.zoomToFit;
        if (wantsFit && env.movement && typeof env.movement.zoomToFit === 'function') {
            setTimeout(() => env.movement.zoomToFit(), 0);
        }
    } catch {}

    if (env.backups && typeof env.backups.queueBoardBackup === 'function') {
        env.backups.queueBoardBackup('board-load');
    }
    try {
        if (env.history && typeof env.history.record === 'function') {
            env.history.record('init');
        }
    } catch {}
}

// MARK: SPLASH MODE
function enterSplashMode() {
    const container = dom.boardContainer;
    if (container) {
        container.hidden = true;
        container.scrollLeft = 0;
        container.scrollTop = 0;
    }
    const workspace = container ? container.closest('.workspace') : null;
    if (workspace) {
        workspace.classList.add('is-splash');
    }
    const grid = dom.boardGrid;
    if (grid) {
        grid.innerHTML = '';
    }
    const title = dom.currentBoardTitleEl;
    if (title) {
        title.textContent = 'No board loaded';
    }
    const breadcrumb = dom.breadcrumbEl;
    if (breadcrumb) {
        breadcrumb.innerHTML = '';
    }
    const upButton = dom.navUpButton;
    if (upButton) {
        upButton.classList.add('hidden');
    }
    movement.clearSelection?.();
    movement.resetPointerStates?.();
    state.selectedBlockId = null;
    state.selectedBlockIds.clear();
    state.boardData = null;
    state.currentBoardId = 'root';
    state.contextMenuTargetBlockId = null;
    hideContextMenu();
    hideSettingsPanel({ skipFocus: true });
}

// MARK: GLOBAL EVENTS
function attachGlobalEvents() {
    if (dom.boardGrid) {
        dom.boardGrid.addEventListener('dblclick', handleCanvasDoubleClick, { passive: false });
        dom.boardGrid.addEventListener('contextmenu', handleContextMenu, { passive: false });
        dom.boardGrid.addEventListener('pointerdown', movement.handleGridPointerDown);
    }
    if (dom.boardContainer) {
        dom.boardContainer.addEventListener('wheel', movement.handleZoom, { passive: false });
        dom.boardContainer.addEventListener('pointerdown', movement.handleContainerPointerDown);
        dom.boardContainer.addEventListener('pointermove', movement.handleContainerPointerMove, { passive: false });
        dom.boardContainer.addEventListener('scroll', () => {
            hideContextMenu();
            movement.updateGridBackground();
        });
    }
    document.addEventListener('pointermove', movement.updatePointerPosition, { passive: true });
    document.addEventListener('pointermove', movement.handlePointerMove, { passive: false });
    document.addEventListener('keydown', movement.handleKeydown);
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('paste', (event) => {
        if (typeof imports.handlePasteEvent === 'function') {
            imports.handlePasteEvent(event);
        }
    });
    document.addEventListener('pointerdown', (event) => {
        if (dom.contextMenuEl && !dom.contextMenuEl.hidden && !dom.contextMenuEl.contains(event.target)) {
            hideContextMenu();
        }
        if (dom.consolePanel && env.consoleUi?.clearFocus && state.console?.isVisible) {
            if (!dom.consolePanel.contains(event.target)) {
                env.consoleUi.clearFocus();
            }
        }
    });
    document.addEventListener('pointerup', (event) => {
        if (!dom.contextMenuEl || dom.contextMenuEl.hidden) {
            return;
        }
        if (dom.contextMenuEl.contains(event.target)) {
            return;
        }
        hideContextMenu();
    });
    window.addEventListener('pointerup', movement.handlePointerUp, { passive: false });
    window.addEventListener('pointercancel', movement.handlePointerUp, { passive: false });
    window.addEventListener('blur', () => {
        movement.handlePointerUp();
        env.sublists?.blurActiveEditor?.();
        hideContextMenu();
        hideSettingsPanel({ skipFocus: true });
    });
    window.addEventListener('resize', movement.handleViewportResize);
    if (dom.windowControlsEl) {
        dom.windowControlsEl.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) {
                return;
            }
            env.electron.ipcRenderer.invoke(env.windowControlChannel || 'board-window-control', button.dataset.action).catch((error) => {
                console.error('Window control failed', error);
            });
        });
    }
    if (dom.navUpButton) {
        dom.navUpButton.addEventListener('click', () => {
            const board = state.boardData.boards[state.currentBoardId];
            if (board?.parentId) {
                navigateToBoard(board.parentId, { direction: 'out' });
            }
        });
    }
    if (dom.currentBoardTitleEl) {
        dom.currentBoardTitleEl.setAttribute('tabindex', '0');
        dom.currentBoardTitleEl.addEventListener('click', (event) => {
            event.preventDefault();
            beginInlineBoardRename(state.currentBoardId, dom.currentBoardTitleEl);
        });
        dom.currentBoardTitleEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                beginInlineBoardRename(state.currentBoardId, dom.currentBoardTitleEl);
            }
        });
    }
    if (dom.refreshButton) {
        const button = dom.refreshButton;
        button.addEventListener('click', () => {
            refreshWorkspace({ source: 'button' });
        });
    }
    if (dom.settingsButton) {
        const button = dom.settingsButton;
        button.addEventListener('click', () => {
            if (state.settingsPanelOpen) {
                hideSettingsPanel();
                return;
            }
            showSettingsPanel();
        });
    }
    if (dom.settingsCloseButton) {
        const closeButton = dom.settingsCloseButton;
        closeButton.addEventListener('click', () => {
            hideSettingsPanel();
        });
    }
    if (dom.settingsOverlay) {
        const overlay = dom.settingsOverlay;
        overlay.addEventListener('pointerdown', (event) => {
            if (event.target === overlay) {
                hideSettingsPanel({ skipFocus: true });
            }
        });
    }
    window.addEventListener('beforeunload', () => {
        try {
            if (movement.stopActiveZoomAnimation) {
                movement.stopActiveZoomAnimation(false);
            }
            data.persistBoardData(true);
        } catch (error) {
            console.error('Failed to persist board data on unload', error);
        }
    });
}

// MARK: CANVAS EVENTS
function handleCanvasDoubleClick(event) {
    if (event.target.closest('.board-block')) {
        return;
    }
    event.preventDefault();
    hideContextMenu();
    const coords = movement.getBoardCoordinates(event);
    createTextBlockAt(coords);
}

function handleContextMenu(event) {
    if (event.clientX === 0 && event.clientY === 0) {
        return;
    }
    if (state.suppressNextContextMenu) {
        event.preventDefault();
        hideContextMenu();
        state.suppressNextContextMenu = false;
        return;
    }
    if (state.scaleState) {
        event.preventDefault();
        return;
    }
    hideSettingsPanel({ skipFocus: true });
    hideContextMenu();
    event.preventDefault();
    const coords = movement.getBoardCoordinates(event);
    if (coords) {
        state.lastPointerBoardPos = coords;
    }
    const targetBlock = event.target.closest('.board-block');
    const blockId = targetBlock ? targetBlock.dataset.id : null;
    state.contextMenuTargetBlockId = blockId;
    if (blockId) {
        if (!state.selectedBlockIds.has(blockId)) {
            movement.selectBlock(blockId);
        } else {
            state.selectedBlockId = blockId;
        }
    } else {
        movement.clearSelection();
    }
    if (!menus.populateMenu(blockId)) {
        state.contextMenuTargetBlockId = null;
        return;
    }
    showContextMenu(event.clientX, event.clientY);
}

// MARK: RENDER PIPELINE
function renderBoard(options = {}) {
    if (!state.boardData) {
        return;
    }
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        state.currentBoardId = 'root';
        renderBoard({ initial: true });
        return;
    }
    const perf = env.utils?.perf;
    const renderStart = perf ? perf.now() : 0;
    if (movement.resetZoomGestureState) {
        movement.resetZoomGestureState(options.initial ? 'board-initial-render' : 'board-render');
    }
    if (movement.resetZoomModifierState) {
        movement.resetZoomModifierState();
    }
    if (movement.resetPointerStates) {
        movement.resetPointerStates();
    }
    if (movement.ensureZoomStateIntegrity) {
        movement.ensureZoomStateIntegrity(options.initial ? 'board-initial-render' : 'board-render');
    }
    const preserveViewport = options.preserveViewport ?? (!options.initial && !options.targetViewport);
    ensureCanvasBounds(board);
    if (dom.currentBoardTitleEl) {
        dom.currentBoardTitleEl.textContent = board.title;
    }
    const renderedTextBlockIds = renderBlocks(board);
    if (env.sublists?.syncForBoard) {
        env.sublists.syncForBoard(board, { force: options.initial });
    }
    movement.updateGridBackground();
    const viewportToApply = options.targetViewport || (preserveViewport && movement.getCurrentViewportSnapshot ? movement.getCurrentViewportSnapshot() : movement.getActiveBoardViewport());
    const container = dom.boardContainer;
    state.boardScale = utils.clamp(viewportToApply?.scale ?? state.boardScale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
    movement.applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    const commitViewport = !options.skipViewportCommit;
    const pad = movement.getCanvasPad ? movement.getCanvasPad() : 0;
    if (container) {
        const resolvedScroll = movement.resolveViewportScrollForContainer
            ? movement.resolveViewportScrollForContainer(viewportToApply, container)
            : {
                scrollX: Number.isFinite(viewportToApply?.scrollX) ? viewportToApply.scrollX : 0,
                scrollY: Number.isFinite(viewportToApply?.scrollY) ? viewportToApply.scrollY : 0
            };
        container.scrollLeft = resolvedScroll.scrollX + pad;
        container.scrollTop = resolvedScroll.scrollY + pad;
        movement.enforceViewportBounds();
        if (commitViewport) {
            state.boardData.viewport = movement.getCurrentViewportSnapshot
                ? movement.getCurrentViewportSnapshot()
                : {
                    scale: state.boardScale,
                    scrollX: container.scrollLeft - pad,
                    scrollY: container.scrollTop - pad,
                    viewportWidth: container.clientWidth || 0,
                    viewportHeight: container.clientHeight || 0
                };
        }
    } else {
        if (commitViewport) {
            state.boardData.viewport = {
                scale: state.boardScale,
                scrollX: Number.isFinite(viewportToApply?.scrollX) ? viewportToApply.scrollX : 0,
                scrollY: Number.isFinite(viewportToApply?.scrollY) ? viewportToApply.scrollY : 0,
                viewportWidth: Number.isFinite(viewportToApply?.viewportWidth) ? viewportToApply.viewportWidth : 0,
                viewportHeight: Number.isFinite(viewportToApply?.viewportHeight) ? viewportToApply.viewportHeight : 0
            };
        }
    }
    if (board && commitViewport) {
        board.viewport = { ...(state.boardData.viewport || viewportToApply || {}) };
    }
    updateBreadcrumb(board);
    movement.syncSelectionWithBoard(board);
    schedulePostRenderTextRefresh(renderedTextBlockIds);
    state.boardData.activeBoardId = state.currentBoardId;
    const renderElapsed = perf ? perf.now() - renderStart : 0;
    const renderDetails = {
        boardId: board.id,
        blocks: board.blocks.length,
        durationMs: Number(renderElapsed.toFixed(1))
    };
    if (options.initial) {
        console.info('Rendering active board', renderDetails);
    } else {
        console.debug('Rendering board', renderDetails);
    }
    if (perf) {
        perf.logIfSlow('renderBoard', renderElapsed, {
            boardId: board.id,
            blocks: board.blocks.length,
            initial: !!options.initial
        });
    }
}

function refreshTextBlocksByIds(blockIds) {
    if (!env.textEditing || typeof env.textEditing.refreshTextBlock !== 'function') {
        return;
    }
    const activeEditingId = typeof document !== 'undefined'
        ? document.querySelector('.board-block.is-editing')?.dataset?.id || ''
        : '';
    const ids = Array.isArray(blockIds) ? blockIds : [];
    ids.forEach((id) => {
        if (!id) {
            return;
        }
        if (activeEditingId && id === activeEditingId) {
            return;
        }
        env.textEditing.refreshTextBlock(id);
    });
}

function schedulePostRenderTextRefresh(blockIds) {
    const ids = Array.isArray(blockIds)
        ? Array.from(new Set(blockIds.filter((id) => typeof id === 'string' && id.trim())))
        : [];
    if (!ids.length) {
        return;
    }
    refreshTextBlocksByIds(ids);
    if (pendingTextRefreshFrame && typeof cancelAnimationFrame === 'function') {
        try {
            cancelAnimationFrame(pendingTextRefreshFrame);
        } catch {}
        pendingTextRefreshFrame = null;
    }
    if (typeof requestAnimationFrame === 'function') {
        pendingTextRefreshFrame = requestAnimationFrame(() => {
            pendingTextRefreshFrame = null;
            refreshTextBlocksByIds(ids);
        });
    }
    const ticket = ++pendingTextRefreshFontTicket;
    try {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
            document.fonts.ready.then(() => {
                if (ticket !== pendingTextRefreshFontTicket) {
                    return;
                }
                refreshTextBlocksByIds(ids);
            }).catch(() => {});
        }
    } catch {}
}

function updateBreadcrumb(board) {
    if (!dom.breadcrumbEl || !state.boardData) {
        return;
    }
    const path = [];
    let current = board;
    while (current) {
        path.unshift(current);
        current = current.parentId ? state.boardData.boards[current.parentId] : null;
    }
    dom.breadcrumbEl.innerHTML = '';
    path.forEach((crumb, index) => {
        const button = document.createElement('button');
        button.textContent = crumb.title || 'Untitled';
        button.dataset.id = crumb.id;
        button.addEventListener('click', () => {
            if (crumb.id !== state.currentBoardId) {
                navigateToBoard(crumb.id, { direction: index < path.length - 1 ? 'out' : 'in' });
            }
        });
        dom.breadcrumbEl.appendChild(button);
        if (index < path.length - 1) {
            const sep = document.createElement('span');
            sep.textContent = '›';
            dom.breadcrumbEl.appendChild(sep);
        }
    });
    updateNavButton(board);
}

function updateNavButton(board) {
    if (!dom.navUpButton) {
        return;
    }
    if (board.parentId) {
        dom.navUpButton.classList.remove('hidden');
    } else {
        dom.navUpButton.classList.add('hidden');
    }
}

function renderBlocks(board) {
    if (!dom.boardGrid) {
        return [];
    }
    dom.boardGrid.innerHTML = '';
    const textBlockIds = [];
    board.blocks.forEach((block) => {
        const element = createBlockElement(block);
        dom.boardGrid.appendChild(element);
        if (block.type === 'text' || block.type === 'title') {
            textBlockIds.push(block.id);
        }
    });
    return textBlockIds;
}

function ensureCanvasBounds(board) {
    board.blocks.forEach((block) => {
        block.x = Math.max(block.x, constants.GRID_SIZE * 2);
        block.y = Math.max(block.y, constants.GRID_SIZE * 2);
    });
}

// MARK: BLOCK FACTORY
function createBlockElement(block) {
    const element = document.createElement('div');
    element.classList.add('board-block', `type-${block.type}`);
    if (block.type === 'board-link') {
        element.classList.add('board-link-block');
    }
    element.dataset.id = block.id;
    element.dataset.type = block.type;
    element.style.left = `${block.x}px`;
    element.style.top = `${block.y}px`;
    element.style.width = `${block.width}px`;
    element.style.height = `${block.height}px`;
    if (block.type === 'text') {
        env.blocks.text.render(block, element);
    } else if (block.type === 'title') {
        env.blocks.title.render(block, element);
    } else if (block.type === 'creation') {
        if (env.blocks.creation?.populateElement) {
            env.blocks.creation.populateElement(block, element);
        }
    } else if (block.type === 'image') {
        if (env.blocks.image?.populateElement) {
            env.blocks.image.populateElement(block, element);
        }
    } else if (block.type === 'audio') {
        if (env.blocks.audio?.populateElement) {
            env.blocks.audio.populateElement(block, element);
        }
        console.info('Audio block rendered', { id: block.id });
    } else if (block.type === 'video') {
        if (env.blocks.video?.populateElement) {
            env.blocks.video.populateElement(block, element);
        }
        console.info('Video block rendered', { id: block.id });
    } else if (block.type === 'link') {
        if (env.blocks.link?.populateElement) {
            env.blocks.link.populateElement(block, element);
        }
        console.info('Link block rendered', { id: block.id });
    } else if (block.type === 'youtube') {
        if (env.blocks.youtube?.populateElement) {
            env.blocks.youtube.populateElement(block, element);
        }
        console.info('YouTube block rendered', { id: block.id });
    } else if (block.type === 'board-link') {
        if (env.blocks.boardLink?.render) {
            env.blocks.boardLink.render(block, element);
        }
    }
    element.addEventListener('pointerdown', (event) => {
        if (element.classList.contains('is-editing')) {
            return;
        }
        movement.handleBlockPointerDown(event, block, element);
    });
    element.addEventListener('dblclick', (event) => {
        if (block.type === 'text' || block.type === 'title') {
            if (element.classList.contains('is-editing')) {
                return;
            }
            const displayEl = element.querySelector('.text-block-display');
            const caretOffset = env.textEditing.resolveCaretOffsetFromDisplay(displayEl);
            env.textEditing.beginTextEditing(block.id, { caretOffset });
        } else if (block.type === 'image') {
            if (env.paintMode?.openForBlock) {
                event.preventDefault();
                event.stopPropagation();
                env.paintMode.openForBlock(block.id);
            }
        } else if (block.type === 'creation') {
            if (env.blocks.creation?.focusFirstField) {
                event.preventDefault();
                event.stopPropagation();
                env.blocks.creation.focusFirstField(block.id);
            }
        } else if (block.type === 'board-link' && block.targetBoardId) {
            navigateToBoard(block.targetBoardId, { direction: 'in' });
        }
    });
    return element;
}

// MARK: BLOCK CREATION
function insertBlock(block, options = {}) {
    const boardData = state.boardData;
    if (!boardData || !block) {
        return null;
    }
    const board = boardData.boards[state.currentBoardId];
    if (!board) {
        return null;
    }
    const now = new Date().toISOString();
    if (!block.id) {
        const prefix = block.type || 'block';
        block.id = utils.createId(prefix);
    }
    const hasPosition = typeof block.x === 'number' && typeof block.y === 'number';
    if (!hasPosition) {
        const base = state.lastPointerBoardPos || { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
        const snapped = utils.snapPointToGrid(base);
        if (typeof block.x !== 'number') {
            block.x = snapped.x;
        }
        if (typeof block.y !== 'number') {
            block.y = snapped.y;
        }
    }
    if (typeof block.width !== 'number') {
        block.width = constants.GRID_SIZE * 6;
    }
    if (typeof block.height !== 'number') {
        block.height = constants.GRID_SIZE * 4;
    }
    if (!block.createdAt) {
        block.createdAt = now;
    }
    block.updatedAt = now;
    board.blocks.push(block);
    board.updatedAt = now;
    if (!options.skipRender) {
        renderBoard();
    }
    const reason = options.saveReason || 'block-insert';
    if (!options.skipSave) {
        data.queueSave(reason);
    }
    console.info('Block inserted', { id: block.id, type: block.type, reason });
    return block;
}

function createTextBlockAt(position) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
    const snappedPosition = utils.snapPointToGrid(basePosition);
    const now = new Date().toISOString();
    const block = {
        id: utils.createId('text'),
        type: 'text',
        x: snappedPosition.x,
        y: snappedPosition.y,
        width: TEXT_BASE_WIDTH,
        height: TEXT_BASE_HEIGHT,
        content: '',
        createdAt: now,
        updatedAt: now
    };
    const inserted = insertBlock(block, { saveReason: 'text-added' });
    if (!inserted) {
        return;
    }
    movement.selectBlock(inserted.id);
    env.textEditing.beginTextEditing(inserted.id);
    console.info('Text block created', { id: inserted.id });
}

function createTextBlockWithContent(position, content, options = {}) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return null;
    }
    const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
    const snappedPosition = utils.snapPointToGrid(basePosition);
    const now = new Date().toISOString();
    const block = {
        id: utils.createId('text'),
        type: 'text',
        x: snappedPosition.x,
        y: snappedPosition.y,
        width: TEXT_BASE_WIDTH,
        height: TEXT_BASE_HEIGHT,
        content: typeof content === 'string' ? content : '',
        createdAt: now,
        updatedAt: now
    };
    const inserted = insertBlock(block, { saveReason: options.saveReason || 'text-added' });
    if (!inserted) {
        return null;
    }
    const shouldSelect = options.select !== false;
    if (shouldSelect) {
        movement.selectBlock(inserted.id);
    }
    if (options.startEditing === false) {
        if (env.textEditing?.refreshTextBlock) {
            env.textEditing.refreshTextBlock(inserted.id);
        }
    } else {
        env.textEditing.beginTextEditing(inserted.id);
    }
    console.info('Text block created with content', { id: inserted.id, length: inserted.content.length });
    return inserted;
}

function createTitleBlockAt(position) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 4 };
    const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
    const snappedPosition = utils.snapPointToGrid(basePosition);
    const now = new Date().toISOString();
    const block = {
        id: utils.createId('title'),
        type: 'title',
        x: snappedPosition.x,
        y: snappedPosition.y,
        width: constants.GRID_SIZE * 22,
        height: constants.GRID_SIZE * 5,
        content: '',
        showBorder: false,
        showShadow: false,
        showUnderline: false,
        createdAt: now,
        updatedAt: now
    };
    const inserted = insertBlock(block, { saveReason: 'title-added' });
    if (!inserted) {
        return;
    }
    movement.selectBlock(inserted.id);
    env.textEditing.beginTextEditing(inserted.id);
    console.info('Title block created', { id: inserted.id });
}

function createDefaultCreationFields() {
    if (env.blocks.creation?.createDefaultFields) {
        return env.blocks.creation.createDefaultFields();
    }
    return CREATION_FIELD_KEYS.reduce((acc, key) => {
        acc[key] = '';
        return acc;
    }, {});
}

function createRandomCreationTheme() {
    const creationHue = Math.floor(Math.random() * 360);
    const creationSaturation = Math.floor((Math.random() * (30 - 16 + 1)) + 16);
    return { creationHue, creationSaturation };
}

function createCreationBlockAt(position) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return null;
    }
    const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
    const snappedPosition = utils.snapPointToGrid(basePosition);
    const now = new Date().toISOString();
    const theme = createRandomCreationTheme();
    const block = {
        id: utils.createId('creation'),
        type: 'creation',
        x: snappedPosition.x,
        y: snappedPosition.y,
        width: constants.GRID_SIZE * 13,
        height: constants.GRID_SIZE * 22,
        creationHue: theme.creationHue,
        creationSaturation: theme.creationSaturation,
        fields: createDefaultCreationFields(),
        createdAt: now,
        updatedAt: now
    };
    const inserted = insertBlock(block, { saveReason: 'creation-added' });
    if (!inserted) {
        return null;
    }
    movement.selectBlock(inserted.id);
    requestAnimationFrame(() => {
        if (env.blocks.creation?.focusFirstField) {
            env.blocks.creation.focusFirstField(inserted.id);
        }
    });
    console.info('Creation block created', { id: inserted.id });
    return inserted;
}

async function promptAndCreateBoard() {
    const parentBoard = state.boardData.boards[state.currentBoardId];
    if (!parentBoard) {
        utils.showToast('Unable to create board');
        return null;
    }
    const targetPosition = {
        x: state.lastPointerBoardPos?.x ?? constants.GRID_SIZE * 6,
        y: state.lastPointerBoardPos?.y ?? constants.GRID_SIZE * 6
    };
    const block = createBoardWithTitle('', targetPosition);
    if (!block) {
        return null;
    }
    renderBoard();
    requestAnimationFrame(() => {
        focusBoardLinkTitle(block.id);
    });
    return block;
}

function createBoardWithTitle(title, position) {
    const parentBoard = state.boardData.boards[state.currentBoardId];
    if (!parentBoard) {
        return null;
    }
    const newBoardId = utils.createId('board');
    const resolvedTitle = title && title.trim() ? title.trim() : 'New Board';
    const now = new Date().toISOString();
    state.boardData.boards[newBoardId] = {
        id: newBoardId,
        title: resolvedTitle,
        parentId: parentBoard.id,
        childIds: [],
        blocks: [],
        sublists: data.createDefaultSublists ? data.createDefaultSublists() : [data.createDefaultSublist()],
        useLocalSublists: false,
        iconPreview: '',
        viewport: {
            scale: state.boardScale,
            scrollX: 0,
            scrollY: 0
        },
        createdAt: now,
        updatedAt: now
    };
    parentBoard.childIds.push(newBoardId);
    parentBoard.updatedAt = now;
    const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
    const snappedPosition = utils.snapPointToGrid(basePosition);
    const boardLinkWidth = constants.GRID_SIZE * 3;
    const boardLinkHeight = constants.GRID_SIZE * 3;
    const block = {
        id: utils.createId('board-link'),
        type: 'board-link',
        targetBoardId: newBoardId,
        title: resolvedTitle,
        x: snappedPosition.x,
        y: snappedPosition.y,
        width: boardLinkWidth,
        height: boardLinkHeight,
        createdAt: now,
        updatedAt: now
    };
    parentBoard.blocks.push(block);
    data.queueSave('board-created');
    if (state.previewDirtyBoards) {
        state.previewDirtyBoards.add(newBoardId);
    }
    if (env.management.queueBoardPreviewCapture) {
        env.management.queueBoardPreviewCapture({ boardId: newBoardId, delay: 0, size: PREVIEW_DEFAULT_SIZE });
    }
    console.info('Board created', { boardId: newBoardId, title: resolvedTitle });
    return block;
}

// MARK: BOARD LINK MANAGEMENT
function getBoardInitial(title) {
    const match = title.trim().match(/[a-zA-Z0-9]/);
    return match ? match[0].toUpperCase() : 'B';
}

const PREVIEW_DEFAULT_SIZE = 192;
const PREVIEW_PADDING = 10;
const PREVIEW_BASE_STYLES = {
    background: '#16161c',
    border: '#2a2a34',
    blockFill: '#24242e',
    blockStroke: '#343441',
    imageFill: '#1f2a36',
    imageStroke: '#3a4b62',
    videoFill: '#232131',
    videoStroke: '#463a5e',
    audioFill: '#242236',
    audioStroke: '#3b3852',
    linkFill: '#1f2638',
    linkStroke: '#354561',
    titleFill: '#2b2236',
    titleStroke: '#5a4a73'
};

function getBoardPreviewBounds(board) {
    const baseWidth = constants.BASE_CANVAS_WIDTH || 1152;
    const baseHeight = constants.BASE_CANVAS_HEIGHT || 1152;
    const margin = constants.GRID_SIZE ? constants.GRID_SIZE * 2 : 64;
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    if (blocks.length === 0) {
        return {
            minX: 0,
            minY: 0,
            width: baseWidth + margin,
            height: baseHeight + margin
        };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    blocks.forEach((block) => {
        if (!block) {
            return;
        }
        const x = Number.isFinite(block.x) ? block.x : 0;
        const y = Number.isFinite(block.y) ? block.y : 0;
        const w = Number.isFinite(block.width) ? block.width : 0;
        const h = Number.isFinite(block.height) ? block.height : 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });
    if (!Number.isFinite(minX)) {
        minX = 0;
    }
    if (!Number.isFinite(minY)) {
        minY = 0;
    }
    const width = Math.max(baseWidth + margin, (maxX - minX) + margin);
    const height = Math.max(baseHeight + margin, (maxY - minY) + margin);
    return { minX, minY, width, height };
}

function resolvePreviewStyleForBlock(block) {
    if (!block || typeof block.type !== 'string') {
        return { fill: PREVIEW_BASE_STYLES.blockFill, stroke: PREVIEW_BASE_STYLES.blockStroke };
    }
    switch (block.type) {
        case 'image':
            return { fill: PREVIEW_BASE_STYLES.imageFill, stroke: PREVIEW_BASE_STYLES.imageStroke };
        case 'video':
            return { fill: PREVIEW_BASE_STYLES.videoFill, stroke: PREVIEW_BASE_STYLES.videoStroke };
        case 'audio':
            return { fill: PREVIEW_BASE_STYLES.audioFill, stroke: PREVIEW_BASE_STYLES.audioStroke };
        case 'link':
            return { fill: PREVIEW_BASE_STYLES.linkFill, stroke: PREVIEW_BASE_STYLES.linkStroke };
        case 'title':
            return { fill: PREVIEW_BASE_STYLES.titleFill, stroke: PREVIEW_BASE_STYLES.titleStroke };
        default:
            return { fill: PREVIEW_BASE_STYLES.blockFill, stroke: PREVIEW_BASE_STYLES.blockStroke };
    }
}

function buildBoardPreviewSvg(board, options = {}) {
    const size = Number.isFinite(options.size) ? Math.max(64, Math.round(options.size)) : PREVIEW_DEFAULT_SIZE;
    const padding = Number.isFinite(options.padding) ? Math.max(4, Math.round(options.padding)) : PREVIEW_PADDING;
    const bounds = getBoardPreviewBounds(board);
    const inner = Math.max(1, size - (padding * 2));
    const scale = Math.min(inner / bounds.width, inner / bounds.height);
    const offsetX = padding + ((inner - (bounds.width * scale)) / 2) - (bounds.minX * scale);
    const offsetY = padding + ((inner - (bounds.height * scale)) / 2) - (bounds.minY * scale);
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    const svg = [];
    svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`);
    svg.push(`<rect x="0" y="0" width="${size}" height="${size}" fill="${PREVIEW_BASE_STYLES.background}" stroke="${PREVIEW_BASE_STYLES.border}" stroke-width="1"/>`);
    blocks.forEach((block) => {
        if (!block) {
            return;
        }
        const style = resolvePreviewStyleForBlock(block);
        const x = Math.max(0, (block.x || 0) * scale + offsetX);
        const y = Math.max(0, (block.y || 0) * scale + offsetY);
        const w = Math.max(1, (block.width || 0) * scale);
        const h = Math.max(1, (block.height || 0) * scale);
        const rx = 0;
        svg.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" ry="${rx}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"/>`);
    });
    svg.push('</svg>');
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg.join(''))}`;
}

function applyBoardIconToElement(boardId, iconElement) {
    if (!iconElement || !state.boardData?.boards) {
        return;
    }
    const board = state.boardData.boards[boardId];
    if (!board) {
        return;
    }
    let preview = typeof board.iconPreview === 'string' ? board.iconPreview.trim() : '';
    const dirtySet = state.previewDirtyBoards;
    const needsPreview = !preview || (dirtySet ? dirtySet.has(boardId) : false);
    if (needsPreview && !state.previewCaptureInFlight) {
        try {
            state.previewCaptureInFlight = true;
            const nextPreview = buildBoardPreviewSvg(board, { size: PREVIEW_DEFAULT_SIZE });
            preview = nextPreview;
            if (nextPreview !== board.iconPreview) {
                board.iconPreview = nextPreview;
                board.updatedAt = new Date().toISOString();
                data.queueSave('board-preview');
            }
            if (dirtySet) {
                dirtySet.delete(boardId);
            }
        } catch (error) {
            console.error('Failed to build board preview', error);
        } finally {
            state.previewCaptureInFlight = false;
        }
    }
    iconElement.classList.toggle('is-empty-preview', !preview);
    if (preview) {
        iconElement.style.setProperty('--board-preview-url', `url("${preview}")`);
        iconElement.textContent = '';
        return;
    }
    iconElement.style.removeProperty('--board-preview-url');
    iconElement.textContent = '';
}

function refreshBoardLinkIcons(boardId) {
    if (!boardId) {
        return;
    }
    document.querySelectorAll(`.board-block[data-target-board-id="${boardId}"] .board-link-icon`).forEach((node) => {
        applyBoardIconToElement(boardId, node);
    });
}

function updateBoardLinkTitles(boardId, newTitle) {
    if (!state.boardData || !boardId) {
        return;
    }
    const boards = state.boardData.boards || {};
    Object.values(boards).forEach((board) => {
        if (!Array.isArray(board?.blocks)) {
            return;
        }
        board.blocks.forEach((block) => {
            if (block.type === 'board-link' && block.targetBoardId === boardId) {
                block.title = newTitle;
                block.updatedAt = new Date().toISOString();
            }
        });
    });
    refreshBoardLinkIcons(boardId);
}

function focusBoardLinkTitle(blockId) {
    if (!blockId) {
        return;
    }
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const block = board.blocks.find((item) => item.id === blockId);
    if (!block || !block.targetBoardId) {
        return;
    }
    const element = document.querySelector(`.board-block[data-id="${blockId}"] .board-link-title`);
    const iconElement = document.querySelector(`.board-block[data-id="${blockId}"] .board-link-icon`);
    if (element) {
        beginInlineBoardRename(block.targetBoardId, element, {
            iconElement
        });
    }
}

function beginInlineBoardRename(boardId, element, options = {}) {
    if (!element || element.dataset.editing === 'true') {
        return;
    }
    const board = state.boardData.boards[boardId];
    if (!board) {
        return;
    }
    const originalTitle = board.title || 'Untitled Board';
    const selection = window.getSelection ? window.getSelection() : null;
    element.dataset.editing = 'true';
    element.classList.add('is-editing');
    element.setAttribute('contenteditable', 'true');
    element.focus({ preventScroll: true });
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    const cleanup = () => {
        element.classList.remove('is-editing');
        element.removeAttribute('contenteditable');
        delete element.dataset.editing;
        element.removeEventListener('keydown', handleKeydown);
        element.removeEventListener('blur', handleBlur);
    };
    const applyTitle = (value, cancel = false) => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        const nextTitle = cancel ? originalTitle : (trimmed || 'Untitled Board');
        const previousTitle = board.title || originalTitle;
        const changed = nextTitle !== previousTitle;
        board.title = nextTitle;
        if (changed) {
            board.updatedAt = new Date().toISOString();
            updateBoardLinkTitles(boardId, nextTitle);
        }
        const applyTitleToNode = (node) => {
            if (!node) {
                return;
            }
            node.textContent = nextTitle;
            if (nextTitle.trim()) {
                node.classList.remove('empty');
            } else {
                node.classList.add('empty');
            }
        };
        applyTitleToNode(element);
        if (changed) {
            document.querySelectorAll(`.board-block[data-target-board-id="${boardId}"] .board-link-title`).forEach((node) => {
                if (node !== element) {
                    applyTitleToNode(node);
                }
            });
            refreshBoardLinkIcons(boardId);
            if (dom.currentBoardTitleEl && state.currentBoardId === boardId) {
                dom.currentBoardTitleEl.textContent = nextTitle;
            }
            if (state.currentBoardId === boardId) {
                updateBreadcrumb(board);
            } else {
                const activeBoard = state.boardData.boards[state.currentBoardId];
                if (activeBoard) {
                    updateBreadcrumb(activeBoard);
                }
            }
            data.queueSave('board-rename-inline');
        } else if (dom.currentBoardTitleEl && state.currentBoardId === boardId) {
            dom.currentBoardTitleEl.textContent = nextTitle;
        }
    };
    const handleBlur = () => {
        applyTitle(element.textContent || '', false);
        cleanup();
    };
    const handleKeydown = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            applyTitle(element.textContent || '', false);
            cleanup();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            element.textContent = originalTitle;
            applyTitle(originalTitle, true);
            cleanup();
        }
    };
    element.addEventListener('blur', handleBlur);
    element.addEventListener('keydown', handleKeydown);
}

function queueBoardPreviewCapture(options = {}) {
    if (!state.boardData?.boards) {
        return;
    }
    const boardId = options.boardId || state.currentBoardId;
    const board = state.boardData.boards[boardId];
    if (!board) {
        return;
    }
    const dirtySet = state.previewDirtyBoards;
    const isDirty = dirtySet ? dirtySet.has(boardId) : false;
    const needsPreview = !!options.force || isDirty || !board.iconPreview;
    if (!needsPreview) {
        return;
    }
    const delay = Number.isFinite(options.delay) ? options.delay : 120;
    clearTimeout(state.previewCaptureTimer);
    state.previewCaptureTimer = setTimeout(() => {
        captureBoardPreview(boardId, options);
    }, delay);
}

async function captureBoardPreview(boardId, options = {}) {
    if (!boardId) {
        return;
    }
    if (state.previewCaptureInFlight) {
        state.previewCaptureTimer = setTimeout(() => {
            captureBoardPreview(boardId, options);
        }, 120);
        return;
    }
    const board = state.boardData?.boards?.[boardId];
    if (!board) {
        return;
    }
    state.previewCaptureInFlight = true;
    const perf = env.utils?.perf;
    const captureStart = perf ? perf.now() : 0;
    try {
        const size = Number.isFinite(options.size) ? options.size : PREVIEW_DEFAULT_SIZE;
        const dataUrl = buildBoardPreviewSvg(board, { size });
        const trimmed = typeof dataUrl === 'string' ? dataUrl.trim() : '';
        if (!trimmed) {
            return;
        }
        const changed = trimmed !== board.iconPreview;
        if (changed) {
            board.iconPreview = trimmed;
            board.updatedAt = new Date().toISOString();
            refreshBoardLinkIcons(boardId);
            data.queueSave('board-preview');
        }
        if (state.previewDirtyBoards) {
            state.previewDirtyBoards.delete(boardId);
        }
        if (perf) {
            perf.logIfSlow('captureBoardPreview', perf.now() - captureStart, {
                boardId,
                size,
                updated: changed
            });
        }
    } catch (error) {
        console.error('Failed to capture board preview', error);
    } finally {
        state.previewCaptureInFlight = false;
    }
}

// MARK: SETTINGS
const SETTINGS_DEFAULT_SECTION = 'interface';

function getMajorGridPatternDefinition(index) {
    const normalized = utils.clamp(Math.round(Number(index) || 0), 0, 5);
    const stroke = 'var(--grid-major-stroke)';
    const ink = 'var(--grid-major-ink)';
    const defs = [
        {
            label: 'Dots',
            major1: `radial-gradient(circle at center, ${ink} 0, ${ink} var(--grid-dot-radius-major), transparent var(--grid-dot-falloff-major))`,
            major2: 'none',
            major3: 'none',
            major4: 'none',
            previewA: 'radial-gradient(circle at center, var(--pattern-ink) 0, var(--pattern-ink) 2px, transparent 7px)',
            previewB: 'none'
        },
        {
            label: 'Cross',
            major1: `linear-gradient(to right, transparent calc(50% - ${stroke}), ${ink} calc(50% - ${stroke}), ${ink} calc(50% + ${stroke}), transparent calc(50% + ${stroke}))`,
            major2: `linear-gradient(to bottom, transparent calc(50% - ${stroke}), ${ink} calc(50% - ${stroke}), ${ink} calc(50% + ${stroke}), transparent calc(50% + ${stroke}))`,
            major3: 'none',
            major4: 'none',
            previewA: 'linear-gradient(to right, transparent 0, transparent calc(50% - 1px), var(--pattern-ink) calc(50% - 1px), var(--pattern-ink) calc(50% + 1px), transparent calc(50% + 1px), transparent 100%)',
            previewB: 'linear-gradient(to bottom, transparent 0, transparent calc(50% - 1px), var(--pattern-ink) calc(50% - 1px), var(--pattern-ink) calc(50% + 1px), transparent calc(50% + 1px), transparent 100%)'
        },
        {
            label: 'Squares',
            major1: `linear-gradient(to right, ${ink} 0 ${stroke}, transparent ${stroke} calc(100% - ${stroke}), ${ink} calc(100% - ${stroke}) 100%)`,
            major2: `linear-gradient(to bottom, ${ink} 0 ${stroke}, transparent ${stroke} calc(100% - ${stroke}), ${ink} calc(100% - ${stroke}) 100%)`,
            major3: 'none',
            major4: 'none',
            previewA: 'linear-gradient(to right, var(--pattern-ink) 0 1px, transparent 1px calc(100% - 1px), var(--pattern-ink) calc(100% - 1px) 100%)',
            previewB: 'linear-gradient(to bottom, var(--pattern-ink) 0 1px, transparent 1px calc(100% - 1px), var(--pattern-ink) calc(100% - 1px) 100%)'
        },
        {
            label: 'Hatch',
            major1: `repeating-linear-gradient(45deg, ${ink} 0 calc(${stroke} * 1.8), transparent calc(${stroke} * 1.8) calc(var(--grid-major-spacing) / 4))`,
            major2: `repeating-linear-gradient(-45deg, ${ink} 0 calc(${stroke} * 1.8), transparent calc(${stroke} * 1.8) calc(var(--grid-major-spacing) / 4))`,
            major3: 'none',
            major4: 'none',
            previewA: 'repeating-linear-gradient(45deg, var(--pattern-ink) 0 1px, transparent 1px 6px)',
            previewB: 'repeating-linear-gradient(-45deg, var(--pattern-ink) 0 1px, transparent 1px 6px)'
        },
        {
            label: 'Dividers',
            major1: `linear-gradient(to right, transparent 0, transparent calc(33.333% - ${stroke}), ${ink} calc(33.333% - ${stroke}), ${ink} calc(33.333% + ${stroke}), transparent calc(33.333% + ${stroke}), transparent calc(66.666% - ${stroke}), ${ink} calc(66.666% - ${stroke}), ${ink} calc(66.666% + ${stroke}), transparent calc(66.666% + ${stroke}), transparent 100%)`,
            major2: `linear-gradient(to bottom, transparent 0, transparent calc(33.333% - ${stroke}), ${ink} calc(33.333% - ${stroke}), ${ink} calc(33.333% + ${stroke}), transparent calc(33.333% + ${stroke}), transparent calc(66.666% - ${stroke}), ${ink} calc(66.666% - ${stroke}), ${ink} calc(66.666% + ${stroke}), transparent calc(66.666% + ${stroke}), transparent 100%)`,
            major3: 'none',
            major4: 'none',
            previewA: 'linear-gradient(to right, transparent 0, transparent calc(33.333% - 1px), var(--pattern-ink) calc(33.333% - 1px), var(--pattern-ink) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent calc(66.666% - 1px), var(--pattern-ink) calc(66.666% - 1px), var(--pattern-ink) calc(66.666% + 1px), transparent calc(66.666% + 1px), transparent 100%)',
            previewB: 'linear-gradient(to bottom, transparent 0, transparent calc(33.333% - 1px), var(--pattern-ink) calc(33.333% - 1px), var(--pattern-ink) calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent calc(66.666% - 1px), var(--pattern-ink) calc(66.666% - 1px), var(--pattern-ink) calc(66.666% + 1px), transparent calc(66.666% + 1px), transparent 100%)'
        },
        {
            label: 'Triangles',
            major1: `repeating-linear-gradient(60deg, ${ink} 0 calc(${stroke} * 1.9), transparent calc(${stroke} * 1.9) calc(var(--grid-major-spacing) / 5))`,
            major2: `repeating-linear-gradient(-60deg, ${ink} 0 calc(${stroke} * 1.9), transparent calc(${stroke} * 1.9) calc(var(--grid-major-spacing) / 5))`,
            major3: 'none',
            major4: 'none',
            previewA: 'repeating-linear-gradient(60deg, var(--pattern-ink) 0 1.4px, transparent 1.4px 7px)',
            previewB: 'repeating-linear-gradient(-60deg, var(--pattern-ink) 0 1.4px, transparent 1.4px 7px)'
        }
    ];
    return { index: normalized, ...defs[normalized] };
}

function ensureMajorGridPatternControl() {
    const existing = document.getElementById('majorGridPatternGroup');
    if (existing) {
        dom.majorGridPatternGroup = existing;
        dom.majorGridPatternButtons = Array.from(existing.querySelectorAll('button[data-pattern-index]'));
        return;
    }
    const gridSectionBody = document.querySelector('.settings-subsection[data-subsection="grid"] .settings-subsection-body');
    if (!gridSectionBody) {
        return;
    }
    const anchorInput = document.getElementById('majorDotScaleInput');
    const anchorField = anchorInput ? anchorInput.closest('.settings-field') : null;

    const field = document.createElement('div');
    field.className = 'settings-field';

    const label = document.createElement('label');
    label.textContent = 'Major Pattern';

    const group = document.createElement('div');
    group.className = 'major-grid-pattern-group';
    group.id = 'majorGridPatternGroup';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Major grid pattern');

    const buttons = [];
    for (let i = 0; i < 6; i += 1) {
        const def = getMajorGridPatternDefinition(i);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'major-grid-pattern-button';
        button.dataset.patternIndex = String(def.index);
        button.setAttribute('aria-pressed', 'false');
        button.title = def.label;
        button.style.setProperty('--preview-pattern-a', def.previewA);
        button.style.setProperty('--preview-pattern-b', def.previewB);
        const caption = document.createElement('span');
        caption.textContent = def.label;
        button.appendChild(caption);
        group.appendChild(button);
        buttons.push(button);
    }

    field.appendChild(label);
    field.appendChild(group);

    if (anchorField && anchorField.parentNode) {
        anchorField.parentNode.insertBefore(field, anchorField.nextSibling);
    } else {
        gridSectionBody.appendChild(field);
    }

    dom.majorGridPatternGroup = group;
    dom.majorGridPatternButtons = buttons;
}

function ensureMajorGridSpacingControl() {
    const existingInput = document.getElementById('majorGridSpacingInput');
    const existingValue = document.getElementById('majorGridSpacingValue');
    if (existingInput) {
        dom.majorGridSpacingInput = existingInput;
        dom.majorGridSpacingValue = existingValue;
        return;
    }
    const gridSectionBody = document.querySelector('.settings-subsection[data-subsection="grid"] .settings-subsection-body');
    if (!gridSectionBody) {
        return;
    }
    const anchorInput = document.getElementById('majorDotScaleInput');
    const anchorField = anchorInput ? anchorInput.closest('.settings-field') : null;

    const field = document.createElement('div');
    field.className = 'settings-field';

    const label = document.createElement('label');
    label.setAttribute('for', 'majorGridSpacingInput');
    label.textContent = 'Major Spacing';

    const slider = document.createElement('div');
    slider.className = 'settings-slider compact';

    const input = document.createElement('input');
    input.type = 'range';
    input.id = 'majorGridSpacingInput';
    input.name = 'majorGridSpacing';
    input.min = '2';
    input.max = '12';
    input.step = '1';

    const value = document.createElement('span');
    value.className = 'settings-value';
    value.id = 'majorGridSpacingValue';
    value.textContent = '4×';

    slider.appendChild(input);
    slider.appendChild(value);
    field.appendChild(label);
    field.appendChild(slider);

    if (anchorField && anchorField.parentNode) {
        anchorField.parentNode.insertBefore(field, anchorField.nextSibling);
    } else {
        gridSectionBody.appendChild(field);
    }

    dom.majorGridSpacingInput = input;
    dom.majorGridSpacingValue = value;
}

function initializeSettingsControls() {
    if (!state.boardData) {
        return;
    }
    const settings = getCurrentSettingsSnapshot();
    ensureMajorGridSpacingControl();
    ensureMajorGridPatternControl();
    applySettingsSnapshot(settings);
    syncSettingsInputs(settings);
    refreshDataSettingsUi();
    initializeSettingsNavigation();
    if (state.settingsControlsInitialized) {
        return;
    }
    state.settingsControlsInitialized = true;
    const backgroundInput = dom.backgroundColorInput;
    const dotColorInput = dom.dotColorInput;
    const dotSizeInput = dom.dotSizeInput;
    const majorDotScaleInput = dom.majorDotScaleInput;
    const majorGridSpacingInput = dom.majorGridSpacingInput;
    const majorGridPatternButtons = dom.majorGridPatternButtons;
    const accentColorInput = dom.accentColorInput;
    const accentToneInput = dom.accentToneInput;
    const blockRadiusInput = dom.blockRadiusInput;
    const blockShadowColorInput = dom.blockShadowColorInput;
    const blockShadowIntensityInput = dom.blockShadowIntensityInput;
    const blockShadowBlurInput = dom.blockShadowBlurInput;
    const blockDragShadowColorInput = dom.blockDragShadowColorInput;
    const blockDragShadowIntensityInput = dom.blockDragShadowIntensityInput;
    const blockDragShadowBlurInput = dom.blockDragShadowBlurInput;
    const boardRadiusInput = dom.boardRadiusInput;
    const zoomSpeedInput = dom.zoomSpeedInput;
    const selectionScaleInput = dom.selectionScaleInput;
    const resizeHandleSizeInput = dom.resizeHandleSizeInput;
    const textFontFamilySelect = dom.textFontFamilySelect;
    const textFontScaleInput = dom.textFontScaleInput;
    const titleFontFamilySelect = dom.titleFontFamilySelect;
    const titleFontScaleInput = dom.titleFontScaleInput;
    const textLetterSpacingInput = dom.textLetterSpacingInput;
    const textWordSpacingInput = dom.textWordSpacingInput;
    const textLineHeightInput = dom.textLineHeightInput;
    const textPaddingInput = dom.textPaddingInput;
    const textPaddingValue = dom.textPaddingValue;
    const titleLetterSpacingInput = dom.titleLetterSpacingInput;
    const titleWordSpacingInput = dom.titleWordSpacingInput;
    const titleLineHeightInput = dom.titleLineHeightInput;
    const titleSmallCapsInput = dom.titleSmallCapsInput;
    const textEditShadowColorInput = dom.textEditShadowColorInput;
    const textEditShadowIntensityInput = dom.textEditShadowIntensityInput;
    const textEditShadowBlurInput = dom.textEditShadowBlurInput;
    const linkUrlLinesInput = dom.linkUrlLinesInput;
    const sublistsEntryTextScaleInput = dom.sublistsEntryTextScaleInput;
    const sublistsEntryPaddingXInput = dom.sublistsEntryPaddingXInput;
    const sublistsEntryPaddingXValue = dom.sublistsEntryPaddingXValue;
    const sublistsEntryPaddingYInput = dom.sublistsEntryPaddingYInput;
    const sublistsEntryPaddingYValue = dom.sublistsEntryPaddingYValue;
    const sublistsTitleTextScaleInput = dom.sublistsTitleTextScaleInput;
    const sublistsTitleTextScaleValue = dom.sublistsTitleTextScaleValue;
    const sublistsTitleOffsetXInput = dom.sublistsTitleOffsetXInput;
    const sublistsTitleOffsetXValue = dom.sublistsTitleOffsetXValue;
    const sublistsTitleIntensityInput = dom.sublistsTitleIntensityInput;
    const sublistsTitleIntensityValue = dom.sublistsTitleIntensityValue;
    const sublistsListContrastInput = dom.sublistsListContrastInput;
    const sublistsListContrastValue = dom.sublistsListContrastValue;
    const sublistsActiveEntryColorInput = dom.sublistsActiveEntryColorInput;
    const sublistsWordWrapInput = dom.sublistsWordWrapInput;
    const dataFolderChangeButton = dom.dataSettingsChangeButton;
    const dataFolderSplashButton = dom.dataSettingsSplashButton;
    const dataFolderRefreshBlocksButton = dom.dataSettingsRefreshBlocksButton;
    const dataFolderCleanupButton = dom.dataSettingsCleanupButton;
    const backupFolderChangeButton = dom.backupSettingsChangeButton;
    const backupFolderOpenButton = dom.backupSettingsOpenButton;
    if (backgroundInput) {
        backgroundInput.addEventListener('input', (event) => {
            updateSettings({ backgroundColor: event.target.value }, 'settings-background-color');
        });
    }
    if (dotColorInput) {
        dotColorInput.addEventListener('input', (event) => {
            updateSettings({ dotColor: event.target.value }, 'settings-dot-color');
        });
    }
    if (dotSizeInput) {
        dotSizeInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ dotSize: value }, 'settings-dot-size');
            }
        });
    }
    if (majorDotScaleInput) {
        majorDotScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ majorDotScale: value }, 'settings-major-dot-scale');
            }
        });
    }
    if (majorGridSpacingInput) {
        majorGridSpacingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ majorGridSpacing: Math.round(value) }, 'settings-major-grid-spacing');
            }
        });
    }
    if (Array.isArray(majorGridPatternButtons) && majorGridPatternButtons.length > 0) {
        majorGridPatternButtons.forEach((button) => {
            if (!button) {
                return;
            }
            button.addEventListener('click', () => {
                const patternIndex = Number(button.dataset.patternIndex);
                if (!Number.isFinite(patternIndex)) {
                    return;
                }
                updateSettings({ majorGridPattern: utils.clamp(Math.round(patternIndex), 0, 5) }, 'settings-major-grid-pattern');
            });
        });
    }
    if (accentColorInput) {
        accentColorInput.addEventListener('input', (event) => {
            updateSettings({ accentColor: event.target.value }, 'settings-accent-color');
        });
    }
    if (accentToneInput) {
        accentToneInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ accentTone: value }, 'settings-accent-tone');
            }
        });
    }
    if (blockRadiusInput) {
        blockRadiusInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ blockRadius: value }, 'settings-block-radius');
            }
        });
    }
    if (blockShadowColorInput) {
        blockShadowColorInput.addEventListener('input', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : '';
            if (value) {
                updateSettings({ blockShadowColor: value }, 'settings-block-shadow-color');
            }
        });
    }
    if (blockShadowIntensityInput) {
        blockShadowIntensityInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ blockShadowIntensity: value }, 'settings-block-shadow-intensity');
            }
        });
    }
    if (blockShadowBlurInput) {
        blockShadowBlurInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ blockShadowBlur: Math.max(0, Math.round(value)) }, 'settings-block-shadow-blur');
            }
        });
    }
    if (blockDragShadowColorInput) {
        blockDragShadowColorInput.addEventListener('input', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : '';
            if (value) {
                updateSettings({ blockDragShadowColor: value }, 'settings-block-drag-shadow-color');
            }
        });
    }
    if (blockDragShadowIntensityInput) {
        blockDragShadowIntensityInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ blockDragShadowIntensity: value }, 'settings-block-drag-shadow-intensity');
            }
        });
    }
    if (blockDragShadowBlurInput) {
        blockDragShadowBlurInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ blockDragShadowBlur: Math.max(0, Math.round(value)) }, 'settings-block-drag-shadow-blur');
            }
        });
    }
    if (boardRadiusInput) {
        boardRadiusInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ boardRadius: value }, 'settings-board-radius');
            }
        });
    }
    if (zoomSpeedInput) {
        zoomSpeedInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ zoomSpeed: value }, 'settings-zoom-speed');
            }
        });
    }
    if (selectionScaleInput) {
        selectionScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ selectionScaleBoost: value / 100 }, 'settings-selection-scale');
            }
        });
    }
    if (resizeHandleSizeInput) {
        resizeHandleSizeInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ resizeHandleSize: Math.round(value) }, 'settings-resize-handle-size');
            }
        });
    }
    if (textFontFamilySelect) {
        textFontFamilySelect.addEventListener('change', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : null;
            if (value) {
                updateSettings({ textFontFamily: value }, 'settings-text-font-family');
            }
        });
    }
    if (textFontScaleInput) {
        textFontScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textFontScale: value }, 'settings-text-font-scale');
            }
        });
    }
    if (titleFontFamilySelect) {
        titleFontFamilySelect.addEventListener('change', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : null;
            if (value) {
                updateSettings({ titleFontFamily: value }, 'settings-title-font-family');
            }
        });
    }
    if (titleFontScaleInput) {
        titleFontScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ titleFontScale: value }, 'settings-title-font-scale');
            }
        });
    }
    if (sublistsEntryTextScaleInput) {
        sublistsEntryTextScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ sublistsEntryTextScale: value }, 'settings-sublists-entry-text-scale');
            }
        });
    }
    if (sublistsEntryPaddingXInput) {
        sublistsEntryPaddingXInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (sublistsEntryPaddingXValue) {
                sublistsEntryPaddingXValue.textContent = `${Math.round(value)}px`;
            }
            if (Number.isFinite(value)) {
                updateSettings({ sublistsEntryPaddingX: value }, 'settings-sublists-entry-padding-x');
            }
        });
    }
    if (sublistsEntryPaddingYInput) {
        sublistsEntryPaddingYInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (sublistsEntryPaddingYValue) {
                sublistsEntryPaddingYValue.textContent = `${Math.round(value)}px`;
            }
            if (Number.isFinite(value)) {
                updateSettings({ sublistsEntryPaddingY: value }, 'settings-sublists-entry-padding-y');
            }
        });
    }
    if (sublistsTitleTextScaleInput) {
        sublistsTitleTextScaleInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                if (sublistsTitleTextScaleValue) {
                    sublistsTitleTextScaleValue.textContent = `${Math.round(value * 100)}%`;
                }
                updateSettings({ sublistsTitleTextScale: value }, 'settings-sublists-title-text-scale');
            }
        });
    }
    if (sublistsTitleOffsetXInput) {
        sublistsTitleOffsetXInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                if (sublistsTitleOffsetXValue) {
                    sublistsTitleOffsetXValue.textContent = `${Math.round(value)}px`;
                }
                updateSettings({ sublistsTitleOffsetX: value }, 'settings-sublists-title-offset-x');
            }
        });
    }
    if (sublistsTitleIntensityInput) {
        sublistsTitleIntensityInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                if (sublistsTitleIntensityValue) {
                    sublistsTitleIntensityValue.textContent = `${Math.round(value * 100)}%`;
                }
                updateSettings({ sublistsTitleIntensity: value }, 'settings-sublists-title-intensity');
            }
        });
    }
    if (sublistsListContrastInput) {
        sublistsListContrastInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                if (sublistsListContrastValue) {
                    sublistsListContrastValue.textContent = `${Math.round(value * 100)}%`;
                }
                updateSettings({ sublistsListContrast: value }, 'settings-sublists-list-contrast');
            }
        });
    }
    if (sublistsActiveEntryColorInput) {
        sublistsActiveEntryColorInput.addEventListener('input', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : '';
            updateSettings({ sublistsActiveEntryColor: value }, 'settings-sublists-active-entry-color');
        });
    }
    if (sublistsWordWrapInput) {
        sublistsWordWrapInput.addEventListener('change', (event) => {
            updateSettings({ sublistsWordWrap: !!event.target.checked }, 'settings-sublists-word-wrap');
        });
    }
    if (textLetterSpacingInput) {
        textLetterSpacingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textLetterSpacing: value }, 'settings-text-letter-spacing');
            }
        });
    }
    if (textWordSpacingInput) {
        textWordSpacingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textWordSpacing: value }, 'settings-text-word-spacing');
            }
        });
    }
    if (textLineHeightInput) {
        textLineHeightInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textLineHeight: value }, 'settings-text-line-height');
            }
        });
    }
    if (textPaddingInput) {
        textPaddingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (textPaddingValue) {
                textPaddingValue.textContent = `${Math.round(value)}px`;
            }
            if (Number.isFinite(value)) {
                updateSettings({ textBlockPadding: value }, 'settings-text-padding');
            }
        });
    }
    if (titleLetterSpacingInput) {
        titleLetterSpacingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ titleLetterSpacing: value }, 'settings-title-letter-spacing');
            }
        });
    }
    if (titleWordSpacingInput) {
        titleWordSpacingInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ titleWordSpacing: value }, 'settings-title-word-spacing');
            }
        });
    }
    if (titleLineHeightInput) {
        titleLineHeightInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ titleLineHeight: value }, 'settings-title-line-height');
            }
        });
    }
    if (titleSmallCapsInput) {
        titleSmallCapsInput.addEventListener('change', (event) => {
            updateSettings({ titleSmallCaps: !!event.target.checked }, 'settings-title-small-caps');
        });
    }
    if (textEditShadowColorInput) {
        textEditShadowColorInput.addEventListener('input', (event) => {
            const value = typeof event.target.value === 'string' ? event.target.value : '';
            if (value) {
                updateSettings({ textEditShadowColor: value }, 'settings-text-edit-glow-color');
            }
        });
    }
    if (textEditShadowIntensityInput) {
        textEditShadowIntensityInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textEditShadowIntensity: value }, 'settings-text-edit-glow-intensity');
            }
        });
    }
    if (textEditShadowBlurInput) {
        textEditShadowBlurInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ textEditShadowBlur: value }, 'settings-text-edit-glow-blur');
            }
        });
    }
    if (linkUrlLinesInput) {
        linkUrlLinesInput.addEventListener('input', (event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
                updateSettings({ linkUrlMaxLines: Math.round(value) }, 'settings-link-url-lines');
            }
        });
    }
    if (dataFolderChangeButton) {
        dataFolderChangeButton.addEventListener('click', handleChangeDataFolderRequest);
    }
    if (dataFolderSplashButton) {
        dataFolderSplashButton.addEventListener('click', handleOpenDataSetupRequest);
    }
    if (dataFolderRefreshBlocksButton) {
        dataFolderRefreshBlocksButton.addEventListener('click', handleRefreshBlockDataRequest);
    }
    if (dataFolderCleanupButton) {
        dataFolderCleanupButton.addEventListener('click', handleDeleteOrphanDataRequest);
    }
    if (backupFolderChangeButton) {
        backupFolderChangeButton.addEventListener('click', handleChangeBackupFolderRequest);
    }
    if (backupFolderOpenButton) {
        backupFolderOpenButton.addEventListener('click', handleOpenBackupFolderRequest);
    }
}

function setActiveSettingsSection(sectionId, options = {}) {
    const nav = dom.settingsNav;
    const container = dom.settingsSections;
    if (!nav || !container) {
        return;
    }
    const skipFocus = !!options.skipFocus;
    const buttons = Array.from(nav.querySelectorAll('button[data-section]'));
    const sections = Array.from(container.querySelectorAll('.settings-section[data-section]'));
    if (!buttons.length || !sections.length) {
        return;
    }
    const hasTarget = sectionId && sections.some((section) => section.dataset.section === sectionId);
    const fallbackId = buttons[0] ? buttons[0].dataset.section : '';
    const targetId = hasTarget ? sectionId : fallbackId || SETTINGS_DEFAULT_SECTION;
    if (!targetId) {
        return;
    }
    sections.forEach((section) => {
        const isActive = section.dataset.section === targetId;
        section.classList.toggle('is-active', isActive);
        if (isActive) {
            section.removeAttribute('hidden');
        } else {
            section.setAttribute('hidden', '');
        }
    });
    buttons.forEach((button) => {
        const isActive = button.dataset.section === targetId;
        button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        button.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    state.activeSettingsSection = targetId;
    if (!skipFocus && options.focusTarget === 'tab') {
        const targetButton = buttons.find((button) => button.dataset.section === targetId);
        if (targetButton && typeof targetButton.focus === 'function') {
            try {
                targetButton.focus({ preventScroll: true });
            } catch {}
        }
    } else if (!skipFocus && options.focusTarget === 'section') {
        const targetSection = sections.find((section) => section.dataset.section === targetId);
        if (targetSection && typeof targetSection.focus === 'function') {
            try {
                targetSection.focus({ preventScroll: true });
            } catch {}
        }
    }
}

function initializeSettingsNavigation() {
    if (state.settingsNavigationInitialized) {
        return;
    }
    const nav = dom.settingsNav;
    const container = dom.settingsSections;
    if (!nav || !container) {
        return;
    }
    const buttons = Array.from(nav.querySelectorAll('button[data-section]'));
    if (!buttons.length) {
        return;
    }
    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            setActiveSettingsSection(button.dataset.section, { focusTarget: 'tab' });
        });
        button.addEventListener('keydown', (event) => {
            const key = event.key;
            if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') {
                return;
            }
            event.preventDefault();
            const currentButtons = Array.from(nav.querySelectorAll('button[data-section]'));
            const currentIndex = currentButtons.indexOf(button);
            if (currentIndex < 0) {
                return;
            }
            let nextIndex = currentIndex;
            if (key === 'ArrowUp' || key === 'ArrowLeft') {
                nextIndex = (currentIndex - 1 + currentButtons.length) % currentButtons.length;
            } else if (key === 'ArrowDown' || key === 'ArrowRight') {
                nextIndex = (currentIndex + 1) % currentButtons.length;
            } else if (key === 'Home') {
                nextIndex = 0;
            } else if (key === 'End') {
                nextIndex = currentButtons.length - 1;
            }
            const nextButton = currentButtons[nextIndex];
            if (nextButton) {
                setActiveSettingsSection(nextButton.dataset.section, { focusTarget: 'tab' });
            }
        });
    });
    state.settingsNavigationInitialized = true;
    setActiveSettingsSection(state.activeSettingsSection || SETTINGS_DEFAULT_SECTION, { focusTarget: 'tab', skipFocus: true });
}

function refreshDataSettingsUi() {
    const display = dom.dataSettingsPath;
    if (display) {
        const rawPath = state.dataDirectoryPath || '';
        if (state.dataDirectoryNeedsSetup) {
            display.textContent = 'Setup required';
        } else {
            display.textContent = rawPath || 'No folder assigned';
        }
    }
    const changeButton = dom.dataSettingsChangeButton;
    if (changeButton) {
        changeButton.disabled = !env.electron?.ipcRenderer?.invoke;
    }
    const splashButton = dom.dataSettingsSplashButton;
    if (splashButton) {
        const available = !!(env.dataSetup && typeof env.dataSetup.show === 'function');
        splashButton.disabled = !available;
    }
    const refreshBlocksButton = dom.dataSettingsRefreshBlocksButton;
    if (refreshBlocksButton) {
        const available = typeof data?.refreshBlockData === 'function';
        const ready = !state.dataDirectoryNeedsSetup && !!state.boardData;
        refreshBlocksButton.disabled = state.blockDataRefreshInProgress || !available || !ready;
        refreshBlocksButton.textContent = state.blockDataRefreshInProgress ? 'Refreshing...' : 'Refresh Block Data';
    }
    const cleanupButton = dom.dataSettingsCleanupButton;
    if (cleanupButton) {
        const available = typeof data?.deleteOrphanAssets === 'function';
        const ready = state.dataDirectoryReady || (env.fs?.existsSync && env.paths?.dataDir ? env.fs.existsSync(env.paths.dataDir) : false);
        cleanupButton.disabled = !ready || state.dataDirectoryCleanupInProgress || !available;
        cleanupButton.textContent = state.dataDirectoryCleanupInProgress ? 'Cleaning…' : 'Delete orphan data';
    }
    const backupDisplay = dom.backupSettingsPath;
    if (backupDisplay) {
        const backupPath = env.backups && typeof env.backups.getDirectory === 'function' ? env.backups.getDirectory() : state.backupDirectoryPath || '';
        backupDisplay.textContent = backupPath || 'Not configured';
    }
    const backupChangeButton = dom.backupSettingsChangeButton;
    if (backupChangeButton) {
        backupChangeButton.disabled = !env.electron?.ipcRenderer?.invoke;
    }
    const backupOpenButton = dom.backupSettingsOpenButton;
    if (backupOpenButton) {
        const ready = env.backups && typeof env.backups.isReady === 'function' ? env.backups.isReady() : !!state.backupDirectoryReady;
        const canOpen = !!env.electron?.shell?.openPath;
        backupOpenButton.disabled = !ready || !canOpen;
    }
}

async function handleChangeDataFolderRequest() {
    if (!env.electron?.ipcRenderer?.invoke) {
        utils.showToast('Folder selection unavailable');
        return;
    }
    try {
        const response = await env.electron.ipcRenderer.invoke('workboard:choose-data-path');
        if (!response || response.canceled) {
            return;
        }
        const selectedPath = typeof response.path === 'string' ? response.path : Array.isArray(response.paths) ? response.paths[0] : '';
        if (!selectedPath) {
            utils.showToast('No folder selected');
            return;
        }
        if (!env.dataSetup || typeof env.dataSetup.applyDataDirectory !== 'function') {
            utils.showToast('Setup unavailable');
            return;
        }
        const applied = await env.dataSetup.applyDataDirectory(selectedPath);
        if (applied) {
            refreshDataSettingsUi();
            utils.showToast('Data folder updated');
        }
    } catch (error) {
        console.error('Data folder change failed', error);
        utils.showToast('Unable to change data folder');
    }
}

function handleOpenDataSetupRequest() {
    hideSettingsPanel({ skipFocus: true });
    enterSplashMode();
    if (env.dataSetup && typeof env.dataSetup.show === 'function') {
        env.dataSetup.updateMessage?.('');
        env.dataSetup.show();
        return;
    }
    utils.showToast('Setup unavailable');
}

async function handleDeleteOrphanDataRequest() {
    if (state.dataDirectoryCleanupInProgress) {
        return;
    }
    if (!data || typeof data.deleteOrphanAssets !== 'function') {
        utils.showToast('Cleanup unavailable');
        return;
    }
    state.dataDirectoryCleanupInProgress = true;
    refreshDataSettingsUi();
    try {
        const result = await data.deleteOrphanAssets();
        const removed = Number(result?.removed) || 0;
        if (removed > 0) {
            const label = removed === 1 ? 'file' : 'files';
            utils.showToast(`Removed ${removed} orphan ${label}`);
        } else {
            utils.showToast('No orphan data found');
        }
    } catch (error) {
        console.error('Failed to delete orphan data', error);
        utils.showToast('Cleanup failed');
    } finally {
        state.dataDirectoryCleanupInProgress = false;
        refreshDataSettingsUi();
    }
}

async function handleRefreshBlockDataRequest() {
    if (state.blockDataRefreshInProgress) {
        return;
    }
    if (!data || typeof data.refreshBlockData !== 'function') {
        utils.showToast('Refresh unavailable');
        return;
    }
    if (!state.boardData) {
        utils.showToast('No board loaded');
        return;
    }
    state.blockDataRefreshInProgress = true;
    refreshDataSettingsUi();
    try {
        const summary = await data.refreshBlockData({ forceIndex: true });
        console.info('Block data refresh summary', summary);
        const repaired = Number(summary?.repaired) || 0;
        const missing = Number(summary?.missing) || 0;
        if (repaired > 0) {
            const label = repaired === 1 ? 'block' : 'blocks';
            utils.showToast(`Re-linked ${repaired} ${label}`);
            renderBoard();
        } else if (missing > 0) {
            const label = missing === 1 ? 'block' : 'blocks';
            utils.showToast(`Assets missing for ${missing} ${label}`);
        } else {
            utils.showToast('All block assets look good');
        }
    } catch (error) {
        console.error('Block data refresh failed', error);
        utils.showToast('Block data refresh failed');
    } finally {
        state.blockDataRefreshInProgress = false;
        refreshDataSettingsUi();
    }
}

async function handleChangeBackupFolderRequest() {
    if (!env.electron?.ipcRenderer?.invoke) {
        utils.showToast('Folder selection unavailable');
        return;
    }
    try {
        const response = await env.electron.ipcRenderer.invoke('workboard:choose-data-path');
        if (!response || response.canceled) {
            return;
        }
        const selectedPath = typeof response.path === 'string' ? response.path : Array.isArray(response.paths) ? response.paths[0] : '';
        if (!selectedPath) {
            utils.showToast('No folder selected');
            return;
        }
        const applied = applyBackupDirectorySetting(selectedPath, { reason: 'backup-folder-change' });
        if (applied) {
            utils.showToast('Backup folder updated');
        }
    } catch (error) {
        console.error('Backup folder change failed', error);
        utils.showToast('Unable to change backup folder');
    }
}

function handleOpenBackupFolderRequest() {
    const directory = env.backups && typeof env.backups.getDirectory === 'function' ? env.backups.getDirectory() : '';
    if (!directory) {
        utils.showToast('Backup folder unavailable');
        return;
    }
    if (!env.electron?.shell?.openPath) {
        utils.showToast('Cannot open backup folder');
        return;
    }
    env.electron.shell.openPath(directory).catch((error) => {
        console.error('Failed to open backup folder', error);
        utils.showToast('Unable to open backup folder');
    });
}

function applyBackupDirectorySetting(targetPath, options = {}) {
    if (!state.boardData) {
        return false;
    }
    const trimmed = typeof targetPath === 'string' ? targetPath.trim() : '';
    const currentSettings = { ...(state.boardData.settings || {}) };
    if (currentSettings.backupDirectory === trimmed) {
        if (env.backups && typeof env.backups.reconcileSettings === 'function') {
            env.backups.reconcileSettings(currentSettings);
        }
        refreshDataSettingsUi();
        return false;
    }
    currentSettings.backupDirectory = trimmed;
    const sanitized = data.sanitizeSettings(currentSettings);
    state.boardData.settings = sanitized;
    if (env.backups && typeof env.backups.reconcileSettings === 'function') {
        env.backups.reconcileSettings(sanitized);
    }
    refreshDataSettingsUi();
    data.queueSave(options.reason || 'backup-folder-update');
    return true;
}

function refreshWorkspace(options = {}) {
    if (!state.boardData) {
        console.warn('Refresh skipped: board data unavailable');
        return;
    }
    const source = options.source || 'manual';
    const previousBoardId = state.currentBoardId;
    try {
        if (movement.stopActiveZoomAnimation) {
            movement.stopActiveZoomAnimation(false);
        }
    } catch {}
    const previousViewport = movement.getCurrentViewportSnapshot ? movement.getCurrentViewportSnapshot() : movement.getActiveBoardViewport();
    try {
        const reloaded = data.loadBoardData();
        state.boardData = reloaded;
        const nextBoardId = (previousBoardId && reloaded.boards?.[previousBoardId]) ? previousBoardId : data.resolveInitialBoardId(reloaded);
        state.currentBoardId = nextBoardId;
        const activeBoard = reloaded.boards?.[nextBoardId];
        const reuseViewport = nextBoardId === previousBoardId;
        const targetViewport = (reuseViewport ? previousViewport : null) || activeBoard?.viewport || reloaded.viewport || previousViewport || { scale: 1, scrollX: 0, scrollY: 0 };
        state.boardScale = utils.clamp(targetViewport?.scale ?? state.boardScale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
        const settings = getCurrentSettingsSnapshot();
        applySettingsSnapshot(settings);
        syncSettingsInputs(settings);
    refreshDataSettingsUi();
        movement.applyBoardScale({ skipSave: true, skipViewportUpdate: true });
        renderBoard({ initial: true, targetViewport, skipViewportCommit: true });
        scheduleSettledViewportRestore(targetViewport, `refresh-${source}`);
        if (options.showToast !== false) {
            utils.showToast('Board refreshed');
        }
        console.info('Workspace refreshed', { source, boardId: state.currentBoardId });
    } catch (error) {
        console.error('Workspace refresh failed', error);
        utils.showToast('Refresh failed');
    }
}

function getCurrentSettingsSnapshot() {
    if (!state.boardData) {
        return data.defaultSettings();
    }
    const sanitized = data.sanitizeSettings(state.boardData.settings || {});
    state.boardData.settings = sanitized;
    if (env.backups && typeof env.backups.reconcileSettings === 'function') {
        env.backups.reconcileSettings(sanitized);
    }
    return sanitized;
}

function updateSettings(patch, reason) {
    if (!state.boardData) {
        return;
    }
    const next = { ...(state.boardData.settings || {}), ...patch };
    const sanitized = data.sanitizeSettings(next);
    state.boardData.settings = sanitized;
    if (env.backups && typeof env.backups.reconcileSettings === 'function') {
        env.backups.reconcileSettings(sanitized);
    }
    applySettingsSnapshot(sanitized);
    syncSettingsInputs(sanitized);
    data.queueSave(reason || 'settings-update');
}

function syncSettingsInputs(settings) {
    const defaults = data.defaultSettings();
    const backgroundInput = dom.backgroundColorInput;
    const dotColorInput = dom.dotColorInput;
    const dotSizeInput = dom.dotSizeInput;
    const dotSizeValue = dom.dotSizeValue;
    const majorDotScaleInput = dom.majorDotScaleInput;
    const majorDotScaleValue = dom.majorDotScaleValue;
    const majorGridSpacingInput = dom.majorGridSpacingInput;
    const majorGridSpacingValue = dom.majorGridSpacingValue;
    const majorGridPatternButtons = dom.majorGridPatternButtons;
    const accentColorInput = dom.accentColorInput;
    const accentToneInput = dom.accentToneInput;
    const accentToneValue = dom.accentToneValue;
    const blockRadiusInput = dom.blockRadiusInput;
    const blockRadiusValue = dom.blockRadiusValue;
    const blockShadowColorInput = dom.blockShadowColorInput;
    const blockShadowIntensityInput = dom.blockShadowIntensityInput;
    const blockShadowIntensityValue = dom.blockShadowIntensityValue;
    const blockShadowBlurInput = dom.blockShadowBlurInput;
    const blockShadowBlurValue = dom.blockShadowBlurValue;
    const blockDragShadowColorInput = dom.blockDragShadowColorInput;
    const blockDragShadowIntensityInput = dom.blockDragShadowIntensityInput;
    const blockDragShadowIntensityValue = dom.blockDragShadowIntensityValue;
    const blockDragShadowBlurInput = dom.blockDragShadowBlurInput;
    const blockDragShadowBlurValue = dom.blockDragShadowBlurValue;
    const boardRadiusInput = dom.boardRadiusInput;
    const boardRadiusValue = dom.boardRadiusValue;
    const zoomSpeedInput = dom.zoomSpeedInput;
    const zoomSpeedValue = dom.zoomSpeedValue;
    const selectionScaleInput = dom.selectionScaleInput;
    const selectionScaleValue = dom.selectionScaleValue;
    const resizeHandleSizeInput = dom.resizeHandleSizeInput;
    const resizeHandleSizeValue = dom.resizeHandleSizeValue;
    const textFontFamilySelect = dom.textFontFamilySelect;
    const textFontScaleInput = dom.textFontScaleInput;
    const textFontScaleValue = dom.textFontScaleValue;
    const titleFontFamilySelect = dom.titleFontFamilySelect;
    const titleFontScaleInput = dom.titleFontScaleInput;
    const titleFontScaleValue = dom.titleFontScaleValue;
    const sublistsEntryTextScaleInput = dom.sublistsEntryTextScaleInput;
    const sublistsEntryTextScaleValue = dom.sublistsEntryTextScaleValue;
    const sublistsEntryPaddingXInput = dom.sublistsEntryPaddingXInput;
    const sublistsEntryPaddingXValue = dom.sublistsEntryPaddingXValue;
    const sublistsEntryPaddingYInput = dom.sublistsEntryPaddingYInput;
    const sublistsEntryPaddingYValue = dom.sublistsEntryPaddingYValue;
    const sublistsTitleTextScaleInput = dom.sublistsTitleTextScaleInput;
    const sublistsTitleTextScaleValue = dom.sublistsTitleTextScaleValue;
    const sublistsTitleOffsetXInput = dom.sublistsTitleOffsetXInput;
    const sublistsTitleOffsetXValue = dom.sublistsTitleOffsetXValue;
    const sublistsTitleIntensityInput = dom.sublistsTitleIntensityInput;
    const sublistsTitleIntensityValue = dom.sublistsTitleIntensityValue;
    const sublistsListContrastInput = dom.sublistsListContrastInput;
    const sublistsListContrastValue = dom.sublistsListContrastValue;
    const sublistsActiveEntryColorInput = dom.sublistsActiveEntryColorInput;
    const sublistsWordWrapInput = dom.sublistsWordWrapInput;
    const textLetterSpacingInput = dom.textLetterSpacingInput;
    const textLetterSpacingValue = dom.textLetterSpacingValue;
    const textWordSpacingInput = dom.textWordSpacingInput;
    const textWordSpacingValue = dom.textWordSpacingValue;
    const textLineHeightInput = dom.textLineHeightInput;
    const textLineHeightValue = dom.textLineHeightValue;
    const textPaddingInput = dom.textPaddingInput;
    const textPaddingValue = dom.textPaddingValue;
    const titleLetterSpacingInput = dom.titleLetterSpacingInput;
    const titleLetterSpacingValue = dom.titleLetterSpacingValue;
    const titleWordSpacingInput = dom.titleWordSpacingInput;
    const titleWordSpacingValue = dom.titleWordSpacingValue;
    const titleLineHeightInput = dom.titleLineHeightInput;
    const titleLineHeightValue = dom.titleLineHeightValue;
    const titleSmallCapsInput = dom.titleSmallCapsInput;
    const textEditShadowColorInput = dom.textEditShadowColorInput;
    const textEditShadowIntensityInput = dom.textEditShadowIntensityInput;
    const textEditShadowIntensityValue = dom.textEditShadowIntensityValue;
    const textEditShadowBlurInput = dom.textEditShadowBlurInput;
    const textEditShadowBlurValue = dom.textEditShadowBlurValue;
    const linkUrlLinesInput = dom.linkUrlLinesInput;
    const linkUrlLinesValue = dom.linkUrlLinesValue;
    const formatSignedPx = (value, digits = 1) => {
        if (!Number.isFinite(value)) {
            return '0px';
        }
        const magnitude = Math.abs(value).toFixed(digits);
        return `${value >= 0 ? '' : '-'}${magnitude}px`;
    };
    if (backgroundInput && backgroundInput.value !== settings.backgroundColor) {
        backgroundInput.value = settings.backgroundColor;
    }
    if (dotColorInput && dotColorInput.value !== settings.dotColor) {
        dotColorInput.value = settings.dotColor;
    }
    if (dotSizeInput) {
        dotSizeInput.value = String(settings.dotSize);
    }
    if (dotSizeValue) {
        dotSizeValue.textContent = settings.dotSize < 1 ? settings.dotSize.toFixed(2) : settings.dotSize.toFixed(1);
    }
    if (majorDotScaleInput) {
        majorDotScaleInput.value = String(settings.majorDotScale ?? defaults.majorDotScale ?? 2.2);
    }
    if (majorDotScaleValue) {
        const scale = Number.isFinite(settings.majorDotScale) ? settings.majorDotScale : (defaults.majorDotScale ?? 2.2);
        majorDotScaleValue.textContent = `${scale.toFixed(2)}×`;
    }
    if (majorGridSpacingInput) {
        const spacing = Number.isFinite(settings.majorGridSpacing)
            ? utils.clamp(Math.round(settings.majorGridSpacing), 2, 12)
            : utils.clamp(Math.round(defaults.majorGridSpacing ?? 4), 2, 12);
        majorGridSpacingInput.value = String(spacing);
        if (majorGridSpacingValue) {
            majorGridSpacingValue.textContent = `${spacing}×`;
        }
    } else if (majorGridSpacingValue) {
        const spacing = Number.isFinite(settings.majorGridSpacing)
            ? utils.clamp(Math.round(settings.majorGridSpacing), 2, 12)
            : utils.clamp(Math.round(defaults.majorGridSpacing ?? 4), 2, 12);
        majorGridSpacingValue.textContent = `${spacing}×`;
    }
    if (Array.isArray(majorGridPatternButtons) && majorGridPatternButtons.length > 0) {
        const activePattern = Number.isFinite(settings.majorGridPattern)
            ? utils.clamp(Math.round(settings.majorGridPattern), 0, 5)
            : utils.clamp(Math.round(defaults.majorGridPattern ?? 0), 0, 5);
        majorGridPatternButtons.forEach((button) => {
            if (!button) {
                return;
            }
            const buttonPattern = Number(button.dataset.patternIndex);
            const selected = Number.isFinite(buttonPattern) && Math.round(buttonPattern) === activePattern;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }
    if (accentColorInput && accentColorInput.value !== settings.accentColor) {
        accentColorInput.value = settings.accentColor;
    }
    if (accentToneInput) {
        accentToneInput.value = String(settings.accentTone);
    }
    if (accentToneValue) {
        accentToneValue.textContent = `${Math.round(settings.accentTone * 100)}%`;
    }
    if (blockRadiusInput) {
        blockRadiusInput.value = String(settings.blockRadius);
    }
    if (blockRadiusValue) {
        blockRadiusValue.textContent = `${Math.round(settings.blockRadius)}px`;
    }
    if (blockShadowColorInput && blockShadowColorInput.value !== settings.blockShadowColor) {
        blockShadowColorInput.value = settings.blockShadowColor;
    }
    const shadowIntensity = utils.clamp(settings.blockShadowIntensity ?? defaults.blockShadowIntensity ?? 0.45, 0, 1);
    if (blockShadowIntensityInput) {
        blockShadowIntensityInput.value = shadowIntensity.toFixed(2);
    }
    if (blockShadowIntensityValue) {
        blockShadowIntensityValue.textContent = `${Math.round(shadowIntensity * 100)}%`;
    }
    const blockShadowBlur = Math.max(0, Math.round(settings.blockShadowBlur ?? defaults.blockShadowBlur ?? 22));
    if (blockShadowBlurInput) {
        blockShadowBlurInput.value = String(blockShadowBlur);
    }
    if (blockShadowBlurValue) {
        blockShadowBlurValue.textContent = `${blockShadowBlur}px`;
    }
    const dragShadowColor = typeof settings.blockDragShadowColor === 'string' ? settings.blockDragShadowColor : defaults.blockDragShadowColor;
    if (blockDragShadowColorInput && dragShadowColor) {
        blockDragShadowColorInput.value = dragShadowColor;
    }
    const dragShadowIntensity = utils.clamp(settings.blockDragShadowIntensity ?? defaults.blockDragShadowIntensity ?? 0.85, 0, 1);
    if (blockDragShadowIntensityInput) {
        blockDragShadowIntensityInput.value = dragShadowIntensity.toFixed(2);
    }
    if (blockDragShadowIntensityValue) {
        blockDragShadowIntensityValue.textContent = `${Math.round(dragShadowIntensity * 100)}%`;
    }
    const dragShadowBlur = Math.max(0, Math.round(settings.blockDragShadowBlur ?? defaults.blockDragShadowBlur ?? 38));
    if (blockDragShadowBlurInput) {
        blockDragShadowBlurInput.value = String(dragShadowBlur);
    }
    if (blockDragShadowBlurValue) {
        blockDragShadowBlurValue.textContent = `${dragShadowBlur}px`;
    }
    if (boardRadiusInput) {
        boardRadiusInput.value = String(settings.boardRadius);
    }
    if (boardRadiusValue) {
        boardRadiusValue.textContent = `${Math.round(settings.boardRadius)}px`;
    }
    if (zoomSpeedInput) {
        zoomSpeedInput.value = String(settings.zoomSpeed);
    }
    if (zoomSpeedValue) {
        zoomSpeedValue.textContent = `${settings.zoomSpeed.toFixed(2)}×`;
    }
    const scalePercent = (settings.selectionScaleBoost ?? 0.02) * 100;
    if (selectionScaleInput) {
        selectionScaleInput.value = scalePercent.toFixed(1);
    }
    if (selectionScaleValue) {
        selectionScaleValue.textContent = `${scalePercent.toFixed(1)}%`;
    }
    const handleSize = Math.round(settings.resizeHandleSize ?? 40);
    if (resizeHandleSizeInput) {
        resizeHandleSizeInput.value = String(handleSize);
    }
    if (resizeHandleSizeValue) {
        resizeHandleSizeValue.textContent = `${handleSize}px`;
    }
    if (textFontFamilySelect) {
        const textFont = settings.textFontFamily ?? '';
        if (textFontFamilySelect.value !== textFont) {
            textFontFamilySelect.value = textFont;
        }
    }
    const textScale = settings.textFontScale ?? 1;
    if (textFontScaleInput) {
        textFontScaleInput.value = textScale.toFixed(2);
    }
    if (textFontScaleValue) {
        textFontScaleValue.textContent = `${Math.round(textScale * 100)}%`;
    }
    if (titleFontFamilySelect) {
        const titleFont = settings.titleFontFamily ?? '';
        if (titleFontFamilySelect.value !== titleFont) {
            titleFontFamilySelect.value = titleFont;
        }
    }
    const titleScale = settings.titleFontScale ?? 1;
    if (titleFontScaleInput) {
        titleFontScaleInput.value = titleScale.toFixed(2);
    }
    if (titleFontScaleValue) {
        titleFontScaleValue.textContent = `${Math.round(titleScale * 100)}%`;
    }
    const sublistsEntryTextScale = utils.clamp(settings.sublistsEntryTextScale ?? defaults.sublistsEntryTextScale ?? 1, 0.5, 2.6);
    if (sublistsEntryTextScaleInput) {
        sublistsEntryTextScaleInput.value = sublistsEntryTextScale.toFixed(2);
    }
    if (sublistsEntryTextScaleValue) {
        sublistsEntryTextScaleValue.textContent = `${Math.round(sublistsEntryTextScale * 100)}%`;
    }
    const sublistsEntryPaddingX = utils.clamp(Math.round(settings.sublistsEntryPaddingX ?? defaults.sublistsEntryPaddingX ?? 8), 0, 40);
    if (sublistsEntryPaddingXInput) {
        sublistsEntryPaddingXInput.value = String(sublistsEntryPaddingX);
    }
    if (sublistsEntryPaddingXValue) {
        sublistsEntryPaddingXValue.textContent = `${sublistsEntryPaddingX}px`;
    }
    const sublistsEntryPaddingY = utils.clamp(Math.round(settings.sublistsEntryPaddingY ?? defaults.sublistsEntryPaddingY ?? 0), 0, 16);
    if (sublistsEntryPaddingYInput) {
        sublistsEntryPaddingYInput.value = String(sublistsEntryPaddingY);
    }
    if (sublistsEntryPaddingYValue) {
        sublistsEntryPaddingYValue.textContent = `${sublistsEntryPaddingY}px`;
    }
    const sublistsTitleTextScale = utils.clamp(settings.sublistsTitleTextScale ?? defaults.sublistsTitleTextScale ?? 1, 0.5, 2.6);
    if (sublistsTitleTextScaleInput) {
        sublistsTitleTextScaleInput.value = sublistsTitleTextScale.toFixed(2);
    }
    if (sublistsTitleTextScaleValue) {
        sublistsTitleTextScaleValue.textContent = `${Math.round(sublistsTitleTextScale * 100)}%`;
    }
    const sublistsTitleOffsetX = utils.clamp(Math.round(settings.sublistsTitleOffsetX ?? defaults.sublistsTitleOffsetX ?? 0), -20, 60);
    if (sublistsTitleOffsetXInput) {
        sublistsTitleOffsetXInput.value = String(sublistsTitleOffsetX);
    }
    if (sublistsTitleOffsetXValue) {
        sublistsTitleOffsetXValue.textContent = `${sublistsTitleOffsetX}px`;
    }
    const sublistsTitleIntensity = utils.clamp(settings.sublistsTitleIntensity ?? defaults.sublistsTitleIntensity ?? 1, 0.2, 1.8);
    if (sublistsTitleIntensityInput) {
        sublistsTitleIntensityInput.value = sublistsTitleIntensity.toFixed(2);
    }
    if (sublistsTitleIntensityValue) {
        sublistsTitleIntensityValue.textContent = `${Math.round(sublistsTitleIntensity * 100)}%`;
    }
    const sublistsListContrast = utils.clamp(settings.sublistsListContrast ?? defaults.sublistsListContrast ?? 1, 0.35, 2.2);
    if (sublistsListContrastInput) {
        sublistsListContrastInput.value = sublistsListContrast.toFixed(2);
    }
    if (sublistsListContrastValue) {
        sublistsListContrastValue.textContent = `${Math.round(sublistsListContrast * 100)}%`;
    }
    if (sublistsActiveEntryColorInput) {
        const color = settings.sublistsActiveEntryColor ?? defaults.sublistsActiveEntryColor;
        if (typeof color === 'string' && color && sublistsActiveEntryColorInput.value !== color) {
            sublistsActiveEntryColorInput.value = color;
        }
    }
    if (sublistsWordWrapInput) {
        sublistsWordWrapInput.checked = settings.sublistsWordWrap !== false;
    }
    const textLetterSpacing = Number.isFinite(settings.textLetterSpacing) ? settings.textLetterSpacing : defaults.textLetterSpacing ?? 0;
    if (textLetterSpacingInput) {
        textLetterSpacingInput.value = String(textLetterSpacing);
    }
    if (textLetterSpacingValue) {
        textLetterSpacingValue.textContent = formatSignedPx(textLetterSpacing, 1);
    }
    const textWordSpacing = Number.isFinite(settings.textWordSpacing) ? settings.textWordSpacing : defaults.textWordSpacing ?? 0;
    if (textWordSpacingInput) {
        textWordSpacingInput.value = String(textWordSpacing);
    }
    if (textWordSpacingValue) {
        textWordSpacingValue.textContent = formatSignedPx(textWordSpacing, 1);
    }
    const textLineHeight = Number.isFinite(settings.textLineHeight) ? settings.textLineHeight : defaults.textLineHeight ?? 1.5;
    if (textLineHeightInput) {
        textLineHeightInput.value = textLineHeight.toFixed(2);
    }
    if (textLineHeightValue) {
        textLineHeightValue.textContent = `${textLineHeight.toFixed(2)}×`;
    }
    const textBlockPadding = Number.isFinite(settings.textBlockPadding) ? settings.textBlockPadding : defaults.textBlockPadding ?? 20;
    const clampedPadding = utils.clamp(textBlockPadding, 4, 80);
    if (textPaddingInput) {
        textPaddingInput.value = String(Math.round(clampedPadding));
    }
    if (textPaddingValue) {
        textPaddingValue.textContent = `${Math.round(clampedPadding)}px`;
    }
    const titleLetterSpacing = Number.isFinite(settings.titleLetterSpacing) ? settings.titleLetterSpacing : defaults.titleLetterSpacing ?? 0;
    if (titleLetterSpacingInput) {
        titleLetterSpacingInput.value = String(titleLetterSpacing);
    }
    if (titleLetterSpacingValue) {
        titleLetterSpacingValue.textContent = formatSignedPx(titleLetterSpacing, 1);
    }
    const titleWordSpacing = Number.isFinite(settings.titleWordSpacing) ? settings.titleWordSpacing : defaults.titleWordSpacing ?? 0;
    if (titleWordSpacingInput) {
        titleWordSpacingInput.value = String(titleWordSpacing);
    }
    if (titleWordSpacingValue) {
        titleWordSpacingValue.textContent = formatSignedPx(titleWordSpacing, 1);
    }
    const titleLineHeight = Number.isFinite(settings.titleLineHeight) ? settings.titleLineHeight : defaults.titleLineHeight ?? 1.2;
    if (titleLineHeightInput) {
        titleLineHeightInput.value = titleLineHeight.toFixed(2);
    }
    if (titleLineHeightValue) {
        titleLineHeightValue.textContent = `${titleLineHeight.toFixed(2)}×`;
    }
    if (titleSmallCapsInput) {
        titleSmallCapsInput.checked = !!settings.titleSmallCaps;
    }
    const textEditShadowColor = typeof settings.textEditShadowColor === 'string' ? settings.textEditShadowColor : defaults.textEditShadowColor;
    if (textEditShadowColorInput && textEditShadowColor) {
        textEditShadowColorInput.value = textEditShadowColor;
    }
    const textEditGlowIntensity = utils.clamp(settings.textEditShadowIntensity ?? defaults.textEditShadowIntensity ?? 0.55, 0, 1);
    if (textEditShadowIntensityInput) {
        textEditShadowIntensityInput.value = textEditGlowIntensity.toFixed(2);
    }
    if (textEditShadowIntensityValue) {
        textEditShadowIntensityValue.textContent = `${Math.round(textEditGlowIntensity * 100)}%`;
    }
    const textEditGlowBlur = Math.max(0, settings.textEditShadowBlur ?? defaults.textEditShadowBlur ?? 26);
    if (textEditShadowBlurInput) {
        textEditShadowBlurInput.value = String(Math.round(textEditGlowBlur));
    }
    if (textEditShadowBlurValue) {
        textEditShadowBlurValue.textContent = `${Math.round(textEditGlowBlur)}px`;
    }
    const linkUrlLines = Math.round(settings.linkUrlMaxLines ?? 3);
    if (linkUrlLinesInput) {
        linkUrlLinesInput.value = String(linkUrlLines);
    }
    if (linkUrlLinesValue) {
        linkUrlLinesValue.textContent = String(linkUrlLines);
    }
}

function applySettingsSnapshot(settings) {
    const root = document.documentElement;
    if (!root) {
        return;
    }
    const style = root.style;
    const defaults = data.defaultSettings();
    const backgroundRgb = hexToRgb(settings.backgroundColor);
    if (backgroundRgb) {
        style.setProperty('--bg-primary', rgbToHex(mixRgb(backgroundRgb, [0, 0, 0], 0.28)));
        style.setProperty('--bg-surface', rgbToHex(backgroundRgb));
        style.setProperty('--bg-card', rgbToHex(mixRgb(backgroundRgb, [255, 255, 255], 0.08)));
        style.setProperty('--bg-card-strong', rgbToHex(mixRgb(backgroundRgb, [255, 255, 255], 0.16)));
        style.setProperty('--bg-card-deep', rgbToHex(mixRgb(backgroundRgb, [0, 0, 0], 0.12)));
        style.setProperty('--border-subtle', rgbaString(mixRgb(backgroundRgb, [255, 255, 255], 0.35), 0.18));
        style.setProperty('--border-strong', rgbaString(mixRgb(backgroundRgb, [255, 255, 255], 0.45), 0.3));
        const scrimRgb = mixRgb(backgroundRgb, [0, 0, 0], 0.55);
        style.setProperty('--overlay-scrim', rgbaString(scrimRgb, 0.72));
        const panelSurfaceRgb = mixRgb(backgroundRgb, [255, 255, 255], 0.12);
        style.setProperty('--panel-surface', rgbaString(panelSurfaceRgb, 0.96));
    }
    const dotRgb = hexToRgb(settings.dotColor);
    if (dotRgb) {
        style.setProperty('--grid-dot', rgbaString(dotRgb, settings.dotOpacity));
        const softAlpha = Math.min(Math.max(settings.dotOpacity * 0.5, 0.04), 0.6);
        style.setProperty('--grid-dot-soft', rgbaString(dotRgb, softAlpha));
        const majorAlpha = utils.clamp((settings.dotOpacity ?? 0.26) * 1.45, 0.18, 0.78);
        style.setProperty('--grid-major-ink-base', rgbaString(dotRgb, majorAlpha));
    }
    const dotRadius = Math.max(settings.dotSize, 0.05);
    style.setProperty('--grid-dot-radius', `${dotRadius}px`);
    style.setProperty('--grid-dot-falloff', `${Math.max(dotRadius * 3, dotRadius + 1.2)}px`);
    const majorScale = Number.isFinite(settings.majorDotScale) ? settings.majorDotScale : (defaults.majorDotScale ?? 2.2);
    const majorDotRadius = Math.max(dotRadius * majorScale, dotRadius + 0.5);
    style.setProperty('--grid-dot-radius-major', `${majorDotRadius}px`);
    style.setProperty('--grid-dot-falloff-major', `${Math.max(majorDotRadius * 3, majorDotRadius + 2)}px`);
    const majorStroke = Math.max(1, majorDotRadius * 0.32);
    style.setProperty('--grid-major-stroke', `${Math.round(majorStroke * 100) / 100}px`);
    const majorGridSpacing = Number.isFinite(settings.majorGridSpacing)
        ? utils.clamp(Math.round(settings.majorGridSpacing), 2, 12)
        : utils.clamp(Math.round(defaults.majorGridSpacing ?? 4), 2, 12);
    style.setProperty('--grid-major-spacing-multiplier', `${majorGridSpacing}`);
    const majorGridPattern = Number.isFinite(settings.majorGridPattern)
        ? utils.clamp(Math.round(settings.majorGridPattern), 0, 5)
        : utils.clamp(Math.round(defaults.majorGridPattern ?? 0), 0, 5);
    const majorDef = getMajorGridPatternDefinition(majorGridPattern);
    style.setProperty('--grid-major-pattern-1', majorDef.major1);
    style.setProperty('--grid-major-pattern-2', majorDef.major2);
    style.setProperty('--grid-major-pattern-3', majorDef.major3);
    style.setProperty('--grid-major-pattern-4', majorDef.major4);
    const scale = Number.isFinite(state.boardScale) ? state.boardScale : 1;
    style.setProperty('--grid-major-ink', scale <= 0.72 ? 'var(--grid-major-ink-base)' : 'transparent');
    const accentRgb = hexToRgb(settings.accentColor);
    const tonedAccent = accentRgb ? applyAccentTone(accentRgb, settings.accentTone) : null;
    if (tonedAccent) {
        style.setProperty('--accent', rgbToHex(tonedAccent));
        style.setProperty('--accent-strong', rgbToHex(mixRgb(tonedAccent, [255, 255, 255], 0.22)));
        style.setProperty('--accent-soft', rgbaString(tonedAccent, 0.2));
        style.setProperty('--accent-outline', rgbaString(tonedAccent, 0.45));
        style.setProperty('--accent-strong-text', rgbToHex(mixRgb(tonedAccent, [255, 255, 255], 0.75)));
    }
    style.setProperty('--block-radius', `${settings.blockRadius}px`);
    const shadowRgb = hexToRgb(settings.blockShadowColor);
    if (shadowRgb) {
        style.setProperty('--block-shadow-color', rgbaString(shadowRgb, 1));
    }
    const shadowIntensity = Math.min(Math.max(settings.blockShadowIntensity ?? 0.45, 0), 1);
    style.setProperty('--block-shadow-intensity', `${shadowIntensity}`);
    if (shadowRgb) {
        style.setProperty('--block-shadow-rgba', rgbaString(shadowRgb, shadowIntensity));
    }
    const blockShadowBlur = Math.max(0, settings.blockShadowBlur ?? defaults.blockShadowBlur ?? 22);
    style.setProperty('--block-shadow-blur', `${blockShadowBlur}px`);
    const dragShadowRgb = hexToRgb(settings.blockDragShadowColor || defaults.blockDragShadowColor);
    if (dragShadowRgb) {
        style.setProperty('--drag-shadow-color', rgbaString(dragShadowRgb, 0.92));
    }
    const dragShadowIntensity = utils.clamp(settings.blockDragShadowIntensity ?? defaults.blockDragShadowIntensity ?? 0.85, 0, 1);
    style.setProperty('--drag-shadow-intensity', `${dragShadowIntensity}`);
    const dragShadowBlur = Math.max(0, settings.blockDragShadowBlur ?? defaults.blockDragShadowBlur ?? 38);
    style.setProperty('--drag-shadow-blur', `${dragShadowBlur}px`);
    style.setProperty('--board-radius', `${settings.boardRadius}px`);
    style.setProperty('--selection-scale-boost', `${settings.selectionScaleBoost ?? 0.02}`);
    const handleSize = Math.min(Math.max(Math.round(settings.resizeHandleSize ?? 40), 20), 80);
    constants.CORNER_HIT_SIZE = handleSize;
    const textScale = Math.min(Math.max(settings.textFontScale ?? 1, 0.5), 2.6);
    const titleScale = Math.min(Math.max(settings.titleFontScale ?? 1, 0.5), 3.2);
    const sublistsEntryTextScale = utils.clamp(settings.sublistsEntryTextScale ?? defaults.sublistsEntryTextScale ?? 1, 0.5, 2.6);
    const sublistsEntryPaddingX = utils.clamp(Math.round(settings.sublistsEntryPaddingX ?? defaults.sublistsEntryPaddingX ?? 8), 0, 40);
    const sublistsEntryPaddingY = utils.clamp(Math.round(settings.sublistsEntryPaddingY ?? defaults.sublistsEntryPaddingY ?? 0), 0, 16);
    const sublistsTitleTextScale = utils.clamp(settings.sublistsTitleTextScale ?? defaults.sublistsTitleTextScale ?? titleScale, 0.5, 2.6);
    const sublistsTitleOffsetX = utils.clamp(Math.round(settings.sublistsTitleOffsetX ?? defaults.sublistsTitleOffsetX ?? 0), -20, 60);
    const sublistsTitleIntensity = utils.clamp(settings.sublistsTitleIntensity ?? defaults.sublistsTitleIntensity ?? 1, 0.2, 1.8);
    const sublistsListContrast = utils.clamp(settings.sublistsListContrast ?? defaults.sublistsListContrast ?? 1, 0.35, 2.2);
    const textFontFamily = settings.textFontFamily || data.defaultSettings().textFontFamily;
    const titleFontFamily = settings.titleFontFamily || data.defaultSettings().titleFontFamily;
    style.setProperty('--text-font-scale', `${textScale}`);
    style.setProperty('--title-font-scale', `${titleScale}`);
    style.setProperty('--sublists-entry-text-scale', `${sublistsEntryTextScale}`);
    style.setProperty('--sublists-entry-padding-x', `${sublistsEntryPaddingX}px`);
    style.setProperty('--sublists-entry-padding-y', `${sublistsEntryPaddingY}px`);
    style.setProperty('--sublists-title-font-scale', `${sublistsTitleTextScale}`);
    style.setProperty('--sublists-title-offset-x', `${sublistsTitleOffsetX}px`);
    const sublistsTitleAlpha = utils.clamp(0.7 * sublistsTitleIntensity, 0.12, 1);
    style.setProperty('--sublists-title-color', `rgba(255, 255, 255, ${Number(sublistsTitleAlpha.toFixed(4))})`);
    const lineLightAlpha = utils.clamp(0.035 * sublistsListContrast, 0, 0.2);
    const lineDarkAlpha = utils.clamp(0.095 * sublistsListContrast, 0, 0.3);
    style.setProperty('--sublists-line-light', `rgba(255, 255, 255, ${Number(lineLightAlpha.toFixed(4))})`);
    style.setProperty('--sublists-line-dark', `rgba(0, 0, 0, ${Number(lineDarkAlpha.toFixed(4))})`);
    const activeEntryRgb = hexToRgb(settings.sublistsActiveEntryColor ?? defaults.sublistsActiveEntryColor)
        || (tonedAccent ? mixRgb(tonedAccent, [255, 255, 255], 0.5) : [255, 255, 255]);
    const sublistsBackgroundRgb = backgroundRgb || hexToRgb(settings.backgroundColor ?? defaults.backgroundColor) || [36, 36, 41];
    const blendRatio = utils.clamp(0.32 * sublistsListContrast, 0.14, 0.9);
    const activeFillRgb = mixRgb(sublistsBackgroundRgb, activeEntryRgb, blendRatio);
    style.setProperty('--sublists-active-line', rgbToHex(activeFillRgb));
    style.setProperty('--sublists-active-entry-fill', rgbToHex(activeFillRgb));
    const invertActiveEntryText = relativeLuminance(activeFillRgb) >= 0.6;
    style.setProperty('--sublists-active-entry-text-color', invertActiveEntryText ? 'rgba(0, 0, 0, 0.92)' : 'var(--text-primary)');
    style.setProperty('--text-font-family', textFontFamily);
    style.setProperty('--title-font-family', titleFontFamily);
    root.classList.toggle('workboard-sublists-wrap', settings.sublistsWordWrap !== false);
    env.sublists?.applySettings?.();
    const linkUrlLines = Math.min(Math.max(Math.round(settings.linkUrlMaxLines ?? 3), 1), 6);
    style.setProperty('--link-url-max-lines', `${linkUrlLines}`);
    const textLetterSpacing = Number.isFinite(settings.textLetterSpacing) ? settings.textLetterSpacing : defaults.textLetterSpacing ?? 0;
    const textWordSpacing = Number.isFinite(settings.textWordSpacing) ? settings.textWordSpacing : defaults.textWordSpacing ?? 0;
    const textLineHeight = Number.isFinite(settings.textLineHeight) ? settings.textLineHeight : defaults.textLineHeight ?? 1.5;
    const titleLetterSpacing = Number.isFinite(settings.titleLetterSpacing) ? settings.titleLetterSpacing : defaults.titleLetterSpacing ?? 0;
    const titleWordSpacing = Number.isFinite(settings.titleWordSpacing) ? settings.titleWordSpacing : defaults.titleWordSpacing ?? 0;
    const titleLineHeight = Number.isFinite(settings.titleLineHeight) ? settings.titleLineHeight : defaults.titleLineHeight ?? 1.2;
    style.setProperty('--text-letter-spacing-offset', `${textLetterSpacing}px`);
    style.setProperty('--text-word-spacing-offset', `${textWordSpacing}px`);
    style.setProperty('--text-line-height-offset', `${textLineHeight}`);
    style.setProperty('--title-letter-spacing-offset', `${titleLetterSpacing}px`);
    style.setProperty('--title-word-spacing-offset', `${titleWordSpacing}px`);
    style.setProperty('--title-line-height-offset', `${titleLineHeight}`);
    style.setProperty('--title-small-caps', settings.titleSmallCaps ? 'small-caps' : 'normal');
    const editGlowRgb = hexToRgb(settings.textEditShadowColor || defaults.textEditShadowColor || '#b798ff');
    if (editGlowRgb) {
        style.setProperty('--text-edit-shadow-color', rgbaString(editGlowRgb, 1));
    }
    const editGlowIntensity = utils.clamp(settings.textEditShadowIntensity ?? defaults.textEditShadowIntensity ?? 0.55, 0, 1);
    style.setProperty('--text-edit-shadow-intensity', `${editGlowIntensity}`);
    const editGlowBlur = Math.max(0, settings.textEditShadowBlur ?? defaults.textEditShadowBlur ?? 26);
    style.setProperty('--text-edit-shadow-blur', `${editGlowBlur}px`);
    const paddingRaw = Number(settings.textBlockPadding);
    const basePadding = Number.isFinite(paddingRaw) ? utils.clamp(paddingRaw, 4, 80) : defaults.textBlockPadding;
    const paddingTop = Math.max(basePadding - 2, 0);
    const paddingBottom = Math.max(basePadding + 2, 0);
    style.setProperty('--text-block-padding-x', `${basePadding}px`);
    style.setProperty('--text-block-padding-top', `${paddingTop}px`);
    style.setProperty('--text-block-padding-bottom', `${paddingBottom}px`);
    if (env.textEditing && typeof env.textEditing.refreshAllTextBlocks === 'function') {
        env.textEditing.refreshAllTextBlocks();
    }
}

function hexToRgb(hex) {
    if (typeof hex !== 'string') {
        return null;
    }
    const normalized = hex.trim();
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized);
    if (!match) {
        return null;
    }
    let value = match[1];
    if (value.length === 3) {
        value = value.split('').map((ch) => ch + ch).join('');
    }
    const intValue = parseInt(value, 16);
    return [
        (intValue >> 16) & 255,
        (intValue >> 8) & 255,
        intValue & 255
    ];
}

function rgbToHex(rgb) {
    const toHex = (component) => {
        const value = Math.min(Math.max(Math.round(component), 0), 255);
        return value.toString(16).padStart(2, '0');
    };
    return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function mixRgb(source, target, ratio) {
    const amount = Math.min(Math.max(ratio, 0), 1);
    return [
        Math.round(source[0] + (target[0] - source[0]) * amount),
        Math.round(source[1] + (target[1] - source[1]) * amount),
        Math.round(source[2] + (target[2] - source[2]) * amount)
    ];
}

function rgbaString(rgb, alpha) {
    const value = Math.min(Math.max(alpha, 0), 1);
    const precision = Math.round(value * 1000) / 1000;
    return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${precision})`;
}

function relativeLuminance(rgb) {
    const toLinear = (component) => {
        const value = Math.min(Math.max(component / 255, 0), 1);
        if (value <= 0.03928) {
            return value / 12.92;
        }
        return Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const r = toLinear(rgb[0]);
    const g = toLinear(rgb[1]);
    const b = toLinear(rgb[2]);
    return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function applyAccentTone(rgb, tone) {
    const clamped = utils.clamp(tone, 0.6, 1.6);
    if (clamped > 1) {
        const ratio = (clamped - 1) / 0.6;
        return mixRgb(rgb, [255, 255, 255], ratio);
    }
    if (clamped < 1) {
        const ratio = (1 - clamped) / 0.4;
        return mixRgb(rgb, [0, 0, 0], ratio);
    }
    return rgb;
}

function showSettingsPanel() {
    const overlay = dom.settingsOverlay;
    if (!overlay) {
        env.utils.forwardDebugLog('warn', ['settings overlay missing']);
        return;
    }
    const settings = getCurrentSettingsSnapshot();
    syncSettingsInputs(settings);
    hideContextMenu();
    initializeSettingsNavigation();
    overlay.hidden = false;
    overlay.classList.add('is-visible');
    state.settingsPanelOpen = true;
    setActiveSettingsSection(state.activeSettingsSection || SETTINGS_DEFAULT_SECTION, { focusTarget: 'tab', skipFocus: true });
    const modal = dom.settingsModal;
    if (modal && !modal.hasAttribute('tabindex')) {
        modal.setAttribute('tabindex', '-1');
    }
    if (modal) {
        try {
            modal.focus({ preventScroll: true });
        } catch {}
    }
}

function hideSettingsPanel(options = {}) {
    const overlay = dom.settingsOverlay;
    if (!overlay) {
        env.utils.forwardDebugLog('warn', ['settings overlay missing']);
        return;
    }
    overlay.classList.remove('is-visible');
    overlay.hidden = true;
    state.settingsPanelOpen = false;
    if (!options.skipFocus) {
        const button = dom.settingsButton;
        if (button) {
            try {
                button.focus({ preventScroll: true });
            } catch {}
        }
    }
}

// MARK: CONTEXT MENU
function showContextMenu(clientX, clientY) {
    if (!dom.contextMenuEl) {
        return;
    }
    env.utils.forwardDebugLog('debug', ['management.showContextMenu', { clientX, clientY, targetBlockId: state.contextMenuTargetBlockId }]);
    dom.contextMenuEl.hidden = false;
    dom.contextMenuEl.classList.add('is-visible');
    dom.contextMenuEl.style.left = '0px';
    dom.contextMenuEl.style.top = '0px';
    const rect = dom.contextMenuEl.getBoundingClientRect();
    const padding = 12;
    const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxY = Math.max(padding, window.innerHeight - rect.height - padding);
    const left = Math.min(Math.max(clientX, padding), maxX);
    const top = Math.min(Math.max(clientY, padding), maxY);
    dom.contextMenuEl.style.left = `${left}px`;
    dom.contextMenuEl.style.top = `${top}px`;
    const deleteButton = dom.contextMenuEl.querySelector('button[data-action="delete-block"]');
    if (deleteButton) {
        deleteButton.hidden = state.selectedBlockIds.size === 0 && !state.contextMenuTargetBlockId;
    }
}

function hideContextMenu() {
    if (!dom.contextMenuEl) {
        return;
    }
    dom.contextMenuEl.classList.remove('is-visible');
    dom.contextMenuEl.hidden = true;
    state.contextMenuTargetBlockId = null;
}

// MARK: DATA OPERATIONS
function queueSave(reason) {
    data.queueSave(reason);
}

function deleteBlock(blockId) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const target = board.blocks.find((block) => block.id === blockId) || null;
    board.blocks = board.blocks.filter((block) => block.id !== blockId);
    state.selectedBlockIds.delete(blockId);
    data.queueSave('block-delete');
    renderBoard();
    if (target && target.type === 'audio' && typeof env.mediaBlocks.disposeAudioRuntime === 'function') {
        env.mediaBlocks.disposeAudioRuntime(blockId);
    }
    if (target) {
        console.info('Block deleted', { id: blockId, type: target.type });
    }
}

function deleteSelectedBlocks() {
    deleteBlocks(Array.from(state.selectedBlockIds));
}

function deleteBlocks(blockIds) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const ids = new Set(blockIds);
    const removed = board.blocks.filter((block) => ids.has(block.id));
    board.blocks = board.blocks.filter((block) => !ids.has(block.id));
    ids.forEach((id) => state.selectedBlockIds.delete(id));
    data.queueSave('blocks-delete');
    renderBoard();
    removed.forEach((block) => {
        if (block.type === 'audio' && typeof env.mediaBlocks.disposeAudioRuntime === 'function') {
            env.mediaBlocks.disposeAudioRuntime(block.id);
        }
    });
    if (removed.length > 0) {
        console.info('Blocks deleted', { ids: removed.map((block) => block.id), count: removed.length });
    }
}

function writeCopiedBlocksToClipboard(snapshot) {
    const clipboard = env.electron?.clipboard;
    if (!clipboard || typeof clipboard.writeBuffer !== 'function') {
        return false;
    }
    if (!snapshot || !Array.isArray(snapshot.items) || snapshot.items.length === 0) {
        return false;
    }
    if (typeof Buffer === 'undefined' || typeof Buffer.from !== 'function') {
        return false;
    }

    const payload = {
        type: 'workboard-blocks',
        version: WORKBOARD_BLOCKS_CLIPBOARD_VERSION,
        clipboardId: String(snapshot.clipboardId || ''),
        mode: snapshot.mode === 'cut' ? 'cut' : 'copy',
        anchorX: snapshot.anchorX,
        anchorY: snapshot.anchorY,
        items: snapshot.items
    };

    try {
        const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
        clipboard.writeBuffer(WORKBOARD_BLOCKS_CLIPBOARD_FORMAT, buffer);
        return true;
    } catch (error) {
        console.warn('Failed to write copied blocks to clipboard', error);
        return false;
    }
}

function copySelectedBlocks() {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return false;
    }
    const ids = Array.from(state.selectedBlockIds);
    if (!ids.length) {
        return false;
    }
    const selected = board.blocks.filter((block) => ids.includes(block.id));
    if (!selected.length) {
        return false;
    }
    let anchorX = selected[0].x;
    let anchorY = selected[0].y;
    for (let index = 1; index < selected.length; index += 1) {
        const block = selected[index];
        if (block.x < anchorX) {
            anchorX = block.x;
        }
        if (block.y < anchorY) {
            anchorY = block.y;
        }
    }
    state.copiedBlocks = {
        boardId: state.currentBoardId,
        anchorX,
        anchorY,
        clipboardId: utils.createId('clipboard'),
        items: selected.map((block) => ({
            block: JSON.parse(JSON.stringify(block)),
            offsetX: block.x - anchorX,
            offsetY: block.y - anchorY
        })),
        mode: 'copy',
        capturedAt: Date.now()
    };
    writeCopiedBlocksToClipboard(state.copiedBlocks);
    state.pendingWorkboardPaste = true;
    if (data.saveClipboardSnapshot) {
        data.saveClipboardSnapshot(state.copiedBlocks);
    }
    return true;
}

function pasteCopiedBlocks() {
    const snapshot = state.copiedBlocks;
    const board = state.boardData.boards[state.currentBoardId];
    if (!snapshot || !board || !snapshot.items || !snapshot.items.length) {
        return false;
    }
    const base = state.lastPointerBoardPos || { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const deltaX = base.x - snapshot.anchorX;
    const deltaY = base.y - snapshot.anchorY;
    const now = new Date().toISOString();
    const created = [];
    snapshot.items.forEach((item) => {
        const original = item.block;
        const clone = JSON.parse(JSON.stringify(original));
        clone.id = utils.createId(clone.type || 'block');
        clone.x = utils.snapToGrid(snapshot.anchorX + item.offsetX + deltaX);
        clone.y = utils.snapToGrid(snapshot.anchorY + item.offsetY + deltaY);
        clone.createdAt = now;
        clone.updatedAt = now;
        data.applyBlockDefaults(clone);
        board.blocks.push(clone);
        created.push(clone.id);
    });
    state.selectedBlockIds = new Set(created);
    state.selectedBlockId = created[0] || null;
    data.queueSave('blocks-paste');
    renderBoard();
    movement.setSelectedBlocks(created, created[0] || null);
    if (snapshot.mode === 'cut') {
        // One-time paste for cut semantics
        state.copiedBlocks = null;
        state.pendingWorkboardPaste = false;
        if (data.saveClipboardSnapshot) {
            data.saveClipboardSnapshot(null);
        }
    } else {
        state.pendingWorkboardPaste = true;
        if (data.saveClipboardSnapshot) {
            data.saveClipboardSnapshot(state.copiedBlocks);
        }
    }
    return true;
}

function pasteBlocksFromClipboardPayload(payload) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board || !payload || typeof payload !== 'object') {
        return false;
    }
    if (payload.type !== 'workboard-blocks' || payload.version !== WORKBOARD_BLOCKS_CLIPBOARD_VERSION) {
        return false;
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return false;
    }

    const clipboardId = String(payload.clipboardId || '');
    const mode = payload.mode === 'cut' ? 'cut' : 'copy';
    if (mode === 'cut' && clipboardId && consumedCutClipboardIds.has(clipboardId)) {
        return true;
    }

    const anchorX = Number.isFinite(payload.anchorX) ? payload.anchorX : 0;
    const anchorY = Number.isFinite(payload.anchorY) ? payload.anchorY : 0;

    const base = state.lastPointerBoardPos || { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const deltaX = base.x - anchorX;
    const deltaY = base.y - anchorY;
    const now = new Date().toISOString();

    const created = [];
    payload.items.forEach((item) => {
        if (!item || typeof item !== 'object') {
            return;
        }
        const original = item.block;
        if (!original || typeof original !== 'object') {
            return;
        }
        const offsetX = Number.isFinite(item.offsetX) ? item.offsetX : 0;
        const offsetY = Number.isFinite(item.offsetY) ? item.offsetY : 0;

        const clone = JSON.parse(JSON.stringify(original));
        clone.id = utils.createId(clone.type || 'block');
        clone.x = utils.snapToGrid(anchorX + offsetX + deltaX);
        clone.y = utils.snapToGrid(anchorY + offsetY + deltaY);
        clone.createdAt = now;
        clone.updatedAt = now;
        data.applyBlockDefaults(clone);
        board.blocks.push(clone);
        created.push(clone.id);
    });

    if (!created.length) {
        return false;
    }

    state.selectedBlockIds = new Set(created);
    state.selectedBlockId = created[0] || null;
    data.queueSave('blocks-paste');
    renderBoard();
    movement.setSelectedBlocks(created, created[0] || null);

    if (mode === 'cut') {
        if (clipboardId) {
            consumedCutClipboardIds.add(clipboardId);
        }
        if (state.copiedBlocks && state.copiedBlocks.clipboardId === clipboardId) {
            state.copiedBlocks = null;
            if (data.saveClipboardSnapshot) {
                data.saveClipboardSnapshot(null);
            }
        }
        state.pendingWorkboardPaste = false;
    } else {
        state.pendingWorkboardPaste = true;
    }

    return true;
}

function cutSelectedBlocks() {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return false;
    }
    const ids = Array.from(state.selectedBlockIds);
    if (!ids.length) {
        return false;
    }
    const selected = board.blocks.filter((block) => ids.includes(block.id));
    if (!selected.length) {
        return false;
    }
    let anchorX = selected[0].x;
    let anchorY = selected[0].y;
    for (let i = 1; i < selected.length; i += 1) {
        const block = selected[i];
        if (block.x < anchorX) anchorX = block.x;
        if (block.y < anchorY) anchorY = block.y;
    }
    state.copiedBlocks = {
        boardId: state.currentBoardId,
        anchorX,
        anchorY,
        clipboardId: utils.createId('clipboard'),
        items: selected.map((block) => ({
            block: JSON.parse(JSON.stringify(block)),
            offsetX: block.x - anchorX,
            offsetY: block.y - anchorY
        })),
        mode: 'cut',
        capturedAt: Date.now()
    };
    writeCopiedBlocksToClipboard(state.copiedBlocks);
    state.pendingWorkboardPaste = true;
    if (data.saveClipboardSnapshot) {
        data.saveClipboardSnapshot(state.copiedBlocks);
    }
    // Remove originals immediately (standard cut semantics)
    const idSet = new Set(ids);
    board.blocks = board.blocks.filter((b) => !idSet.has(b.id));
    state.selectedBlockIds.clear();
    state.selectedBlockId = null;
    data.queueSave('blocks-cut');
    renderBoard();
    return true;
}

function moveBlocksToBoard(blockIds, targetBoardId, options = {}) {
    const sourceBoard = state.boardData.boards[state.currentBoardId];
    const targetBoard = state.boardData.boards[targetBoardId];
    if (!sourceBoard || !targetBoard) {
        return false;
    }
    const ids = Array.isArray(blockIds) ? blockIds : [blockIds];
    const moved = [];
    const retained = [];
    const idSet = new Set(ids);
    const now = new Date().toISOString();
    sourceBoard.blocks.forEach((block) => {
        if (!idSet.has(block.id)) {
            retained.push(block);
            return;
        }
        const clone = JSON.parse(JSON.stringify(block));
        clone.id = utils.createId(clone.type || 'block');
        clone.updatedAt = now;
        data.applyBlockDefaults(clone);
        moved.push(clone);
    });
    if (!moved.length) {
        return false;
    }
    sourceBoard.blocks = retained;
    // Positioning: keep same x/y alignment
    moved.forEach((blk) => targetBoard.blocks.push(blk));
    state.selectedBlockIds.clear();
    state.selectedBlockId = null;
    if (state.previewDirtyBoards) {
        state.previewDirtyBoards.add(targetBoardId);
        state.previewDirtyBoards.add(sourceBoard.id);
    }
    data.queueSave('blocks-move-to-board');
    renderBoard();
    return true;
}

// MARK: TEXT EDITING

function handleGlobalKeydown(event) {
    if (event.altKey) {
        return;
    }
    if (state.paintModeActive) {
        return;
    }
    const paintHotkeyBlockUntil = Number(state.paintModeHotkeyBlockUntil) || 0;
    if (paintHotkeyBlockUntil > Date.now()) {
        return;
    }
    if (event.code === 'MediaPlayPause' || event.key === 'MediaPlayPause') {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (event.code === 'Backquote' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const active = document.activeElement;
        const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
        const isEditable = active && (active.isContentEditable || tag === 'input' || tag === 'textarea');
        if (!isEditable) {
            if (env.consoleUi && typeof env.consoleUi.toggle === 'function') {
                env.consoleUi.toggle();
            }
            event.preventDefault();
            event.stopPropagation();
        }
        return;
    }
    const active = document.activeElement;
    const tagName = active && active.tagName ? active.tagName.toLowerCase() : '';
    let inputType = '';
    if (active && typeof active.getAttribute === 'function') {
        inputType = (active.getAttribute('type') || '').toLowerCase();
    }
    const isTextInput = tagName === 'input' && (!inputType || ['text', 'search', 'url', 'email', 'tel', 'password', 'number'].includes(inputType));
    const isEditableField = !!(active && (active.isContentEditable || tagName === 'textarea' || isTextInput));

    if (!event.ctrlKey && !event.metaKey && (event.code === 'Space' || event.key === ' ')) {
        if (!isEditableField) {
            event.preventDefault();
            event.stopPropagation();
            if (env.movement && typeof env.movement.zoomToFit === 'function') {
                env.movement.zoomToFit();
            }
        }
        return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
        if (key === 'p' && !isEditableField) {
            event.preventDefault();
            event.stopPropagation();
            if (env.paintMode?.openWorkspace) {
                env.paintMode.openWorkspace().catch((error) => {
                    console.error('Paint workspace open failed', error);
                    env.utils?.showToast?.(error?.message || 'Paint workspace failed to open');
                });
            }
            return;
        }
        if (key === 'l' && !isEditableField) {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                env.sublists?.setVisibility?.(true);
            } else {
                env.sublists?.toggleVisibility?.();
            }
            return;
        }
        if (key === 'q' && !isEditableField) {
            event.preventDefault();
            event.stopPropagation();
            if (state.settingsPanelOpen) {
                hideSettingsPanel();
            } else {
                showSettingsPanel();
            }
            return;
        }
        if (key === 'r' && !isEditableField) {
            event.preventDefault();
            event.stopPropagation();
            try {
                if (movement.stopActiveZoomAnimation) {
                    movement.stopActiveZoomAnimation(false);
                }
                data.persistBoardData(true, 'reload');
            } catch (error) {
                console.error('Failed to persist board data before reload', error);
            }
            if (env.electron?.ipcRenderer?.invoke) {
                env.electron.ipcRenderer.invoke('workboard:relaunch-window').catch((error) => {
                    console.error('Failed to relaunch Board Studio window', error);
                    env.utils?.showToast?.(error?.message || 'Board Studio relaunch failed');
                });
            } else {
                window.location.reload();
            }
            return;
        }
    }
    if (event.key === 'Escape') {
        if (state.settingsPanelOpen) {
            event.preventDefault();
            event.stopPropagation();
            hideSettingsPanel();
            return;
        }
        const consumed = env.textEditing ? env.textEditing.cancelActiveTextEdit() : false;
        hideContextMenu();
        if (consumed) {
            event.stopPropagation();
            return;
        }
        if (active && active.matches && active.matches('.board-link-title[contenteditable="true"], .current-board-title[contenteditable="true"]')) {
            return;
        }
        const board = state.boardData.boards[state.currentBoardId];
        if (board?.parentId) {
            event.preventDefault();
            event.stopPropagation();
            navigateToBoard(board.parentId, { direction: 'out' });
        }
    }
}

function resolveNavigationDirection(currentBoard, nextBoard, explicitDirection) {
    if (explicitDirection === 'in' || explicitDirection === 'out') {
        return explicitDirection;
    }
    if (nextBoard?.parentId && nextBoard.parentId === currentBoard?.id) {
        return 'in';
    }
    if (currentBoard?.parentId && currentBoard.parentId === nextBoard?.id) {
        return 'out';
    }
    return 'in';
}

function easeInOutCubic(t) {
    const clamped = Math.min(Math.max(t, 0), 1);
    return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function cancelBoardTransition() {
    const existing = state.boardTransition;
    if (!existing) {
        return;
    }
    if (existing.frameId) {
        window.cancelAnimationFrame(existing.frameId);
    }
    state.boardTransition = null;
    if (dom.boardContainer) {
        dom.boardContainer.classList.remove('is-transitioning');
    }
    if (dom.boardGrid) {
        dom.boardGrid.style.opacity = '';
        dom.boardGrid.style.filter = '';
    }
}

function computeCenteredScroll(scale, targetViewport, container) {
    const viewportWidth = Math.max(1, container?.clientWidth ?? 1);
    const viewportHeight = Math.max(1, container?.clientHeight ?? 1);
    const scrollX = Number.isFinite(targetViewport?.scrollX) ? targetViewport.scrollX : 0;
    const scrollY = Number.isFinite(targetViewport?.scrollY) ? targetViewport.scrollY : 0;
    const targetScale = Number.isFinite(targetViewport?.scale) ? targetViewport.scale : state.boardScale || 1;
    const centerBoardX = (scrollX + (viewportWidth / 2)) / targetScale;
    const centerBoardY = (scrollY + (viewportHeight / 2)) / targetScale;
    return {
        scrollX: (centerBoardX * scale) - (viewportWidth / 2),
        scrollY: (centerBoardY * scale) - (viewportHeight / 2)
    };
}

function startBoardTransition(nextBoardId, direction, targetViewport) {
    if (!dom.boardContainer || !dom.boardGrid) {
        state.currentBoardId = nextBoardId;
        renderBoard({ direction, targetViewport });
        if (env.movement && typeof env.movement.centerViewport === 'function') {
            env.movement.centerViewport({ skipSave: true });
        }
        data.queueSave('board-navigate');
        return;
    }

    cancelBoardTransition();

    const container = dom.boardContainer;
    const grid = dom.boardGrid;
    const pad = movement.getCanvasPad ? movement.getCanvasPad() : 0;
    container.classList.add('is-transitioning');

    const previousViewport = movement.getCurrentViewportSnapshot ? movement.getCurrentViewportSnapshot() : movement.getActiveBoardViewport();
    const previousScale = utils.clamp(previousViewport?.scale ?? state.boardScale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
    const previousScrollX = Number.isFinite(previousViewport?.scrollX) ? previousViewport.scrollX : (container.scrollLeft - pad);
    const previousScrollY = Number.isFinite(previousViewport?.scrollY) ? previousViewport.scrollY : (container.scrollTop - pad);
    const outScale = utils.clamp(previousScale * (direction === 'out' ? 0.94 : 1.06), constants.MIN_SCALE, constants.MAX_SCALE);
    const outScroll = computeCenteredScroll(outScale, { scale: previousScale, scrollX: previousScrollX, scrollY: previousScrollY }, container);

    const targetScale = utils.clamp(targetViewport?.scale ?? 1, constants.MIN_SCALE, constants.MAX_SCALE);
    const inStartScale = utils.clamp(targetScale * (direction === 'out' ? 1.06 : 0.94), constants.MIN_SCALE, constants.MAX_SCALE);
    const inStartScroll = computeCenteredScroll(inStartScale, targetViewport, container);

    const duration = 250;
    const split = 0.48;
    const outDuration = Math.max(1, Math.round(duration * split));
    const inDuration = Math.max(1, duration - outDuration);

    const transition = {
        phase: 'out',
        frameId: null,
        startTime: 0
    };
    state.boardTransition = transition;

    const runIn = (timestamp) => {
        if (!state.boardTransition || state.boardTransition !== transition) {
            return;
        }
        if (!transition.startTime) {
            transition.startTime = timestamp;
        }
        const t = Math.min((timestamp - transition.startTime) / inDuration, 1);
        const eased = easeInOutCubic(t);
        const scale = inStartScale + (targetScale - inStartScale) * eased;
        const scrollX = inStartScroll.scrollX + ((targetViewport.scrollX ?? 0) - inStartScroll.scrollX) * eased;
        const scrollY = inStartScroll.scrollY + ((targetViewport.scrollY ?? 0) - inStartScroll.scrollY) * eased;
        state.boardScale = scale;
        movement.applyBoardScale({ skipSave: true, skipViewportUpdate: true });
        container.scrollLeft = scrollX + pad;
        container.scrollTop = scrollY + pad;
        movement.enforceViewportBounds();
        grid.style.opacity = String(eased);
        grid.style.filter = `blur(${((1 - eased) * 7).toFixed(2)}px)`;
        if (t < 1) {
            transition.frameId = window.requestAnimationFrame(runIn);
            return;
        }
        grid.style.opacity = '';
        grid.style.filter = '';
        container.classList.remove('is-transitioning');
        state.boardTransition = null;
        if (env.movement && typeof env.movement.centerViewport === 'function') {
            env.movement.centerViewport({ skipSave: true });
        } else {
            data.updateViewportState();
        }
        data.queueSave('board-navigate');
    };

    const runOut = (timestamp) => {
        if (!state.boardTransition || state.boardTransition !== transition) {
            return;
        }
        if (!transition.startTime) {
            transition.startTime = timestamp;
        }
        const t = Math.min((timestamp - transition.startTime) / outDuration, 1);
        const eased = easeInOutCubic(t);
        const scale = previousScale + (outScale - previousScale) * eased;
        const scrollX = previousScrollX + (outScroll.scrollX - previousScrollX) * eased;
        const scrollY = previousScrollY + (outScroll.scrollY - previousScrollY) * eased;
        state.boardScale = scale;
        movement.applyBoardScale({ skipSave: true, skipViewportUpdate: true });
        container.scrollLeft = scrollX + pad;
        container.scrollTop = scrollY + pad;
        movement.enforceViewportBounds();
        grid.style.opacity = String(1 - eased);
        grid.style.filter = `blur(${(eased * 7).toFixed(2)}px)`;
        if (t < 1) {
            transition.frameId = window.requestAnimationFrame(runOut);
            return;
        }

        transition.phase = 'in';
        transition.startTime = 0;
        state.currentBoardId = nextBoardId;
        state.boardScale = inStartScale;
        renderBoard({
            direction,
            targetViewport: { ...targetViewport, scale: inStartScale, scrollX: inStartScroll.scrollX, scrollY: inStartScroll.scrollY },
            skipViewportCommit: true
        });
        grid.style.opacity = '0';
        grid.style.filter = 'blur(7px)';
        transition.frameId = window.requestAnimationFrame(runIn);
    };

    transition.frameId = window.requestAnimationFrame(runOut);
}

// MARK: NAVIGATION
function navigateToBoard(boardId, options = {}) {
    if (!state.boardData || !state.boardData.boards) {
        return;
    }
    if (boardId === state.currentBoardId) {
        return;
    }
    if (env.management.queueBoardPreviewCapture) {
        env.management.queueBoardPreviewCapture({ boardId: state.currentBoardId, delay: 0 });
    }
    const nextBoard = state.boardData.boards[boardId];
    if (!nextBoard) {
        return;
    }
    const currentBoard = state.boardData.boards[state.currentBoardId];
    const direction = resolveNavigationDirection(currentBoard, nextBoard, options.direction);
    data.updateViewportState();
    const targetViewport = data.sanitizeViewport ? data.sanitizeViewport(nextBoard.viewport || state.boardData.viewport || { scale: 1, scrollX: 0, scrollY: 0 }) : (nextBoard.viewport || state.boardData.viewport || { scale: 1, scrollX: 0, scrollY: 0 });
    if (movement.resetPointerStates) {
        movement.resetPointerStates();
    }
    if (movement.resetZoomGestureState) {
        movement.resetZoomGestureState('board-navigation');
    }
    if (movement.ensureZoomStateIntegrity) {
        movement.ensureZoomStateIntegrity('board-navigation');
    }
    startBoardTransition(boardId, direction, targetViewport);
}

// MARK: UTILITY
function focusBlockEditor(blockId) {
    env.textEditing.beginTextEditing(blockId);
}

function getBlockById(blockId) {
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return null;
    }
    return board.blocks.find((block) => block.id === blockId) || null;
}

// MARK: EXPORTS
env.management.initializeBoard = initializeBoard;
env.management.enterSplashMode = enterSplashMode;
env.management.renderBoard = renderBoard;
env.management.insertBlock = insertBlock;
env.management.createTextBlockAt = createTextBlockAt;
env.management.createTextBlockWithContent = createTextBlockWithContent;
env.management.createTitleBlockAt = createTitleBlockAt;
env.management.createCreationBlockAt = createCreationBlockAt;
env.management.promptAndCreateBoard = promptAndCreateBoard;
env.management.createBoardWithTitle = createBoardWithTitle;
env.management.getBoardInitial = getBoardInitial;
env.management.applyBoardIconToElement = applyBoardIconToElement;
env.management.refreshBoardLinkIcons = refreshBoardLinkIcons;
env.management.showContextMenu = showContextMenu;
env.management.hideContextMenu = hideContextMenu;
env.management.queueSave = queueSave;
env.management.queueBoardPreviewCapture = queueBoardPreviewCapture;
env.management.deleteBlock = deleteBlock;
env.management.deleteSelectedBlocks = deleteSelectedBlocks;
env.management.deleteBlocks = deleteBlocks;
env.management.copySelectedBlocks = copySelectedBlocks;
env.management.pasteCopiedBlocks = pasteCopiedBlocks;
env.management.pasteBlocksFromClipboardPayload = pasteBlocksFromClipboardPayload;
env.management.cutSelectedBlocks = cutSelectedBlocks;
env.management.moveBlocksToBoard = moveBlocksToBoard;
env.management.navigateToBoard = navigateToBoard;
env.management.focusBlockEditor = focusBlockEditor;
env.management.getBlockById = getBlockById;
env.management.refreshDataSettingsUi = refreshDataSettingsUi;
env.management.showSettingsPanel = showSettingsPanel;
env.management.hideSettingsPanel = hideSettingsPanel;
env.management.refreshWorkspace = refreshWorkspace;
env.management.setActiveSettingsSection = setActiveSettingsSection;
env.management.beginInlineBoardRename = beginInlineBoardRename;
env.management.updateBoardLinkTitles = updateBoardLinkTitles;
env.management.focusBoardLinkTitle = focusBoardLinkTitle;
env.management.applyBackupDirectorySetting = applyBackupDirectorySetting;
if (env.textEditing) {
    env.management.commitActiveTextEdit = env.textEditing.commitActiveTextEdit;
    env.management.applyTitleVisuals = env.textEditing.applyTitleVisuals;
    env.management.refreshTextBlock = env.textEditing.refreshTextBlock;
}

module.exports = env;
