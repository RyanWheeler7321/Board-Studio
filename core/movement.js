'use strict';

// MARK: MOVEMENT SYSTEM
const env = require('./state');
const { dom, state, constants, utils, data } = env;
const perf = env.utils?.perf;
const { boardContainer, boardSurface, boardGrid } = dom;

let pendingViewportSync = null;
let pendingResizeFrame = null;
const resizeLockedTypes = new Set(['audio', 'board-link', 'link']);
// All block types should be corner-resize only (edges disabled)
const cornerResizeOnlyTypes = new Set(['youtube', 'text', 'title', 'image', 'video', 'link', 'board-link', 'audio', 'creation']);
let selectionGuardDepth = 0;
const WORKBOARD_BLOCKS_CLIPBOARD_FORMAT = 'application/x-workboard-blocks';
// MARK: Selection Guard
function clearDocumentSelection() {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
        return;
    }
    try {
        const selection = window.getSelection();
        if (selection && typeof selection.removeAllRanges === 'function') {
            selection.removeAllRanges();
        }
    } catch {}
}

function activateSelectionGuard() {
    if (selectionGuardDepth === 0) {
        const body = document.body;
        if (body) {
            body.classList.add('selection-guard-active');
        }
    }
    selectionGuardDepth += 1;
}

function releaseSelectionGuard() {
    if (selectionGuardDepth === 0) {
        return;
    }
    selectionGuardDepth -= 1;
    if (selectionGuardDepth === 0) {
        const body = document.body;
        if (body) {
            body.classList.remove('selection-guard-active');
        }
    }
}
function tryPasteBlocksFromClipboard() {
    const clipboard = env.electron?.clipboard;
    if (!clipboard || typeof clipboard.availableFormats !== 'function' || typeof clipboard.readBuffer !== 'function') {
        return false;
    }
    try {
        const formats = clipboard.availableFormats() || [];
        if (!Array.isArray(formats) || !formats.includes(WORKBOARD_BLOCKS_CLIPBOARD_FORMAT)) {
            return false;
        }
        const buffer = clipboard.readBuffer(WORKBOARD_BLOCKS_CLIPBOARD_FORMAT);
        if (!buffer || !buffer.length) {
            return false;
        }
        const payload = JSON.parse(buffer.toString('utf8'));
        if (env.management && typeof env.management.pasteBlocksFromClipboardPayload === 'function') {
            return !!env.management.pasteBlocksFromClipboardPayload(payload);
        }
    } catch (error) {
        console.warn('Failed to paste Workboard blocks from clipboard', error);
    }
    return false;
}

function blurActiveContentEditable(options = {}) {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active || !active.isContentEditable || typeof active.blur !== 'function') {
        return;
    }
    if (options.keepSelectedBlock) {
        const activeBlock = active.closest?.('.board-block');
        const activeId = activeBlock?.dataset?.id;
        if (activeId && state.selectedBlockIds.has(activeId)) {
            return;
        }
    }
    active.blur();
}
const aspectLockedTypes = new Set(['image', 'video']);
const DOM_DELTA_PIXEL = 0;
const ZOOM_GESTURE_TIMEOUT = 260;
const ZOOM_DIAGONAL_MAX_RATIO = 0.32;
const ZOOM_DIAGONAL_MAX_MAGNITUDE = 140;
const ZOOM_DIAGONAL_MIN_MAGNITUDE = 0.35;
const DRAG_ACTIVATION_DISTANCE = 6;
const SCALE_CENTER_ZONE = 0.34;
const SCALE_MIN_FACTOR = 0.05;
let cachedTransformOrigin = { raw: '0px 0px', x: 0, y: 0 };

// MARK: Transform Origin Helpers
function parseTransformOriginComponent(value, axis) {
    if (!boardGrid || typeof value !== 'string') {
        return 0;
    }
    const normalized = value.trim().toLowerCase();
    const size = axis === 'x' ? boardGrid.offsetWidth : boardGrid.offsetHeight;
    if (normalized === '' || normalized === '0') {
        return 0;
    }
    if (normalized === 'center') {
        return size / 2;
    }
    if ((axis === 'x' && normalized === 'left') || (axis === 'y' && normalized === 'top')) {
        return 0;
    }
    if ((axis === 'x' && normalized === 'right') || (axis === 'y' && normalized === 'bottom')) {
        return size;
    }
    if (normalized.endsWith('%')) {
        const percent = parseFloat(normalized);
        if (Number.isFinite(percent)) {
            return size * (percent / 100);
        }
        return 0;
    }
    if (normalized.endsWith('px')) {
        const px = parseFloat(normalized);
        return Number.isFinite(px) ? px : 0;
    }
    const numeric = parseFloat(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
}

function getTransformOriginOffsets() {
    if (!boardGrid) {
        return { x: 0, y: 0 };
    }
    let origin = boardGrid.style.transformOrigin;
    if (!origin) {
        try {
            const computed = window.getComputedStyle(boardGrid);
            origin = typeof computed?.transformOrigin === 'string' ? computed.transformOrigin : '0px 0px';
        } catch {
            origin = '0px 0px';
        }
    }
    if (cachedTransformOrigin.raw === origin) {
        return { x: cachedTransformOrigin.x, y: cachedTransformOrigin.y };
    }
    const parts = origin.split(/\s+/);
    const x = parseTransformOriginComponent(parts[0], 'x');
    const y = parseTransformOriginComponent(parts[1] ?? parts[0], 'y');
    cachedTransformOrigin = { raw: origin, x, y };
    return { x, y };
}

function setTransformOriginToDefault() {
    if (!boardGrid) {
        return;
    }
    boardGrid.style.transformOrigin = '0px 0px';
    cachedTransformOrigin = { raw: '0px 0px', x: 0, y: 0 };
}

function setTransformOriginToPivot(x, y) {
    if (!boardGrid) {
        return;
    }
    const pivotX = Number.isFinite(x) ? x : 0;
    const pivotY = Number.isFinite(y) ? y : 0;
    const value = `${pivotX}px ${pivotY}px`;
    boardGrid.style.transformOrigin = value;
    cachedTransformOrigin = { raw: value, x: pivotX, y: pivotY };
}

// MARK: Coordinate Conversion
function getEffectiveBoardScale() {
    const fallback = state.boardScale || 1;
    if (!boardGrid) {
        return fallback;
    }
    const width = boardGrid.offsetWidth;
    const height = boardGrid.offsetHeight;
    if (!width || !height) {
        return fallback;
    }
    const rect = boardGrid.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        return fallback;
    }
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
        return fallback;
    }
    if (Math.abs(scaleX - scaleY) <= 0.0001) {
        return scaleX;
    }
    return (scaleX + scaleY) / 2;
}

function getCanvasPad() {
    if (boardContainer && typeof window !== 'undefined') {
        try {
            const raw = window.getComputedStyle(boardContainer).getPropertyValue('--canvas-pad');
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        } catch {}
    }
    if (Number.isFinite(state.canvasPad)) {
        return state.canvasPad;
    }
    const viewportPad = boardContainer ? Math.max(boardContainer.clientWidth || 0, boardContainer.clientHeight || 0) : 0;
    const fallback = Math.max(constants.CANVAS_MARGIN || 600, constants.GRID_SIZE * 8, viewportPad);
    return Number.isFinite(fallback) ? fallback : 0;
}

function convertClientToBoard(clientX, clientY, options = {}) {
    if (!boardContainer) {
        return { x: 0, y: 0 };
    }
    const rect = boardContainer.getBoundingClientRect();
    const scale = options.scale ?? getEffectiveBoardScale();
    const scrollLeft = options.scrollLeft ?? boardContainer.scrollLeft;
    const scrollTop = options.scrollTop ?? boardContainer.scrollTop;
    const origin = getTransformOriginOffsets();
    const pad = getCanvasPad();
    const clientLeft = boardContainer.clientLeft || 0;
    const clientTop = boardContainer.clientTop || 0;
    const relativeX = (clientX - rect.left) - clientLeft;
    const relativeY = (clientY - rect.top) - clientTop;
    const screenX = relativeX + scrollLeft - pad;
    const screenY = relativeY + scrollTop - pad;
    const boardX = origin.x + (screenX - origin.x) / scale;
    const boardY = origin.y + (screenY - origin.y) / scale;
    return { x: boardX, y: boardY };
}

// MARK: Zoom Classification
function setZoomModifierState(active) {
    state.zoomModifierActive = !!active;
}

function resetZoomGestureState(reason = 'manual') {
    state.zoomGesture.active = false;
    state.zoomGesture.lastEventTs = 0;
    state.zoomGesture.source = reason || 'manual';
}

function classifyWheelAsZoom(event) {
    const now = performance.now ? performance.now() : Date.now();
    const ctrlMeta = event.ctrlKey || event.metaKey || state.zoomModifierActive || (typeof event.getModifierState === 'function' && (event.getModifierState('Control') || event.getModifierState('Meta')));
    const deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0;
    const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    const magnitude = Math.hypot(deltaX, deltaY);
    let shouldZoom = false;
    let detectedSource = 'none';
    if (ctrlMeta) {
        shouldZoom = true;
        detectedSource = 'modifier';
    } else {
        const symmetric = Math.abs(deltaX) > ZOOM_DIAGONAL_MIN_MAGNITUDE && Math.abs(deltaY) > ZOOM_DIAGONAL_MIN_MAGNITUDE && Math.sign(deltaX) === Math.sign(deltaY);
        if (symmetric && magnitude > ZOOM_DIAGONAL_MIN_MAGNITUDE && magnitude <= ZOOM_DIAGONAL_MAX_MAGNITUDE) {
            const difference = Math.abs(Math.abs(deltaX) - Math.abs(deltaY));
            const ratio = magnitude === 0 ? 1 : difference / magnitude;
            if (ratio <= ZOOM_DIAGONAL_MAX_RATIO) {
                shouldZoom = true;
                detectedSource = 'diagonal';
            }
        }
        if (!shouldZoom) {
            const pinchVertical = event.deltaMode === DOM_DELTA_PIXEL && Math.abs(deltaX) < 0.25 && Math.abs(deltaY) > 0 && Math.abs(deltaY) < 6;
            if (pinchVertical) {
                shouldZoom = true;
                detectedSource = 'pinch';
            }
        }
        if (!shouldZoom && state.zoomGesture.active) {
            const elapsed = now - state.zoomGesture.lastEventTs;
            if (elapsed <= ZOOM_GESTURE_TIMEOUT) {
                shouldZoom = true;
                detectedSource = state.zoomGesture.source || 'session';
            }
        }
    }
    if (!shouldZoom && magnitude > 0) {
        shouldZoom = true;
        detectedSource = 'wheel';
    }
    if (shouldZoom) {
        state.zoomGesture.active = true;
        state.zoomGesture.lastEventTs = now;
        state.zoomGesture.source = detectedSource;
    } else if (state.zoomGesture.active && now - state.zoomGesture.lastEventTs > ZOOM_GESTURE_TIMEOUT) {
        resetZoomGestureState('timeout');
    }
    return shouldZoom;
}

// MARK: Viewport Utilities
function getStandardViewport() {
    return {
        scale: 1,
        scrollX: 0,
        scrollY: 0,
        viewportWidth: 0,
        viewportHeight: 0
    };
}

function resolveViewportScrollForContainer(viewport, container = boardContainer) {
    const normalized = data.sanitizeViewport ? data.sanitizeViewport(viewport || getStandardViewport()) : (viewport || getStandardViewport());
    const scale = utils.clamp(Number(normalized.scale) || 1, constants.MIN_SCALE, constants.MAX_SCALE);
    const rawScrollX = Number.isFinite(normalized.scrollX) ? normalized.scrollX : 0;
    const rawScrollY = Number.isFinite(normalized.scrollY) ? normalized.scrollY : 0;
    const savedWidth = Number(normalized.viewportWidth);
    const savedHeight = Number(normalized.viewportHeight);
    const containerWidth = Math.max(0, Number(container?.clientWidth) || 0);
    const containerHeight = Math.max(0, Number(container?.clientHeight) || 0);
    if (!(savedWidth > 0 && savedHeight > 0 && containerWidth > 0 && containerHeight > 0 && scale > 0)) {
        return {
            scrollX: rawScrollX,
            scrollY: rawScrollY
        };
    }
    const centerBoardX = (rawScrollX + (savedWidth / 2)) / scale;
    const centerBoardY = (rawScrollY + (savedHeight / 2)) / scale;
    return {
        scrollX: (centerBoardX * scale) - (containerWidth / 2),
        scrollY: (centerBoardY * scale) - (containerHeight / 2)
    };
}

