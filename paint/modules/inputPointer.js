'use strict';

// MARK: MODULE
module.exports = function createPaintInputPointerModule(deps) {
    const { paintActions, paintQueries, paintUi } = deps;
    const {
        env,
        dom,
        utils,
        paintWorkspaceState,
        paintWorkspaceUi,
        BRUSH_BLEND_MODES,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        STROKE_MODE_FILL,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        EDIT_MODE_TRANSFORM,
        DEFAULT_BRUSH_SIZE,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        TOOL_SPACING_MIN,
        TOOL_SPACING_MAX,
        PAINT_CONTEXTMENU_SUPPRESS_MS,
        IGNORE_HOVER_AFTER_UP_MS,
        IGNORE_MOUSE_AFTER_STYLUS_UP_MS,
        getSession,
        normalizeKey,
        clamp,
        clamp01,
        logPaintTrace
    } = deps;

    const {
        resolveWorkspaceAsset,
        resolveSessionAsset,
        isFileBackedPaintSession,
        isAdjustPanelOpen,
        isTimelineBarVisible,
        isExitMenuOpen,
        isColorPopoverOpen,
        clientToStage,
        stageToImage,
        shouldIgnoreNonActivePointerEvent,
        isStylusLikeEvent,
        resolveToolSpacingFactor,
        resolveCropHit,
        resolvePressureDefaults
    } = paintQueries;

    const {
        hideColorPickIndicator,
        showColorPickIndicator,
        setHelpVisible,
        updateHud,
        renderCursorCanvas,
        renderPaintWorkspaceUi,
        showTimelineQuickPreview,
        setExitMenuVisible,
        showColorPopoverAt,
        hideColorPopover,
        showPaintContextMenuAt,
        hidePaintContextMenu,
        setDebugVisible,
        renderDebugOverlay,
        queuePaintUiFocusRelease,
        renderLassoPreview
    } = paintUi;

    const {
        createPaintProjectFromClipboard,
        renameCurrentPaintProject,
        touchPaintSessionActivity,
        closeAdjustPanel,
        beginAdjustRender,
        toggleActiveLayerVisibility,
        fillAtHoverPoint,
        fillCanvasWithColor,
        mirrorCanvasHorizontal,
        clearSelectionAndQueueUndo,
        persistPaintPreferences,
        fitTransformToCanvas,
        setSessionColor,
        syncColorPickerFromSession,
        renderHueCanvas,
        renderSvCanvas,
        pickLayerAtImagePoint,
        setActiveLayerByIndex,
        pickVisibleColorAtImagePoint,
        cancelCropMode,
        applyCropRect,
        adjustCropByKeyboard,
        toggleCollapsedTimelineDrawer,
        triggerTimelineMotion,
        navigatePaintAnimation,
        insertTimelineFrameFromHotkey,
        togglePaintAnimationPlayback,
        undo,
        redo,
        copySelectionOrCanvasToClipboard,
        pasteClipboardImageAsTransformSelection,
        rebuildSelectionFromComponents,
        invertSelection,
        fitToScreen,
        clearOverlayCanvas,
        beginTransformMode,
        createPaintLayer,
        setActiveTool,
        updateStageCursor,
        setBrushBlendMode,
        captureInputSample,
        updateHoverFromPointerEvent,
        beginZoomDrag,
        endZoomDrag,
        beginPan,
        endPan,
        applySpacingDrag,
        updateToolSizeFromSession,
        syncBorderSizeToBrush,
        renderCropOverlay,
        finalizeSelection,
        beginTransformDrag,
        continueStroke,
        beginStroke,
        endStroke,
        renderStageUi,
        requestCancelPaint,
        saveAndExit,
        zoomAtScreenPoint,
        applySelectionEditsAndClearSelection,
        beginRect,
        continueZoomDrag,
        continuePan,
        updateCropRectFromDrag,
        updateTransformDrag,
        syncHoverToLastStage
    } = paintActions;

    function handlePaintContextMenu(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        const suppressUntil = Number(session.suppressContextMenuUntil) || 0;
        const buttons = Number(event?.buttons) || 0;
        const leftDown = (buttons & 1) !== 0;
        const suppress = session.isDrawing
            || session.pointerDown
            || !!session.sizeDrag?.active
            || !!session.zoomDrag?.active
            || !!session.pan?.active
            || (!!session.crop?.active && !!session.crop?.drag)
            || (session.editMode === EDIT_MODE_SELECT && !!session.select?.lassoing)
            || (session.editMode === EDIT_MODE_TRANSFORM && !!session.transform?.dragging)
            || (now < suppressUntil)
            || leftDown;
        if (suppress) {
            hidePaintContextMenu();
            if (isColorPopoverOpen()) {
                hideColorPopover();
            }
            return;
        }
        if (isColorPopoverOpen()) {
            hideColorPopover();
        }
        showPaintContextMenuAt(event.clientX, event.clientY);
    }

    function handlePaintWheel(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const stagePoint = clientToStage(event);
        const deltaY = Number(event.deltaY) || 0;
        const direction = deltaY > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.08 : 1 / 1.08;
        zoomAtScreenPoint(factor, stagePoint.x, stagePoint.y);
    }

    function buildRectSelectionPoints(x0, y0, x1, y1) {
        const left = clamp(Math.min(x0, x1), 0, session.width);
        const right = clamp(Math.max(x0, x1), 0, session.width);
        const top = clamp(Math.min(y0, y1), 0, session.height);
        const bottom = clamp(Math.max(y0, y1), 0, session.height);
        return [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom }
        ];
    }

    function resolveSelectionOperation(event) {
        const modifierHeld = !!(event.ctrlKey || event.metaKey);
        if (event.shiftKey && modifierHeld) {
            return 'sub';
        }
        if (event.shiftKey) {
            return 'add';
        }
        return 'replace';
    }

    function nowMs() {
        return (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }

    function beginSelectionTrace(session, event, mode, op) {
        if (!session?.select) {
            return;
        }
        session.select.trace = {
            startedAt: nowMs(),
            mode,
            op,
            pointerType: typeof event?.pointerType === 'string' ? event.pointerType : '',
            inputType: String(event?.type || ''),
            sampledPoints: Array.isArray(session.select.points) ? session.select.points.length : 0,
            storedPoints: Array.isArray(session.select.points) ? session.select.points.length : 0,
            replacedPoints: 0,
            compactedPoints: 0,
            previewFrames: 0,
            maxPreviewMs: 0,
            totalPreviewMs: 0,
            lastSlowLoggedAt: 0,
            moveEvents: 0,
            rawMoveEvents: 0
        };
        logPaintTrace('paint.selection.begin', {
            mode,
            op,
            pointerType: session.select.trace.pointerType,
            eventType: session.select.trace.inputType,
            existingSelection: !!session.selection,
            existingComponents: Array.isArray(session.selection?.components) ? session.selection.components.length : 0
        });
    }

    function noteSelectionTrace(session, event, payload = {}) {
        const trace = session?.select?.trace;
        if (!trace) {
            return;
        }
        trace.sampledPoints += Number(payload.sampledPoints) || 0;
        trace.storedPoints = Number(payload.storedPoints) || trace.storedPoints;
        trace.replacedPoints += Number(payload.replacedPoints) || 0;
        trace.compactedPoints += Number(payload.compactedPoints) || 0;
        if (event?.type === 'pointerrawupdate') {
            trace.rawMoveEvents += 1;
        } else {
            trace.moveEvents += 1;
        }
    }

    function finishSelectionTrace(session, scope, extra = {}) {
        const trace = session?.select?.trace;
        if (!trace) {
            return;
        }
        logPaintTrace(scope, {
            mode: trace.mode,
            op: trace.op,
            elapsedMs: Number((nowMs() - trace.startedAt).toFixed(2)),
            sampledPoints: trace.sampledPoints,
            storedPoints: trace.storedPoints,
            replacedPoints: trace.replacedPoints,
            compactedPoints: trace.compactedPoints,
            previewFrames: trace.previewFrames,
            previewMaxMs: Number((Number(trace.maxPreviewMs) || 0).toFixed(2)),
            moveEvents: trace.moveEvents,
            rawMoveEvents: trace.rawMoveEvents,
            ...extra
        });
        session.select.trace = null;
    }

    function compactLassoPoints(points) {
        if (!Array.isArray(points) || points.length < 3200) {
            return 0;
        }
        const compacted = [points[0]];
        for (let index = 1; index < points.length - 1; index += 2) {
            compacted.push(points[index]);
        }
        compacted.push(points[points.length - 1]);
        const removed = points.length - compacted.length;
        points.splice(0, points.length, ...compacted);
        return removed;
    }

    function appendLassoPoint(points, px, py) {
        if (!Array.isArray(points)) {
            return { accepted: 0, replaced: 0, compacted: 0 };
        }
        const nextPoint = { x: px, y: py };
        if (!points.length) {
            points.push(nextPoint);
            return { accepted: 1, replaced: 0, compacted: 0 };
        }
        const last = points[points.length - 1];
        const distance = Math.hypot(px - last.x, py - last.y);
        if (distance < 0.85) {
            return { accepted: 0, replaced: 0, compacted: 0 };
        }
        if (points.length >= 2) {
            const prev = points[points.length - 2];
            const ax = last.x - prev.x;
            const ay = last.y - prev.y;
            const bx = px - last.x;
            const by = py - last.y;
            const aLen = Math.hypot(ax, ay);
            const bLen = Math.hypot(bx, by);
            if (aLen > 0.0001 && bLen > 0.0001) {
                const cross = Math.abs((ax * by) - (ay * bx));
                const dot = (ax * bx) + (ay * by);
                const nearlyStraight = dot > 0 && cross <= (aLen * bLen * 0.055);
                if (nearlyStraight) {
                    points[points.length - 1] = nextPoint;
                    return { accepted: 0, replaced: 1, compacted: 0 };
                }
            }
        }
        points.push(nextPoint);
        return {
            accepted: 1,
            replaced: 0,
            compacted: compactLassoPoints(points)
        };
    }

    function processLassoSelectionSamples(session, event) {
        const coalesced = event.type === 'pointerrawupdate'
            ? null
            : (typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null);
        const sampleEvents = (Array.isArray(coalesced) && coalesced.length > 0) ? coalesced : [event];
        let acceptedPoints = 0;
        let replacedPoints = 0;
        let compactedPoints = 0;
        for (const sampleEvent of sampleEvents) {
            const stagePoint = clientToStage(sampleEvent);
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            const px = clamp(imgPoint.x, 0, session.width);
            const py = clamp(imgPoint.y, 0, session.height);
            const result = appendLassoPoint(session.select.points, px, py);
            acceptedPoints += result.accepted;
            replacedPoints += result.replaced;
            compactedPoints += result.compacted;
        }
        noteSelectionTrace(session, event, {
            sampledPoints: sampleEvents.length,
            storedPoints: session.select.points.length,
            replacedPoints,
            compactedPoints
        });
        if (acceptedPoints > 0 || replacedPoints > 0) {
            session.select.dragMoved = true;
            renderLassoPreview(session.select.points);
        }
    }

    function isTinyLassoGesture(session) {
        if (!session?.select || String(session.select.mode || 'lasso').trim() !== 'lasso') {
            return false;
        }
        const points = Array.isArray(session.select.points) ? session.select.points : [];
        if (!points.length) {
            return true;
        }
        const anchorX = Number(session.select.anchorX) || 0;
        const anchorY = Number(session.select.anchorY) || 0;
        let maxDistance = 0;
        for (const point of points) {
            if (!point) {
                continue;
            }
            maxDistance = Math.max(maxDistance, Math.hypot((Number(point.x) || 0) - anchorX, (Number(point.y) || 0) - anchorY));
        }
        const startedAt = Number(session.select.startedAt) || 0;
        const elapsedMs = startedAt > 0 ? (nowMs() - startedAt) : 0;
        return maxDistance <= 4 && elapsedMs <= 300;
    }

    function ensureSelectionToolMode(session, reason = '') {
        if (!session?.select?.toolLocked) {
            return false;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
            return false;
        }
        if (session.editMode !== EDIT_MODE_SELECT) {
            session.editMode = EDIT_MODE_SELECT;
            logPaintTrace('paint.selection.tool.reassert', {
                reason: String(reason || ''),
                mode: String(session.select.mode || 'lasso'),
                tool: String(session.tool || '')
            });
            updateHud();
        }
        return true;
    }

    function handlePaintPointerDown(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        if (isColorPopoverOpen()) {
            const popover = dom.paintColorPopover;
            if (!popover || !popover.contains(event.target)) {
                hideColorPopover();
                return;
            }
        }

        const stagePoint = clientToStage(event);
        const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
        const x = imgPoint.x;
        const y = imgPoint.y;
        updateHoverFromPointerEvent(event);
        hidePaintContextMenu();
        ensureSelectionToolMode(session, 'ui-pointerdown');

        if (event.button === 0 && session.selectionCancelRect) {
            const rect = session.selectionCancelRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                clearSelectionAndQueueUndo();
                renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
                return;
            }
        }
        if (event.button === 0 && session.selectionApplyRect) {
            const rect = session.selectionApplyRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                applySelectionEditsAndClearSelection();
                renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
                return;
            }
        }
        if (event.button === 0 && session.selectionFitRect) {
            const rect = session.selectionFitRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                fitTransformToCanvas();
                renderStageUi();
                return;
            }
        }
        if (event.button === 0 && session.symmetryXHandleRect) {
            const rect = session.symmetryXHandleRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.width && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.height) {
                session.symmetryDrag = { axis: 'x' };
                return;
            }
        }
        if (event.button === 0 && session.symmetryYHandleRect) {
            const rect = session.symmetryYHandleRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.width && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.height) {
                session.symmetryDrag = { axis: 'y' };
                return;
            }
        }

        if (session.ctrlSpaceHeld) {
            if (event.button !== 0) {
                return;
            }
            const stylusLike = isStylusLikeEvent(event);
            if (event.pointerType !== 'pen' && !stylusLike) {
                dom.paintUiCanvas.setPointerCapture(event.pointerId);
            }
            captureInputSample(event, 'zoom-down', { acceptZero: true, forcePen: true });
            session.pointerDown = true;
            session.pointerId = event.pointerId;
            session.activePointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
            session.activeWasStylusLike = stylusLike || session.activePointerType === 'pen';
            session.lastStageX = stagePoint.x;
            session.lastStageY = stagePoint.y;
            beginZoomDrag(stagePoint.x, stagePoint.y);
            return;
        }

        if (event.ctrlKey && !session.ctrlSpaceHeld && !session.spaceKeyHeld && !session.spaceDown && event.button === 0 && session.editMode === EDIT_MODE_PAINT && !session.crop.active && !isColorPopoverOpen()) {
            if (event.altKey) {
                const pickedLayer = pickLayerAtImagePoint(x, y);
                if (pickedLayer) {
                    event.preventDefault();
                    event.stopPropagation();
                    setActiveLayerByIndex(pickedLayer.index);
                    utils.showToast?.(`Paint: ${pickedLayer.layer.name || 'Layer'} selected`);
                }
                session.colorPickDrag = false;
                return;
            }
            const picked = pickVisibleColorAtImagePoint(x, y);
            if (picked) {
                event.preventDefault();
                event.stopPropagation();
                setSessionColor(picked);
                syncColorPickerFromSession();
                renderHueCanvas();
                renderSvCanvas();
                showColorPickIndicator(picked, event.clientX, event.clientY);
            }
            session.colorPickDrag = true;
            return;
        }

        if (event.button === 2) {
            return;
        }

        const stylusLike = isStylusLikeEvent(event);
        if (session.spaceKeyHeld || session.ctrlSpaceHeld) {
            session.spaceTapCandidate = false;
        }
        if (event.pointerType !== 'pen' && !stylusLike) {
            dom.paintUiCanvas.setPointerCapture(event.pointerId);
        }
        captureInputSample(event, 'down', { acceptZero: true, forcePen: true });
        session.pointerDown = true;
        session.pointerId = event.pointerId;
        session.activePointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
        session.activeWasStylusLike = stylusLike || session.activePointerType === 'pen';
        session.lastStageX = stagePoint.x;
        session.lastStageY = stagePoint.y;
        session.lastClientX = Number.isFinite(event?.clientX) ? Math.round(event.clientX) : session.lastClientX;
        session.lastClientY = Number.isFinite(event?.clientY) ? Math.round(event.clientY) : session.lastClientY;

        if (isColorPopoverOpen()) {
            hideColorPopover();
        }

        if (event.shiftKey && event.button === 0 && session.editMode === EDIT_MODE_PAINT && (session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_RECT || session.tool === TOOL_STAMP) && !session.crop.active) {
            session.sizeDrag.active = true;
            session.sizeDrag.mode = session.sDown ? 'spacing' : 'size';
            session.sizeDrag.startX = stagePoint.x;
            session.sizeDrag.startY = stagePoint.y;
            session.sizeDrag.startSize = session.size;
            session.sizeDrag.startSpacing = resolveToolSpacingFactor(session.tool);
            logPaintTrace('paint.sizeDrag.begin', {
                mode: session.sizeDrag.mode,
                tool: session.tool,
                startSize: session.sizeDrag.startSize,
                startSpacing: session.sizeDrag.startSpacing
            });
            updateStageCursor();
            renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
            return;
        }

        if (session.spaceDown || event.button === 1) {
            beginPan(stagePoint.x, stagePoint.y);
            return;
        }

        if (session.crop.active) {
            const handle = resolveCropHit(x, y);
            if (!handle) {
                session.crop.drag = null;
                return;
            }
            session.crop.drag = {
                handle,
                startX: x,
                startY: y,
                startRect: { ...session.crop.rect }
            };
            return;
        }

        if (session.editMode === EDIT_MODE_SELECT) {
            if (event.button !== 0) {
                return;
            }
            const mode = String(session.select.mode || 'lasso').trim() || 'lasso';
            const px = clamp(x, 0, session.width);
            const py = clamp(y, 0, session.height);
            if (mode === 'lasso' && session.select.awaitingContinuation && Array.isArray(session.select.points) && session.select.points.length > 0) {
                const last = session.select.points[session.select.points.length - 1];
                session.select.lassoing = true;
                session.select.dragMoved = false;
                if (!last || Math.hypot(px - last.x, py - last.y) >= 0.5) {
                    const result = appendLassoPoint(session.select.points, px, py);
                    noteSelectionTrace(session, event, {
                        sampledPoints: 1,
                        storedPoints: session.select.points.length,
                        replacedPoints: result.replaced,
                        compactedPoints: result.compacted
                    });
                }
                renderLassoPreview(session.select.points);
                return;
            }
            session.select.op = resolveSelectionOperation(event);
            session.select.lassoing = true;
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            session.select.anchorX = px;
            session.select.anchorY = py;
            session.select.startedAt = nowMs();
            if (mode === 'rect') {
                session.select.points = buildRectSelectionPoints(session.select.anchorX, session.select.anchorY, session.select.anchorX, session.select.anchorY);
            } else {
                session.select.points = [{ x: session.select.anchorX, y: session.select.anchorY }];
            }
            beginSelectionTrace(session, event, mode, session.select.op);
            renderLassoPreview(session.select.points);
            return;
        }

        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.selection?.path) {
            if (event.button !== 0) {
                return;
            }
            const ix = Number.isFinite(x) ? x : 0;
            const iy = Number.isFinite(y) ? y : 0;
            if (beginTransformDrag(ix, iy, stagePoint.x, stagePoint.y)) {
                renderStageUi();
            }
            return;
        }

        if (event.button !== 0) {
            return;
        }
        beginStroke(event);
        if (session.tool === TOOL_RECT) {
            beginRect(clamp(x, 0, session.width), clamp(y, 0, session.height));
            return;
        }
        continueStroke(event);
    }

    function handlePaintPointerMove(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        if (shouldIgnoreNonActivePointerEvent(event)) {
            return;
        }
        const selectionPreviewActive = session.editMode === EDIT_MODE_SELECT && session.select?.lassoing;
        if (event.type === 'pointerrawupdate' && selectionPreviewActive) {
            return;
        }
        if (event.type === 'pointerrawupdate' && !session.isDrawing && !session.pointerDown && !session.sizeDrag?.active && !session.zoomDrag?.active && !session.pan?.active && !(session.crop?.active && session.crop.drag) && !(session.editMode === EDIT_MODE_SELECT && session.select?.lassoing) && !(session.editMode === EDIT_MODE_TRANSFORM && session.transform?.dragging)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        captureInputSample(event, 'move', { raw: event.type === 'pointerrawupdate', coalescedCount: typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents().length : 0, acceptZero: true, forcePen: true });
        updateHoverFromPointerEvent(event);

        const stagePoint = clientToStage(event);
        const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
        const x = imgPoint.x;
        const y = imgPoint.y;

        if (session.colorPickDrag && event.ctrlKey && !event.altKey && !session.ctrlSpaceHeld && !session.spaceKeyHeld && !session.spaceDown && event.buttons) {
            const picked = pickVisibleColorAtImagePoint(x, y);
            if (picked) {
                setSessionColor(picked);
                syncColorPickerFromSession();
                renderHueCanvas();
                renderSvCanvas();
                showColorPickIndicator(picked, event.clientX, event.clientY);
            }
            return;
        }

        if (session.sizeDrag?.active) {
            const dy = stagePoint.y - session.sizeDrag.startY;
            if (session.sizeDrag.mode === 'spacing') {
                const baseSpacing = Number.isFinite(session.sizeDrag.startSpacing) ? session.sizeDrag.startSpacing : resolveToolSpacingFactor(session.tool);
                session.toolSpacing[session.tool] = applySpacingDrag(baseSpacing, dy);
            } else {
                const dx = stagePoint.x - session.sizeDrag.startX;
                const next = clamp(session.sizeDrag.startSize + (dx * 0.25), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
                session.size = Math.round(next);
            }
            updateToolSizeFromSession();
            syncBorderSizeToBrush();
            updateHud();
            renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
            return;
        }

        if (session.zoomDrag.active) {
            continueZoomDrag(stagePoint.x, stagePoint.y);
            return;
        }

        if (session.pan.active) {
            continuePan(stagePoint.x, stagePoint.y);
            return;
        }

        if (session.crop.active && session.crop.drag) {
            const drag = session.crop.drag;
            session.crop.rect = updateCropRectFromDrag(drag.handle, drag.startRect, drag.startX, drag.startY, x, y);
            renderCropOverlay();
            return;
        }

        if (session.editMode === EDIT_MODE_SELECT && session.select.lassoing) {
            if (String(session.select.mode || 'lasso').trim() === 'rect') {
                const px = clamp(x, 0, session.width);
                const py = clamp(y, 0, session.height);
                session.select.points = buildRectSelectionPoints(session.select.anchorX, session.select.anchorY, px, py);
                session.select.dragMoved = Math.abs(px - session.select.anchorX) >= 0.5 || Math.abs(py - session.select.anchorY) >= 0.5;
                noteSelectionTrace(session, event, {
                    sampledPoints: 1,
                    storedPoints: session.select.points.length
                });
                renderLassoPreview(session.select.points);
            } else {
                processLassoSelectionSamples(session, event);
            }
            return;
        }

        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.transform.dragging) {
            const ix = Number.isFinite(x) ? x : 0;
            const iy = Number.isFinite(y) ? y : 0;
            updateTransformDrag(ix, iy);
            renderStageUi();
            return;
        }

        if (!session.isDrawing) {
            return;
        }

        const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
        if (coalesced && coalesced.length > 0) {
            for (const subEvent of coalesced) {
                captureInputSample(subEvent, 'coalesced', { acceptZero: true, forcePen: true });
                continueStroke(subEvent);
            }
            return;
        }
        continueStroke(event);
    }

    function handlePaintPointerUp(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        const needsHandling = !!(session.pointerDown
            || session.isDrawing
            || session.colorPickDrag
            || session.sizeDrag?.active
            || session.zoomDrag?.active
            || session.pan?.active
            || (session.crop?.active && session.crop?.drag)
            || (session.editMode === EDIT_MODE_SELECT && session.select?.lassoing)
            || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.dragging));
        if (!needsHandling) {
            return;
        }
        const eventPointerId = Number(event?.pointerId);
        if (Number.isFinite(eventPointerId) && Number.isFinite(session.pointerId) && eventPointerId !== session.pointerId) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        captureInputSample(event, 'up', { acceptZero: true, forcePen: true });
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        session.suppressContextMenuUntil = now + PAINT_CONTEXTMENU_SUPPRESS_MS;
        session.ignoreHoverUntil = now + IGNORE_HOVER_AFTER_UP_MS;
        const upPointerType = (typeof session.activePointerType === 'string' && session.activePointerType)
            ? session.activePointerType
            : (typeof event?.pointerType === 'string' ? event.pointerType : '');
        session.ignoreHoverPointerType = upPointerType;
        session.ignoreHoverWasStylusLike = !!(session.activeWasStylusLike || upPointerType === 'pen');
        if (session.ignoreHoverWasStylusLike) {
            session.ignoreMouseUntil = now + IGNORE_MOUSE_AFTER_STYLUS_UP_MS;
        }
        syncHoverToLastStage(0);
        session.pointerDown = false;
        session.pointerId = null;
        session.activePointerType = '';
        session.activeWasStylusLike = false;
        session.colorPickDrag = false;
        hideColorPickIndicator();

        if (session.sizeDrag?.active) {
            session.sizeDrag.active = false;
            logPaintTrace('paint.sizeDrag.end', {
                mode: String(session.sizeDrag.mode || 'size'),
                size: session.size,
                spacing: resolveToolSpacingFactor(session.tool)
            });
            session.sizeDrag.mode = 'size';
            updateStageCursor();
            persistPaintPreferences();
            renderCursorCanvas();
            return;
        }

        if (session.zoomDrag.active) {
            endZoomDrag();
            return;
        }
        if (session.pan.active) {
            endPan();
            return;
        }
        if (session.crop.active && session.crop.drag) {
            session.crop.drag = null;
            renderStageUi();
            return;
        }
        if (session.editMode === EDIT_MODE_SELECT && session.select.lassoing) {
            const mode = String(session.select.mode || 'lasso').trim() || 'lasso';
            session.select.lassoing = false;
            if (mode === 'lasso' && session.selection && isTinyLassoGesture(session)) {
                finishSelectionTrace(session, 'paint.selection.clearGesture', {
                    cleared: true
                });
                session.select.awaitingContinuation = false;
                session.select.dragMoved = false;
                session.select.points = [];
                clearSelectionAndQueueUndo();
                updateStageCursor();
                renderCursorCanvas();
                return;
            }
            if (mode === 'lasso' && (event.ctrlKey || event.metaKey)) {
                session.select.awaitingContinuation = true;
                session.select.dragMoved = false;
                finishSelectionTrace(session, 'paint.selection.continuation', {
                    awaitingContinuation: true,
                    points: Array.isArray(session.select.points) ? session.select.points.length : 0
                });
                beginSelectionTrace(session, event, mode, session.select.op);
                session.select.trace.sampledPoints = Array.isArray(session.select.points) ? session.select.points.length : 0;
                session.select.trace.storedPoints = Array.isArray(session.select.points) ? session.select.points.length : 0;
                renderLassoPreview(session.select.points);
                updateStageCursor();
                renderCursorCanvas();
                return;
            }
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            finalizeSelection(session.select.points, session.select.op);
            session.select.points = [];
            updateStageCursor();
            renderCursorCanvas();
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.transform.dragging) {
            session.transform.dragging = false;
            return;
        }
        if (session.isDrawing) {
            const stagePoint = clientToStage(event);
            const dx = Number.isFinite(stagePoint.x) ? Math.abs(stagePoint.x - session.lastStageX) : 0;
            const dy = Number.isFinite(stagePoint.y) ? Math.abs(stagePoint.y - session.lastStageY) : 0;
            const suspiciousJump = (dx + dy) > 60;
            if (!suspiciousJump) {
                continueStroke(event);
            }
        }
        endStroke();
    }

    function handleStagePointerDown(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        if (dom.paintColorPopover && dom.paintColorPopover.contains(event.target)) {
            return;
        }
        if (isColorPopoverOpen()) {
            hideColorPopover();
            return;
        }
        if (event.target === dom.paintUiCanvas) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        session.lastClientX = Number.isFinite(event?.clientX) ? Math.round(event.clientX) : session.lastClientX;
        session.lastClientY = Number.isFinite(event?.clientY) ? Math.round(event.clientY) : session.lastClientY;

        const stagePoint = clientToStage(event);
        if (session.spaceKeyHeld || session.ctrlSpaceHeld) {
            session.spaceTapCandidate = false;
        }
        captureInputSample(event, 'stage-down', { acceptZero: true, forcePen: true });
        updateHoverFromPointerEvent(event);
        ensureSelectionToolMode(session, 'stage-pointerdown');

        if (event.button === 0 && session.selectionCancelRect) {
            const rect = session.selectionCancelRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                clearSelectionAndQueueUndo();
                renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
                return;
            }
        }
        if (event.button === 0 && session.selectionApplyRect) {
            const rect = session.selectionApplyRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                applySelectionEditsAndClearSelection();
                renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
                return;
            }
        }
        if (event.button === 0 && session.selectionFitRect) {
            const rect = session.selectionFitRect;
            if (stagePoint.x >= rect.x && stagePoint.x <= rect.x + rect.size && stagePoint.y >= rect.y && stagePoint.y <= rect.y + rect.size) {
                fitTransformToCanvas();
                renderStageUi();
                return;
            }
        }

        if (session.ctrlSpaceHeld) {
            if (event.button !== 0) {
                return;
            }
            const stylusLike = isStylusLikeEvent(event);
            if (event.pointerType !== 'pen' && !stylusLike) {
                dom.paintStage.setPointerCapture(event.pointerId);
            }
            captureInputSample(event, 'stage-zoom-down', { acceptZero: true, forcePen: true });
            session.pointerDown = true;
            session.pointerId = event.pointerId;
            session.activePointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
            session.activeWasStylusLike = stylusLike || session.activePointerType === 'pen';
            session.lastStageX = stagePoint.x;
            session.lastStageY = stagePoint.y;
            beginZoomDrag(stagePoint.x, stagePoint.y);
            return;
        }

        if (event.ctrlKey && !session.ctrlSpaceHeld && !session.spaceKeyHeld && !session.spaceDown && event.button === 0 && session.editMode === EDIT_MODE_PAINT && !session.crop.active && !isColorPopoverOpen()) {
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            if (event.altKey) {
                const pickedLayer = pickLayerAtImagePoint(imgPoint.x, imgPoint.y);
                if (pickedLayer) {
                    setActiveLayerByIndex(pickedLayer.index);
                    utils.showToast?.(`Paint: ${pickedLayer.layer.name || 'Layer'} selected`);
                }
                session.colorPickDrag = false;
                return;
            }
            const picked = pickVisibleColorAtImagePoint(imgPoint.x, imgPoint.y);
            if (picked) {
                setSessionColor(picked);
                syncColorPickerFromSession();
                renderHueCanvas();
                renderSvCanvas();
                showColorPickIndicator(picked, event.clientX, event.clientY);
            }
            session.colorPickDrag = true;
            return;
        }

        const stylusLike = isStylusLikeEvent(event);
        if (event.pointerType !== 'pen' && !stylusLike) {
            dom.paintStage.setPointerCapture(event.pointerId);
        }
        session.pointerDown = true;
        session.pointerId = event.pointerId;
        session.activePointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
        session.activeWasStylusLike = stylusLike || session.activePointerType === 'pen';
        session.lastStageX = stagePoint.x;
        session.lastStageY = stagePoint.y;
        if (session.spaceDown || event.button === 1) {
            beginPan(stagePoint.x, stagePoint.y);
            return;
        }

        if (event.button !== 0) {
            return;
        }
        if (event.shiftKey && session.editMode === EDIT_MODE_PAINT && (session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_RECT || session.tool === TOOL_STAMP) && !session.crop.active) {
            session.sizeDrag.active = true;
            session.sizeDrag.mode = session.sDown ? 'spacing' : 'size';
            session.sizeDrag.startX = stagePoint.x;
            session.sizeDrag.startY = stagePoint.y;
            session.sizeDrag.startSize = session.size;
            session.sizeDrag.startSpacing = resolveToolSpacingFactor(session.tool);
            logPaintTrace('paint.sizeDrag.begin', {
                mode: session.sizeDrag.mode,
                tool: session.tool,
                startSize: session.sizeDrag.startSize,
                startSpacing: session.sizeDrag.startSpacing
            });
            updateStageCursor();
            renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
            return;
        }
        if (session.crop.active) {
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            const handle = resolveCropHit(imgPoint.x, imgPoint.y);
            if (!handle) {
                session.crop.drag = null;
                return;
            }
            session.crop.drag = {
                handle,
                startX: imgPoint.x,
                startY: imgPoint.y,
                startRect: { ...session.crop.rect }
            };
            renderStageUi();
            return;
        }
        if (session.editMode === EDIT_MODE_SELECT) {
            if (event.button !== 0) {
                return;
            }
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            const mode = String(session.select.mode || 'lasso').trim() || 'lasso';
            const px = clamp(imgPoint.x, 0, session.width);
            const py = clamp(imgPoint.y, 0, session.height);
            if (mode === 'lasso' && session.select.awaitingContinuation && Array.isArray(session.select.points) && session.select.points.length > 0) {
                const last = session.select.points[session.select.points.length - 1];
                session.select.lassoing = true;
                session.select.dragMoved = false;
                if (!last || Math.hypot(px - last.x, py - last.y) >= 0.5) {
                    const result = appendLassoPoint(session.select.points, px, py);
                    noteSelectionTrace(session, event, {
                        sampledPoints: 1,
                        storedPoints: session.select.points.length,
                        replacedPoints: result.replaced,
                        compactedPoints: result.compacted
                    });
                }
                renderLassoPreview(session.select.points);
                return;
            }
            session.select.op = resolveSelectionOperation(event);
            session.select.lassoing = true;
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            session.select.anchorX = px;
            session.select.anchorY = py;
            session.select.startedAt = nowMs();
            if (mode === 'rect') {
                session.select.points = buildRectSelectionPoints(session.select.anchorX, session.select.anchorY, session.select.anchorX, session.select.anchorY);
            } else {
                session.select.points = [{ x: session.select.anchorX, y: session.select.anchorY }];
            }
            beginSelectionTrace(session, event, mode, session.select.op);
            renderLassoPreview(session.select.points);
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.selection?.path) {
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            beginTransformDrag(imgPoint.x, imgPoint.y, stagePoint.x, stagePoint.y);
            renderStageUi();
            return;
        }
        if (session.editMode !== EDIT_MODE_PAINT) {
            return;
        }
        beginStroke(event);
        continueStroke(event);
    }

    function handleStagePointerMove(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        if (shouldIgnoreNonActivePointerEvent(event)) {
            return;
        }
        if (event.type === 'pointerrawupdate' && !session.isDrawing && !session.pointerDown && !session.sizeDrag?.active && !session.zoomDrag?.active && !session.pan?.active && !(session.crop?.active && session.crop.drag) && !(session.editMode === EDIT_MODE_SELECT && session.select?.lassoing) && !(session.editMode === EDIT_MODE_TRANSFORM && session.transform?.dragging)) {
            return;
        }
        captureInputSample(event, 'stage-move', { raw: event.type === 'pointerrawupdate', acceptZero: true, forcePen: true });
        updateHoverFromPointerEvent(event);
        const stagePoint = clientToStage(event);
        if (session.symmetryDrag?.axis) {
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            if (session.symmetryDrag.axis === 'x') {
                session.symmetryAxisX = clamp(imgPoint.x, 0, session.width);
            } else {
                session.symmetryAxisY = clamp(imgPoint.y, 0, session.height);
            }
            renderStageUi();
            persistPaintPreferences();
            return;
        }
        if (session.colorPickDrag && event.ctrlKey && !event.altKey && !session.ctrlSpaceHeld && !session.spaceKeyHeld && !session.spaceDown && event.buttons) {
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            const picked = pickVisibleColorAtImagePoint(imgPoint.x, imgPoint.y);
            if (picked) {
                setSessionColor(picked);
                syncColorPickerFromSession();
                renderHueCanvas();
                renderSvCanvas();
                showColorPickIndicator(picked, event.clientX, event.clientY);
            }
            return;
        }
        if (session.sizeDrag?.active) {
            event.preventDefault();
            event.stopPropagation();
            const dy = stagePoint.y - session.sizeDrag.startY;
            if (session.sizeDrag.mode === 'spacing') {
                const baseSpacing = Number.isFinite(session.sizeDrag.startSpacing) ? session.sizeDrag.startSpacing : resolveToolSpacingFactor(session.tool);
                session.toolSpacing[session.tool] = applySpacingDrag(baseSpacing, dy);
            } else {
                const dx = stagePoint.x - session.sizeDrag.startX;
                const next = clamp(session.sizeDrag.startSize + (dx * 0.25), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
                session.size = Math.round(next);
            }
            updateToolSizeFromSession();
            syncBorderSizeToBrush();
            updateHud();
            renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
            return;
        }
        if (session.zoomDrag.active) {
            event.preventDefault();
            event.stopPropagation();
            continueZoomDrag(stagePoint.x, stagePoint.y);
            return;
        }
        if (session.pan.active) {
            event.preventDefault();
            event.stopPropagation();
            continuePan(stagePoint.x, stagePoint.y);
            return;
        }
        if (session.crop.active && session.crop.drag) {
            event.preventDefault();
            event.stopPropagation();
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            const drag = session.crop.drag;
            session.crop.rect = updateCropRectFromDrag(drag.handle, drag.startRect, drag.startX, drag.startY, imgPoint.x, imgPoint.y);
            renderStageUi();
            return;
        }
        if (session.editMode === EDIT_MODE_SELECT && session.select.lassoing) {
            event.preventDefault();
            event.stopPropagation();
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            if (String(session.select.mode || 'lasso').trim() === 'rect') {
                const px = clamp(imgPoint.x, 0, session.width);
                const py = clamp(imgPoint.y, 0, session.height);
                session.select.points = buildRectSelectionPoints(session.select.anchorX, session.select.anchorY, px, py);
                session.select.dragMoved = Math.abs(px - session.select.anchorX) >= 0.5 || Math.abs(py - session.select.anchorY) >= 0.5;
                noteSelectionTrace(session, event, {
                    sampledPoints: 1,
                    storedPoints: session.select.points.length
                });
                renderLassoPreview(session.select.points);
            } else {
                processLassoSelectionSamples(session, event);
            }
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.transform.dragging) {
            event.preventDefault();
            event.stopPropagation();
            const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
            updateTransformDrag(imgPoint.x, imgPoint.y);
            renderStageUi();
            return;
        }
        if (session.isDrawing) {
            event.preventDefault();
            event.stopPropagation();
            const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
            if (coalesced && coalesced.length > 0) {
                for (const subEvent of coalesced) {
                    captureInputSample(subEvent, 'stage-coalesced', { acceptZero: true, forcePen: true });
                    continueStroke(subEvent);
                }
            } else {
                continueStroke(event);
            }
        }
    }

    function handleStagePointerUp(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        const needsHandling = !!(session.pointerDown
            || session.isDrawing
            || session.colorPickDrag
            || session.sizeDrag?.active
            || session.zoomDrag?.active
            || session.pan?.active
            || (session.crop?.active && session.crop?.drag)
            || (session.editMode === EDIT_MODE_SELECT && session.select?.lassoing)
            || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.dragging));
        if (!needsHandling) {
            return;
        }
        const eventPointerId = Number(event?.pointerId);
        if (Number.isFinite(eventPointerId) && Number.isFinite(session.pointerId) && eventPointerId !== session.pointerId) {
            return;
        }
        const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        session.suppressContextMenuUntil = now + PAINT_CONTEXTMENU_SUPPRESS_MS;
        session.ignoreHoverUntil = now + IGNORE_HOVER_AFTER_UP_MS;
        const upPointerType = (typeof session.activePointerType === 'string' && session.activePointerType)
            ? session.activePointerType
            : (typeof event?.pointerType === 'string' ? event.pointerType : '');
        session.ignoreHoverPointerType = upPointerType;
        session.ignoreHoverWasStylusLike = !!(session.activeWasStylusLike || upPointerType === 'pen');
        if (session.ignoreHoverWasStylusLike) {
            session.ignoreMouseUntil = now + IGNORE_MOUSE_AFTER_STYLUS_UP_MS;
        }
        syncHoverToLastStage(0);
        session.pointerDown = false;
        session.pointerId = null;
        session.activePointerType = '';
        session.activeWasStylusLike = false;
        session.colorPickDrag = false;
        hideColorPickIndicator();
        if (session.sizeDrag?.active) {
            event.preventDefault();
            event.stopPropagation();
            session.sizeDrag.active = false;
            logPaintTrace('paint.sizeDrag.end', {
                mode: String(session.sizeDrag.mode || 'size'),
                size: session.size,
                spacing: resolveToolSpacingFactor(session.tool)
            });
            session.sizeDrag.mode = 'size';
            updateStageCursor();
            persistPaintPreferences();
            renderCursorCanvas();
            return;
        }
        if (session.zoomDrag.active) {
            event.preventDefault();
            event.stopPropagation();
            endZoomDrag();
            return;
        }
        if (session.pan.active) {
            event.preventDefault();
            event.stopPropagation();
            endPan();
            return;
        }
        if (session.crop.active && session.crop.drag) {
            event.preventDefault();
            event.stopPropagation();
            session.crop.drag = null;
            renderStageUi();
            return;
        }
        if (session.symmetryDrag?.axis) {
            event.preventDefault();
            event.stopPropagation();
            session.symmetryDrag = null;
            return;
        }
        if (session.editMode === EDIT_MODE_SELECT && session.select.lassoing) {
            event.preventDefault();
            event.stopPropagation();
            const mode = String(session.select.mode || 'lasso').trim() || 'lasso';
            session.select.lassoing = false;
            if (mode === 'lasso' && session.selection && isTinyLassoGesture(session)) {
                finishSelectionTrace(session, 'paint.selection.clearGesture', {
                    cleared: true
                });
                session.select.awaitingContinuation = false;
                session.select.dragMoved = false;
                session.select.points = [];
                clearSelectionAndQueueUndo();
                updateStageCursor();
                renderCursorCanvas();
                return;
            }
            if (mode === 'lasso' && (event.ctrlKey || event.metaKey)) {
                session.select.awaitingContinuation = true;
                session.select.dragMoved = false;
                finishSelectionTrace(session, 'paint.selection.continuation', {
                    awaitingContinuation: true,
                    points: Array.isArray(session.select.points) ? session.select.points.length : 0
                });
                beginSelectionTrace(session, event, mode, session.select.op);
                session.select.trace.sampledPoints = Array.isArray(session.select.points) ? session.select.points.length : 0;
                session.select.trace.storedPoints = Array.isArray(session.select.points) ? session.select.points.length : 0;
                renderLassoPreview(session.select.points);
                updateStageCursor();
                renderCursorCanvas();
                return;
            }
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            finalizeSelection(session.select.points, session.select.op);
            session.select.points = [];
            updateStageCursor();
            renderCursorCanvas();
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.transform.dragging) {
            event.preventDefault();
            event.stopPropagation();
            session.transform.dragging = false;
            renderStageUi();
            return;
        }
        if (session.isDrawing) {
            event.preventDefault();
            event.stopPropagation();
            captureInputSample(event, 'stage-up', { acceptZero: true, forcePen: true });
            const stagePoint = clientToStage(event);
            const dx = Number.isFinite(stagePoint.x) ? Math.abs(stagePoint.x - session.lastStageX) : 0;
            const dy = Number.isFinite(stagePoint.y) ? Math.abs(stagePoint.y - session.lastStageY) : 0;
            const suspiciousJump = (dx + dy) > 60;
            if (!suspiciousJump) {
                continueStroke(event);
            }
            endStroke();
        }
    }


    return {
        handlePaintContextMenu,
        handlePaintWheel,
        handlePaintPointerDown,
        handlePaintPointerMove,
        handlePaintPointerUp,
        handleStagePointerDown,
        handleStagePointerMove,
        handleStagePointerUp
    };
};
