'use strict';

// MARK: MODULE
module.exports = function createPaintToolsModule(deps) {
    const {
        dom,
        env,
        state,
        utils,
        recentColors,
        BRUSH_BLEND_MODES,
        BRUSH_BLEND_COMPOSITE_MAP,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        DEFAULT_COLOR,
        DEFAULT_BRUSH_SIZE,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        DEFAULT_BORDER_SIZE_RATIO,
        DEFAULT_VIEW_SCALE,
        RECENT_COLORS_MAX,
        PAINT_PREFS_STORAGE_KEY,
        EDIT_MODE_TRANSFORM,
        getSession,
        isPaintEditorWindow,
        clamp,
        normalizeHexColor,
        updateRecentColors,
        renderRecentColorSwatches,
        renderRelatedColorSwatches,
        resolveBorderSize,
        cachePressureForTool,
        cacheToolSettingsForTool,
        applyPressureForTool,
        applyToolSettingsForTool,
        setStampPanelVisible,
        updateHud,
        renderCursorCanvas,
        renderBlendMenu,
        rebuildSelectionFromComponents,
        captureSelectionSnapshot,
        pushUndoAction,
        clearOverlayCanvas,
        renderStageUi,
        floodFillAtImagePoint,
        positionStampEditorInline,
        queueStageShadowRefresh,
        queueStagePatternRefresh
    } = deps;

    const session = new Proxy({}, {
        get(_target, prop) {
            return getSession()?.[prop];
        },
        set(_target, prop, value) {
            const current = getSession();
            if (!current) {
                return false;
            }
            current[prop] = value;
            return true;
        }
    });

function reversePoints(points) {
        const source = Array.isArray(points) ? points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y)) : [];
        if (source.length <= 2) {
            return source.slice().reverse();
        }
        const tail = source.slice(1).reverse();
        return [source[0], ...tail];
    }

function getBrushProfile(tool = session?.tool) {
    if (!session?.brushProfiles || !tool) {
        return null;
    }
    const profile = session.brushProfiles[tool];
    return profile && typeof profile === 'object' ? profile : null;
}