function scheduleViewportSync() {
    if (!boardContainer) {
        return;
    }
    if (state.boardTransition) {
        return;
    }
    if (pendingViewportSync !== null) {
        return;
    }
    pendingViewportSync = window.requestAnimationFrame(() => {
        pendingViewportSync = null;
        data.updateViewportState();
        if (data.queueViewportSave) {
            data.queueViewportSave({ maxWaitMs: 1000 });
        } else {
            data.queueSave?.('viewport');
        }
    });
}

function calculateBoardExtents() {
    const margin = constants.GRID_SIZE * 2;
    const baseWidth = constants.BASE_CANVAS_WIDTH + margin;
    const baseHeight = constants.BASE_CANVAS_HEIGHT + margin;
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (!board || !Array.isArray(board.blocks) || board.blocks.length === 0) {
        return { width: baseWidth, height: baseHeight };
    }
    let maxX = 0;
    let maxY = 0;
    board.blocks.forEach((block) => {
        const right = block.x + block.width;
        const bottom = block.y + block.height;
        if (right > maxX) {
            maxX = right;
        }
        if (bottom > maxY) {
            maxY = bottom;
        }
    });
    return {
        width: Math.max(baseWidth, maxX + margin),
        height: Math.max(baseHeight, maxY + margin)
    };
}

// MARK: Container Pointer Events
function beginPan(event, captureElement = boardContainer) {
    if (!boardContainer || !event) {
        return false;
    }
    const target = captureElement || boardContainer;
    try {
        if (target && typeof target.setPointerCapture === 'function') {
            target.setPointerCapture(event.pointerId);
        }
    } catch {}
    state.panState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: boardContainer.scrollLeft,
        scrollTop: boardContainer.scrollTop,
        captureElement: target && typeof target.releasePointerCapture === 'function' ? target : null
    };
    boardContainer.classList.add('is-panning');
    env.management.hideContextMenu();
    return true;
}

function applyPanFromPointer(event) {
    if (!state.panState || event.pointerId !== state.panState.pointerId) {
        return false;
    }
    if (!boardContainer) {
        return false;
    }
    const deltaX = state.panState.startX - event.clientX;
    const deltaY = state.panState.startY - event.clientY;
    boardContainer.scrollLeft = state.panState.scrollLeft + deltaX;
    boardContainer.scrollTop = state.panState.scrollTop + deltaY;
    return true;
}

function handleContainerPointerDown(event) {
    if (!boardContainer) {
        return;
    }
    if (env.sublists?.blurActiveEditor && !dom.sublistsPanel?.contains(event.target)) {
        env.sublists.blurActiveEditor();
    }
    if (env.toolShell?.blurActiveSidebarInput && !dom.sublistsPanel?.contains(event.target)) {
        env.toolShell.blurActiveSidebarInput();
    }
    if (event.button === 1) {
        event.preventDefault();
        beginPan(event, boardContainer);
        return;
    }
    if (event.button === 0 && event.target === boardContainer) {
        env.management.commitActiveTextEdit();
    }
    if (event.target === boardContainer) {
        selectBlock(null);
        env.management.hideContextMenu();
    }
}

function handleGridPointerDown(event) {
    if (event.button !== 0) {
        return;
    }
    if (env.sublists?.blurActiveEditor && !dom.sublistsPanel?.contains(event.target)) {
        env.sublists.blurActiveEditor();
    }
    if (env.toolShell?.blurActiveSidebarInput && !dom.sublistsPanel?.contains(event.target)) {
        env.toolShell.blurActiveSidebarInput();
    }
    if (event.target.closest('.board-block')) {
        return;
    }
    event.preventDefault();
    env.management.hideContextMenu();
    env.management.commitActiveTextEdit();
    clearSelection();
    startSelectionMarquee(event);
}

// MARK: Selection Marquee
function startSelectionMarquee(event) {
    const coords = getBoardCoordinates(event);
    const captureTarget = event.currentTarget || boardGrid;
    state.marqueeState = {
        pointerId: event.pointerId,
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y,
        captureTarget,
        moved: false
    };
    const marquee = ensureSelectionMarqueeElement();
    marquee.classList.add('hidden');
    positionMarqueeElement(marquee, {
        left: coords.x,
        top: coords.y,
        width: 0,
        height: 0
    });
    captureTarget.setPointerCapture(event.pointerId);
}

function handleSelectionMarqueeMove(event) {
    if (!state.marqueeState || event.pointerId !== state.marqueeState.pointerId) {
        return;
    }
    const coords = getBoardCoordinates(event);
    state.marqueeState.currentX = coords.x;
    state.marqueeState.currentY = coords.y;
    const bounds = getMarqueeBounds(state.marqueeState);
    updateSelectionMarquee(bounds);
    if (Math.abs(bounds.width) > 4 || Math.abs(bounds.height) > 4) {
        state.marqueeState.moved = true;
    }
}

function finishSelectionMarquee(event) {
    if (!state.marqueeState || (event && event.pointerId !== state.marqueeState.pointerId)) {
        return;
    }
    const bounds = getMarqueeBounds(state.marqueeState);
    if (state.marqueeState.captureTarget) {
        try {
            state.marqueeState.captureTarget.releasePointerCapture(state.marqueeState.pointerId);
        } catch {}
    }
    ensureSelectionMarqueeElement().classList.add('hidden');
    if (state.marqueeState.moved) {
        applySelectionFromBounds(bounds);
    }
    state.marqueeState = null;
}

function updateSelectionMarquee(bounds) {
    const marquee = ensureSelectionMarqueeElement();
    if (!marquee) {
        return;
    }
    marquee.classList.remove('hidden');
    positionMarqueeElement(marquee, bounds);
}

function positionMarqueeElement(marquee, bounds) {
    marquee.style.left = `${bounds.left}px`;
    marquee.style.top = `${bounds.top}px`;
    marquee.style.width = `${Math.abs(bounds.width)}px`;
    marquee.style.height = `${Math.abs(bounds.height)}px`;
}

function getMarqueeBounds(stateObj) {
    const left = Math.min(stateObj.startX, stateObj.currentX);
    const top = Math.min(stateObj.startY, stateObj.currentY);
    const width = Math.abs(stateObj.currentX - stateObj.startX);
    const height = Math.abs(stateObj.currentY - stateObj.startY);
    return { left, top, width, height };
}

function applySelectionFromBounds(bounds) {
    if (!state.boardData) {
        return;
    }
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const hits = board.blocks.filter((block) => {
        return (
            block.x < bounds.left + bounds.width &&
            block.x + block.width > bounds.left &&
            block.y < bounds.top + bounds.height &&
            block.y + block.height > bounds.top
        );
    }).map((block) => block.id);
    setSelectedBlocks(hits, hits[0] || null);
}

function handleContainerPointerMove(event) {
    if (applyPanFromPointer(event)) {
        return;
    }
    if (state.marqueeState) {
        handleSelectionMarqueeMove(event);
    }
}

// MARK: Pointer Lifecycle
function handlePointerUp(event) {
    cancelPendingDrag(event);
    if (state.panState && (!event || event.pointerId === state.panState.pointerId)) {
        finishPanning();
    }
    if (state.marqueeState) {
        finishSelectionMarquee(event);
    }
    if (state.dragState && (!event || event.pointerId === state.dragState.pointerId)) {
        finishDraggingBlock(event);
    }
    if (state.scaleState && (!event || event.pointerId === state.scaleState.pointerId)) {
        finishScalingBlock(event);
    }
    if (state.resizeState && (!event || event.pointerId === state.resizeState.pointerId)) {
        finishResizingBlock(event);
    }
    if (!state.dragState && !state.resizeState && !state.scaleState) {
        setBoardCursor('');
    }
}

function finishPanning() {
    if (!boardContainer || !state.panState) {
        state.panState = null;
        return;
    }
    const captureElement = state.panState.captureElement || boardContainer;
    try {
        if (captureElement && typeof captureElement.releasePointerCapture === 'function') {
            captureElement.releasePointerCapture(state.panState.pointerId);
        }
    } catch {}
    boardContainer.classList.remove('is-panning');
    state.panState = null;
    data.updateViewportState();
}

// MARK: Zoom Interaction
function handleZoom(event) {
    if (!boardContainer) {
        return;
    }
    if (state.boardTransition) {
        const transition = state.boardTransition;
        if (transition?.frameId) {
            try {
                window.cancelAnimationFrame(transition.frameId);
            } catch {}
        }
        state.boardTransition = null;
        boardContainer.classList.remove('is-transitioning');
        if (boardGrid) {
            boardGrid.style.opacity = '';
            boardGrid.style.filter = '';
        }
    }
    if (state.zoomAnimation) {
        finalizeSmoothZoom(false);
    }
    if (!classifyWheelAsZoom(event)) {
        return;
    }
    event.preventDefault();
    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    const deltaInput = utils.clamp(dominantDelta || 0, -600, 600);
    if (deltaInput === 0) {
        return;
    }
    if (state.activeBoardAnimation) {
        const animation = state.activeBoardAnimation;
        if (animation && typeof animation.cancel === 'function') {
            try {
                animation.cancel();
            } catch {}
        }
        state.activeBoardAnimation = null;
        applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    }
    let rawSpeed = Number(state.boardData?.settings?.zoomSpeed);
    if (!Number.isFinite(rawSpeed) || rawSpeed <= 0) {
        rawSpeed = 1;
    }
    const zoomSpeed = utils.clamp(rawSpeed, 0.25, 3);
    const baseSensitivity = (constants.SCALE_SENSITIVITY || 0.0012) * zoomSpeed;
    const intensity = Math.abs(deltaInput);
    const threshold = constants.ZOOM_BOOST_THRESHOLD || 240;
    const divisor = constants.ZOOM_BOOST_DIVISOR || 480;
    const maxExtra = constants.ZOOM_MAX_BOOST || 1.8;
    let boost = 1;
    if (intensity > threshold && divisor > 0) {
        const extra = Math.min((intensity - threshold) / divisor, maxExtra);
        if (extra > 0) {
            boost += extra;
        }
    }
    const effectiveSensitivity = baseSensitivity * boost;
    const scaleChange = Math.exp(-deltaInput * effectiveSensitivity);
    let prevScale = getEffectiveBoardScale();
    if (!Number.isFinite(prevScale) || prevScale <= 0) {
        prevScale = state.boardScale && Number.isFinite(state.boardScale) ? state.boardScale : 1;
    }
    prevScale = utils.clamp(prevScale, constants.MIN_SCALE, constants.MAX_SCALE);
    state.boardScale = prevScale;
    let newScale = prevScale * scaleChange;
    if (!Number.isFinite(newScale) || newScale <= 0) {
        newScale = deltaInput > 0 ? Math.max(constants.MIN_SCALE, prevScale * 0.9) : Math.min(constants.MAX_SCALE, prevScale * 1.1);
    }
    newScale = utils.clamp(newScale, constants.MIN_SCALE, constants.MAX_SCALE);
    if (Math.abs(newScale - prevScale) < 0.0004) {
        const nudge = deltaInput > 0 ? -0.008 : 0.008;
        newScale = utils.clamp(prevScale * (1 + nudge), constants.MIN_SCALE, constants.MAX_SCALE);
        if (Math.abs(newScale - prevScale) < 0.0001) {
            newScale = deltaInput > 0 ? Math.max(constants.MIN_SCALE, prevScale - 0.01) : Math.min(constants.MAX_SCALE, prevScale + 0.01);
        }
        if (Math.abs(newScale - prevScale) < 0.0001) {
            return;
        }
    }
    const rect = boardContainer.getBoundingClientRect();
    const clientLeft = boardContainer.clientLeft || 0;
    const clientTop = boardContainer.clientTop || 0;
    const fallbackClientX = (boardContainer.clientWidth || 0) / 2;
    const fallbackClientY = (boardContainer.clientHeight || 0) / 2;
    const eventClientX = Number.isFinite(event.clientX) ? event.clientX : (rect.left + clientLeft + fallbackClientX);
    const eventClientY = Number.isFinite(event.clientY) ? event.clientY : (rect.top + clientTop + fallbackClientY);
    const rawClientX = (eventClientX - rect.left) - clientLeft;
    const rawClientY = (eventClientY - rect.top) - clientTop;
    const focusClientX = utils.clamp(rawClientX, 0, boardContainer.clientWidth || rawClientX);
    const focusClientY = utils.clamp(rawClientY, 0, boardContainer.clientHeight || rawClientY);
    const focusBoard = convertClientToBoard(eventClientX, eventClientY, { scale: prevScale });
    const origin = getTransformOriginOffsets();
    env.utils.forwardDebugLog('debug', ['movement.handleZoom', {
        prevScale,
        newScale,
        deltaInput,
        boost,
        focusBoardX: focusBoard.x,
        focusBoardY: focusBoard.y,
        source: state.zoomGesture.source,
        ctrl: event.ctrlKey,
        meta: event.metaKey
    }]);
    startSmoothZoom({
        targetScale: newScale,
        focusBoardX: focusBoard.x,
        focusBoardY: focusBoard.y,
        focusClientX,
        focusClientY,
        pointerType: event.pointerType || 'wheel',
        originX: origin.x,
        originY: origin.y
    });
    ensureZoomStateIntegrity('zoom-event');
}

