'use strict';

// MARK: MODULE
module.exports = function createPaintStageRenderModule(deps) {
    const {
        dom,
        paintWorkspaceState,
        LAYER_PREVIEW_SIZE,
        STICKER_SHADOW_PAD,
        PATTERN_TILE_LIMIT,
        CURSOR_HINT_LEFT_OFFSET,
        SELECTION_DASH_ON,
        SELECTION_DASH_OFF,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        TOOL_LABELS,
        TOOL_KEYS,
        BRUSH_BLEND_MODES,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        EDIT_MODE_TRANSFORM,
        DEFAULT_COLOR,
        MAX_BRUSH_SIZE,
        getSession,
        clamp,
        clamp01,
        logPaintTrace,
        appendPaintPerfLog,
        getActiveLayer,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        resolveEffectiveLayerVisibility,
        resolvePaintThemeToken,
        resolveToolSpacingFactor,
        formatSpacingPercent,
        resolveOpacityCapForTool,
        imageToStage,
        buildPath2D,
        isColorPopoverOpen,
        resolveTransformHandleAtStage,
        ensureLayerControlsEnabled,
        createFlattenedLayersCanvas,
        createVisibleLayersCanvas,
        updateTransformPreviewGeometry
    } = deps;

    let layerPreviewRefreshQueued = false;
    let layerPreviewRefreshTimer = null;
    let lastLayerPreviewRefreshAt = 0;
    let stageShadowRefreshQueued = false;
    let stageShadowNeedsRebuild = false;
    let stagePatternRefreshQueued = false;
    let selectionAntsFrame = 0;
    const LAYER_PREVIEW_SOURCE_MAX_SIDE = 200;
    const LAYER_PREVIEW_REFRESH_MIN_MS = 180;

    function hasAnimatedSelection(session) {
        if (!session) {
            return false;
        }
        return !!(
            session.selection?.path
            || (session.editMode === EDIT_MODE_SELECT && Array.isArray(session.select?.points) && session.select.points.length > 1 && session.select.awaitingContinuation)
            || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active)
        );
    }

    function queueSelectionAntsFrame() {
        if (selectionAntsFrame) {
            return;
        }
        selectionAntsFrame = window.requestAnimationFrame(() => {
            selectionAntsFrame = 0;
            const session = getSession();
            if (!hasAnimatedSelection(session)) {
                return;
            }
            renderStageUi();
        });
    }

    function buildOpenPath2D(points) {
        if (!Array.isArray(points) || points.length < 2) {
            return null;
        }
        const path = new Path2D();
        const first = points[0];
        path.moveTo(first.x, first.y);
        for (let index = 1; index < points.length; index += 1) {
            const point = points[index];
            path.lineTo(point.x, point.y);
        }
        return path;
    }

    function drawSelectionAnts(ctx, path, scale, phase) {
        if (!path) {
            return;
        }
        const safeScale = Math.max(0.2, scale || 1);
        const dashOn = Math.max(SELECTION_DASH_ON / safeScale, 1 / safeScale);
        const dashOff = Math.max(SELECTION_DASH_OFF / safeScale, 1 / safeScale);
        const patternLength = dashOn + dashOff;
        const offset = ((phase % patternLength) + patternLength) % patternLength;
        const lineWidth = 1 / safeScale;
        const passes = [
            { color: 'rgba(255, 72, 196, 0.98)', shift: 0 },
            { color: 'rgba(0, 178, 255, 0.98)', shift: patternLength / 3 },
            { color: 'rgba(0, 0, 0, 0.9)', shift: (patternLength * 2) / 3 }
        ];
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'round';
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([dashOn, dashOff]);
        for (const pass of passes) {
            ctx.strokeStyle = pass.color;
            ctx.lineDashOffset = -(offset + pass.shift);
            ctx.stroke(path);
        }
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
    }

    function resolveSelectionHintLabel(session) {
        if (session.editMode !== EDIT_MODE_SELECT) {
            return '';
        }
        const mode = String(session.select?.mode || 'lasso').trim() || 'lasso';
        if (session.shiftDown && session.ctrlDown) {
            return '-';
        }
        if (session.shiftDown) {
            return '+';
        }
        if (mode === 'lasso' && session.ctrlDown) {
            return 'LINE';
        }
        return '';
    }

    function syncOverlayCanvasPresentation(reason = 'overlay-presentation-sync') {
        const session = getSession();
        if (!dom.paintOverlayCanvas || !session) {
            return;
        }
        const activeLayer = getActiveLayer();
        const activeLayerIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, Math.max(0, (session.layers?.length || 1) - 1));
        const activeLayerVisible = resolveEffectiveLayerVisibility(activeLayer, activeLayerIndex);
        const activeLayerOpacity = normalizeLayerOpacity(activeLayer?.opacity);
        const brushLike = session.tool === TOOL_AIR
            || session.tool === TOOL_INK
            || session.tool === TOOL_PAINT
            || session.tool === TOOL_BLUR
            || session.tool === TOOL_STAMP
            || session.tool === TOOL_RECT;
        let mode = 'default';
        let display = '';
        let opacity = 1;
        if (session.isDrawing && session.editMode === EDIT_MODE_PAINT && brushLike) {
            if (session.eraserMode) {
                mode = 'eraser-hidden';
                display = 'none';
                opacity = 0;
            } else {
                mode = 'active-layer';
                display = activeLayerVisible ? '' : 'none';
                opacity = activeLayerVisible ? activeLayerOpacity : 0;
            }
        }
        const safeOpacity = clamp(opacity, 0, 1);
        const key = `${mode}|${display}|${safeOpacity.toFixed(4)}|${activeLayer?.id || ''}`;
        if (paintWorkspaceState.overlayPresentationKey === key) {
            return;
        }
        paintWorkspaceState.overlayPresentationKey = key;
        dom.paintOverlayCanvas.style.display = display;
        dom.paintOverlayCanvas.style.opacity = mode === 'default' ? '' : String(safeOpacity);
        logPaintTrace('paint.overlay.presentation', {
            reason,
            mode,
            display,
            opacity: safeOpacity,
            activeLayerId: activeLayer?.id || '',
            activeLayerVisible,
            activeLayerOpacity,
            tool: session.tool,
            eraserMode: !!session.eraserMode,
            isDrawing: session.isDrawing === true
        });
    }

    function ensureLayerPreviewState() {
        const session = getSession();
        if (!session) {
            return null;
        }
        if (!session.layerPreviewState || typeof session.layerPreviewState !== 'object') {
            session.layerPreviewState = {
                entries: new Map(),
                dirtyLayerIds: new Set()
            };
        }
        return session.layerPreviewState;
    }

    function pruneLayerPreviewState(previewState) {
        if (!previewState?.entries || typeof previewState.entries.forEach !== 'function') {
            return;
        }
        const validIds = new Set((getSession()?.layers || []).map((layer) => String(layer?.id || '')).filter(Boolean));
        previewState.entries.forEach((_entry, layerId) => {
            if (!validIds.has(layerId)) {
                previewState.entries.delete(layerId);
                previewState.dirtyLayerIds?.delete?.(layerId);
            }
        });
    }

    function markLayerPreviewDirty(layerId = '') {
        const previewState = ensureLayerPreviewState();
        if (!previewState?.dirtyLayerIds) {
            return false;
        }
        pruneLayerPreviewState(previewState);
        const nextId = String(layerId || '').trim();
        if (nextId) {
            previewState.dirtyLayerIds.add(nextId);
            const entry = previewState.entries.get(nextId);
            if (entry) {
                entry.previewDataUrl = '';
            }
            return true;
        }
        for (const layer of getSession()?.layers || []) {
            const currentId = String(layer?.id || '').trim();
            if (!currentId) {
                continue;
            }
            previewState.dirtyLayerIds.add(currentId);
            const entry = previewState.entries.get(currentId);
            if (entry) {
                entry.previewDataUrl = '';
            }
        }
        return true;
    }

    function resolveLayerPreviewLayer(layerOrId) {
        const session = getSession();
        if (!session?.layers?.length) {
            return null;
        }
        if (layerOrId && typeof layerOrId === 'object') {
            return layerOrId;
        }
        const targetId = String(layerOrId || '').trim();
        if (!targetId) {
            return null;
        }
        return session.layers.find((layer) => String(layer?.id || '').trim() === targetId) || null;
    }

    function buildLayerPreviewSourceCanvas(sourceCanvas, layerId = '', options = {}) {
        const session = getSession();
        if (!sourceCanvas) {
            return null;
        }
        const previewState = ensureLayerPreviewState();
        if (!previewState?.entries) {
            return null;
        }
        pruneLayerPreviewState(previewState);
        const safeLayerId = String(layerId || '').trim();
        if (!safeLayerId) {
            return null;
        }
        let entry = previewState.entries.get(safeLayerId);
        if (!entry) {
            entry = {
                canvas: document.createElement('canvas'),
                previewDataUrl: '',
                width: 0,
                height: 0
            };
            previewState.entries.set(safeLayerId, entry);
        }
        const force = options.force === true || previewState.dirtyLayerIds.has(safeLayerId);
        const srcW = Math.max(1, Number(sourceCanvas.width) || 1);
        const srcH = Math.max(1, Number(sourceCanvas.height) || 1);
        const maxSourceSide = Math.max(srcW, srcH);
        const scale = maxSourceSide <= LAYER_PREVIEW_SOURCE_MAX_SIDE
            ? 1
            : (LAYER_PREVIEW_SOURCE_MAX_SIDE / maxSourceSide);
        const targetWidth = Math.max(1, Math.round(srcW * scale));
        const targetHeight = Math.max(1, Math.round(srcH * scale));
        if (!force && entry.width === targetWidth && entry.height === targetHeight && entry.canvas.width === targetWidth && entry.canvas.height === targetHeight) {
            return entry.canvas;
        }
        if (entry.canvas.width !== targetWidth) {
            entry.canvas.width = targetWidth;
        }
        if (entry.canvas.height !== targetHeight) {
            entry.canvas.height = targetHeight;
        }
        entry.width = targetWidth;
        entry.height = targetHeight;
        entry.previewDataUrl = '';
        const ctx = entry.canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return null;
        }
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.imageSmoothingQuality = scale < 0.5 ? 'high' : 'medium';
        ctx.drawImage(sourceCanvas, 0, 0, srcW, srcH, 0, 0, targetWidth, targetHeight);
        const activeLayer = getActiveLayer();
        const canCompositeSelection = !!(
            session?.selectionEdit?.dirty
            && session?.selectionEdit?.canvas
            && session?.selection?.maskCanvas
            && session?.selection?.bounds
            && !session?.selection?.inverted
            && activeLayer?.id
            && safeLayerId
            && activeLayer.id === safeLayerId
        );
        if (canCompositeSelection) {
            const bounds = session.selection.bounds;
            const drawX = bounds.x * scale;
            const drawY = bounds.y * scale;
            const drawWidth = bounds.width * scale;
            const drawHeight = bounds.height * scale;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(session.selection.maskCanvas, 0, 0, bounds.width, bounds.height, drawX, drawY, drawWidth, drawHeight);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(session.selectionEdit.canvas, 0, 0, bounds.width, bounds.height, drawX, drawY, drawWidth, drawHeight);
            ctx.restore();
        }
        previewState.dirtyLayerIds.delete(safeLayerId);
        return entry.canvas;
    }

    function drawLayerPreview(previewCanvas, sourceCanvas, layerId = '', options = {}) {
        if (!previewCanvas || !sourceCanvas) {
            return;
        }
        const size = Math.max(1, Math.round(Number(options.size) || LAYER_PREVIEW_SIZE));
        if (previewCanvas.width !== size) {
            previewCanvas.width = size;
        }
        if (previewCanvas.height !== size) {
            previewCanvas.height = size;
        }
        const ctx = previewCanvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return;
        }
        const previewSource = buildLayerPreviewSourceCanvas(sourceCanvas, layerId, options);
        if (!previewSource) {
            return;
        }
        const srcW = Math.max(1, Number(previewSource.width) || 1);
        const srcH = Math.max(1, Number(previewSource.height) || 1);
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = 'rgba(25, 30, 40, 0.98)';
        ctx.fillRect(0, 0, size, size);
        const scale = Math.min(size / srcW, size / srcH);
        const drawW = Math.max(1, Math.round(srcW * scale));
        const drawH = Math.max(1, Math.round(srcH * scale));
        const dx = Math.floor((size - drawW) / 2);
        const dy = Math.floor((size - drawH) / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(previewSource, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
    }

    function getLayerPreviewDataUrl(layerOrId, options = {}) {
        const layer = resolveLayerPreviewLayer(layerOrId);
        if (!layer?.canvas) {
            return '';
        }
        const previewCanvas = buildLayerPreviewSourceCanvas(layer.canvas, String(layer.id || ''), options);
        if (!previewCanvas) {
            return '';
        }
        const previewState = ensureLayerPreviewState();
        const entry = previewState?.entries?.get?.(String(layer.id || '').trim());
        if (!entry) {
            return '';
        }
        if (!entry.previewDataUrl) {
            try {
                entry.previewDataUrl = previewCanvas.toDataURL('image/png');
            } catch {
                entry.previewDataUrl = '';
            }
        }
        return entry.previewDataUrl;
    }

    function refreshLayerPreviewCanvases(options = {}) {
        const session = getSession();
        if (!session || !dom.paintLayerList || !dom.paintLayerBar || dom.paintLayerBar.hidden) {
            return;
        }
        const thumbs = dom.paintLayerList.querySelectorAll('.paint-layer-thumb[data-layer-id]');
        if (!thumbs.length) {
            return;
        }
        const byId = new Map();
        const force = options.force === true;
        for (const layer of session.layers || []) {
            if (layer?.id && layer.canvas) {
                byId.set(layer.id, layer.canvas);
            }
        }
        thumbs.forEach((node) => {
            const layerId = String(node.dataset.layerId || '');
            if (!layerId) {
                return;
            }
            const source = byId.get(layerId);
            if (!source) {
                return;
            }
            drawLayerPreview(node, source, layerId, { force });
        });
    }

    function queueLayerPreviewRefresh(options = {}) {
        const session = getSession();
        if (!session) {
            return;
        }
        const reason = typeof options === 'string'
            ? options
            : String(options?.reason || 'layer-preview-refresh');
        const layerId = typeof options === 'object' ? String(options?.layerId || '') : '';
        markLayerPreviewDirty(layerId);
        const timelineVisible = !!dom.paintLayerBar && dom.paintLayerBar.hidden !== true;
        if (!timelineVisible) {
            return;
        }
        if (layerPreviewRefreshQueued) {
            return;
        }
        layerPreviewRefreshQueued = true;
        const delay = Math.max(0, LAYER_PREVIEW_REFRESH_MIN_MS - (Date.now() - lastLayerPreviewRefreshAt));
        if (layerPreviewRefreshTimer) {
            clearTimeout(layerPreviewRefreshTimer);
        }
        layerPreviewRefreshTimer = setTimeout(() => {
            layerPreviewRefreshTimer = null;
            layerPreviewRefreshQueued = false;
            lastLayerPreviewRefreshAt = Date.now();
            refreshLayerPreviewCanvases({ reason });
        }, delay);
    }

    function renderBlendMenu() {
        const session = getSession();
        if (!dom.paintBlendMenu) {
            return;
        }
        dom.paintBlendMenu.innerHTML = '';
        for (const mode of BRUSH_BLEND_MODES) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'paint-hud-menu-item';
            button.dataset.blendMode = mode;
            const label = mode.replace('-', ' ');
            button.textContent = label ? (label[0].toUpperCase() + label.slice(1)) : 'Normal';
            if (session?.brushBlendMode === mode) {
                button.classList.add('is-active');
            }
            dom.paintBlendMenu.appendChild(button);
        }
    }

    function renderToolMenu() {
        const session = getSession();
        if (!dom.paintToolMenu) {
            return;
        }
        dom.paintToolMenu.innerHTML = '';
        for (const tool of Object.keys(TOOL_KEYS)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'paint-hud-menu-item';
            button.dataset.tool = tool;
            button.textContent = `${TOOL_KEYS[tool] || ''} - ${TOOL_LABELS[tool] || tool}`;
            if (session?.tool === tool) {
                button.classList.add('is-active');
            }
            dom.paintToolMenu.appendChild(button);
        }
    }

    function updateStageCursor() {
        const session = getSession();
        if (!session || !dom.paintStage) {
            return;
        }
        const selectionToolLocked = !!session.select?.toolLocked;
        if (session.sizeDrag?.active) {
            dom.paintStage.style.cursor = session.sizeDrag.mode === 'spacing' ? 'ns-resize' : 'ew-resize';
            return;
        }
        if (session.ctrlSpaceHeld || session.zoomDrag?.active) {
            dom.paintStage.style.cursor = 'ns-resize';
            return;
        }
        if (session.pan?.active) {
            dom.paintStage.style.cursor = 'grabbing';
            return;
        }
        if (session.spaceDown) {
            dom.paintStage.style.cursor = 'grab';
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
            const stageX = Number(session.hover?.stageX);
            const stageY = Number(session.hover?.stageY);
            if (session.transform.dragging) {
                dom.paintStage.style.cursor = 'grabbing';
                return;
            }
            if (Number.isFinite(stageX) && Number.isFinite(stageY)) {
                const handleHit = resolveTransformHandleAtStage(stageX, stageY);
                if (handleHit) {
                    dom.paintStage.style.cursor = 'pointer';
                    return;
                }
                const imgX = Number(session.hover?.x);
                const imgY = Number(session.hover?.y);
                if (Number.isFinite(imgX) && Number.isFinite(imgY)) {
                    const hitPath = session.transform.previewPath || session.selection?.path;
                    if (hitPath) {
                        const hit = session.baseCtx.isPointInPath(hitPath, imgX, imgY, session.selection?.fillRule || 'nonzero');
                        if (hit) {
                            dom.paintStage.style.cursor = 'move';
                            return;
                        }
                    }
                }
            }
            dom.paintStage.style.cursor = 'default';
            return;
        }
        if (selectionToolLocked) {
            dom.paintStage.style.cursor = 'default';
            return;
        }
        const isBrushOrShape = session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_RECT || session.tool === TOOL_STAMP;
        if (session.isDrawing || (session.editMode === EDIT_MODE_PAINT && isBrushOrShape && !session.crop.active && !isColorPopoverOpen())) {
            dom.paintStage.style.cursor = 'none';
            return;
        }
        dom.paintStage.style.cursor = 'default';
    }

    function updateHud() {
        const session = getSession();
        if (!session) {
            return;
        }
        const selectionToolLocked = !!session.select?.toolLocked && session.editMode !== EDIT_MODE_TRANSFORM;
        const displayScaleMode = session.displayScaleMode === 'pixelated' || session.displayScaleMode === 'smooth'
            ? session.displayScaleMode
            : 'auto';
        const usePixelatedDisplay = displayScaleMode === 'pixelated'
            || (displayScaleMode === 'auto' && Number(session.view?.scale) > 2);
        if (dom.paintCanvasWrap) {
            dom.paintCanvasWrap.classList.toggle('is-border-hidden', session.canvasBorderVisible === false);
            dom.paintCanvasWrap.classList.toggle('is-alpha-invisible', session.invisibleBackground === true);
            dom.paintCanvasWrap.classList.toggle('is-pixelated', usePixelatedDisplay);
            dom.paintCanvasWrap.style.borderColor = session.canvasBorderVisible === false
                ? 'rgba(255, 255, 255, 0)'
                : resolvePaintThemeToken('--paint-theme-canvas-border', 'rgba(191, 225, 255, 0.28)');
        }
        if (dom.paintHudColor) {
            dom.paintHudColor.style.setProperty('--paint-hud-color', session.color);
            dom.paintHudColor.title = session.color;
        }
        if (dom.paintHudSize) {
            dom.paintHudSize.textContent = `Size ${Math.round(session.size)} px`;
        }
        if (dom.paintHudSpacing) {
            const factor = resolveToolSpacingFactor(session.tool);
            dom.paintHudSpacing.textContent = `Spacing ${formatSpacingPercent(factor)}`;
        }
        if (dom.paintHudMode) {
            dom.paintHudMode.textContent = session.strokeMode === STROKE_MODE_BORDER ? 'Border' : 'Filled';
        }
        if (dom.paintHudZoom) {
            const zoomText = `${Math.round(session.view.scale * 100)}%`;
            dom.paintHudZoom.textContent = zoomText;
            if (session.lastZoomHudValue !== zoomText) {
                session.lastZoomHudValue = zoomText;
                dom.paintHudZoom.classList.add('is-visible');
                if (session.zoomHudHideTimer) {
                    clearTimeout(session.zoomHudHideTimer);
                }
                session.zoomHudHideTimer = setTimeout(() => {
                    dom.paintHudZoom?.classList.remove('is-visible');
                }, 2000);
            }
        }
        if (dom.paintHudBlend) {
            const rawBlend = String(session.brushBlendMode || 'normal').replace('-', ' ');
            dom.paintHudBlend.textContent = rawBlend ? (rawBlend[0].toUpperCase() + rawBlend.slice(1)) : 'Normal';
        }
        if (dom.paintHudPressureSize) {
            dom.paintHudPressureSize.classList.toggle('is-on', session.pressureAffectsSize !== false);
        }
        if (dom.paintHudPressureOpacity) {
            dom.paintHudPressureOpacity.classList.toggle('is-on', session.pressureAffectsOpacity !== false);
        }
        if (dom.paintHudEraser) {
            dom.paintHudEraser.classList.toggle('is-on', !!session.eraserMode);
            dom.paintHudEraser.title = session.eraserMode ? 'Eraser is on' : 'Eraser is off';
        }
        if (dom.paintNoBoundaryClipToggle) {
            dom.paintNoBoundaryClipToggle.textContent = `No Boundary Clip: ${paintWorkspaceState.noBoundaryClip !== false ? 'On' : 'Off'}`;
        }
        if (dom.paintQuickAnimationPeekToggle) {
            dom.paintQuickAnimationPeekToggle.textContent = `Quick Animation Peek: ${paintWorkspaceState.quickAnimationPeek === true ? 'On' : 'Off'}`;
        }
        if (dom.paintCanvasEdgeToggle) {
            dom.paintCanvasEdgeToggle.textContent = `Canvas Edge: ${session.canvasBorderVisible !== false ? 'On' : 'Off'}`;
        }
        dom.paintMirrorXToggle?.classList.toggle('is-active', !!session.mirrorX);
        dom.paintMirrorYToggle?.classList.toggle('is-active', !!session.mirrorY);
        dom.paintPatternToggle?.classList.toggle('is-active', !!session.patternMode);
        dom.paintAlphaLockToggle?.classList.toggle('is-active', !!session.alphaLockEnabled);
        dom.paintInvisibleBgToggle?.classList.toggle('is-active', !!session.invisibleBackground);
        dom.paintIsolateToggle?.classList.toggle('is-active', !!session.isolateActiveLayer);
        if (dom.paintIsolateToggle) {
            const isolateLabel = session.isolateActiveLayer ? 'Isolate active layer: On' : 'Isolate active layer: Off';
            dom.paintIsolateToggle.title = isolateLabel;
            dom.paintIsolateToggle.setAttribute('aria-label', isolateLabel);
            dom.paintIsolateToggle.setAttribute('aria-pressed', session.isolateActiveLayer ? 'true' : 'false');
        }
        dom.paintDisplayScaleModeToggle?.classList.toggle('is-active', displayScaleMode !== 'auto');
        if (dom.paintDisplayScaleModeLabel) {
            dom.paintDisplayScaleModeLabel.textContent = displayScaleMode === 'pixelated'
                ? 'Px'
                : (displayScaleMode === 'smooth' ? 'Sm' : 'Auto');
        }
        if (dom.paintDisplayScaleModeToggle) {
            const label = displayScaleMode === 'pixelated'
                ? 'Pixelated'
                : (displayScaleMode === 'smooth' ? 'Smooth' : 'Auto');
            dom.paintDisplayScaleModeToggle.title = `Display filter: ${label}`;
            dom.paintDisplayScaleModeToggle.setAttribute('aria-label', `Display filter: ${label}`);
        }
        if (dom.paintHudTool) {
            dom.paintHudTool.classList.toggle('is-eraser', !!session.eraserMode);
        }
        if (dom.paintHudToolIcon) {
            if (session.editMode === EDIT_MODE_SELECT || selectionToolLocked) {
                dom.paintHudToolIcon.textContent = String(session.select?.mode || 'lasso').trim() === 'rect' ? 'R' : 'Q';
            } else if (session.editMode === EDIT_MODE_TRANSFORM) {
                dom.paintHudToolIcon.textContent = 'T';
            } else {
                dom.paintHudToolIcon.textContent = TOOL_KEYS[session.tool] || '';
            }
        }
        if (dom.paintHudToolLabel) {
            if (session.editMode === EDIT_MODE_SELECT || selectionToolLocked) {
                dom.paintHudToolLabel.textContent = String(session.select?.mode || 'lasso').trim() === 'rect'
                    ? 'R Rect Select'
                    : 'Q Lasso';
            } else if (session.editMode === EDIT_MODE_TRANSFORM) {
                dom.paintHudToolLabel.textContent = 'T Transform';
            } else {
                const label = TOOL_LABELS[session.tool] || 'Paint';
                dom.paintHudToolLabel.textContent = session.eraserMode ? `${label} - Eraser` : label;
            }
        }
        const cap = resolveOpacityCapForTool(session.tool);
        if (dom.paintHudOpacitySlider) {
            const nextValue = clamp(Math.round(cap * 100), 0, 100);
            if (Number(dom.paintHudOpacitySlider.value) !== nextValue) {
                dom.paintHudOpacitySlider.value = String(nextValue);
            }
        }
        if (dom.paintHudOpacityValue) {
            dom.paintHudOpacityValue.textContent = `${Math.round(cap * 100)}%`;
        }
        ensureLayerControlsEnabled();
    }

    function ensureStageUiSized() {
        const session = getSession();
        if (!session || !dom.paintStage || !dom.paintStageUiCanvas) {
            return;
        }
        const stageRect = dom.paintStage.getBoundingClientRect();
        const cssWidth = Math.max(1, Math.round(stageRect.width));
        const cssHeight = Math.max(1, Math.round(stageRect.height));
        const dpr = Math.max(1, Number(window.devicePixelRatio) || 1);
        const canvas = dom.paintStageUiCanvas;
        const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
        const targetHeight = Math.max(1, Math.round(cssHeight * dpr));
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
        const cursorCanvas = dom.paintCursorCanvas;
        if (cursorCanvas && (cursorCanvas.width !== targetWidth || cursorCanvas.height !== targetHeight)) {
            cursorCanvas.width = targetWidth;
            cursorCanvas.height = targetHeight;
        }
        const shadowCanvas = dom.paintStageShadowCanvas;
        if (shadowCanvas && (shadowCanvas.width !== targetWidth || shadowCanvas.height !== targetHeight)) {
            shadowCanvas.width = targetWidth;
            shadowCanvas.height = targetHeight;
        }
        const patternCanvas = dom.paintStagePatternCanvas;
        if (patternCanvas && (patternCanvas.width !== targetWidth || patternCanvas.height !== targetHeight)) {
            patternCanvas.width = targetWidth;
            patternCanvas.height = targetHeight;
        }
        if (!session.stageUi) {
            session.stageUi = { cssWidth, cssHeight, dpr };
        } else {
            session.stageUi.cssWidth = cssWidth;
            session.stageUi.cssHeight = cssHeight;
            session.stageUi.dpr = dpr;
        }
    }

    function clearStageShadowCanvas() {
        const session = getSession();
        if (!session?.stageShadowCtx || !session?.stageUi) {
            return;
        }
        ensureStageUiSized();
        const ctx = session.stageShadowCtx;
        ctx.save();
        ctx.setTransform(session.stageUi.dpr, 0, 0, session.stageUi.dpr, 0, 0);
        ctx.clearRect(0, 0, session.stageUi.cssWidth, session.stageUi.cssHeight);
        ctx.restore();
    }

    function clearStagePatternCanvas() {
        const session = getSession();
        if (!session?.stagePatternCtx || !session?.stageUi) {
            return;
        }
        ensureStageUiSized();
        const ctx = session.stagePatternCtx;
        ctx.save();
        ctx.setTransform(session.stageUi.dpr, 0, 0, session.stageUi.dpr, 0, 0);
        ctx.clearRect(0, 0, session.stageUi.cssWidth, session.stageUi.cssHeight);
        ctx.restore();
    }

    function rebuildStageShadowSource() {
        const session = getSession();
        if (!session) {
            return;
        }
        const startedAt = Date.now();
        const flattened = createVisibleLayersCanvas();
        if (!flattened) {
            session.stageShadowSource = null;
            return;
        }
        const pad = STICKER_SHADOW_PAD;
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = session.width + (pad * 2);
        shadowCanvas.height = session.height + (pad * 2);
        const shadowCtx = shadowCanvas.getContext('2d', { willReadFrequently: false });
        if (!shadowCtx) {
            session.stageShadowSource = null;
            return;
        }
        shadowCtx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height);
        shadowCtx.shadowColor = 'rgba(0, 0, 0, 0.34)';
        shadowCtx.shadowBlur = 22;
        shadowCtx.shadowOffsetX = 0;
        shadowCtx.shadowOffsetY = 12;
        shadowCtx.drawImage(flattened, pad, pad);
        shadowCtx.globalCompositeOperation = 'destination-out';
        shadowCtx.shadowColor = 'transparent';
        shadowCtx.shadowBlur = 0;
        shadowCtx.shadowOffsetY = 0;
        shadowCtx.drawImage(flattened, pad, pad);
        session.stageShadowSource = shadowCanvas;
        appendPaintPerfLog(`shadow-rebuild ms=${Date.now() - startedAt} width=${session.width} height=${session.height}`);
    }

    function applyStageUiImageTransform(ctx) {
        const session = getSession();
        const dpr = session?.stageUi?.dpr || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(session.view.tx, session.view.ty);
        ctx.scale(session.view.scale, session.view.scale);
    }

    function renderStageShadowCanvas() {
        const session = getSession();
        if (!session?.stageShadowCtx || !session?.stageUi) {
            return;
        }
        clearStageShadowCanvas();
        if (stageShadowNeedsRebuild || !session.stageShadowSource) {
            rebuildStageShadowSource();
            stageShadowNeedsRebuild = false;
        }
        if (!session.stageShadowSource) {
            return;
        }
        const pad = STICKER_SHADOW_PAD;
        const ctx = session.stageShadowCtx;
        ctx.save();
        applyStageUiImageTransform(ctx);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(session.stageShadowSource, -pad, -pad);
        ctx.restore();
    }

    function queueStageShadowRefresh(options = {}) {
        const session = getSession();
        if (!session?.stageShadowCtx) {
            return;
        }
        if (options.rebuild !== false) {
            stageShadowNeedsRebuild = true;
        }
        if (stageShadowRefreshQueued) {
            return;
        }
        stageShadowRefreshQueued = true;
        window.requestAnimationFrame(() => {
            stageShadowRefreshQueued = false;
            renderStageShadowCanvas();
        });
    }

    function drawPatternTileContent(ctx, dx, dy, drawWidth, drawHeight) {
        const session = getSession();
        if (!session) {
            return;
        }
        for (let index = 0; index < (session.layers || []).length; index += 1) {
            const layer = session.layers[index];
            if (!layer?.canvas) {
                continue;
            }
            if (!resolveEffectiveLayerVisibility(layer, index)) {
                continue;
            }
            ctx.drawImage(layer.canvas, dx, dy, drawWidth, drawHeight);
        }
        if (session.overlayCanvas) {
            ctx.drawImage(session.overlayCanvas, dx, dy, drawWidth, drawHeight);
        }
        if (session.selectionEdit?.dirty && session.selectionEdit.canvas && session.selection?.bounds && !session.selection?.inverted) {
            const bounds = session.selection.bounds;
            const sx = dx + ((bounds.x / session.width) * drawWidth);
            const sy = dy + ((bounds.y / session.height) * drawHeight);
            const sw = (bounds.width / session.width) * drawWidth;
            const sh = (bounds.height / session.height) * drawHeight;
            ctx.drawImage(session.selectionEdit.canvas, sx, sy, sw, sh);
        }
    }

    function renderStagePatternCanvas() {
        const session = getSession();
        if (!session?.stagePatternCtx || !session?.stageUi) {
            return;
        }
        clearStagePatternCanvas();
        if (!session.patternMode) {
            return;
        }
        const tileWidth = session.width * session.view.scale;
        const tileHeight = session.height * session.view.scale;
        if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || tileWidth <= 0 || tileHeight <= 0) {
            return;
        }
        const minTileX = Math.max(-PATTERN_TILE_LIMIT, Math.floor((-session.view.tx) / tileWidth) - 1);
        const maxTileX = Math.min(PATTERN_TILE_LIMIT, Math.ceil((session.stageUi.cssWidth - session.view.tx) / tileWidth) + 1);
        const minTileY = Math.max(-PATTERN_TILE_LIMIT, Math.floor((-session.view.ty) / tileHeight) - 1);
        const maxTileY = Math.min(PATTERN_TILE_LIMIT, Math.ceil((session.stageUi.cssHeight - session.view.ty) / tileHeight) + 1);
        const ctx = session.stagePatternCtx;
        ctx.save();
        ctx.setTransform(session.stageUi.dpr, 0, 0, session.stageUi.dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
            for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
                if (tileX === 0 && tileY === 0) {
                    continue;
                }
                const dx = session.view.tx + (tileX * tileWidth);
                const dy = session.view.ty + (tileY * tileHeight);
                drawPatternTileContent(ctx, dx, dy, tileWidth, tileHeight);
            }
        }
        ctx.restore();
    }

    function queueStagePatternRefresh() {
        const session = getSession();
        if (!session?.stagePatternCtx) {
            return;
        }
        if (stagePatternRefreshQueued) {
            return;
        }
        stagePatternRefreshQueued = true;
        window.requestAnimationFrame(() => {
            stagePatternRefreshQueued = false;
            renderStagePatternCanvas();
        });
    }

    function clearStageUiCanvas() {
        const session = getSession();
        if (!session?.stageUiCtx || !session?.stageUi) {
            return;
        }
        ensureStageUiSized();
        const ctx = session.stageUiCtx;
        ctx.save();
        ctx.setTransform(session.stageUi.dpr, 0, 0, session.stageUi.dpr, 0, 0);
        ctx.clearRect(0, 0, session.stageUi.cssWidth, session.stageUi.cssHeight);
        ctx.restore();
    }

    function clearCursorCanvas() {
        const session = getSession();
        if (!session?.cursorCtx || !session?.stageUi) {
            return;
        }
        ensureStageUiSized();
        const ctx = session.cursorCtx;
        ctx.save();
        ctx.setTransform(session.stageUi.dpr, 0, 0, session.stageUi.dpr, 0, 0);
        ctx.clearRect(0, 0, session.stageUi.cssWidth, session.stageUi.cssHeight);
        ctx.restore();
    }

    function drawCursorHint(ctx, originX, originY, lines) {
        if (!Array.isArray(lines) || !lines.length) {
            return;
        }
        ctx.save();
        ctx.translate(originX, originY);
        ctx.font = '600 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        const paddingX = 10;
        const paddingY = 7;
        const lineHeight = 16;
        const maxLines = Math.min(3, lines.length);
        let maxWidth = 0;
        for (let index = 0; index < maxLines; index += 1) {
            const text = String(lines[index] ?? '');
            maxWidth = Math.max(maxWidth, ctx.measureText(text).width);
        }
        const width = Math.ceil(maxWidth + (paddingX * 2));
        const height = (paddingY * 2) + (lineHeight * maxLines);
        const r = 10;
        ctx.fillStyle = 'rgba(10, 12, 18, 0.78)';
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(width - r, 0);
        ctx.quadraticCurveTo(width, 0, width, r);
        ctx.lineTo(width, height - r);
        ctx.quadraticCurveTo(width, height, width - r, height);
        ctx.lineTo(r, height);
        ctx.quadraticCurveTo(0, height, 0, height - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        for (let index = 0; index < maxLines; index += 1) {
            const text = String(lines[index] ?? '');
            ctx.fillText(text, paddingX, paddingY + (index * lineHeight));
        }
        ctx.restore();
    }

    function drawCursorHintAtStage(stageX, stageY, radius, lines) {
        const session = getSession();
        if (!session?.cursorCtx || !session?.stageUi) {
            return;
        }
        const dpr = session.stageUi.dpr;
        const ctx = session.cursorCtx;
        const hintX = -Math.max(10, radius + CURSOR_HINT_LEFT_OFFSET);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(stageX, stageY);
        drawCursorHint(ctx, hintX, -14, lines);
        ctx.restore();
    }

    function drawSpacingDragPreview() {
        const session = getSession();
        if (!session?.cursorCtx || !session?.stageUi || !session?.sizeDrag?.active || session.sizeDrag.mode !== 'spacing') {
            return;
        }
        const ctx = session.cursorCtx;
        const dpr = session.stageUi.dpr;
        const centerX = session.stageUi.cssWidth * 0.5;
        const centerY = session.stageUi.cssHeight * 0.5;
        const spacingFactor = resolveToolSpacingFactor(session.tool);
        const radius = clamp((session.tool === TOOL_AIR ? session.size * 3 : session.size) * 0.18, 3, 18);
        const gap = clamp(radius * 0.9 * spacingFactor * 8, 8, 92);
        const count = 5;
        const startX = centerX - (gap * ((count - 1) * 0.5));
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        drawCursorHint(ctx, centerX - 88, centerY - 64, [
            'Brush spacing',
            formatSpacingPercent(spacingFactor)
        ]);
        for (let index = 0; index < count; index += 1) {
            const x = startX + (index * gap);
            const isCenter = index === Math.floor(count / 2);
            ctx.beginPath();
            ctx.fillStyle = isCenter ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.62)';
            ctx.arc(x, centerY + 6, isCenter ? radius * 0.9 : radius * 0.65, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function setCursorBlendMode(mode) {
        if (!dom.paintCursorCanvas) {
            return;
        }
        const normalized = typeof mode === 'string' ? mode.trim() : '';
        dom.paintCursorCanvas.style.mixBlendMode = normalized || '';
    }

    function renderCursorCanvas(options = {}) {
        const session = getSession();
        if (!session?.cursorCtx || !session?.stageUi) {
            return;
        }
        const selectionToolLocked = !!session.select?.toolLocked && session.editMode !== EDIT_MODE_TRANSFORM;
        ensureStageUiSized();
        clearCursorCanvas();
        if (session.crop.active || isColorPopoverOpen()) {
            return;
        }
        if (session.tool !== TOOL_AIR && session.tool !== TOOL_INK && session.tool !== TOOL_PAINT && session.tool !== TOOL_BLUR && session.tool !== TOOL_RECT && session.tool !== TOOL_STAMP) {
            return;
        }
        if (session.editMode !== EDIT_MODE_PAINT || selectionToolLocked) {
            return;
        }
        const stageX = Number(options.stageX ?? session.hover?.stageX);
        const stageY = Number(options.stageY ?? session.hover?.stageY);
        if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) {
            return;
        }
        const inBounds = typeof session.hover?.inBounds === 'boolean' ? session.hover.inBounds : true;
        const sizeBase = session.tool === TOOL_AIR ? session.size * 3 : session.size;
        const radiusImg = clamp(sizeBase / 2, 0.5, MAX_BRUSH_SIZE);
        const radius = radiusImg * session.view.scale;
        const dpr = session.stageUi.dpr;
        const sizeDragActive = !!session.sizeDrag?.active;
        const sizeDragMode = sizeDragActive ? String(session.sizeDrag.mode || 'size') : '';
        const sizeDragLines = sizeDragActive
            ? (sizeDragMode === 'spacing'
                ? [`Spacing ${formatSpacingPercent(resolveToolSpacingFactor(session.tool))}`]
                : [`${Math.round(session.size)}px`])
            : null;
        const ctx = session.cursorCtx;
        const targetAlpha = session.isDrawing ? 0.12 : 1;
        session.cursorAlpha = Number.isFinite(session.cursorAlpha) ? session.cursorAlpha : 1;
        session.cursorAlpha += (targetAlpha - session.cursorAlpha) * (session.isDrawing ? 0.28 : 0.6);
        const alpha = clamp(session.cursorAlpha, 0, 1);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        ctx.translate(stageX, stageY);
        const angle = Number.isFinite(session.cursorAngle) ? session.cursorAngle : 0;
        const tilt = clamp01(Number(session.cursorTilt) || 0);
        if (session.tool === TOOL_RECT) {
            if (session.strokeMode !== STROKE_MODE_BORDER) {
                ctx.restore();
                if (sizeDragLines) {
                    drawCursorHintAtStage(stageX, stageY, radius, sizeDragLines);
                }
                if (sizeDragActive && sizeDragMode === 'spacing') {
                    drawSpacingDragPreview();
                }
                return;
            }
            const size = clamp(session.size * session.view.scale, 2, 120);
            const half = size / 2;
            ctx.fillStyle = inBounds ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)';
            ctx.strokeStyle = inBounds ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 1.2;
            ctx.fillRect(-half, -half, size, size);
            ctx.strokeRect(-half, -half, size, size);
        } else if (session.tool === TOOL_PAINT) {
            const stretch = 1 + (tilt * 0.9);
            const squash = 1 - (tilt * 0.35);
            if (Number.isFinite(angle) && angle) {
                ctx.rotate(angle);
            }
            ctx.scale(stretch, squash);
        }
        if (session.tool === TOOL_RECT) {
            ctx.restore();
            if (sizeDragLines) {
                drawCursorHintAtStage(stageX, stageY, radius, sizeDragLines);
            }
            if (sizeDragActive && sizeDragMode === 'spacing') {
                drawSpacingDragPreview();
            }
            return;
        }
        const eraserMode = !!session.eraserMode;
        const ringColor = eraserMode ? resolvePaintThemeToken('--paint-theme-erase', 'rgba(255, 125, 214, 0.96)') : null;
        if (session.isDrawing) {
            ctx.strokeStyle = eraserMode
                ? (inBounds ? ringColor : resolvePaintThemeToken('--paint-theme-accent-soft', 'rgba(255, 125, 214, 0.55)'))
                : (inBounds ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.55)');
            ctx.lineWidth = 2.0;
            if (!inBounds) {
                ctx.setLineDash([6, 4]);
            }
            if (eraserMode && inBounds) {
                ctx.setLineDash([6, 4]);
            }
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.strokeStyle = eraserMode
                ? (inBounds ? ringColor : resolvePaintThemeToken('--paint-theme-accent-fill-strong', 'rgba(255, 125, 214, 0.75)'))
                : (inBounds ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.85)');
            ctx.lineWidth = 2.0;
            if (!inBounds) {
                ctx.setLineDash([6, 4]);
            }
            if (eraserMode && inBounds) {
                ctx.setLineDash([6, 4]);
            }
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (eraserMode && inBounds) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 2;
            const half = Math.max(6, Math.min(radius * 0.5, 16));
            ctx.beginPath();
            ctx.moveTo(-half, 0);
            ctx.lineTo(half, 0);
            ctx.stroke();
            ctx.restore();
        }
        if (session.strokeMode === STROKE_MODE_BORDER && session.tool !== TOOL_RECT) {
            const borderSize = deps.resolveBorderSize() * session.view.scale;
            const half = borderSize / 2;
            ctx.save();
            ctx.strokeStyle = inBounds ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.4;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(-half, -half, borderSize, borderSize);
            ctx.setLineDash([]);
            ctx.restore();
        }
        const hoverButtons = Number(session.hover?.buttons) || 0;
        const hoverDown = hoverButtons !== 0;
        if (session.tool === TOOL_PAINT && !session.isDrawing && !hoverDown) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 1;
            const half = radius * 0.5;
            ctx.beginPath();
            ctx.moveTo(-half, 0);
            ctx.lineTo(half, 0);
            ctx.stroke();
            ctx.restore();
        }
        ctx.restore();
        if (sizeDragLines) {
            drawCursorHintAtStage(stageX, stageY, radius, sizeDragLines);
        }
        if (sizeDragActive && sizeDragMode === 'spacing') {
            drawSpacingDragPreview();
        }
    }

    function renderStageUi() {
        const session = getSession();
        if (!session?.stageUiCtx || !session?.stageUi) {
            return;
        }
        if (hasAnimatedSelection(session)) {
            queueSelectionAntsFrame();
        }
        ensureStageUiSized();
        clearStageUiCanvas();
        const ctx = session.stageUiCtx;
        const cssWidth = session.stageUi.cssWidth;
        const cssHeight = session.stageUi.cssHeight;
        const dpr = session.stageUi.dpr;
        const antsPhase = ((typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now()) * (1 / 80);
        if (session.canvasBorderVisible !== false) {
            ctx.save();
            applyStageUiImageTransform(ctx);
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = resolvePaintThemeToken('--paint-theme-accent-strong', 'rgba(208, 231, 255, 0.82)');
            ctx.lineWidth = Math.max(1, 2 / Math.max(0.2, session.view.scale));
            ctx.setLineDash([8 / session.view.scale, 6 / session.view.scale]);
            ctx.strokeRect(0, 0, session.width, session.height);
            ctx.setLineDash([]);
            ctx.restore();
        }
        session.symmetryXHandleRect = null;
        session.symmetryYHandleRect = null;
        if (session.mirrorX || session.mirrorY) {
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([8, 6]);
            ctx.strokeStyle = resolvePaintThemeToken('--paint-theme-accent', 'rgba(255, 125, 214, 0.72)');
            const handleSize = 22;
            if (session.mirrorX) {
                const xStage = imageToStage(session.symmetryAxisX, 0).x;
                const handleY = Math.max(28, Math.min(cssHeight - 28 - handleSize, (cssHeight * 0.5) - (handleSize / 2)));
                ctx.beginPath();
                ctx.moveTo(xStage, 0);
                ctx.lineTo(xStage, cssHeight);
                ctx.stroke();
                session.symmetryXHandleRect = { x: xStage - (handleSize / 2), y: handleY, width: handleSize, height: handleSize };
                ctx.fillStyle = resolvePaintThemeToken('--paint-theme-accent', 'rgba(255, 125, 214, 0.94)');
                ctx.beginPath();
                ctx.arc(xStage, handleY + (handleSize / 2), handleSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            if (session.mirrorY) {
                const yStage = imageToStage(0, session.symmetryAxisY).y;
                const handleX = Math.max(28, Math.min(cssWidth - 28 - handleSize, (cssWidth * 0.5) - (handleSize / 2)));
                ctx.beginPath();
                ctx.moveTo(0, yStage);
                ctx.lineTo(cssWidth, yStage);
                ctx.stroke();
                session.symmetryYHandleRect = { x: handleX, y: yStage - (handleSize / 2), width: handleSize, height: handleSize };
                ctx.fillStyle = resolvePaintThemeToken('--paint-theme-accent', 'rgba(255, 125, 214, 0.94)');
                ctx.beginPath();
                ctx.arc(handleX + (handleSize / 2), yStage, handleSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.setLineDash([]);
            ctx.restore();
        }
        if (session.crop.active && session.crop.rect) {
            const rect = session.crop.rect;
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, 0, cssWidth, cssHeight);
            ctx.restore();
            ctx.save();
            applyStageUiImageTransform(ctx);
            ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
            ctx.fillStyle = 'rgba(255,255,255,0.045)';
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            ctx.restore();
            ctx.save();
            applyStageUiImageTransform(ctx);
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = Math.max(1, 2 / Math.max(0.2, session.view.scale));
            ctx.setLineDash([6 / session.view.scale, 4 / session.view.scale]);
            ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
            ctx.setLineDash([]);
            const handleSize = 10 / session.view.scale;
            const corners = [
                { x: rect.x, y: rect.y },
                { x: rect.x + rect.width, y: rect.y },
                { x: rect.x, y: rect.y + rect.height },
                { x: rect.x + rect.width, y: rect.y + rect.height }
            ];
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            for (const corner of corners) {
                ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
            }
            ctx.restore();
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.selection?.bounds) {
            updateTransformPreviewGeometry();
            const bounds = session.selection.bounds;
            const transform = session.transform;
            ctx.save();
            applyStageUiImageTransform(ctx);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = clamp01(transform.opacity ?? 1);
            ctx.translate(transform.centerX + transform.dx, transform.centerY + transform.dy);
            ctx.rotate(transform.rotation);
            ctx.scale(transform.scaleX, transform.scaleY);
            ctx.translate(-transform.centerX, -transform.centerY);
            ctx.drawImage(transform.contentCanvas, bounds.x, bounds.y);
            ctx.restore();
            const corners = transform.previewCorners;
            if (corners && corners.length === 4) {
                const transformPath = new Path2D();
                transformPath.moveTo(corners[0].x, corners[0].y);
                transformPath.lineTo(corners[1].x, corners[1].y);
                transformPath.lineTo(corners[2].x, corners[2].y);
                transformPath.lineTo(corners[3].x, corners[3].y);
                transformPath.closePath();
                ctx.save();
                applyStageUiImageTransform(ctx);
                ctx.globalCompositeOperation = 'source-over';
                drawSelectionAnts(ctx, transformPath, session.view.scale, antsPhase);
                ctx.restore();
            }
            if (transform.handles) {
                ctx.save();
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
                ctx.shadowColor = 'rgba(0,0,0,0.55)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetY = 3;
                const drawHandle = (handle) => {
                    const pos = imageToStage(handle.x, handle.y);
                    ctx.beginPath();
                    ctx.fillStyle = 'rgba(255,125,214,0.98)';
                    ctx.arc(pos.x, pos.y, 6.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.shadowColor = 'transparent';
                    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.shadowColor = 'rgba(0,0,0,0.55)';
                };
                drawHandle(transform.handles.top);
                drawHandle(transform.handles.bottom);
                drawHandle(transform.handles.left);
                drawHandle(transform.handles.right);
                drawHandle(transform.handles.uniform);
                ctx.restore();
            }
        }
        if (session.editMode === EDIT_MODE_SELECT && Array.isArray(session.select?.points) && session.select.points.length > 1 && (session.select.lassoing || session.select.awaitingContinuation)) {
            const selectMode = String(session.select.mode || 'lasso').trim() || 'lasso';
            const path = selectMode === 'rect' ? buildPath2D(session.select.points) : buildOpenPath2D(session.select.points);
            if (path) {
                ctx.save();
                applyStageUiImageTransform(ctx);
                ctx.globalCompositeOperation = 'source-over';
                drawSelectionAnts(ctx, path, session.view.scale, antsPhase);
                ctx.restore();
            }
        }
        if (session.selection?.path) {
            const path = session.transform?.previewOutlinePath || session.selection.outlinePath || session.transform?.previewPath || session.selection.path;
            ctx.save();
            applyStageUiImageTransform(ctx);
            ctx.globalCompositeOperation = 'source-over';
            drawSelectionAnts(ctx, path, session.view.scale, antsPhase);
            ctx.restore();
            if (session.selection?.bounds) {
                const bounds = session.selection.bounds;
                const topRight = imageToStage(bounds.x + bounds.width, bounds.y);
                const buttonSize = 22;
                const pad = 8;
                const buttonX = topRight.x + pad;
                const buttonY = topRight.y - buttonSize - pad;
                const gap = 6;
                const rightX = buttonX;
                session.selectionCancelRect = { x: rightX, y: buttonY, size: buttonSize };
                const showFit = session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && session.transform.source === 'paste';
                session.selectionFitRect = showFit ? { x: rightX - (buttonSize + gap), y: buttonY, size: buttonSize } : null;
                const showApply = !!session.selectionEdit?.dirty;
                const applyOffset = showFit ? (buttonSize + gap) * 2 : (buttonSize + gap);
                session.selectionApplyRect = showApply ? { x: rightX - applyOffset, y: buttonY, size: buttonSize } : null;
                ctx.save();
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
                const drawButtonBase = (rect) => {
                    ctx.fillStyle = 'rgba(24,24,32,0.9)';
                    ctx.strokeStyle = 'rgba(255,125,214,0.95)';
                    ctx.lineWidth = 2;
                    ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
                    ctx.strokeRect(rect.x, rect.y, rect.size, rect.size);
                };
                if (session.selectionApplyRect) {
                    drawButtonBase(session.selectionApplyRect);
                    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                    ctx.lineWidth = 2.2;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(session.selectionApplyRect.x + 6, session.selectionApplyRect.y + 12);
                    ctx.lineTo(session.selectionApplyRect.x + 10, session.selectionApplyRect.y + 16);
                    ctx.lineTo(session.selectionApplyRect.x + 17, session.selectionApplyRect.y + 7);
                    ctx.stroke();
                }
                if (session.selectionFitRect) {
                    drawButtonBase(session.selectionFitRect);
                    ctx.fillStyle = 'rgba(255,255,255,0.9)';
                    ctx.font = '700 12px "Inter", system-ui, -apple-system, Segoe UI, sans-serif';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'center';
                    ctx.fillText('F', session.selectionFitRect.x + (buttonSize / 2), session.selectionFitRect.y + (buttonSize / 2) + 0.5);
                }
                drawButtonBase(session.selectionCancelRect);
                ctx.beginPath();
                ctx.moveTo(buttonX + 6, buttonY + 6);
                ctx.lineTo(buttonX + buttonSize - 6, buttonY + buttonSize - 6);
                ctx.moveTo(buttonX + buttonSize - 6, buttonY + 6);
                ctx.lineTo(buttonX + 6, buttonY + buttonSize - 6);
                ctx.stroke();
                ctx.restore();
            }
        }
        if (isColorPopoverOpen()) {
            return;
        }
        const stageX = Number(session.hover?.stageX);
        const stageY = Number(session.hover?.stageY);
        if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) {
            return;
        }
        const isBrush = session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_STAMP;
        const selectionToolLocked = !!session.select?.toolLocked && session.editMode !== EDIT_MODE_TRANSFORM;
        if (isBrush && session.editMode === EDIT_MODE_PAINT && !selectionToolLocked) {
            return;
        }
        const icon = (session.editMode === EDIT_MODE_SELECT || selectionToolLocked)
            ? (String(session.select?.mode || 'lasso').trim() === 'rect' ? 'R' : 'Q')
            : (session.editMode === EDIT_MODE_TRANSFORM
                ? 'T'
                : (session.tool === TOOL_RECT
                    ? '4'
                    : (session.tool === TOOL_BLUR ? '5' : '')));
        const selectionHint = resolveSelectionHintLabel(session);
        if (!icon) {
            return;
        }
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = 'rgba(255,125,214,0.98)';
        ctx.fillText(icon, stageX - 18, stageY + 12);
        if (selectionHint) {
            ctx.fillStyle = selectionHint === '-' ? 'rgba(0, 178, 255, 0.98)' : 'rgba(255,255,255,0.92)';
            ctx.font = selectionHint.length > 1
                ? '11px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
                : '13px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
            ctx.fillText(selectionHint, stageX - (selectionHint.length > 1 ? 46 : 32), stageY + 12);
        }
        if (session.tool === TOOL_RECT && session.editMode === EDIT_MODE_PAINT && !selectionToolLocked) {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
            ctx.fillText(`${Math.round(session.size)}px`, stageX + 8, stageY + 12);
        }
        ctx.restore();
    }

    return {
        syncOverlayCanvasPresentation,
        drawLayerPreview,
        getLayerPreviewDataUrl,
        refreshLayerPreviewCanvases,
        queueLayerPreviewRefresh,
        renderBlendMenu,
        renderToolMenu,
        updateStageCursor,
        updateHud,
        ensureStageUiSized,
        clearStageShadowCanvas,
        clearStagePatternCanvas,
        rebuildStageShadowSource,
        renderStageShadowCanvas,
        queueStageShadowRefresh,
        drawPatternTileContent,
        renderStagePatternCanvas,
        queueStagePatternRefresh,
        clearStageUiCanvas,
        clearCursorCanvas,
        drawCursorHint,
        drawCursorHintAtStage,
        setCursorBlendMode,
        renderCursorCanvas,
        applyStageUiImageTransform,
        renderStageUi
    };
};