function syncBrushProfileFromSession(tool = session?.tool) {
    const profile = getBrushProfile(tool);
    if (!profile || !session) {
        return;
    }
    profile.size = clamp(Math.round(Number(session.size) || DEFAULT_BRUSH_SIZE), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
    profile.spacing = Number.isFinite(Number(session.toolSpacing?.[tool])) ? Number(session.toolSpacing[tool]) : profile.spacing;
    profile.opacityCap = Number.isFinite(Number(session.opacityCapByTool?.[tool])) ? clamp(Number(session.opacityCapByTool[tool]), 0, 1) : profile.opacityCap;
    profile.pressure = {
        opacity: session.pressureAffectsOpacity !== false,
        size: session.pressureAffectsSize !== false
    };
    if (tool === TOOL_AIR || tool === TOOL_INK || tool === TOOL_PAINT || tool === TOOL_RECT) {
        profile.fillMode = session.strokeMode === 'border' ? 'border' : 'fill';
    }
    if (tool === TOOL_RECT) {
        profile.borderWidth = clamp(Math.round(Number(session.borderSize) || 1), 1, 240);
    }
    if (tool === TOOL_STAMP && session.stampSettings) {
        profile.sourceMode = String(session.stampSettings.sourceMode || profile.sourceMode || 'alpha-mask');
        profile.tipShape = String(session.stampSettings.tipShape || profile.tipShape || 'custom');
        profile.commitOnRelease = session.stampSettings.commitOnRelease !== false;
        profile.varSize = Math.round(Number(session.stampSettings.varSize) || 0);
        profile.varSizeX = Math.round(Number(session.stampSettings.varSizeX) || 0);
        profile.varSizeY = Math.round(Number(session.stampSettings.varSizeY) || 0);
        profile.varRot = Math.round(Number(session.stampSettings.varRot) || 0);
        profile.varColor = Math.round(Number(session.stampSettings.varColor) || 0);
        profile.varHue = Math.round(Number(session.stampSettings.varHue) || 0);
        profile.varVal = Math.round(Number(session.stampSettings.varVal) || 0);
        profile.varSat = Math.round(Number(session.stampSettings.varSat) || 0);
        profile.scatter = Math.round(Number(session.stampSettings.scatter) || 0);
        profile.varAlpha = Math.round(Number(session.stampSettings.varAlpha) || 0);
        profile.flipX = !!session.stampSettings.flipX;
        profile.flipY = !!session.stampSettings.flipY;
        profile.followRotation = session.stampSettings.followRotation !== false;
    }
}

function updateToolSizeFromSession() {
    if (!session?.toolSizes) {
        return;
    }
    session.toolSizes[session.tool] = session.size;
    syncBrushProfileFromSession(session.tool);
}

function applyToolSize(tool) {
    if (!session?.toolSizes) {
        return;
    }
    const nextSize = session.toolSizes[tool];
    if (Number.isFinite(nextSize)) {
        session.size = clamp(nextSize, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
    }
}

function syncBorderSizeToBrush() {
    if (!session) {
        return;
    }
    if (session.tool === TOOL_RECT) {
        const profile = getBrushProfile(TOOL_RECT);
        if (profile) {
            session.borderSize = clamp(Math.round(Number(profile.borderWidth) || 1), 1, 240);
            return;
        }
    }
    session.borderSize = clamp(Math.round((session.size || DEFAULT_BRUSH_SIZE) * DEFAULT_BORDER_SIZE_RATIO), 1, 240);
}

function setActiveTool(tool) {
    if (!session) {
        return;
    }
    syncBrushProfileFromSession(session.tool);
    cachePressureForTool(session.tool);
    cacheToolSettingsForTool(session.tool);
    session.tool = tool;
    applyToolSize(tool);
    syncBorderSizeToBrush();
    applyPressureForTool(tool);
    applyToolSettingsForTool(tool);
    if (tool !== TOOL_STAMP) {
        session.lastNonStampTool = tool;
    }
    if (session.stampPanelOpen) {
        setStampPanelVisible(true);
    }
    updateHud();
    renderCursorCanvas();
}

function setBrushBlendMode(mode) {
    if (!session) {
        return;
    }
    const normalized = String(mode || '').toLowerCase();
    const index = BRUSH_BLEND_MODES.indexOf(normalized);
    session.brushBlendMode = index >= 0 ? normalized : 'normal';
    session.brushBlendIndex = index >= 0 ? index : 0;
    if (session.blendModeByTool && session.tool) {
        session.blendModeByTool[session.tool] = session.brushBlendMode;
    }
    syncBrushProfileFromSession(session.tool);
    applyOverlayBlendMode();
    updateHud();
    renderBlendMenu();
}

function resolveBrushCompositeOperation() {
    const blendMode = BRUSH_BLEND_MODES.includes(session?.brushBlendMode) ? session.brushBlendMode : 'normal';
    return BRUSH_BLEND_COMPOSITE_MAP[blendMode] || 'source-over';
}

function applyOverlayBlendMode() {
    if (!dom.paintOverlayCanvas) {
        return;
    }
    const blendMode = BRUSH_BLEND_MODES.includes(session?.brushBlendMode) ? session.brushBlendMode : 'normal';
    dom.paintOverlayCanvas.style.mixBlendMode = blendMode;
}

function readLocalPaintPrefs() {
    try {
        const raw = window.localStorage.getItem(PAINT_PREFS_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function writeLocalPaintPrefs(prefs) {
    try {
        window.localStorage.setItem(PAINT_PREFS_STORAGE_KEY, JSON.stringify(prefs || {}));
    } catch {}
}

function snapshotPaintPrefs() {
    syncBrushProfileFromSession(session?.tool);
    const sizes = session?.toolSizes && typeof session.toolSizes === 'object' ? { ...session.toolSizes } : null;
    const spacings = session?.toolSpacing && typeof session.toolSpacing === 'object' ? { ...session.toolSpacing } : null;
    const strokeModes = session?.strokeModeByTool && typeof session.strokeModeByTool === 'object' ? { ...session.strokeModeByTool } : null;
    const opacityCaps = session?.opacityCapByTool && typeof session.opacityCapByTool === 'object' ? { ...session.opacityCapByTool } : null;
    const stampSettings = session?.stampSettings && typeof session.stampSettings === 'object' ? { ...session.stampSettings } : null;
    const brushProfiles = session?.brushProfiles && typeof session.brushProfiles === 'object'
        ? JSON.parse(JSON.stringify(session.brushProfiles))
        : null;

    let pressureByTool = null;
    if (session?.pressureByTool && typeof session.pressureByTool === 'object') {
        pressureByTool = {};
        for (const [tool, value] of Object.entries(session.pressureByTool)) {
            if (!value || typeof value !== 'object') {
                continue;
            }
            pressureByTool[tool] = {
                opacity: value.opacity !== false,
                size: value.size !== false
            };
        }
    }

    const tool = typeof session?.tool === 'string' ? session.tool : TOOL_INK;
    const color = normalizeHexColor(session?.color) || DEFAULT_COLOR;
    const storedRecent = recentColors.map((entry) => normalizeHexColor(entry)).filter(Boolean).slice(0, RECENT_COLORS_MAX);
    const borderSize = resolveBorderSize();
    const canvasBorderVisible = session?.canvasBorderVisible !== false;
    const invisibleBackground = session?.invisibleBackground === true;
    const displayScaleMode = session?.displayScaleMode === 'pixelated' || session?.displayScaleMode === 'smooth'
        ? session.displayScaleMode
        : 'auto';
    const mirrorX = !!session?.mirrorX;
    const mirrorY = !!session?.mirrorY;
    const patternMode = !!session?.patternMode;
    const alphaLock = !!session?.alphaLockEnabled;
    const symmetryAxisX = Number.isFinite(Number(session?.symmetryAxisX)) ? Number(session.symmetryAxisX) : null;
    const symmetryAxisY = Number.isFinite(Number(session?.symmetryAxisY)) ? Number(session.symmetryAxisY) : null;

    if (brushProfiles) {
        for (const profile of Object.values(brushProfiles)) {
            if (!profile || typeof profile !== 'object') {
                continue;
            }
            profile.blendMode = 'normal';
        }
    }

    return {
        tool,
        color,
        sizes,
        spacings,
        pressureByTool,
        brushProfiles,
        opacityCaps,
        stampSettings,
        strokeModes,
        borderSize,
        canvasBorderVisible,
        invisibleBackground,
        displayScaleMode,
        mirrorX,
        mirrorY,
        patternMode,
        alphaLock,
        symmetryAxisX,
        symmetryAxisY,
        recentColors: storedRecent
    };
}

function persistPaintPreferences() {
    syncBrushProfileFromSession(session?.tool);
    const prefs = snapshotPaintPrefs();
    if (state.boardData && !isPaintEditorWindow()) {
        if (!state.boardData.settings || typeof state.boardData.settings !== 'object') {
            state.boardData.settings = {};
        }
        state.boardData.settings.paint = prefs;
        env.data?.queueSave?.('settings-paint');
    }
    writeLocalPaintPrefs(prefs);
}

function fillSelectionOrCanvas() {
    if (!session || session.isDrawing || session.crop.active || session.zoomDrag.active || session.pan.active) {
        return;
    }
    if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
        utils.showToast?.('Paint: apply/cancel transform first');
        return;
    }
    const color = session.color || DEFAULT_COLOR;

    const hasSelection = !!session.selection?.path;
    const bounds = hasSelection
        ? (session.selection.inverted ? { x: 0, y: 0, width: session.width, height: session.height } : session.selection.bounds)
        : { x: 0, y: 0, width: session.width, height: session.height };

    const safeBounds = {
        x: clamp(Math.floor(bounds.x), 0, session.width - 1),
        y: clamp(Math.floor(bounds.y), 0, session.height - 1),
        width: clamp(Math.ceil(bounds.width), 1, session.width),
        height: clamp(Math.ceil(bounds.height), 1, session.height)
    };
    const before = session.baseCtx.getImageData(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);

    session.baseCtx.save();
    session.baseCtx.globalCompositeOperation = 'source-over';
    session.baseCtx.fillStyle = color;
    if (hasSelection) {
        session.baseCtx.clip(session.selection.path, session.selection.fillRule || 'nonzero');
    }
    session.baseCtx.fillRect(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
    session.baseCtx.restore();

    const after = session.baseCtx.getImageData(safeBounds.x, safeBounds.y, safeBounds.width, safeBounds.height);
    pushUndoAction({ type: 'pixels', bounds: safeBounds, before, after });
    clearOverlayCanvas();
    renderStageUi();
}

function fillCanvasWithColor() {
    if (!session || session.isDrawing || session.crop.active || session.zoomDrag.active || session.pan.active) {
        return;
    }
    if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
        utils.showToast?.('Paint: apply/cancel transform first');
        return;
    }
    const color = session.color || DEFAULT_COLOR;
    const bounds = { x: 0, y: 0, width: session.width, height: session.height };
    const before = session.baseCtx.getImageData(0, 0, session.width, session.height);

    session.baseCtx.save();
    session.baseCtx.globalCompositeOperation = 'source-over';
    session.baseCtx.fillStyle = color;
    session.baseCtx.fillRect(0, 0, session.width, session.height);
    session.baseCtx.restore();

    const after = session.baseCtx.getImageData(0, 0, session.width, session.height);
    pushUndoAction({ type: 'pixels', bounds, before, after });
    clearOverlayCanvas();
    renderStageUi();
}

function fillAtHoverPoint() {
    if (!session || session.isDrawing || session.crop.active || session.zoomDrag.active || session.pan.active) {
        return;
    }
    const stageX = Number(session.hover?.stageX ?? session.lastStageX);
    const stageY = Number(session.hover?.stageY ?? session.lastStageY);
    if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) {
        return;
    }
    const imgPoint = stageToImage(stageX, stageY);
    if (imgPoint.x < 0 || imgPoint.x > session.width || imgPoint.y < 0 || imgPoint.y > session.height) {
        return;
    }
    floodFillAtImagePoint(imgPoint.x, imgPoint.y);
    renderStageUi();
    renderCursorCanvas({ stageX, stageY });
}

function mirrorCanvasHorizontal() {
    if (!session || session.isDrawing || session.crop.active || session.zoomDrag.active || session.pan.active) {
        return;
    }
    if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
        utils.showToast?.('Paint: apply/cancel transform first');
        return;
    }
    const width = session.width;
    const height = session.height;
    if (width <= 0 || height <= 0) {
        return;
    }

    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const ctx = tmp.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return;
    }
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(session.baseCanvas, 0, 0);
    ctx.restore();

    session.baseCtx.save();
    session.baseCtx.globalCompositeOperation = 'source-over';
    session.baseCtx.clearRect(0, 0, width, height);
    session.baseCtx.drawImage(tmp, 0, 0);
    session.baseCtx.restore();

    if (session.selection?.components) {
        const mirrored = session.selection.components.map((component) => ({
            op: component.op,
            points: reversePoints(component.points.map((point) => ({ x: width - point.x, y: point.y })))
        }));
        rebuildSelectionFromComponents(mirrored, !!session.selection.inverted);
    }

    clearOverlayCanvas();
    renderStageUi();
}

function invertSelection() {
    if (!session || session.isDrawing || session.crop.active) {
        return;
    }
    const before = captureSelectionSnapshot();
    if (!session.selection?.components) {
        const rectPoints = [
            { x: 0, y: 0 },
            { x: session.width, y: 0 },
            { x: session.width, y: session.height },
            { x: 0, y: session.height }
        ];
        rebuildSelectionFromComponents([{ points: rectPoints, op: 'add' }], false);
        pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
        return;
    }
    rebuildSelectionFromComponents(session.selection.components, !session.selection.inverted);
    pushUndoAction({ type: 'selection', before, after: captureSelectionSnapshot() });
}

function setWrapTransform() {
    const current = getSession();
    if (!current?.view) {
        return;
    }
    dom.paintCanvasWrap.style.setProperty('--paint-scale', String(current.view.scale));
    dom.paintCanvasWrap.style.setProperty('--paint-tx', `${current.view.tx}px`);
    dom.paintCanvasWrap.style.setProperty('--paint-ty', `${current.view.ty}px`);
    dom.paintCanvasWrap.style.setProperty('--paint-checker-size', `${20 / Math.max(0.05, Number(current.view.scale) || 1)}px`);
    positionStampEditorInline();
    updateHud();
    queueStageShadowRefresh({ rebuild: false });
    queueStagePatternRefresh();
    renderStageUi();
    renderCursorCanvas();
}

function fitToScreen() {
    const current = getSession();
    if (!current?.view) {
        return;
    }
    const stageRect = dom.paintStage.getBoundingClientRect();
    const fitScale = Math.min(stageRect.width / current.width, stageRect.height / current.height);
    const scale = fitScale * 0.9;
    current.view.scale = clamp(scale, 0.05, 32);
    current.view.tx = Math.round((stageRect.width - (current.width * current.view.scale)) / 2);
    current.view.ty = Math.round((stageRect.height - (current.height * current.view.scale)) / 2);
    setWrapTransform();
}

function setDefaultZoom() {
    const current = getSession();
    if (!current?.view) {
        return;
    }
    const stageRect = dom.paintStage.getBoundingClientRect();
    current.view.scale = clamp(DEFAULT_VIEW_SCALE, 0.05, 32);
    current.view.tx = Math.round((stageRect.width - (current.width * current.view.scale)) / 2);
    current.view.ty = Math.round((stageRect.height - (current.height * current.view.scale)) / 2);
    setWrapTransform();
}

function zoomAtScreenPoint(deltaScale, screenX, screenY) {
    const current = getSession();
    if (!current?.view) {
        return;
    }
    const oldScale = current.view.scale;
    const newScale = clamp(oldScale * deltaScale, 0.05, 32);
    if (newScale === oldScale) {
        return;
    }
    const imgX = (screenX - current.view.tx) / oldScale;
    const imgY = (screenY - current.view.ty) / oldScale;
    current.view.scale = newScale;
    current.view.tx = Math.round(screenX - (imgX * newScale));
    current.view.ty = Math.round(screenY - (imgY * newScale));
    setWrapTransform();
}

function clientToStage(event) {
    const rect = dom.paintStage.getBoundingClientRect();
    const x = Number(event?.clientX) - rect.left;
    const y = Number(event?.clientY) - rect.top;
    return { x, y };
}

function stageToImageRaw(stageX, stageY) {
    const current = getSession();
    if (!current?.view) {
        return { x: 0, y: 0 };
    }
    return {
        x: (stageX - current.view.tx) / current.view.scale,
        y: (stageY - current.view.ty) / current.view.scale
    };
}

function stageToImage(stageX, stageY) {
    const raw = stageToImageRaw(stageX, stageY);
    let x = raw.x;
    let y = raw.y;
    if (session.patternMode) {
        x = ((x % session.width) + session.width) % session.width;
        y = ((y % session.height) + session.height) % session.height;
    }
    return { x, y };
}

function imageToStage(imgX, imgY) {
    const current = getSession();
    if (!current?.view) {
        return { x: 0, y: 0 };
    }
    return {
        x: current.view.tx + (imgX * current.view.scale),
        y: current.view.ty + (imgY * current.view.scale)
    };
}

function getMirroredPoints(x, y) {
    if (!session) {
        return [{ x, y }];
    }
    const points = [{ x, y }];
    const axisX = Number(session.symmetryAxisX);
    const axisY = Number(session.symmetryAxisY);
    const pushUnique = (px, py) => {
        if (!points.some((point) => Math.abs(point.x - px) < 0.001 && Math.abs(point.y - py) < 0.001)) {
            points.push({ x: px, y: py });
        }
    };
    if (session.mirrorX) {
        pushUnique((axisX * 2) - x, y);
    }
    if (session.mirrorY) {
        pushUnique(x, (axisY * 2) - y);
    }
    if (session.mirrorX && session.mirrorY) {
        pushUnique((axisX * 2) - x, (axisY * 2) - y);
    }
    return points;
}

function getPatternWrappedPoints(points, radius = 0) {
    if (!session?.patternMode || !Array.isArray(points) || points.length === 0) {
        return Array.isArray(points) ? points : [];
    }
    const width = Math.max(1, Number(session.width) || 1);
    const height = Math.max(1, Number(session.height) || 1);
    const bleed = Math.max(0, Number(radius) || 0);
    const output = [];
    const seen = new Set();
    for (const point of points) {
        if (!point) {
            continue;
        }
        for (const offsetY of [-height, 0, height]) {
            for (const offsetX of [-width, 0, width]) {
                const px = point.x + offsetX;
                const py = point.y + offsetY;
                if ((px + bleed) < 0 || (px - bleed) > width || (py + bleed) < 0 || (py - bleed) > height) {
                    continue;
                }
                const key = `${Math.round(px * 1000)}:${Math.round(py * 1000)}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                output.push({ x: px, y: py });
            }
        }
    }
    return output;
}

function getMirroredPairs(x0, y0, x1, y1) {
    if (!session) {
        return [{ fromX: x0, fromY: y0, toX: x1, toY: y1 }];
    }
    const pairs = [{ fromX: x0, fromY: y0, toX: x1, toY: y1 }];
    const axisX = Number(session.symmetryAxisX);
    const axisY = Number(session.symmetryAxisY);
    const pushUnique = (fromX, fromY, toX, toY) => {
        if (!pairs.some((entry) =>
            Math.abs(entry.fromX - fromX) < 0.001
            && Math.abs(entry.fromY - fromY) < 0.001
            && Math.abs(entry.toX - toX) < 0.001
            && Math.abs(entry.toY - toY) < 0.001)) {
            pairs.push({ fromX, fromY, toX, toY });
        }
    };
    if (session.mirrorX) {
        pushUnique((axisX * 2) - x0, y0, (axisX * 2) - x1, y1);
    }
    if (session.mirrorY) {
        pushUnique(x0, (axisY * 2) - y0, x1, (axisY * 2) - y1);
    }
    if (session.mirrorX && session.mirrorY) {
        pushUnique((axisX * 2) - x0, (axisY * 2) - y0, (axisX * 2) - x1, (axisY * 2) - y1);
    }
    return pairs;
}

function getPatternWrappedPairs(pairs, radius = 0) {
    if (!session?.patternMode || !Array.isArray(pairs) || pairs.length === 0) {
        return Array.isArray(pairs) ? pairs : [];
    }
    const width = Math.max(1, Number(session.width) || 1);
    const height = Math.max(1, Number(session.height) || 1);
    const bleed = Math.max(0, Number(radius) || 0);
    const output = [];
    const seen = new Set();
    for (const pair of pairs) {
        if (!pair) {
            continue;
        }
        for (const offsetY of [-height, 0, height]) {
            for (const offsetX of [-width, 0, width]) {
                const fromX = pair.fromX + offsetX;
                const fromY = pair.fromY + offsetY;
                const toX = pair.toX + offsetX;
                const toY = pair.toY + offsetY;
                const minX = Math.min(fromX, toX) - bleed;
                const maxX = Math.max(fromX, toX) + bleed;
                const minY = Math.min(fromY, toY) - bleed;
                const maxY = Math.max(fromY, toY) + bleed;
                if (maxX < 0 || minX > width || maxY < 0 || minY > height) {
                    continue;
                }
                const key = [
                    Math.round(fromX * 1000),
                    Math.round(fromY * 1000),
                    Math.round(toX * 1000),
                    Math.round(toY * 1000)
                ].join(':');
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                output.push({ fromX, fromY, toX, toY });
            }
        }
    }
    return output;
}

function unwrapPatternStrokePoint(lastX, lastY, x, y) {
    if (!session?.patternMode || !Number.isFinite(lastX) || !Number.isFinite(lastY)) {
        return { x, y };
    }
    const width = Math.max(1, Number(session.width) || 1);
    const height = Math.max(1, Number(session.height) || 1);
    let nextX = x;
    let nextY = y;
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    if ((nextX - lastX) > halfWidth) {
        nextX -= width;
    } else if ((nextX - lastX) < -halfWidth) {
        nextX += width;
    }
    if ((nextY - lastY) > halfHeight) {
        nextY -= height;
    } else if ((nextY - lastY) < -halfHeight) {
        nextY += height;
    }
    return { x: nextX, y: nextY };
}

    return {
        updateToolSizeFromSession,
        applyToolSize,
        syncBorderSizeToBrush,
        setActiveTool,
        setBrushBlendMode,
        resolveBrushCompositeOperation,
        applyOverlayBlendMode,
        readLocalPaintPrefs,
        writeLocalPaintPrefs,
        snapshotPaintPrefs,
        persistPaintPreferences,
        fillSelectionOrCanvas,
        fillCanvasWithColor,
        fillAtHoverPoint,
        mirrorCanvasHorizontal,
        invertSelection,
        setWrapTransform,
        fitToScreen,
        setDefaultZoom,
        zoomAtScreenPoint,
        clientToStage,
        stageToImageRaw,
        stageToImage,
        imageToStage,
        getMirroredPoints,
        getPatternWrappedPoints,
        getMirroredPairs,
        getPatternWrappedPairs,
        unwrapPatternStrokePoint
    };
};