// MARK: Zoom Animation
function startSmoothZoom(config) {
    if (!boardContainer) {
        state.boardScale = config.targetScale;
        applyBoardScale();
        return;
    }
    stopActiveZoomAnimation(false);
    const duration = constants.ZOOM_ANIMATION_DURATION || 180;
    const initialScale = getEffectiveBoardScale();
    state.boardScale = initialScale;
    state.zoomAnimation = {
        startScale: initialScale,
        targetScale: config.targetScale,
        focusBoardX: config.focusBoardX,
        focusBoardY: config.focusBoardY,
        focusClientX: config.focusClientX,
        focusClientY: config.focusClientY,
        originX: Number.isFinite(config.originX) ? config.originX : 0,
        originY: Number.isFinite(config.originY) ? config.originY : 0,
        pointerType: config.pointerType,
        duration,
        startTime: 0,
        frameId: null
    };
    state.zoomAnimation.frameId = window.requestAnimationFrame(runSmoothZoomFrame);
}
function runSmoothZoomFrame(timestamp) {
    const animation = state.zoomAnimation;
    if (!animation) {
        return;
    }
    if (!animation.startTime) {
        animation.startTime = timestamp;
    }
    const elapsed = timestamp - animation.startTime;
    const progress = Math.min(elapsed / animation.duration, 1);
    const eased = easeOutCubic(progress);
    const currentScale = animation.startScale + (animation.targetScale - animation.startScale) * eased;
    state.boardScale = currentScale;
    applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    const originX = Number.isFinite(animation.originX) ? animation.originX : 0;
    const originY = Number.isFinite(animation.originY) ? animation.originY : 0;
    const pad = getCanvasPad();
    const screenX = pad + originX + (animation.focusBoardX - originX) * currentScale;
    const screenY = pad + originY + (animation.focusBoardY - originY) * currentScale;
    const scrollLeft = screenX - animation.focusClientX;
    const scrollTop = screenY - animation.focusClientY;
    boardContainer.scrollLeft = scrollLeft;
    boardContainer.scrollTop = scrollTop;
    enforceViewportBounds();
    if (progress < 1) {
        animation.frameId = window.requestAnimationFrame(runSmoothZoomFrame);
        return;
    }
    finalizeSmoothZoom(true);
}

function finalizeSmoothZoom(commitSave) {
    const animation = state.zoomAnimation;
    if (!animation) {
        return;
    }
    if (animation.frameId) {
        window.cancelAnimationFrame(animation.frameId);
    }
    const finalScale = animation.targetScale;
    state.boardScale = finalScale;
    applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    const originX = Number.isFinite(animation.originX) ? animation.originX : 0;
    const originY = Number.isFinite(animation.originY) ? animation.originY : 0;
    const pad = getCanvasPad();
    const screenX = pad + originX + (animation.focusBoardX - originX) * finalScale;
    const screenY = pad + originY + (animation.focusBoardY - originY) * finalScale;
    const scrollLeft = screenX - animation.focusClientX;
    const scrollTop = screenY - animation.focusClientY;
    boardContainer.scrollLeft = scrollLeft;
    boardContainer.scrollTop = scrollTop;
    enforceViewportBounds();
    state.zoomAnimation = null;
    if (commitSave) {
        data.updateViewportState();
        if (!animation.pointerType || animation.pointerType !== 'touch') {
            if (data.queueViewportSave) {
                data.queueViewportSave({ maxWaitMs: 0 });
            } else {
                data.queueSave('viewport');
            }
        }
    }
}

function stopActiveZoomAnimation(commitSave) {
    if (!state.zoomAnimation) {
        return;
    }
    const animation = state.zoomAnimation;
    if (animation.frameId) {
        window.cancelAnimationFrame(animation.frameId);
        animation.frameId = null;
    }
    const effectiveScale = getEffectiveBoardScale();
    if (Number.isFinite(effectiveScale) && effectiveScale > 0) {
        const clamped = utils.clamp(effectiveScale, constants.MIN_SCALE, constants.MAX_SCALE);
        if (Math.abs(clamped - state.boardScale) > 0.0001) {
            state.boardScale = clamped;
            applyBoardScale({ skipSave: true, skipViewportUpdate: true });
        }
    }
    state.zoomAnimation = null;
    data.updateViewportState();
    if (commitSave && (!animation.pointerType || animation.pointerType !== 'touch')) {
        if (data.queueViewportSave) {
            data.queueViewportSave({ maxWaitMs: 0 });
        } else {
            data.queueSave('viewport');
        }
    }
}

function easeOutCubic(t) {
    const inv = 1 - Math.min(Math.max(t, 0), 1);
    return 1 - inv * inv * inv;
}

function applyBoardScale(options = {}) {
    if (!boardGrid) {
        return;
    }
    const normalized = typeof options === 'boolean' ? { skipSave: options, skipViewportUpdate: options } : options;
    const skipSave = !!normalized.skipSave;
    const skipViewportUpdate = !!normalized.skipViewportUpdate;
    if (state.activeBoardAnimation && typeof state.activeBoardAnimation.cancel === 'function') {
        try {
            state.activeBoardAnimation.cancel();
        } catch {}
        state.activeBoardAnimation = null;
    }
    boardGrid.style.transform = `scale(${state.boardScale})`;
    setTransformOriginToDefault();
    updateGridBackground();
    if (!skipViewportUpdate) {
        data.updateViewportState();
    }
    if (!skipSave) {
        data.queueSave('scale-changed');
    }
}

function ensureZoomStateIntegrity(reason = 'manual') {
    if (!Number.isFinite(state.boardScale) || state.boardScale <= 0) {
        state.boardScale = 1;
    }
    state.boardScale = utils.clamp(state.boardScale, constants.MIN_SCALE, constants.MAX_SCALE);
    if (boardContainer && state.panState && !boardContainer.classList.contains('is-panning')) {
        boardContainer.classList.add('is-panning');
    } else if (boardContainer && !state.panState && boardContainer.classList.contains('is-panning')) {
        boardContainer.classList.remove('is-panning');
    }
    if (state.zoomGesture.active && performance.now) {
        const diff = performance.now() - (state.zoomGesture.lastEventTs || 0);
        if (diff > (ZOOM_GESTURE_TIMEOUT * 2)) {
            resetZoomGestureState(`${reason}-reset`);
        }
    }
}

function updateGridBackground() {
    if (!boardGrid || !boardContainer) {
        return;
    }
    const t0 = perf ? perf.now() : 0;
    let previousPad = Number.isFinite(state.canvasPad) ? state.canvasPad : null;
    try {
        const raw = window.getComputedStyle(boardContainer).getPropertyValue('--canvas-pad');
        const parsed = Number.parseFloat(raw);
        if (Number.isFinite(parsed) && parsed >= 0) {
            previousPad = parsed;
        }
    } catch {}
    const pad = Math.max(constants.CANVAS_MARGIN || 600, constants.GRID_SIZE * 8, boardContainer.clientWidth || 0, boardContainer.clientHeight || 0);
    const shouldPreserveScroll = !state.boardTransition && previousPad !== null && previousPad > 0 && previousPad !== pad;
    const preservedScrollX = shouldPreserveScroll ? (boardContainer.scrollLeft - previousPad) : null;
    const preservedScrollY = shouldPreserveScroll ? (boardContainer.scrollTop - previousPad) : null;
    state.canvasPad = pad;
    boardContainer.style.setProperty('--canvas-pad', `${pad}px`);
    const extents = calculateBoardExtents();
    const width = extents.width;
    const height = extents.height;
    if (boardSurface) {
        boardSurface.style.width = `${width + (pad * 2)}px`;
        boardSurface.style.height = `${height + (pad * 2)}px`;
    }
    boardGrid.style.width = `${width}px`;
    boardGrid.style.height = `${height}px`;
    if (shouldPreserveScroll) {
        boardContainer.scrollLeft = preservedScrollX + pad;
        boardContainer.scrollTop = preservedScrollY + pad;
    }
    const scale = getEffectiveBoardScale();
    const root = document.documentElement;
    if (root) {
        root.style.setProperty('--grid-major-ink', scale <= 0.72 ? 'var(--grid-major-ink-base)' : 'transparent');
    }
    enforceViewportBounds();
    scheduleViewportSync();
    if (perf) {
        const board = state.boardData?.boards?.[state.currentBoardId];
        perf.logIfSlow('updateGridBackground', perf.now() - t0, {
            boardId: state.currentBoardId,
            blocks: board?.blocks?.length || 0
        });
    }
}

function enforceViewportBounds() {
    if (!boardContainer) {
        return;
    }
    const extents = calculateBoardExtents();
    const scale = getEffectiveBoardScale();
    const pad = getCanvasPad();
    const maxScrollLeft = Math.max(0, (pad * 2) + (extents.width * scale) - boardContainer.clientWidth);
    const maxScrollTop = Math.max(0, (pad * 2) + (extents.height * scale) - boardContainer.clientHeight);
    const clampedLeft = utils.clamp(boardContainer.scrollLeft, 0, maxScrollLeft);
    const clampedTop = utils.clamp(boardContainer.scrollTop, 0, maxScrollTop);
    if (boardContainer.scrollLeft !== clampedLeft) {
        boardContainer.scrollLeft = clampedLeft;
    }
    if (boardContainer.scrollTop !== clampedTop) {
        boardContainer.scrollTop = clampedTop;
    }
    scheduleViewportSync();
}

function handleContainerScroll() {
    if (!boardContainer) {
        return;
    }
    scheduleViewportSync();
}

function getActiveBoardViewport() {
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (board?.viewport) {
        return data.sanitizeViewport(board.viewport);
    }
    if (state.boardData?.viewport) {
        return data.sanitizeViewport(state.boardData.viewport);
    }
    return getStandardViewport();
}

function restoreViewport(options = {}) {
    if (!boardContainer || !state.boardData) {
        return;
    }
    const normalized = typeof options === 'boolean' ? { skipSave: options } : options;
    const skipSave = !!normalized.skipSave;
    const viewport = data.sanitizeViewport ? data.sanitizeViewport(normalized.viewport || getActiveBoardViewport()) : (normalized.viewport || getActiveBoardViewport());
    const rawScale = typeof viewport.scale === 'number' ? viewport.scale : Number(viewport.scale) || 1;
    const nextScale = utils.clamp(rawScale, constants.MIN_SCALE, constants.MAX_SCALE);
    const resolvedScroll = resolveViewportScrollForContainer(viewport, boardContainer);
    const pad = getCanvasPad();
    state.boardScale = nextScale;
    applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    boardContainer.scrollLeft = resolvedScroll.scrollX + pad;
    boardContainer.scrollTop = resolvedScroll.scrollY + pad;
    enforceViewportBounds();
    const appliedSnapshot = getCurrentViewportSnapshot();
    if (!skipSave) {
        state.boardData.viewport = { ...appliedSnapshot };
        const board = state.boardData.boards?.[state.currentBoardId];
        if (board) {
            board.viewport = { ...appliedSnapshot };
        }
    }
    if (normalized.reason) {
        console.debug('Viewport restored', {
            reason: normalized.reason,
            boardId: state.currentBoardId,
            savedViewport: viewport,
            appliedViewport: appliedSnapshot
        });
    }
    if (!skipSave) {
        data.updateViewportState();
        if (data.queueViewportSave) {
            data.queueViewportSave({ maxWaitMs: 0 });
        } else {
            data.queueSave('viewport');
        }
    }
}

function getCurrentViewportSnapshot() {
    if (!boardContainer) {
        return getActiveBoardViewport();
    }
    const pad = getCanvasPad();
    return {
        scale: state.boardScale,
        scrollX: boardContainer.scrollLeft - pad,
        scrollY: boardContainer.scrollTop - pad,
        viewportWidth: boardContainer.clientWidth || 0,
        viewportHeight: boardContainer.clientHeight || 0
    };
}

function centerViewport(options = {}) {
    if (!boardContainer || !state.boardData) {
        return false;
    }
    const normalized = options && typeof options === 'object' ? options : {};
    const skipSave = !!normalized.skipSave;
    const pad = getCanvasPad();
    const extents = calculateBoardExtents();
    const scale = utils.clamp(state.boardScale || 1, constants.MIN_SCALE, constants.MAX_SCALE);
    const viewportWidth = Math.max(1, boardContainer.clientWidth);
    const viewportHeight = Math.max(1, boardContainer.clientHeight);
    const scrollLeft = pad + ((extents.width * scale) / 2) - (viewportWidth / 2);
    const scrollTop = pad + ((extents.height * scale) / 2) - (viewportHeight / 2);
    boardContainer.scrollLeft = scrollLeft;
    boardContainer.scrollTop = scrollTop;
    enforceViewportBounds();
    data.updateViewportState();
    if (!skipSave) {
        if (data.queueViewportSave) {
            data.queueViewportSave({ maxWaitMs: 0 });
        } else {
            data.queueSave?.('viewport');
        }
    }
    return true;
}

function zoomToFit(options = {}) {
    if (!boardContainer || !state.boardData) {
        return false;
    }
    if (state.zoomAnimation) {
        finalizeSmoothZoom(false);
    }
    if (state.activeBoardAnimation && typeof state.activeBoardAnimation.cancel === 'function') {
        try {
            state.activeBoardAnimation.cancel();
        } catch {}
        state.activeBoardAnimation = null;
    }
    const board = state.boardData.boards?.[state.currentBoardId];
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    blocks.forEach((block) => {
        if (!block) {
            return;
        }
        const x = Number(block.x);
        const y = Number(block.y);
        const w = Number(block.width);
        const h = Number(block.height);
        const left = Number.isFinite(x) ? x : 0;
        const top = Number.isFinite(y) ? y : 0;
        const right = left + (Number.isFinite(w) ? w : 0);
        const bottom = top + (Number.isFinite(h) ? h : 0);
        if (left < minX) {
            minX = left;
        }
        if (top < minY) {
            minY = top;
        }
        if (right > maxX) {
            maxX = right;
        }
        if (bottom > maxY) {
            maxY = bottom;
        }
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        const extents = calculateBoardExtents();
        minX = 0;
        minY = 0;
        maxX = extents.width;
        maxY = extents.height;
    }
    const padding = Number.isFinite(options.padding) ? options.padding : (constants.GRID_SIZE * 2);
    const contentWidth = Math.max(1, (maxX - minX) + (padding * 2));
    const contentHeight = Math.max(1, (maxY - minY) + (padding * 2));
    const viewportWidth = Math.max(1, boardContainer.clientWidth);
    const viewportHeight = Math.max(1, boardContainer.clientHeight);
    const scaleX = viewportWidth / contentWidth;
    const scaleY = viewportHeight / contentHeight;
    const targetScale = utils.clamp(Math.min(scaleX, scaleY), constants.MIN_SCALE, constants.MAX_SCALE);
    state.boardScale = targetScale;
    applyBoardScale({ skipSave: true, skipViewportUpdate: true });
    const pad = getCanvasPad();
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    boardContainer.scrollLeft = pad + (centerX * targetScale) - (viewportWidth / 2);
    boardContainer.scrollTop = pad + (centerY * targetScale) - (viewportHeight / 2);
    enforceViewportBounds();
    data.updateViewportState();
    data.queueSave('zoom-to-fit');
    return true;
}

function handleViewportResize() {
    if (!boardContainer) {
        return;
    }
    resetPointerStates();
    if (pendingResizeFrame) {
        window.cancelAnimationFrame(pendingResizeFrame);
    }
    pendingResizeFrame = window.requestAnimationFrame(() => {
        pendingResizeFrame = window.requestAnimationFrame(() => {
            pendingResizeFrame = null;
            restoreViewport({ skipSave: true, reason: 'resize' });
            if (state.selectionMarqueeEl) {
                state.selectionMarqueeEl.classList.add('hidden');
            }
            const viewport = getCurrentViewportSnapshot();
            data.updateViewportState();
            env.utils.forwardDebugLog('debug', ['movement.handleViewportResize applied', { viewport }]);
        });
    });
}

function resetPointerStates() {
    handlePointerUp();
    clearSelectionPointerState();
    state.lastPointerBoardPos = {
        x: constants.GRID_SIZE * 8,
        y: constants.GRID_SIZE * 8
    };
    state.lastPointerUpdateTs = 0;
    state.pendingDrag = null;
    resetZoomGestureState('pointer-reset');
}

function clearSelectionPointerState() {
    state.selectionChangedOnPointerDown = false;
    state.lastPointerDownBlockId = null;
}

function queuePendingDrag(block, element, event) {
    if (!block || !element || !event) {
        return;
    }
    if (event.isPrimary === false) {
        return;
    }
    if (typeof event.button === 'number' && event.button > 0) {
        return;
    }
    state.pendingDrag = {
        blockId: block.id,
        pointerId: event.pointerId,
        element,
        startClientX: event.clientX,
        startClientY: event.clientY
    };
}

function cancelPendingDrag(event) {
    if (!state.pendingDrag) {
        return;
    }
    if (event && state.pendingDrag.pointerId !== event.pointerId) {
        return;
    }
    state.pendingDrag = null;
}

function maybeStartPendingDrag(event) {
    if (!state.pendingDrag || !event || state.dragState) {
        return;
    }
    if (event.pointerId !== state.pendingDrag.pointerId) {
        return;
    }
    const deltaX = event.clientX - state.pendingDrag.startClientX;
    const deltaY = event.clientY - state.pendingDrag.startClientY;
    const distanceSq = (deltaX * deltaX) + (deltaY * deltaY);
    if (distanceSq < DRAG_ACTIVATION_DISTANCE * DRAG_ACTIVATION_DISTANCE) {
        return;
    }
    const block = env.management.getBlockById(state.pendingDrag.blockId);
    const element = state.pendingDrag.element;
    state.pendingDrag = null;
    if (!block || !element || !element.isConnected) {
        return;
    }
    startDraggingBlock(block, element, event);
    handleBlockDrag(event);
}

function consumeSelectionPointerState(blockId) {
    const selectionJustChanged = state.selectionChangedOnPointerDown && state.lastPointerDownBlockId === blockId;
    clearSelectionPointerState();
    return selectionJustChanged;
}

function updatePointerPosition(event) {
    if (!event) {
        return;
    }
    state.lastPointerBoardPos = getBoardCoordinates(event);
    state.lastPointerUpdateTs = Date.now();
}

function getBoardCoordinates(event) {
    if (!event || !boardContainer) {
        return { x: 0, y: 0 };
    }
    const point = convertClientToBoard(event.clientX, event.clientY);
    return {
        x: Math.round(point.x),
        y: Math.round(point.y)
    };
}

function handleKeydown(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
        setZoomModifierState(true);
        state.zoomGesture.source = 'modifier';
    }
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
    if (!state.boardData) {
        return;
    }
    const activeElement = document.activeElement;
    const tagName = activeElement?.tagName ? activeElement.tagName.toLowerCase() : '';
    let inputType = '';
    if (tagName === 'input' && typeof activeElement.getAttribute === 'function') {
        inputType = (activeElement.getAttribute('type') || '').toLowerCase();
    }
    const isTextInput = tagName === 'textarea' || (tagName === 'input' && (!inputType || ['text', 'search', 'url', 'email', 'tel', 'password', 'number'].includes(inputType)));
    if (activeElement && (
        (activeElement.closest && activeElement.closest('.board-block.is-editing')) ||
        activeElement.dataset && activeElement.dataset.editing === 'true' ||
        activeElement.isContentEditable ||
        isTextInput
    )) {
        return;
    }
    const controlKey = event.ctrlKey || event.metaKey;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    if (controlKey && key === 'z') {
        event.preventDefault();
        if (env.history && typeof env.history.undo === 'function') {
            env.history.undo();
        }
        return;
    }
    if (controlKey && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        if (env.history && typeof env.history.redo === 'function') {
            env.history.redo();
        }
        return;
    }
    if (controlKey && key === 'c') {
        event.preventDefault();
        env.management.copySelectedBlocks();
        return;
    }
    if (controlKey && key === 'x') {
        event.preventDefault();
        env.management.cutSelectedBlocks();
        return;
    }
    if (controlKey && key === 'v') {
        const pasted = tryPasteBlocksFromClipboard();
        if (pasted) {
            event.preventDefault();
            return;
        }
    }
    if (event.key === 'Backspace') {
        if (state.selectedBlockIds.size > 0) {
            event.preventDefault();
        } else if (!controlKey && !event.altKey && !event.shiftKey) {
            event.preventDefault();
        }
        return;
    }
    if (event.key === 'Delete') {
        if (state.selectedBlockIds.size > 0) {
            event.preventDefault();
            env.management.deleteSelectedBlocks();
        }
    }
    if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        env.management.createTextBlockAt(state.lastPointerBoardPos);
    }
    if (event.key === 'b' && event.ctrlKey) {
        event.preventDefault();
        env.management.promptAndCreateBoard();
    }
    if (!controlKey && !event.shiftKey && key === 's') {
        if (env.paintMode?.createBlank1920x1080AndPaint) {
            event.preventDefault();
            env.paintMode.createBlank1920x1080AndPaint().catch((error) => console.error('Paint spawn failed', error));
        }
    }
    if (!controlKey && !event.shiftKey && key === 'p') {
        if (env.paintMode?.openWorkspace) {
            event.preventDefault();
            env.paintMode.openWorkspace().catch((error) => {
                console.error('Paint workspace open failed', error);
                env.utils?.showToast?.(error?.message || 'Paint workspace failed to open');
            });
        }
    }
}

function handleKeyup(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
        setZoomModifierState(false);
        if (state.zoomGesture.source === 'modifier') {
            resetZoomGestureState('modifier-release');
        }
    }
}

function resetZoomModifierState() {
    setZoomModifierState(false);
    resetZoomGestureState('manual');
}

function handleBlockPointerDown(event, block, element) {
    if (!block || !element) {
        return;
    }
    const editableTarget = event.target && typeof event.target.closest === 'function' ? event.target.closest('[contenteditable="true"], textarea, input') : null;
    if (editableTarget) {
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
        const isActiveTextField = editableTarget === activeElement || (activeElement && editableTarget.contains(activeElement));
        const inlineEditing = editableTarget.dataset?.editing === 'true';
        if (isActiveTextField || inlineEditing) {
            if (!state.selectedBlockIds.has(block.id)) {
                selectBlock(block.id);
            }
            return;
        }
    }
    if (!editableTarget) {
        const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
        if (activeElement && activeElement.isContentEditable && typeof activeElement.blur === 'function') {
            activeElement.blur();
        }
    }
    if (event.button === 1) {
        event.preventDefault();
        cancelPendingDrag();
        clearSelectionPointerState();
        beginPan(event, element);
        return;
    }
    if (event.button === 2 && event.shiftKey) {
        event.preventDefault();
        cancelPendingDrag();
        clearSelectionPointerState();
        env.management.hideContextMenu();
        if (!state.selectedBlockIds.has(block.id)) {
            selectBlock(block.id);
            state.selectionChangedOnPointerDown = true;
        } else {
            state.selectionChangedOnPointerDown = false;
            state.selectedBlockId = block.id;
            applySelectionStyles();
        }
        state.lastPointerDownBlockId = block.id;
        startScalingBlock(block, element, event);
        return;
    }
    clearDocumentSelection();
    cancelPendingDrag();
    const resizeLocked = resizeLockedTypes.has(block.type);
    const handle = resizeLocked ? null : detectResizeHandle(event, element);
    if (handle) {
        state.selectionChangedOnPointerDown = false;
        state.lastPointerDownBlockId = block.id;
        startResizingBlock(block, element, event, handle);
        return;
    }
    const blockWasSelected = state.selectedBlockIds.has(block.id);
    state.selectionChangedOnPointerDown = false;
    state.lastPointerDownBlockId = block.id;
    if (!blockWasSelected) {
        const duplicateIntent = event.ctrlKey || event.metaKey;
        if (event.shiftKey) {
            const updated = new Set(state.selectedBlockIds);
            updated.add(block.id);
            setSelectedBlocks(Array.from(updated), block.id);
            state.selectionChangedOnPointerDown = true;
        } else if (duplicateIntent && state.selectedBlockIds.size === 0) {
            state.selectionChangedOnPointerDown = false;
        } else {
            selectBlock(block.id);
            state.selectionChangedOnPointerDown = true;
        }
    }
    queuePendingDrag(block, element, event);
}

function detectResizeHandle(event, element) {
    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const edge = constants.CORNER_HIT_SIZE;
    const blockType = element?.dataset?.type || '';
    const cornerOnly = cornerResizeOnlyTypes.has(blockType);
    const nearLeft = offsetX <= edge;
    const nearRight = offsetX >= rect.width - edge;
    const nearTop = offsetY <= edge;
    const nearBottom = offsetY >= rect.height - edge;
    if (nearLeft && nearTop) return 'top-left';
    if (nearRight && nearTop) return 'top-right';
    if (nearLeft && nearBottom) return 'bottom-left';
    if (nearRight && nearBottom) return 'bottom-right';
    if (cornerOnly) {
        return null;
    }
    if (nearLeft) return 'left';
    if (nearRight) return 'right';
    if (nearTop) return 'top';
    if (nearBottom) return 'bottom';
    return null;
}

function cursorForHandle(handle) {
    switch (handle) {
        case 'left':
        case 'right':
            return 'ew-resize';
        case 'top':
        case 'bottom':
            return 'ns-resize';
        case 'top-left':
        case 'bottom-right':
            return 'nwse-resize';
        case 'top-right':
        case 'bottom-left':
            return 'nesw-resize';
        default:
            return '';
    }
}

function setBoardCursor(cursor) {
    if (!boardContainer) {
        return;
    }
    boardContainer.style.cursor = cursor || '';
}

function updateHoverCursor(event) {
    if (!boardContainer || !event) {
        return;
    }
    if (state.dragState || state.resizeState || state.scaleState || state.panState) {
        return;
    }
    const target = event.target && typeof event.target.closest === 'function' ? event.target.closest('.board-block') : null;
    if (!target) {
        setBoardCursor('');
        return;
    }
    if (target.classList.contains('is-editing')) {
        setBoardCursor('text');
        return;
    }
    const lockResize = resizeLockedTypes.has(target.dataset.type);
    const handle = lockResize ? null : detectResizeHandle(event, target);
    const cursor = handle ? cursorForHandle(handle) : 'grab';
    setBoardCursor(cursor);
}

function ensureDragPreviewLayer() {
    if (!boardGrid) {
        return null;
    }
    let layer = boardGrid.querySelector('.drag-preview-layer');
    if (!layer) {
        layer = document.createElement('div');
        layer.classList.add('drag-preview-layer');
        boardGrid.appendChild(layer);
    } else {
        layer.innerHTML = '';
    }
    return layer;
}

function ensureDragOverlayLayers() {
    if (!boardGrid) {
        return { shadow: null, active: null };
    }
    let shadowLayer = boardGrid.querySelector('.drag-shadow-layer');
    if (!shadowLayer) {
        shadowLayer = document.createElement('div');
        shadowLayer.classList.add('drag-shadow-layer');
    } else {
        shadowLayer.innerHTML = '';
    }
    let activeLayer = boardGrid.querySelector('.drag-active-layer');
    if (!activeLayer) {
        activeLayer = document.createElement('div');
        activeLayer.classList.add('drag-active-layer');
    } else {
        activeLayer.innerHTML = '';
    }
    boardGrid.appendChild(shadowLayer);
    boardGrid.appendChild(activeLayer);
    return { shadow: shadowLayer, active: activeLayer };
}

function clearDragOverlayLayers() {
    if (!boardGrid) {
        return;
    }
    const activeLayer = boardGrid.querySelector('.drag-active-layer');
    if (activeLayer) {
        activeLayer.remove();
    }
    const shadowLayer = boardGrid.querySelector('.drag-shadow-layer');
    if (shadowLayer) {
        shadowLayer.remove();
    }
}

function clearDragPreview() {
    if (!boardGrid) {
        return;
    }
    const layer = boardGrid.querySelector('.drag-preview-layer');
    if (layer) {
        layer.remove();
    }
}

function initializeDragPreview() {
    if (!state.dragState || state.dragState.previewInitialized) {
        return;
    }
    const layer = ensureDragPreviewLayer();
    state.dragState.previewLayer = layer;
    state.dragState.previewItems = new Map();
    if (!layer) {
        state.dragState.previewInitialized = true;
        return;
    }
    if (layer) {
        state.dragState.selectedIds.forEach((id) => {
            const block = state.dragState.blocks.get(id);
            if (!block) {
                return;
            }
            const preview = document.createElement('div');
            preview.classList.add('drag-preview');
            preview.style.left = `${block.x}px`;
            preview.style.top = `${block.y}px`;
            preview.style.width = `${block.width}px`;
            preview.style.height = `${block.height}px`;
            layer.appendChild(preview);
            state.dragState.previewItems.set(id, preview);
        });
    }
    state.dragState.previewInitialized = true;
}

function startDraggingBlock(block, element, event) {
    const duplicateMode = !!(event.ctrlKey || event.metaKey);
    const selectedIds = state.selectedBlockIds.size ? Array.from(state.selectedBlockIds) : [block.id];
    const initialPositions = new Map();
    const blocks = new Map();
    const pendingPositions = new Map();
    const elements = new Map();
    const startPointer = getBoardCoordinates(event);
    const previewItems = new Map();
    const overlayLayers = ensureDragOverlayLayers();
    const activeLayer = overlayLayers.active;
    const shadowLayer = duplicateMode ? null : overlayLayers.shadow;
    const shadows = new Map();
    const ghostElements = duplicateMode ? new Map() : null;
    const originalParents = new Map();
    selectedIds.forEach((id) => {
        const target = env.management.getBlockById(id);
        if (!target) {
            return;
        }
        initialPositions.set(id, { x: target.x, y: target.y });
        pendingPositions.set(id, { x: target.x, y: target.y });
        blocks.set(id, target);
        const blockElement = document.querySelector(`.board-block[data-id="${id}"]`);
        if (duplicateMode) {
            if (blockElement) {
                blockElement.classList.add('is-ghost-drag');
                ghostElements?.set(id, blockElement);
                const cloneElement = blockElement.cloneNode(true);
                cloneElement.classList.remove('is-selected', 'is-primary-selected', 'is-editing', 'is-ghost-drag');
                cloneElement.classList.add('is-dragging');
                cloneElement.dataset.id = `${id}-duplicate-drag`;
                cloneElement.dataset.cloneSourceId = id;
                cloneElement.style.pointerEvents = 'none';
                cloneElement.style.left = `${target.x}px`;
                cloneElement.style.top = `${target.y}px`;
                cloneElement.style.width = `${target.width}px`;
                cloneElement.style.height = `${target.height}px`;
                elements.set(id, cloneElement);
                if (activeLayer) {
                    activeLayer.appendChild(cloneElement);
                }
            }
        } else if (blockElement) {
            blockElement.classList.add('is-dragging');
            const parentElement = blockElement.parentElement;
            if (parentElement) {
                originalParents.set(id, parentElement);
            }
            if (shadowLayer) {
                const shadowElement = document.createElement('div');
                shadowElement.classList.add('drag-shadow');
                shadowElement.dataset.shadowId = id;
                shadowElement.classList.toggle('drag-shadow-hidden', !!event.altKey);
                shadowElement.style.left = blockElement.style.left;
                shadowElement.style.top = blockElement.style.top;
                shadowElement.style.width = blockElement.style.width;
                shadowElement.style.height = blockElement.style.height;
                try {
                    const computed = window.getComputedStyle(blockElement);
                    if (computed && computed.borderRadius) {
                        shadowElement.style.borderRadius = computed.borderRadius;
                    }
                } catch {}
                shadowLayer.appendChild(shadowElement);
                shadows.set(id, shadowElement);
            }
            if (activeLayer) {
                activeLayer.appendChild(blockElement);
            }
            elements.set(id, blockElement);
        }
    });
    state.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startPointer,
        selectedIds,
        initialPositions,
        pendingPositions,
        elements,
        shadows,
        shadowLayer,
        activeLayer,
        originalParents,
        previewItems,
        previewLayer: null,
        blocks,
        capturedElement: element,
        moved: false,
        previewInitialized: false,
        dropTargetBoardId: null,
        dropTargetSublist: null,
        duplicateMode,
        ghostElements,
        duplicateApplied: false,
        createdDuplicateIds: null
    };
    activateSelectionGuard();
    clearDocumentSelection();
    element.setPointerCapture(event.pointerId);
    setBoardCursor('grabbing');
}

function handleBlockDrag(event) {
    if (!state.dragState || event.pointerId !== state.dragState.pointerId) {
        return;
    }
    const dragState = state.dragState;
    const pointerBoard = getBoardCoordinates(event);
    const deltaX = pointerBoard.x - dragState.startPointer.x;
    const deltaY = pointerBoard.y - dragState.startPointer.y;
    const hasMovement = deltaX !== 0 || deltaY !== 0;
    dragState.showPreview = !!event.altKey;
    if (dragState.previewLayer) {
        dragState.previewLayer.classList.toggle('is-hidden', !dragState.showPreview);
    }
    if (hasMovement && !dragState.previewInitialized) {
        initializeDragPreview();
    }
    if (hasMovement) {
        dragState.moved = true;
    }
    dragState.initialPositions.forEach((initial, id) => {
        const targetX = initial.x + deltaX;
        const targetY = initial.y + deltaY;
        const blockElement = dragState.elements.get(id);
        if (blockElement) {
            blockElement.style.left = `${targetX}px`;
            blockElement.style.top = `${targetY}px`;
        }
        const shadow = dragState.shadows ? dragState.shadows.get(id) : null;
        if (shadow) {
            shadow.style.left = `${targetX}px`;
            shadow.style.top = `${targetY}px`;
            shadow.classList.toggle('drag-shadow-hidden', dragState.showPreview);
        }
        const snappedX = utils.snapToGrid(initial.x + deltaX);
        const snappedY = utils.snapToGrid(initial.y + deltaY);
        dragState.pendingPositions.set(id, { x: snappedX, y: snappedY });
        const preview = dragState.previewItems.get(id);
        if (preview) {
            preview.classList.toggle('is-hidden', !dragState.showPreview);
            preview.style.left = `${snappedX}px`;
            preview.style.top = `${snappedY}px`;
        }
    });

    // Detect drop target board-link under pointer (excluding selected elements)
    const selectedSet = new Set(dragState.selectedIds || []);
    let nextTarget = null;
    let nextSublistTarget = null;
    const pointX = event.clientX;
    const pointY = event.clientY;
    const candidates = Array.from(document.querySelectorAll('.board-block.board-link-block'));
    for (const candidate of candidates) {
        const blockId = candidate.dataset.id;
        if (!blockId || selectedSet.has(blockId)) {
            continue;
        }
        const rect = candidate.getBoundingClientRect();
        if (pointX >= rect.left && pointX <= rect.right && pointY >= rect.top && pointY <= rect.bottom) {
            const block = env.management.getBlockById(blockId);
            if (block && block.targetBoardId) {
                nextTarget = block.targetBoardId;
                break;
            }
        }
    }
    if (!dragState.duplicateMode && env.sublists?.resolveBlockDropTarget) {
        const draggedBlocks = dragState.selectedIds
            .map((id) => dragState.blocks.get(id))
            .filter((block) => !!block);
        nextSublistTarget = env.sublists.resolveBlockDropTarget({
            clientX: pointX,
            clientY: pointY,
            blocks: draggedBlocks
        });
    } else if (env.sublists?.clearDropTargetIndicator) {
        env.sublists.clearDropTargetIndicator();
    }
    if (nextSublistTarget) {
        nextTarget = null;
    } else if (env.sublists?.clearDropTargetIndicator) {
        env.sublists.clearDropTargetIndicator();
    }
    const previousSublistTarget = dragState.dropTargetSublist;
    const sublistTargetChanged = (previousSublistTarget?.listId || '') !== (nextSublistTarget?.listId || '')
        || (Number(previousSublistTarget?.rowIndex) || 0) !== (Number(nextSublistTarget?.rowIndex) || 0);
    if (sublistTargetChanged) {
        dragState.dropTargetSublist = nextSublistTarget;
    }
    if (dragState.dropTargetBoardId !== nextTarget || sublistTargetChanged) {
        dragState.dropTargetBoardId = nextTarget;
        const intent = !!nextTarget || !!nextSublistTarget;
        if (dragState.previewLayer) {
            dragState.previewLayer.classList.toggle('drag-intent', intent);
        }
        if (dragState.activeLayer) {
            dragState.activeLayer.classList.toggle('drag-intent', intent);
        }
        dragState.elements.forEach((element) => {
            if (!element) return;
            element.style.opacity = intent ? '0.55' : '';
        });
    }
}

function finishDraggingBlock(event) {
    const dragState = state.dragState;
    if (!dragState) {
        return;
    }
    releaseSelectionGuard();
    clearDocumentSelection();
    const captured = dragState.capturedElement;
    if (captured) {
        try {
            captured.releasePointerCapture(dragState.pointerId);
        } catch {}
    }
    const board = state.boardData?.boards[state.currentBoardId];
    const duplicateMode = !!dragState.duplicateMode;
    let createdDuplicates = Array.isArray(dragState.createdDuplicateIds) ? dragState.createdDuplicateIds.slice() : [];
    const targetBoardId = dragState.dropTargetBoardId;
    const targetSublist = dragState.dropTargetSublist;
    const movedToSublistIds = new Set();
    let shouldRenderAfter = false;
    let selectionAfter = null;
    let selectionPrimary = null;
    let shouldSyncDomOrder = false;
    let queueSaveKey = null;
    let moveToBoardTarget = null;
    let moveToBoardIds = null;
    if (env.sublists?.clearDropTargetIndicator) {
        env.sublists.clearDropTargetIndicator();
    }

    if (board && dragState.moved) {
        if (duplicateMode) {
            if (!dragState.duplicateApplied) {
                const now = new Date().toISOString();
                const processed = new Set();
                const clones = [];
                dragState.blocks.forEach((block, id) => {
                    const pending = dragState.pendingPositions.get(id);
                    if (!pending || !block || processed.has(id)) {
                        return;
                    }
                    processed.add(id);
                    const clone = JSON.parse(JSON.stringify(block));
                    clone.id = utils.createId(clone.type || 'block');
                    clone.x = pending.x;
                    clone.y = pending.y;
                    clone.createdAt = now;
                    clone.updatedAt = now;
                    data.applyBlockDefaults(clone);
                    clones.push(clone);
                });
                if (clones.length > 0) {
                    clones.forEach((clone) => board.blocks.push(clone));
                    createdDuplicates = clones.map((clone) => clone.id);
                    dragState.createdDuplicateIds = createdDuplicates.slice();
                    board.updatedAt = now;
                }
                dragState.duplicateApplied = true;
            }
            if (!createdDuplicates.length && Array.isArray(dragState.createdDuplicateIds)) {
                createdDuplicates = dragState.createdDuplicateIds.slice();
            }
            if (createdDuplicates.length > 0) {
                if (targetBoardId && state.boardData?.boards?.[targetBoardId]) {
                    const targetBoard = state.boardData.boards[targetBoardId];
                    const cloneSet = new Set(createdDuplicates);
                    const movedClones = [];
                    board.blocks = board.blocks.filter((blk) => {
                        if (cloneSet.has(blk.id)) {
                            movedClones.push(blk);
                            return false;
                        }
                        return true;
                    });
                    if (movedClones.length > 0) {
                        const now = new Date().toISOString();
                        movedClones.forEach((blk) => {
                            blk.updatedAt = now;
                            targetBoard.blocks.push(blk);
                        });
                        targetBoard.updatedAt = now;
                        board.updatedAt = now;
                    }
                    clearSelection();
                    queueSaveKey = 'blocks-duplicate-move';
                } else {
                    queueSaveKey = 'blocks-duplicate-drag';
                    selectionAfter = createdDuplicates;
                    selectionPrimary = createdDuplicates[0] || null;
                    if (selectionAfter && selectionAfter.length > 0) {
                        state.selectedBlockIds = new Set(selectionAfter);
                        state.selectedBlockId = selectionPrimary;
                    }
                }
            } else {
                clearSelection();
            }
            shouldRenderAfter = true;
        } else {
            if (targetSublist && env.sublists?.dropBlocksIntoList) {
                const orderedBlocks = dragState.selectedIds
                    .map((id) => dragState.blocks.get(id))
                    .filter((block) => !!block);
                const dropResult = env.sublists.dropBlocksIntoList(orderedBlocks, targetSublist);
                const movedIds = Array.isArray(dropResult?.movedBlockIds) ? dropResult.movedBlockIds : [];
                if (movedIds.length > 0) {
                    movedIds.forEach((id) => movedToSublistIds.add(id));
                    board.blocks = board.blocks.filter((blk) => !movedToSublistIds.has(blk.id));
                    board.updatedAt = new Date().toISOString();
                    const nextSelection = Array.from(state.selectedBlockIds).filter((id) => !movedToSublistIds.has(id));
                    state.selectedBlockIds = new Set(nextSelection);
                    if (!state.selectedBlockIds.has(state.selectedBlockId)) {
                        state.selectedBlockId = nextSelection[0] || null;
                    }
                    queueSaveKey = 'blocks-to-sublists';
                    shouldRenderAfter = true;
                }
            }
            dragState.blocks.forEach((block, id) => {
                if (movedToSublistIds.has(id)) {
                    return;
                }
                const pending = dragState.pendingPositions.get(id);
                if (!pending) {
                    return;
                }
                block.x = pending.x;
                block.y = pending.y;
                block.updatedAt = new Date().toISOString();
            });
            const movedOrder = new Set(dragState.selectedIds);
            movedToSublistIds.forEach((id) => movedOrder.delete(id));
            if (movedOrder.size > 0) {
                const retained = [];
                const moved = [];
                board.blocks.forEach((block) => {
                    if (movedOrder.has(block.id)) {
                        moved.push(block);
                    } else {
                        retained.push(block);
                    }
                });
                if (moved.length > 0) {
                    board.blocks = [...retained, ...moved];
                }
            }
            if (targetBoardId) {
                const idsToMove = Array.from(state.selectedBlockIds).filter((id) => !movedToSublistIds.has(id));
                if (idsToMove.length > 0) {
                    moveToBoardTarget = targetBoardId;
                    moveToBoardIds = idsToMove;
                }
            } else {
                if (movedOrder.size > 0) {
                    if (!queueSaveKey) {
                        queueSaveKey = 'block-move';
                    }
                    shouldSyncDomOrder = true;
                }
            }
        }
    }

    dragState.elements.forEach((element, id) => {
        if (!element) {
            return;
        }
        element.classList.remove('is-dragging');
        element.classList.remove('is-ghost-drag');
        if (duplicateMode) {
            element.remove();
            return;
        }
        if (movedToSublistIds.has(id)) {
            element.remove();
            return;
        }
        const parentElement = dragState.originalParents ? dragState.originalParents.get(id) : null;
        if (parentElement) {
            parentElement.appendChild(element);
        } else if (boardGrid) {
            boardGrid.appendChild(element);
        }
        const pending = dragState.pendingPositions.get(id);
        const original = dragState.initialPositions.get(id);
        const targetPosition = duplicateMode ? original : pending;
        if (targetPosition) {
            const shouldAnimateDrop = !!dragState.moved && !duplicateMode;
            if (shouldAnimateDrop) {
                element.classList.add('is-dropping');
                void element.offsetWidth;
            }
            element.style.left = `${targetPosition.x}px`;
            element.style.top = `${targetPosition.y}px`;
            if (shouldAnimateDrop) {
                setTimeout(() => {
                    element.classList.remove('is-dropping');
                }, 180);
            }
        }
    });
    if (duplicateMode && dragState.ghostElements) {
        dragState.ghostElements.forEach((ghostElement) => {
            if (ghostElement) {
                ghostElement.classList.remove('is-ghost-drag');
            }
        });
    }
    clearDragOverlayLayers();
    clearDragPreview();

    if (!duplicateMode && dragState.moved && shouldSyncDomOrder && board) {
        syncDomOrderWithBoard(board);
        updateGridBackground();
    }

    setBoardCursor('');
    state.dragState = null;

    if (moveToBoardTarget && moveToBoardIds && moveToBoardIds.length > 0) {
        env.management.moveBlocksToBoard(moveToBoardIds, moveToBoardTarget);
        return;
    }

    if (duplicateMode) {
        if (queueSaveKey) {
            data.queueSave(queueSaveKey);
        }
        if (shouldRenderAfter) {
            env.management.renderBoard();
        }
        return;
    }

    if (shouldRenderAfter) {
        env.management.renderBoard();
    }

    if (queueSaveKey) {
        data.queueSave(queueSaveKey);
    }
}

function syncDomOrderWithBoard(board) {
    if (!boardGrid || !board || !Array.isArray(board.blocks)) {
        return;
    }
    const t0 = perf ? perf.now() : 0;
    const ELEMENT_NODE = typeof Node === 'undefined' ? 1 : Node.ELEMENT_NODE;
    const findNextBoardBlock = (node) => {
        let current = node ? node.nextSibling : null;
        while (current) {
            if (current.nodeType === ELEMENT_NODE && current.classList.contains('board-block')) {
                return current;
            }
            current = current.nextSibling;
        }
        return null;
    };
    const findFirstBoardBlock = () => {
        const first = boardGrid.querySelector('.board-block');
        return first || null;
    };
    const overlayAnchor = Array.from(boardGrid.childNodes).find((node) => {
        return node.nodeType === ELEMENT_NODE && !node.classList.contains('board-block');
    }) || null;

    let previous = null;
    board.blocks.forEach((block) => {
        const element = boardGrid.querySelector(`.board-block[data-id="${block.id}"]`);
        if (!element) {
            return;
        }
        if (!previous) {
            const firstBoardBlock = findFirstBoardBlock();
            if (element !== firstBoardBlock) {
                boardGrid.insertBefore(element, firstBoardBlock ?? overlayAnchor);
            }
        } else if (element.previousElementSibling !== previous) {
            const desiredNext = findNextBoardBlock(previous);
            if (desiredNext !== element) {
                boardGrid.insertBefore(element, desiredNext ?? overlayAnchor);
            }
        }
        previous = element;
    });
    if (perf) {
        perf.logIfSlow('syncDomOrderWithBoard', perf.now() - t0, {
            boardId: board.id,
            blocks: board.blocks.length
        });
    }
}

// MARK: Block Scaling
function determineScaleAnchor(event, element) {
    const rect = element.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 1;
    const height = rect.height > 0 ? rect.height : 1;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const normalizedX = utils.clamp(offsetX / width, 0, 1);
    const normalizedY = utils.clamp(offsetY / height, 0, 1);
    let zoneX = 'center';
    if (normalizedX < SCALE_CENTER_ZONE) {
        zoneX = 'left';
    } else if (normalizedX > 1 - SCALE_CENTER_ZONE) {
        zoneX = 'right';
    }
    let zoneY = 'center';
    if (normalizedY < SCALE_CENTER_ZONE) {
        zoneY = 'top';
    } else if (normalizedY > 1 - SCALE_CENTER_ZONE) {
        zoneY = 'bottom';
    }
    let anchor = { x: 0.5, y: 0.5 };
    let handle = 'center';
    let mode = 'center';
    if (zoneX === 'left' && zoneY === 'top') {
        anchor = { x: 1, y: 1 };
        handle = 'top-left';
        mode = 'corner';
    } else if (zoneX === 'right' && zoneY === 'top') {
        anchor = { x: 0, y: 1 };
        handle = 'top-right';
        mode = 'corner';
    } else if (zoneX === 'left' && zoneY === 'bottom') {
        anchor = { x: 1, y: 0 };
        handle = 'bottom-left';
        mode = 'corner';
    } else if (zoneX === 'right' && zoneY === 'bottom') {
        anchor = { x: 0, y: 0 };
        handle = 'bottom-right';
        mode = 'corner';
    } else if (zoneX === 'left') {
        anchor = { x: 1, y: 0.5 };
        handle = 'left';
        mode = 'edge-x';
    } else if (zoneX === 'right') {
        anchor = { x: 0, y: 0.5 };
        handle = 'right';
        mode = 'edge-x';
    } else if (zoneY === 'top') {
        anchor = { x: 0.5, y: 1 };
        handle = 'top';
        mode = 'edge-y';
    } else if (zoneY === 'bottom') {
        anchor = { x: 0.5, y: 0 };
        handle = 'bottom';
        mode = 'edge-y';
    } else if (zoneX !== 'center' || zoneY !== 'center') {
        anchor = {
            x: normalizedX < 0.5 ? 1 : 0,
            y: normalizedY < 0.5 ? 1 : 0
        };
        handle = 'interior';
        mode = 'interior';
    }
    let cursor = cursorForHandle(handle);
    if (!cursor || handle === 'center' || handle === 'interior') {
        cursor = 'nwse-resize';
    }
    return {
        anchor,
        handle,
        mode,
        cursor
    };
}

function startScalingBlock(block, element, event) {
    if (resizeLockedTypes.has(block.type)) {
        return;
    }
    const anchorInfo = determineScaleAnchor(event, element);
    if (!anchorInfo) {
        return;
    }
    const initialWidth = Number(block.width) || 0;
    const initialHeight = Number(block.height) || 0;
    if (initialWidth <= 0 || initialHeight <= 0) {
        return;
    }
    const pointerBoard = getBoardCoordinates(event);
    const anchorWorld = {
        x: block.x + anchorInfo.anchor.x * initialWidth,
        y: block.y + anchorInfo.anchor.y * initialHeight
    };
    const pointerNormalized = {
        x: utils.clamp((pointerBoard.x - block.x) / initialWidth, 0, 1),
        y: utils.clamp((pointerBoard.y - block.y) / initialHeight, 0, 1)
    };
    const vectorX = pointerBoard.x - anchorWorld.x;
    const vectorY = pointerBoard.y - anchorWorld.y;
    const minimums = getResizeMinimums(block);
    state.scaleState = {
        pointerId: event.pointerId,
        blockId: block.id,
        anchorNormalized: anchorInfo.anchor,
        anchorWorld,
        pointerNormalized,
        initial: {
            x: block.x,
            y: block.y,
            width: initialWidth,
            height: initialHeight
        },
        pending: {
            x: block.x,
            y: block.y,
            width: initialWidth,
            height: initialHeight
        },
        initialVector: { x: vectorX, y: vectorY },
        initialDistance: Math.hypot(vectorX, vectorY),
        initialPointer: pointerBoard,
        blockType: block.type,
        element,
        cursor: anchorInfo.cursor,
        mode: anchorInfo.mode,
        minWidth: minimums.width,
        minHeight: minimums.height,
        aspectRatio: initialHeight > 0 ? initialWidth / initialHeight : null,
        moved: false
    };
    activateSelectionGuard();
    clearDocumentSelection();
    try {
        element.setPointerCapture(event.pointerId);
    } catch {}
    element.classList.add('is-resizing');
    element.style.cursor = anchorInfo.cursor;
    setBoardCursor(anchorInfo.cursor);
}

function handleBlockScale(event) {
    const scaleState = state.scaleState;
    if (!scaleState || event.pointerId !== scaleState.pointerId) {
        return;
    }
    const pointerBoard = getBoardCoordinates(event);
    const anchorX = scaleState.anchorWorld.x;
    const anchorY = scaleState.anchorWorld.y;
    let scaleFactor;
    if (scaleState.mode === 'center') {
        const deltaX = pointerBoard.x - scaleState.initialPointer.x;
        const deltaY = pointerBoard.y - scaleState.initialPointer.y;
        const baselineX = scaleState.initial.width / 2;
        const baselineY = scaleState.initial.height / 2;
        if (Math.abs(deltaX) >= Math.abs(deltaY) && baselineX > 0.0001) {
            scaleFactor = 1 + (deltaX / baselineX);
        } else if (baselineY > 0.0001) {
            scaleFactor = 1 + (deltaY / baselineY);
        } else {
            scaleFactor = 1;
        }
    } else {
        const pointerNorm = scaleState.pointerNormalized;
        const anchorNorm = scaleState.anchorNormalized;
        const width0 = scaleState.initial.width;
        const height0 = scaleState.initial.height;
        const denomX = (pointerNorm.x - anchorNorm.x) * width0;
        const denomY = (pointerNorm.y - anchorNorm.y) * height0;
        const numeratorX = pointerBoard.x - anchorX;
        const numeratorY = pointerBoard.y - anchorY;
        const candidates = [];
        if (Math.abs(denomX) > 0.0001) {
            candidates.push({ axis: 'x', value: numeratorX / denomX, weight: Math.abs(denomX) });
        }
        if (Math.abs(denomY) > 0.0001) {
            candidates.push({ axis: 'y', value: numeratorY / denomY, weight: Math.abs(denomY) });
        }
        if (candidates.length === 0) {
            if (scaleState.initialDistance > 0.0001) {
                const currentDistance = Math.hypot(numeratorX, numeratorY);
                scaleFactor = currentDistance / scaleState.initialDistance;
            } else {
                scaleFactor = 1;
            }
        } else if (candidates.length === 1) {
            scaleFactor = candidates[0].value;
        } else {
            let preferred = candidates[0];
            if (scaleState.mode === 'edge-x') {
                const pick = candidates.find((candidate) => candidate.axis === 'x');
                if (pick) {
                    preferred = pick;
                }
            } else if (scaleState.mode === 'edge-y') {
                const pick = candidates.find((candidate) => candidate.axis === 'y');
                if (pick) {
                    preferred = pick;
                }
            } else {
                candidates.sort((a, b) => b.weight - a.weight);
                preferred = candidates[0];
            }
            scaleFactor = preferred.value;
        }
    }
    if (!Number.isFinite(scaleFactor)) {
        scaleFactor = 1;
    }
    if (scaleFactor < 0) {
        scaleFactor = -scaleFactor;
    }
    const minScaleWidth = scaleState.initial.width > 0 ? scaleState.minWidth / scaleState.initial.width : SCALE_MIN_FACTOR;
    const minScaleHeight = scaleState.initial.height > 0 ? scaleState.minHeight / scaleState.initial.height : SCALE_MIN_FACTOR;
    const minScale = Math.max(minScaleWidth, minScaleHeight, SCALE_MIN_FACTOR);
    scaleFactor = Math.max(scaleFactor, minScale);
    const width = scaleState.initial.width * scaleFactor;
    const height = scaleState.initial.height * scaleFactor;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
    }
    const nextX = scaleState.anchorWorld.x - scaleState.anchorNormalized.x * width;
    const nextY = scaleState.anchorWorld.y - scaleState.anchorNormalized.y * height;
    scaleState.pending = {
        x: nextX,
        y: nextY,
        width,
        height
    };
    if (Math.abs(width - scaleState.initial.width) > 0.5 || Math.abs(height - scaleState.initial.height) > 0.5) {
        scaleState.moved = true;
    }
    const element = scaleState.element || document.querySelector(`.board-block[data-id="${scaleState.blockId}"]`);
    if (element) {
        element.style.left = `${nextX}px`;
        element.style.top = `${nextY}px`;
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.cursor = scaleState.cursor;
    }
    setBoardCursor(scaleState.cursor);
}

function finishScalingBlock(event) {
    if (!state.scaleState) {
        return;
    }
    const scaleState = state.scaleState;
    releaseSelectionGuard();
    clearDocumentSelection();
    const element = scaleState.element || document.querySelector(`.board-block[data-id="${scaleState.blockId}"]`);
    if (element) {
        try {
            element.releasePointerCapture(scaleState.pointerId);
        } catch {}
        element.classList.remove('is-resizing');
        element.style.cursor = '';
    }
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (board && scaleState.moved && scaleState.pending) {
        const block = board.blocks.find((item) => item.id === scaleState.blockId);
        if (block) {
            const ratio = scaleState.aspectRatio || (scaleState.initial.height > 0 ? scaleState.initial.width / scaleState.initial.height : null);
            const snapped = utils.snapRectToGrid(scaleState.pending, {
                preserveRatio: !!ratio,
                aspectRatio: ratio,
                minWidthCells: Math.max(Math.round(scaleState.minWidth / constants.GRID_SIZE), 1),
                minHeightCells: Math.max(Math.round(scaleState.minHeight / constants.GRID_SIZE), 1)
            });
            const nextRect = {
                x: Math.max(snapped.x, 0),
                y: Math.max(snapped.y, 0),
                width: snapped.width,
                height: snapped.height
            };
            block.x = nextRect.x;
            block.y = nextRect.y;
            block.width = nextRect.width;
            block.height = nextRect.height;
            if (aspectLockedTypes.has(block.type)) {
                const updatedRatio = nextRect.height > 0 ? nextRect.width / nextRect.height : null;
                if (updatedRatio) {
                    block.aspectRatio = updatedRatio;
                }
            }
            block.updatedAt = new Date().toISOString();
            if (block.type === 'title') {
                block.layoutMode = 'manual';
                block.manualWidth = nextRect.width;
                block.manualHeight = nextRect.height;
                env.textEditing.refreshTextBlock(block.id);
            } else if (block.type === 'text') {
                block.layoutMode = 'manual';
                block.manualWidth = nextRect.width;
                block.manualHeight = nextRect.height;
                env.textEditing.refreshTextBlock(block.id);
            }
            if (element) {
                element.style.left = `${nextRect.x}px`;
                element.style.top = `${nextRect.y}px`;
                element.style.width = `${nextRect.width}px`;
                element.style.height = `${nextRect.height}px`;
            }
            updateGridBackground();
            data.queueSave('block-scale');
        }
    }
    state.scaleState = null;
    state.suppressNextContextMenu = true;
    setBoardCursor('');
}

function startResizingBlock(block, element, event, handle) {
    if (resizeLockedTypes.has(block.type)) {
        return;
    }
    const minimums = getResizeMinimums(block);
    state.resizeState = {
        pointerId: event.pointerId,
        blockId: block.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        initial: {
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height
        },
        pending: {
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height
        },
        moved: false,
        element,
        blockType: block.type,
        aspectRatio: aspectLockedTypes.has(block.type) ? (Number.isFinite(block.aspectRatio) && block.aspectRatio > 0 ? block.aspectRatio : (block.height ? (block.width / Math.max(block.height, 1)) : null)) : null,
        minWidth: minimums.width,
        minHeight: minimums.height,
        preserveAspect: block.type === 'video' ? true : (block.type === 'image' && !event.altKey),
        aspectUnlocked: !!event.altKey
    };
    activateSelectionGuard();
    clearDocumentSelection();
    element.setPointerCapture(event.pointerId);
    element.classList.add('is-resizing');
    const cursor = cursorForHandle(handle);
    element.style.cursor = cursor;
    setBoardCursor(cursor);
}

function handleBlockResize(event) {
    if (!state.resizeState || event.pointerId !== state.resizeState.pointerId) {
        return;
    }
    const resizeState = state.resizeState;
    const board = state.boardData.boards[state.currentBoardId];
    if (!board) {
        return;
    }
    const block = board.blocks.find((item) => item.id === resizeState.blockId);
    if (!block) {
        return;
    }

    const element = resizeState.element || document.querySelector(`.board-block[data-id="${resizeState.blockId}"]`);
    const cursor = cursorForHandle(resizeState.handle);
    setBoardCursor(cursor);
    const deltaX = (event.clientX - resizeState.startX) / getEffectiveBoardScale();
    const deltaY = (event.clientY - resizeState.startY) / getEffectiveBoardScale();
    const preserveAspect = ((resizeState.blockType === 'video') || (resizeState.blockType === 'image' && !event.altKey)) && resizeState.aspectRatio;
    resizeState.preserveAspect = !!preserveAspect;
    if (resizeState.blockType === 'image' && event.altKey) {
        resizeState.aspectUnlocked = true;
    }
    const next = calculateResizeRect(resizeState.initial, resizeState.handle, deltaX, deltaY, {
        minWidth: resizeState.minWidth,
        minHeight: resizeState.minHeight,
        preserveAspect: resizeState.preserveAspect,
        aspectRatio: resizeState.aspectRatio
    });
    if (resizeState.blockType === 'image' && !resizeState.preserveAspect && resizeState.aspectUnlocked) {
        const ratio = next.height > 0 ? (next.width / next.height) : null;
        if (Number.isFinite(ratio) && ratio > 0) {
            resizeState.aspectRatio = ratio;
        }
    }
    resizeState.pending = next;
    resizeState.moved = true;
    if (element) {
        element.style.left = `${next.x}px`;
        element.style.top = `${next.y}px`;
        element.style.width = `${next.width}px`;
        element.style.height = `${next.height}px`;
        element.style.cursor = cursor;
    }
}

function finishResizingBlock(event) {
    if (!state.resizeState) {
        return;
    }
    releaseSelectionGuard();
    clearDocumentSelection();
    const resizeState = state.resizeState;
    const element = resizeState.element || document.querySelector(`.board-block[data-id="${resizeState.blockId}"]`);
    if (element) {
        try {
            element.releasePointerCapture(resizeState.pointerId);
        } catch {}
        element.classList.remove('is-resizing');
        element.style.cursor = '';
    }
    const board = state.boardData?.boards[state.currentBoardId];
    if (board && resizeState.moved) {
        const block = board.blocks.find((item) => item.id === resizeState.blockId);
        if (block && resizeState.pending) {
            const minWidthCells = Math.max(Math.round(resizeState.minWidth / constants.GRID_SIZE), 1);
            const minHeightCells = Math.max(Math.round(resizeState.minHeight / constants.GRID_SIZE), 1);
            const snapped = utils.snapRectToGrid(resizeState.pending, {
                preserveRatio: resizeState.preserveAspect && aspectLockedTypes.has(resizeState.blockType),
                aspectRatio: resizeState.aspectRatio || null,
                minWidthCells,
                minHeightCells
            });
            block.x = snapped.x;
            block.y = snapped.y;
            block.width = snapped.width;
            block.height = snapped.height;
            if (block.type === 'image') {
                const updatedRatio = snapped.height > 0 ? (snapped.width / snapped.height) : null;
                if (Number.isFinite(updatedRatio) && updatedRatio > 0) {
                    block.aspectRatio = updatedRatio;
                }
            } else if (aspectLockedTypes.has(block.type) && resizeState.aspectRatio) {
                block.aspectRatio = resizeState.aspectRatio;
            }
            block.updatedAt = new Date().toISOString();
            if (block.type === 'title') {
                block.layoutMode = 'manual';
                block.manualWidth = snapped.width;
                block.manualHeight = snapped.height;
            } else if (block.type === 'text') {
                block.layoutMode = 'manual';
                block.manualWidth = snapped.width;
                block.manualHeight = snapped.height;
            }
            if (element) {
                element.style.left = `${snapped.x}px`;
                element.style.top = `${snapped.y}px`;
                element.style.width = `${snapped.width}px`;
                element.style.height = `${snapped.height}px`;
            }
            if (block.type === 'text' || block.type === 'title') {
                env.textEditing.refreshTextBlock(block.id);
            }
            updateGridBackground();
        }
        data.queueSave('block-resize');
    }
    state.resizeState = null;
    setBoardCursor('');
}

function calculateResizeRect(initial, handle, deltaX, deltaY, options = {}) {
    let x = initial.x;
    let y = initial.y;
    let width = initial.width;
    let height = initial.height;
    switch (handle) {
        case 'left':
            x = initial.x + deltaX;
            width = initial.width - deltaX;
            break;
        case 'right':
            width = initial.width + deltaX;
            break;
        case 'top':
            y = initial.y + deltaY;
            height = initial.height - deltaY;
            break;
        case 'bottom':
            height = initial.height + deltaY;
            break;
        case 'top-left':
            x = initial.x + deltaX;
            y = initial.y + deltaY;
            width = initial.width - deltaX;
            height = initial.height - deltaY;
            break;
        case 'top-right':
            y = initial.y + deltaY;
            width = initial.width + deltaX;
            height = initial.height - deltaY;
            break;
        case 'bottom-left':
            x = initial.x + deltaX;
            width = initial.width - deltaX;
            height = initial.height + deltaY;
            break;
        case 'bottom-right':
            width = initial.width + deltaX;
            height = initial.height + deltaY;
            break;
    }
    const minWidth = options.minWidth ?? constants.GRID_SIZE;
    const minHeight = options.minHeight ?? constants.GRID_SIZE;
    width = Math.max(width, 1);
    height = Math.max(height, 1);
    if (options.preserveAspect && options.aspectRatio) {
        const ratio = options.aspectRatio > 0 ? options.aspectRatio : 1;
        const edges = {
            left: initial.x,
            right: initial.x + initial.width,
            top: initial.y,
            bottom: initial.y + initial.height
        };
        const anchorX = handle.includes('left') ? edges.right : handle.includes('right') ? edges.left : initial.x + initial.width / 2;
        const anchorY = handle.includes('top') ? edges.bottom : handle.includes('bottom') ? edges.top : initial.y + initial.height / 2;
        let candidateWidth;
        let candidateHeight;
        if (handle === 'top' || handle === 'bottom') {
            candidateHeight = Math.max(height, minHeight);
            candidateWidth = candidateHeight * ratio;
        } else if (handle === 'left' || handle === 'right') {
            candidateWidth = Math.max(width, minWidth);
            candidateHeight = candidateWidth / ratio;
        } else {
            const widthChange = Math.abs(width - initial.width);
            const heightChange = Math.abs(height - initial.height);
            if (widthChange >= heightChange) {
                candidateWidth = Math.max(width, minWidth);
                candidateHeight = candidateWidth / ratio;
            } else {
                candidateHeight = Math.max(height, minHeight);
                candidateWidth = candidateHeight * ratio;
            }
        }
        const scale = Math.max(minWidth / candidateWidth, minHeight / candidateHeight, 1);
        candidateWidth *= scale;
        candidateHeight *= scale;
        width = candidateWidth;
        height = candidateHeight;
        if (handle.includes('left')) {
            x = anchorX - width;
        } else if (handle.includes('right')) {
            x = anchorX;
        } else {
            x = anchorX - width / 2;
        }
        if (handle.includes('top')) {
            y = anchorY - height;
        } else if (handle.includes('bottom')) {
            y = anchorY;
        } else {
            y = anchorY - height / 2;
        }
    } else {
        if (width < minWidth) {
            if (handle.includes('left')) {
                x = initial.x + initial.width - minWidth;
            }
            width = minWidth;
        }
        if (height < minHeight) {
            if (handle.includes('top')) {
                y = initial.y + initial.height - minHeight;
            }
            height = minHeight;
        }
    }
    return {
        x: Math.max(x, 0),
        y: Math.max(y, 0),
        width,
        height
    };
}

function getResizeMinimums(block) {
    const grid = constants.GRID_SIZE;
    if (!block) {
        return { width: grid * 3, height: grid * 3 };
    }
    if (block.type === 'text') {
        return { width: grid * 8, height: grid * 3 };
    }
    if (block.type === 'title') {
        return { width: grid * 6, height: grid * 4 };
    }
    if (block.type === 'image') {
        return { width: grid * 4, height: grid * 4 };
    }
    if (block.type === 'audio') {
        return { width: grid * 14, height: grid * 5 };
    }
    if (block.type === 'video') {
        return { width: grid * 6, height: grid * 4 };
    }
    if (block.type === 'link') {
        return { width: grid * 10, height: grid * 5 };
    }
    if (block.type === 'youtube') {
        return { width: grid * 20, height: grid * 12 };
    }
    if (block.type === 'board-link') {
        return { width: grid * 3, height: grid * 3 };
    }
    return { width: grid * 4, height: grid * 4 };

}

function handlePointerMove(event) {
    if (applyPanFromPointer(event)) {
        return;
    }
    if (state.pendingDrag) {
        maybeStartPendingDrag(event);
    }
    if (state.dragState && event.pointerId === state.dragState.pointerId) {
        handleBlockDrag(event);
        return;
    }
    if (state.scaleState && event.pointerId === state.scaleState.pointerId) {
        handleBlockScale(event);
        return;
    }
    if (state.resizeState && event.pointerId === state.resizeState.pointerId) {
        handleBlockResize(event);
        return;
    }
    if (state.marqueeState && event.pointerId === state.marqueeState.pointerId) {
        handleSelectionMarqueeMove(event);
        return;
    }
    updateHoverCursor(event);
}

function selectBlock(blockId, options = {}) {
    if (!blockId) {
        clearSelection();
        return;
    }
    if (options.append) {
        const updated = new Set(state.selectedBlockIds);
        updated.add(blockId);
        setSelectedBlocks(Array.from(updated), blockId);
        return;
    }
    setSelectedBlocks([blockId], blockId);
}

function setSelectedBlocks(blockIds, primaryId = null) {
    state.selectedBlockIds = new Set(blockIds);
    state.selectedBlockId = primaryId;
    const activeEditor = typeof document !== 'undefined' ? document.querySelector('.board-block.is-editing') : null;
    if (activeEditor) {
        const activeId = activeEditor.dataset?.id;
        if (activeId && !state.selectedBlockIds.has(activeId) && env.textEditing?.commitActiveTextEdit) {
            env.textEditing.commitActiveTextEdit();
        }
    }
    blurActiveContentEditable({ keepSelectedBlock: true });
    applySelectionStyles();
}

function clearSelection() {
    if (env.textEditing?.commitActiveTextEdit) {
        const activeEditor = typeof document !== 'undefined' ? document.querySelector('.board-block.is-editing') : null;
        if (activeEditor) {
            env.textEditing.commitActiveTextEdit();
        }
    }
    blurActiveContentEditable();
    state.selectedBlockIds.clear();
    state.selectedBlockId = null;
    applySelectionStyles();
}

function applySelectionStyles() {
    document.querySelectorAll('.board-block').forEach((element) => {
        const id = element.dataset.id;
        if (state.selectedBlockIds.has(id)) {
            element.classList.add('is-selected');
            if (state.selectedBlockId === id) {
                element.classList.add('is-primary-selected');
            } else {
                element.classList.remove('is-primary-selected');
            }
        } else {
            element.classList.remove('is-selected');
            element.classList.remove('is-primary-selected');
        }
    });
}

function syncSelectionWithBoard(board) {
    if (!board) {
        clearSelection();
        return;
    }
    const available = new Set(board.blocks.map((block) => block.id));
    const filtered = Array.from(state.selectedBlockIds).filter((id) => available.has(id));
    state.selectedBlockIds = new Set(filtered);
    if (state.selectedBlockId && !available.has(state.selectedBlockId)) {
        state.selectedBlockId = filtered[0] || null;
    }
    applySelectionStyles();
}

function ensureSelectionMarqueeElement() {
    let marquee = state.selectionMarqueeEl;
    if (!marquee) {
        marquee = document.createElement('div');
        marquee.classList.add('selection-marquee', 'hidden');
        if (boardGrid) {
            boardGrid.appendChild(marquee);
        }
        state.selectionMarqueeEl = marquee;
    } else if (boardGrid && marquee.parentElement !== boardGrid) {
        marquee.remove();
        boardGrid.appendChild(marquee);
    }
    return marquee;
}

env.movement.handleContainerPointerDown = handleContainerPointerDown;
env.movement.handleGridPointerDown = handleGridPointerDown;
env.movement.handleContainerPointerMove = handleContainerPointerMove;
env.movement.handlePointerUp = handlePointerUp;
env.movement.handleZoom = handleZoom;
env.movement.applyBoardScale = applyBoardScale;
env.movement.ensureZoomStateIntegrity = ensureZoomStateIntegrity;
env.movement.updateGridBackground = updateGridBackground;
env.movement.restoreViewport = restoreViewport;
env.movement.enforceViewportBounds = enforceViewportBounds;
env.movement.handleContainerScroll = handleContainerScroll;
env.movement.updatePointerPosition = updatePointerPosition;
env.movement.getBoardCoordinates = getBoardCoordinates;
env.movement.getActiveBoardViewport = getActiveBoardViewport;
env.movement.handleKeydown = handleKeydown;
env.movement.handleKeyup = handleKeyup;
env.movement.handleBlockPointerDown = handleBlockPointerDown;
env.movement.handleBlockDrag = handleBlockDrag;
env.movement.startScalingBlock = startScalingBlock;
env.movement.handleBlockScale = handleBlockScale;
env.movement.finishScalingBlock = finishScalingBlock;
env.movement.handleBlockResize = handleBlockResize;
env.movement.handlePointerMove = handlePointerMove;
env.movement.selectBlock = selectBlock;
env.movement.setSelectedBlocks = setSelectedBlocks;
env.movement.clearSelection = clearSelection;
env.movement.resetZoomModifierState = resetZoomModifierState;
env.movement.resetZoomGestureState = resetZoomGestureState;
env.movement.syncSelectionWithBoard = syncSelectionWithBoard;
env.movement.resetPointerStates = resetPointerStates;
env.movement.consumeSelectionPointerState = consumeSelectionPointerState;
env.movement.getStandardViewport = getStandardViewport;
env.movement.getCurrentViewportSnapshot = getCurrentViewportSnapshot;
env.movement.resolveViewportScrollForContainer = resolveViewportScrollForContainer;
env.movement.centerViewport = centerViewport;
env.movement.zoomToFit = zoomToFit;
env.movement.stopActiveZoomAnimation = stopActiveZoomAnimation;
env.movement.ensureSelectionMarqueeElement = ensureSelectionMarqueeElement;
env.movement.handleViewportResize = handleViewportResize;
env.movement.setTransformOriginToDefault = setTransformOriginToDefault;
env.movement.setTransformOriginToPivot = setTransformOriginToPivot;
env.movement.getTransformOriginOffsets = getTransformOriginOffsets;
env.movement.getEffectiveBoardScale = getEffectiveBoardScale;
env.movement.getCanvasPad = getCanvasPad;
env.movement.convertClientToBoard = convertClientToBoard;

module.exports = env;



