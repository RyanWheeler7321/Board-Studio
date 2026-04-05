'use strict';

// MARK: MODULE
module.exports = function createPaintStrokeEngineModule(deps) {
    const {
        paintWorkspaceState,
        DEFAULT_COLOR,
        DEFAULT_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        MIN_ACTIVE_STYLUS_PRESSURE,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_BLUR,
        TOOL_STAMP,
        TOOL_RECT,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        PAINT_CONTEXTMENU_SUPPRESS_MS,
        IGNORE_MOUSE_AFTER_STYLUS_UP_MS,
        ERASER_LIVE_COMMIT_MS,
        STAMP_LIVE_COMMIT_MS,
        STROKE_SMOOTHING,
        PRESSURE_SMOOTHING,
        TILT_SMOOTHING,
        ANGLE_SMOOTHING,
        getSession,
        clamp,
        clamp01,
        normalizeAngleRad,
        lerpAngleRad,
        logPaintTrace,
        appendPaintPerfLog,
        getActiveLayer,
        repairSessionLayerStructureIfNeeded,
        renderLayerBar,
        clearOverlayCanvas,
        updateStageCursor,
        applyToolSize,
        setBrushBlendMode,
        setCursorBlendMode,
        syncOverlayCanvasPresentation,
        resolveOpacityCapForTool,
        computeCommitBounds,
        expandLiveStrokeBeforeSnapshot,
        normalizeBounds,
        syncCurrentFrameStateForTimeline,
        invalidateTimelinePreviewCacheForLayers,
        refreshTimelinePreviewForCurrentFrame,
        scheduleDeferredTimelineStoreSync,
        queueLayerPreviewRefresh,
        pushUndoAction,
        parseHexColor,
        getStampCanvas,
        quantizeStampRadius,
        resolveDabSpacing,
        getPatternWrappedPoints,
        getMirroredPoints,
        getPatternWrappedPairs,
        getMirroredPairs,
        updateActionBounds,
        resolveBrushCompositeOperation,
        createAlphaMaskCanvas,
        extractBorderImageData,
        resolveBorderSize,
        unwrapPatternStrokePoint,
        clientToStage,
        stageToImageRaw,
        queueStagePatternRefresh,
        queueStageShadowRefresh,
        renderStageUi,
        renderCursorCanvas,
        captureStampEntryFromEditor,
        touchStampEntry,
        updateRecentColors,
        renderRecentColorSwatches
    } = deps;

    let session = null;
    let recentColorSwatchRefreshQueued = false;
    let liveStrokeCommitFrameRequest = 0;

    function bindSession() {
        session = getSession();
        return session;
    }

    function shouldRefreshTimelinePreviewImmediately() {
        return paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true || paintWorkspaceState.timelineQuickPreview === true;
    }

    function queueRecentColorSwatchRefresh() {
        if (recentColorSwatchRefreshQueued) {
            return;
        }
        recentColorSwatchRefreshQueued = true;
        window.requestAnimationFrame(() => {
            recentColorSwatchRefreshQueued = false;
            renderRecentColorSwatches();
        });
    }

    function cancelQueuedLiveStrokeCommit() {
        if (!liveStrokeCommitFrameRequest) {
            return;
        }
        window.cancelAnimationFrame(liveStrokeCommitFrameRequest);
        liveStrokeCommitFrameRequest = 0;
    }

    function queueLiveStrokeCommit() {
        if (liveStrokeCommitFrameRequest) {
            return;
        }
        liveStrokeCommitFrameRequest = window.requestAnimationFrame(() => {
            liveStrokeCommitFrameRequest = 0;
            if (!session?.liveStrokeCommit?.active) {
                return;
            }
            commitLiveStrokeNow();
            const bounds = session?.currentBounds;
            if (!session?.liveStrokeCommit?.active || !bounds) {
                return;
            }
            if (Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY)) {
                queueLiveStrokeCommit();
            }
        });
    }

    function resolvePressure(event) {
        bindSession();
        const pointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
        const buttons = Number(event?.buttons) || 0;
        const pressure = Number(event?.pressure);
        const legacyPressure = Number(event?.mozPressure ?? event?.force ?? event?.webkitForce);
        const stylusLike = isStylusLikeEvent(event);
        const cachedPressure = session?.lastPen?.pressure;
        const hasCachedPressure = Number.isFinite(cachedPressure) && cachedPressure > 0;
        if (Number.isFinite(pressure)) {
            const normalized = clamp(pressure, 0, 1);
            const looksLikeMouseDefault = pointerType === 'mouse' && Math.abs(normalized - 0.5) < 0.000001;
            if (looksLikeMouseDefault && hasCachedPressure && buttons) {
                return clamp(cachedPressure, 0, 1);
            }
            if (!looksLikeMouseDefault || !stylusLike) {
                if (normalized > 0 || buttons) {
                    if (normalized === 0 && buttons && (pointerType === 'pen' || stylusLike)) {
                        if (hasCachedPressure) {
                            return clamp(cachedPressure, 0, 1);
                        }
                        return MIN_ACTIVE_STYLUS_PRESSURE;
                    }
                    return normalized;
                }
            }
        }
        if (Number.isFinite(legacyPressure)) {
            const normalized = clamp(legacyPressure, 0, 1);
            if (normalized > 0 || buttons) {
                return normalized;
            }
        }
        if (buttons && hasCachedPressure) {
            return clamp(cachedPressure, 0, 1);
        }
        const width = Number(event?.width);
        const height = Number(event?.height);
        if (buttons && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            const contact = Math.max(width, height);
            const proxy = clamp((contact - 1) / 12, 0, 1);
            if (proxy > 0) {
                return proxy;
            }
        }
        if (buttons) {
            const tiltProxy = resolveTiltMagnitude(event);
            if (tiltProxy > 0.01) {
                return clamp(0.15 + (tiltProxy * 0.85), 0, 1);
            }
            return 0.5;
        }
        return 0;
    }

    function ensureSelectionEditInitialized() {
        if (!session?.selection?.bounds || !session.selection.maskCanvas || !session.selection.path || session.selection.inverted) {
            return false;
        }
        if (session.selectionEdit) {
            return true;
        }
        const bounds = session.selection.bounds;
        const canvas = document.createElement('canvas');
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return false;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(session.baseCanvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(session.selection.maskCanvas, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        session.selectionEdit = { canvas, ctx, bounds: { ...bounds }, dirty: false };
        deps.clearSelectionCanvas();
        if (session.selectionCtx) {
            session.selectionCtx.drawImage(canvas, bounds.x, bounds.y);
        }
        queueLayerPreviewRefresh();
        return true;
    }

    function refreshSelectionEditPreview() {
        if (!session?.selectionCtx || !session?.selectionEdit) {
            return;
        }
        const bounds = session.selectionEdit.bounds;
        deps.clearSelectionCanvas();
        session.selectionCtx.drawImage(session.selectionEdit.canvas, bounds.x, bounds.y);
        queueLayerPreviewRefresh();
    }

    function resolveBrushAngle(event) {
        const azimuth = Number(event?.azimuthAngle);
        if (Number.isFinite(azimuth)) {
            return normalizeAngleRad(azimuth);
        }
        const tiltX = Number(event?.tiltX);
        const tiltY = Number(event?.tiltY);
        if (Number.isFinite(tiltX) && Number.isFinite(tiltY)) {
            const tiltMag = Math.hypot(tiltX, tiltY) / 90;
            if (tiltMag > 0.08) {
                return normalizeAngleRad(Math.atan2(tiltY, tiltX));
            }
        }
        const twist = Number(event?.twist);
        if (Number.isFinite(twist) && twist) {
            return normalizeAngleRad((twist * Math.PI) / 180);
        }
        return 0;
    }

    function resolveTiltMagnitude(event) {
        const tiltX = Number(event?.tiltX);
        const tiltY = Number(event?.tiltY);
        if (!Number.isFinite(tiltX) || !Number.isFinite(tiltY)) {
            const cached = session?.lastPen?.tiltMag;
            if (Number.isFinite(cached)) {
                return clamp(cached, 0, 1);
            }
            return 0;
        }
        const magnitude = Math.hypot(tiltX, tiltY) / 90;
        return clamp(magnitude, 0, 1);
    }

    function isStylusLikeEvent(event) {
        if (!event) {
            return false;
        }
        const pointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
        if (pointerType === 'pen') {
            return true;
        }
        const tiltX = Number(event.tiltX);
        const tiltY = Number(event.tiltY);
        if (Number.isFinite(tiltX) && Number.isFinite(tiltY) && (tiltX || tiltY)) {
            return true;
        }
        const altitude = Number(event.altitudeAngle);
        if (Number.isFinite(altitude) && altitude > 0.01) {
            return true;
        }
        const twist = Number(event.twist);
        if (Number.isFinite(twist) && twist) {
            return true;
        }
        const width = Number(event.width);
        const height = Number(event.height);
        const buttons = Number(event.buttons) || 0;
        if (buttons && Number.isFinite(width) && Number.isFinite(height) && (width > 1.05 || height > 1.05)) {
            return true;
        }
        return false;
    }

    function resolvePenAngleWithFallback(event) {
        const pointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
        const stylusLike = isStylusLikeEvent(event);
        const angle = resolveBrushAngle(event);
        const azimuth = Number(event?.azimuthAngle);
        const twist = Number(event?.twist);
        const tiltX = Number(event?.tiltX);
        const tiltY = Number(event?.tiltY);
        const tiltMag = (Number.isFinite(tiltX) && Number.isFinite(tiltY)) ? (Math.hypot(tiltX, tiltY) / 90) : 0;
        const hasOrientation = Number.isFinite(azimuth) || (Number.isFinite(twist) && twist) || tiltMag > 0.08;
        const cached = session?.lastPen?.angle;
        if (pointerType === 'pen' || stylusLike) {
            if (hasOrientation) {
                return angle;
            }
            if (Number.isFinite(cached)) {
                return normalizeAngleRad(cached);
            }
            return angle;
        }
        if (!hasOrientation && Number.isFinite(cached)) {
            return normalizeAngleRad(cached);
        }
        return angle;
    }

    function getBrushProfile(tool = session?.tool) {
        if (!session?.brushProfiles || !tool) {
            return null;
        }
        const profile = session.brushProfiles[tool];
        return profile && typeof profile === 'object' ? profile : null;
    }

    function traceShapePath(ctx, primitive, left, top, width, height, cornerRadius = 0) {
        const safeLeft = Number(left) || 0;
        const safeTop = Number(top) || 0;
        const safeWidth = Math.max(1, Number(width) || 1);
        const safeHeight = Math.max(1, Number(height) || 1);
        if (primitive === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(safeLeft + (safeWidth * 0.5), safeTop + (safeHeight * 0.5), safeWidth * 0.5, safeHeight * 0.5, 0, 0, Math.PI * 2);
            return;
        }
        const radius = clamp(Math.round(Number(cornerRadius) || 0), 0, Math.floor(Math.min(safeWidth, safeHeight) * 0.5));
        ctx.beginPath();
        if (radius > 0 && typeof ctx.roundRect === 'function') {
            ctx.roundRect(safeLeft, safeTop, safeWidth, safeHeight, radius);
            return;
        }
        ctx.rect(safeLeft, safeTop, safeWidth, safeHeight);
    }

    function resolveBrushRadius(tool, pressure) {
        const sizeBase = (session?.size || DEFAULT_BRUSH_SIZE) * (tool === TOOL_AIR ? 3 : 1);
        if (session?.pressureAffectsSize === false) {
            return clamp(sizeBase / 2, 0, MAX_BRUSH_SIZE);
        }
        const p = clamp01(pressure);
        const pressureScale = tool === TOOL_INK ? (p * 1.25) : (tool === TOOL_AIR ? (p * 1.0) : (p * 1.15));
        return clamp((sizeBase * pressureScale) / 2, 0, MAX_BRUSH_SIZE);
    }

    function resolveBaseAlpha(tool, pressure) {
        if (session?.eraserMode) {
            return 1;
        }
        const profile = getBrushProfile(tool);
        const basePressure = session.pressureAffectsOpacity === false ? 1 : clamp01(pressure);
        const pressureAlpha = tool === TOOL_AIR ? Math.pow(basePressure, 0.9) : Math.pow(basePressure, 1.2);
        const minAlpha = 0;
        const maxAlpha = tool === TOOL_AIR ? 1 : ((tool === TOOL_PAINT || tool === TOOL_BLUR) ? 0.8 : 1);
        const raw = clamp(minAlpha + (pressureAlpha * (maxAlpha - minAlpha)), minAlpha, maxAlpha);
        const cap = resolveOpacityCapForTool(tool);
        const flow = (tool === TOOL_AIR || tool === TOOL_PAINT) ? clamp(Number(profile?.flow) || 1, 0.01, 1) : 1;
        return clamp(raw * cap * flow, 0, 1);
    }

    function resolveSpacingAdjustedAlpha(tool, baseAlpha, spacing, radius) {
        if (!Number.isFinite(baseAlpha) || baseAlpha <= 0) {
            return 0;
        }
        if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(radius) || radius <= 0) {
            return baseAlpha;
        }
        const densityRef = tool === TOOL_AIR
            ? (radius * 1.25)
            : (tool === TOOL_PAINT
                ? (radius * 1.1)
                : (tool === TOOL_BLUR ? (radius * 0.85) : (radius * 0.7)));
        const spacingRatio = clamp(spacing / Math.max(0.001, densityRef), 0.02, 1);
        const adjusted = 1 - Math.pow(1 - clamp01(baseAlpha), spacingRatio);
        return clamp(adjusted, 0, 1);
    }

    function ensureBlurSurface(size) {
        if (!session) {
            return null;
        }
        if (!session.blurCanvas) {
            session.blurCanvas = document.createElement('canvas');
        }
        const canvas = session.blurCanvas;
        const target = Math.max(2, Math.round(size));
        if (canvas.width !== target || canvas.height !== target) {
            canvas.width = target;
            canvas.height = target;
        }
        if (!session.blurCtx) {
            session.blurCtx = canvas.getContext('2d', { willReadFrequently: false });
        }
        if (!session.blurCtx) {
            return null;
        }
        return { canvas, ctx: session.blurCtx };
    }

    function drawBlurDab(x, y, radius, alpha) {
        if (!session || !session.baseCanvas || !session.overlayCtx) {
            return;
        }
        const profile = getBrushProfile(TOOL_BLUR);
        const blurRadius = clamp(Number(profile?.blurRadius) || Math.max(1, radius * 0.6), 1, 120);
        const strength = clamp(alpha * clamp(Number(profile?.blurStrength) || 0.7, 0.01, 1), 0, 1);
        if (strength <= 0) {
            return;
        }
        const domainRadius = Math.max(1, radius);
        const sampleRadius = Math.max(domainRadius + 2, domainRadius + (blurRadius * 1.6));
        const size = Math.ceil(sampleRadius * 2);
        const surface = ensureBlurSurface(size);
        if (!surface) {
            return;
        }
        const { canvas, ctx } = surface;
        const sx = Math.floor(x - sampleRadius);
        const sy = Math.floor(y - sampleRadius);
        const sw = size;
        const sh = size;
        ctx.save();
        ctx.clearRect(0, 0, size, size);
        ctx.filter = `blur(${blurRadius}px)`;
        ctx.drawImage(session.baseCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        if (session.overlayCanvas) {
            ctx.drawImage(session.overlayCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        }
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'destination-in';
        const grad = ctx.createRadialGradient(sampleRadius, sampleRadius, 0, sampleRadius, sampleRadius, domainRadius);
        grad.addColorStop(0, `rgba(0,0,0,${strength})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        ctx.restore();
        session.overlayCtx.save();
        session.overlayCtx.globalCompositeOperation = 'source-over';
        session.overlayCtx.drawImage(canvas, sx, sy);
        session.overlayCtx.restore();
        updateActionBounds(session.currentBounds, x, y, Math.max(domainRadius, blurRadius));
    }

    function randSigned() {
        return (Math.random() * 2) - 1;
    }

    function resolvePaintStampAlpha(alpha) {
        const base = clamp(alpha, 0, 1);
        if (base <= 0 || session?.eraserMode) {
            return base;
        }
        return clamp(base * (0.9 + (Math.random() * 0.1)), 0, 1);
    }

    function drawUserStampDab(x, y, angle, tiltMagnitude, radius, alpha) {
        if (!session?.overlayCtx || !session?.stampSettings) {
            return;
        }
        const settings = session.stampSettings;
        const tipShape = String(settings.tipShape || 'custom');
        const proceduralRadius = quantizeStampRadius(radius);
        const stampCanvas = tipShape === 'custom'
            ? session?.stamp?.editorCanvas
            : getStampCanvas(TOOL_STAMP, proceduralRadius, session.color);
        if (!stampCanvas) {
            return;
        }
        const width = stampCanvas.width || 1;
        const height = stampCanvas.height || 1;
        const baseScale = tipShape === 'custom'
            ? (radius * 2) / Math.max(1, Math.max(width, height))
            : (radius / Math.max(0.001, proceduralRadius));
        if (!Number.isFinite(baseScale) || baseScale <= 0.00001) {
            return;
        }
        const jitterMain = clamp(Number(settings.varSize) || 0, 0, 100) / 100;
        const jitterX = clamp(Number(settings.varSizeX) || 0, 0, 100) / 100;
        const jitterY = clamp(Number(settings.varSizeY) || 0, 0, 100) / 100;
        const rotDeg = clamp(Number(settings.varRot) || 0, 0, 180);
        const colorVar = clamp(Number(settings.varColor) || 0, 0, 100) / 100;
        const hueVar = clamp(Number(settings.varHue) || 0, 0, 180);
        const valVar = clamp(Number(settings.varVal) || 0, 0, 100) / 100;
        const satVar = clamp(Number(settings.varSat) || 0, 0, 100) / 100;
        const scatter = clamp(Number(settings.scatter) || 0, 0, 100) / 100;
        const alphaVar = clamp(Number(settings.varAlpha) || 0, 0, 100) / 100;
        const mainScale = 1 + (randSigned() * jitterMain);
        let scaleX = baseScale * mainScale * (1 + (randSigned() * jitterX));
        let scaleY = baseScale * mainScale * (1 + (randSigned() * jitterY));
        const follow = settings.followRotation !== false;
        const safeAngle = Number.isFinite(angle) ? angle : 0;
        const rotation = (follow ? safeAngle : 0) + ((rotDeg * Math.PI / 180) * randSigned());
        let cx = x;
        let cy = y;
        if (scatter > 0.0001) {
            const scatterPx = scatter * radius * 1.8;
            cx += randSigned() * scatterPx;
            cy += randSigned() * scatterPx;
        }
        let effectiveAlpha = clamp(alpha, 0, 1);
        if (alphaVar > 0.0001) {
            effectiveAlpha = clamp(effectiveAlpha * (1 + (randSigned() * alphaVar)), 0, 1);
        }
        if (settings.flipX && Math.random() < 0.5) {
            scaleX *= -1;
        }
        if (settings.flipY && Math.random() < 0.5) {
            scaleY *= -1;
        }
        const ctx = session.overlayCtx;
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = effectiveAlpha;
        ctx.translate(cx, cy);
        if (rotation) {
            ctx.rotate(rotation);
        }
        ctx.scale(scaleX, scaleY);
        if (hueVar > 0.0001 || valVar > 0.0001 || satVar > 0.0001) {
            const hue = randSigned() * hueVar;
            const bright = clamp(1 + (randSigned() * valVar), 0.15, 3);
            const sat = clamp(1 + (randSigned() * satVar), 0, 3);
            ctx.filter = `hue-rotate(${hue}deg) brightness(${bright}) saturate(${sat})`;
        }
        ctx.drawImage(stampCanvas, -(width / 2), -(height / 2));
        if (tipShape === 'custom' && settings.sourceMode !== 'preserve-color' && !session.eraserMode) {
            ctx.globalCompositeOperation = 'source-in';
            ctx.globalAlpha = 1;
            ctx.fillStyle = session.color || DEFAULT_COLOR;
            ctx.fillRect(-(width / 2), -(height / 2), width, height);
        }
        if (settings.sourceMode === 'preserve-color' && colorVar > 0.0001) {
            const rgb = parseHexColor(session.color) || { r: 255, g: 255, b: 255 };
            const strength = clamp01(colorVar * (0.2 + (Math.random() * 0.8)));
            const tintR = clamp(Math.round(255 + ((rgb.r - 255) * strength)), 0, 255);
            const tintG = clamp(Math.round(255 + ((rgb.g - 255) * strength)), 0, 255);
            const tintB = clamp(Math.round(255 + ((rgb.b - 255) * strength)), 0, 255);
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = effectiveAlpha;
            ctx.fillStyle = `rgb(${tintR}, ${tintG}, ${tintB})`;
            ctx.fillRect(-(width / 2), -(height / 2), width, height);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.globalAlpha = 1;
            ctx.drawImage(stampCanvas, -(width / 2), -(height / 2));
        }
        ctx.restore();
        const halfW = Math.abs(scaleX) * (width / 2);
        const halfH = Math.abs(scaleY) * (height / 2);
        const boundsRadius = Math.hypot(halfW, halfH);
        updateActionBounds(session.currentBounds, cx, cy, boundsRadius);
    }

    function drawDabWithParams(tool, x, y, angle, tiltMagnitude, radius, alpha) {
        if (!session || radius <= 0.001) {
            return;
        }
        const stampRadius = quantizeStampRadius(radius);
        if (stampRadius <= 0.001) {
            return;
        }
        const scale = radius / stampRadius;
        if (!Number.isFinite(scale) || scale <= 0.0001 || !Number.isFinite(alpha) || alpha <= 0) {
            return;
        }
        const effectiveAlpha = clamp(alpha, 0, 1);
        if (!Number.isFinite(effectiveAlpha) || effectiveAlpha <= 0) {
            return;
        }
        const dabAlpha = tool === TOOL_PAINT ? resolvePaintStampAlpha(effectiveAlpha) : effectiveAlpha;
        const safeAngle = Number.isFinite(angle) ? angle : 0;
        const tilt = clamp01(Number(tiltMagnitude) || 0);
        const points = getPatternWrappedPoints(getMirroredPoints(x, y), radius);
        for (const point of points) {
            if (tool === TOOL_BLUR) {
                drawBlurDab(point.x, point.y, radius, alpha);
                continue;
            }
            if (tool === TOOL_STAMP) {
                drawUserStampDab(point.x, point.y, safeAngle, tilt, radius, effectiveAlpha);
                continue;
            }
            const stamp = getStampCanvas(tool, stampRadius, session.color);
            if (!stamp) {
                continue;
            }
            const ctx = session.overlayCtx;
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = dabAlpha;
            const stretch = 1 + (tilt * 0.9);
            const squash = 1 - (tilt * 0.35);
            ctx.translate(point.x, point.y);
            if (tool === TOOL_PAINT) {
                if (safeAngle) {
                    ctx.rotate(safeAngle);
                }
                if (tilt && getBrushProfile(TOOL_PAINT)?.tiltStretch !== false) {
                    ctx.scale(stretch, squash);
                }
            }
            if (scale !== 1) {
                ctx.scale(scale, scale);
            }
            ctx.drawImage(stamp, -(stamp.width / 2), -(stamp.height / 2));
            ctx.restore();
            updateActionBounds(session.currentBounds, point.x, point.y, radius);
        }
        if (tool === TOOL_STAMP && session?.stampLive && session.currentBounds) {
            const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
            if (!Number.isFinite(session.stampLive.lastCommitAt) || (now - session.stampLive.lastCommitAt) >= STAMP_LIVE_COMMIT_MS) {
                session.stampLive.lastCommitAt = now;
                session.stampLive.dirty = true;
                commitOverlayToBase(session.currentBounds, { skipUndo: true });
                session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            }
        }
        if (session.patternMode) {
            queueStagePatternRefresh();
        }
    }

    function resolveStrokePressure(pressureFrom, pressureTo) {
        const p0 = Number(pressureFrom);
        const p1 = Number(pressureTo);
        if (Number.isFinite(p0) && Number.isFinite(p1)) {
            return (p0 + p1) / 2;
        }
        if (Number.isFinite(p1)) {
            return p1;
        }
        if (Number.isFinite(p0)) {
            return p0;
        }
        return 1;
    }

    function drawInkDot(x, y, pressure) {
        if (!session) {
            return;
        }
        const p = resolveStrokePressure(pressure, pressure);
        const radius = resolveBrushRadius(TOOL_INK, p);
        const baseAlpha = resolveBaseAlpha(TOOL_INK, p);
        const spacing = resolveDabSpacing(TOOL_INK, radius, { min: 0.35 });
        const alpha = resolveSpacingAdjustedAlpha(TOOL_INK, baseAlpha, spacing, radius);
        if (!Number.isFinite(alpha) || alpha <= 0 || radius <= 0.001) {
            return;
        }
        drawDabWithParams(TOOL_INK, x, y, 0, 0, radius, alpha);
    }

    function drawInkStrokeSegment(fromX, fromY, toX, toY, pressureFrom, pressureTo) {
        if (!session) {
            return;
        }
        drawStrokeSegment(TOOL_INK, fromX, fromY, toX, toY, pressureFrom, pressureTo, 0, 0);
    }

    function drawStrokeSegment(tool, fromX, fromY, toX, toY, pressureFrom, pressureTo, angle, tiltMagnitude) {
        if (!session) {
            return;
        }
        const dx = toX - fromX;
        const dy = toY - fromY;
        const distance = Math.hypot(dx, dy);
        const radiusFrom = resolveBrushRadius(tool, pressureFrom);
        const radiusTo = resolveBrushRadius(tool, pressureTo);
        const radiusRef = Math.max(radiusFrom, radiusTo);
        const alphaTo = resolveBaseAlpha(tool, pressureTo);
        const spacing = resolveDabSpacing(tool, radiusRef, { min: 0.35 });
        if (!Number.isFinite(distance) || distance <= 0) {
            const alpha = resolveSpacingAdjustedAlpha(tool, alphaTo, spacing, radiusTo);
            drawDabWithParams(tool, toX, toY, angle, tiltMagnitude, radiusTo, alpha);
            if (session.stroke) {
                session.stroke.carry = 0;
            }
            return;
        }
        const carryDistance = clamp(Number.isFinite(session.stroke?.carry) ? session.stroke.carry : 0, 0, spacing);
        const totalDistance = distance + carryDistance;
        const steps = Math.floor(totalDistance / spacing);
        if (steps <= 0) {
            if (session.stroke) {
                session.stroke.carry = totalDistance;
            }
            return;
        }
        for (let index = 1; index <= steps; index += 1) {
            const distAlong = (index * spacing) - carryDistance;
            const t = distAlong / distance;
            const x = fromX + (dx * t);
            const y = fromY + (dy * t);
            const pressure = pressureFrom + ((pressureTo - pressureFrom) * t);
            const radius = resolveBrushRadius(tool, pressure);
            const baseAlpha = resolveBaseAlpha(tool, pressure);
            const alpha = resolveSpacingAdjustedAlpha(tool, baseAlpha, spacing, radius);
            drawDabWithParams(tool, x, y, angle, tiltMagnitude, radius, alpha);
        }
        if (session.stroke) {
            session.stroke.carry = totalDistance - (steps * spacing);
        }
    }

    function updateRectPreview(x, y) {
        if (!session || !session.rect) {
            return;
        }
        session.rect.x1 = x;
        session.rect.y1 = y;
        const x0 = session.rect.x0;
        const y0 = session.rect.y0;
        const profile = getBrushProfile(TOOL_RECT);
        const primitive = String(profile?.primitive || 'rect');
        const cornerRadius = clamp(Math.round(Number(profile?.cornerRadius) || 0), 0, 128);
        const left = Math.min(x0, x);
        const top = Math.min(y0, y);
        const right = Math.max(x0, x);
        const bottom = Math.max(y0, y);
        const width = Math.max(1, Math.round(right - left));
        const height = Math.max(1, Math.round(bottom - top));
        const lineWidth = session.strokeMode === STROKE_MODE_BORDER ? clamp(Math.round(Number(profile?.borderWidth) || session.borderSize || session.size), 1, 240) : 0;
        const pad = (lineWidth ? lineWidth : 0) + 2;
        clearOverlayCanvas();
        session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const pair of getMirroredPairs(x0, y0, x, y)) {
            const pairLeft = Math.min(pair.fromX, pair.toX);
            const pairTop = Math.min(pair.fromY, pair.toY);
            const pairRight = Math.max(pair.fromX, pair.toX);
            const pairBottom = Math.max(pair.fromY, pair.toY);
            const pairWidth = Math.max(1, Math.round(pairRight - pairLeft));
            const pairHeight = Math.max(1, Math.round(pairBottom - pairTop));
            session.overlayCtx.save();
            session.overlayCtx.globalCompositeOperation = 'source-over';
            session.overlayCtx.globalAlpha = 1;
            traceShapePath(session.overlayCtx, primitive, pairLeft, pairTop, pairWidth, pairHeight, cornerRadius);
            if (session.strokeMode === STROKE_MODE_BORDER) {
                session.overlayCtx.strokeStyle = session.color;
                session.overlayCtx.lineWidth = lineWidth;
                session.overlayCtx.lineJoin = 'miter';
                session.overlayCtx.stroke();
            } else {
                session.overlayCtx.fillStyle = session.color;
                session.overlayCtx.fill();
            }
            session.overlayCtx.restore();
            updateActionBounds(session.currentBounds, pairLeft, pairTop, pad);
            updateActionBounds(session.currentBounds, pairRight, pairBottom, pad);
        }
        if (session.patternMode) {
            queueStagePatternRefresh();
        }
    }

    function beginStroke(event) {
        if (!bindSession() || !session || session.crop.active) {
            return;
        }
        if (session.select?.toolLocked) {
            session.editMode = EDIT_MODE_SELECT;
            logPaintTrace('beginStroke.blockedSelectionTool', {
                tool: session.tool,
                mode: String(session.select.mode || 'lasso'),
                pointerType: typeof event?.pointerType === 'string' ? event.pointerType : '',
                pointerButton: Number.isFinite(Number(event?.button)) ? Number(event.button) : -1
            });
            updateStageCursor();
            renderStageUi();
            renderCursorCanvas();
            return;
        }
        cancelQueuedLiveStrokeCommit();
        repairSessionLayerStructureIfNeeded('before-stroke', { skipUi: true });
        if (paintWorkspaceState.expandedTimelineVisible === true) {
            paintWorkspaceState.expandedTimelineVisible = false;
            paintWorkspaceState.timelineExpanded = false;
            paintWorkspaceState.drawerOpen = false;
            logPaintTrace('beginStroke.timelineCollapsed', { reason: 'paint-action' });
            renderLayerBar();
        }
        const activeLayer = getActiveLayer();
        logPaintTrace('beginStroke', {
            tool: session.tool,
            eraserMode: !!session.eraserMode,
            color: session.color || DEFAULT_COLOR,
            blendMode: session.brushBlendMode || 'normal',
            opacityCap: resolveOpacityCapForTool(session.tool),
            activeLayerId: activeLayer?.id || '',
            activeLayerName: activeLayer?.name || '',
            pressureAffectsOpacity: session.pressureAffectsOpacity !== false,
            pressureAffectsSize: session.pressureAffectsSize !== false,
            pointerType: typeof event?.pointerType === 'string' ? event.pointerType : '',
            pointerButton: Number.isFinite(Number(event?.button)) ? Number(event.button) : -1
        });
        clearOverlayCanvas();
        session.isDrawing = true;
        session.strokePointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
        session.strokeWasStylusLike = isStylusLikeEvent(event);
        applyToolSize(session.tool);
        setBrushBlendMode(session.brushBlendMode);
        updateStageCursor();
        session.pointerId = event.pointerId;
        session.cursorAlpha = 1;
        if (session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_STAMP) {
            setCursorBlendMode('normal');
        }
        session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        syncOverlayCanvasPresentation('begin-stroke');
        session.strokeClipActive = false;
        if (session.selection?.path && session.editMode === EDIT_MODE_PAINT) {
            session.strokeClipActive = true;
            session.overlayCtx.save();
            session.overlayCtx.clip(session.selection.path, session.selection.fillRule || 'nonzero');
        }
        session.stroke = {
            lastX: null,
            lastY: null,
            lastPressure: null,
            smoothX: null,
            smoothY: null,
            smoothAngle: 0,
            smoothPressure: null,
            smoothTilt: null,
            anchorX: null,
            anchorY: null,
            wasOutside: false,
            carry: 0
        };
        const selectionEditActive = false;
        const supportsLiveStrokeCommit = session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_BLUR || session.tool === TOOL_STAMP;
        const pointerType = session.strokePointerType;
        const mousePaintCommit = !selectionEditActive
            && !session.eraserMode
            && supportsLiveStrokeCommit
            && !session.strokeWasStylusLike
            && (pointerType === 'mouse' || !pointerType);
        if ((session.eraserMode && supportsLiveStrokeCommit) || mousePaintCommit) {
            session.liveStrokeCommit = {
                active: true,
                mode: selectionEditActive ? 'selection' : 'base',
                dirty: false,
                before: null,
                bounds: null,
                lastCommitAt: 0,
                strategy: mousePaintCommit ? 'mouse-initial' : 'continuous',
                committedOnce: false
            };
        } else {
            session.liveStrokeCommit = null;
        }
        if (!selectionEditActive && !session.eraserMode && session.tool === TOOL_STAMP && session.stampSettings?.commitOnRelease === false) {
            session.stampLive = {
                dirty: false,
                lastCommitAt: 0,
                before: session.baseCtx.getImageData(0, 0, session.width, session.height)
            };
        } else {
            session.stampLive = null;
        }
    }

    function commitLiveStrokeNow() {
        if (!session?.liveStrokeCommit?.active) {
            return;
        }
        const now = Date.now();
        const minDelayMs = session.eraserMode ? ERASER_LIVE_COMMIT_MS : 0;
        if (Number.isFinite(session.liveStrokeCommit.lastCommitAt) && (now - session.liveStrokeCommit.lastCommitAt) < minDelayMs) {
            if (session.eraserMode) {
                queueLiveStrokeCommit();
            }
            return;
        }
        const startedAt = Date.now();
        const normalized = normalizeBounds(session.currentBounds);
        if (!normalized) {
            return;
        }
        logPaintTrace('paint.liveStroke.commit', {
            eraserMode: !!session.eraserMode,
            mode: session.liveStrokeCommit.mode || '',
            minDelayMs,
            normalized
        });
        const borderOnly = session.strokeMode === STROKE_MODE_BORDER && session.tool !== TOOL_RECT;
        if (session.liveStrokeCommit.mode === 'base') {
            expandLiveStrokeBeforeSnapshot(computeCommitBounds(session.currentBounds));
        }
        commitOverlayToBase(session.currentBounds, {
            borderOnly,
            skipUndo: true,
            capturePatch: false,
            timelineRefreshMode: 'cache-only'
        });
        session.liveStrokeCommit.dirty = true;
        session.liveStrokeCommit.lastCommitAt = now;
        session.liveStrokeCommit.committedOnce = true;
        session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        appendPaintPerfLog(`live-erase-commit ms=${Date.now() - startedAt} mode=${session.liveStrokeCommit.mode}`);
    }

    function commitLiveStrokeIfNeeded() {
        if (!session?.liveStrokeCommit?.active) {
            return;
        }
        if (!session.eraserMode && session.liveStrokeCommit.strategy === 'mouse-initial' && session.liveStrokeCommit.committedOnce) {
            return;
        }
        if (session.eraserMode) {
            queueLiveStrokeCommit();
            return;
        }
        commitLiveStrokeNow();
    }

    function continueStroke(event) {
        if (!bindSession() || !session || !session.isDrawing) {
            return;
        }
        const stagePoint = clientToStage(event);
        const rawImgPoint = stageToImageRaw(stagePoint.x, stagePoint.y);
        const rawX = rawImgPoint.x;
        const rawY = rawImgPoint.y;
        const rawPressure = resolvePressure(event);
        const rawAngle = normalizeAngleRad(resolvePenAngleWithFallback(event));
        const rawTilt = resolveTiltMagnitude(event);
        const tool = session.tool;
        if (tool === TOOL_RECT) {
            updateRectPreview(rawX, rawY);
            return;
        }
        const inBounds = session.patternMode || (rawX >= 0 && rawX <= session.width && rawY >= 0 && rawY <= session.height);
        if (!inBounds) {
            session.stroke.wasOutside = true;
            session.stroke.lastX = null;
            session.stroke.lastY = null;
            session.stroke.smoothX = rawX;
            session.stroke.smoothY = rawY;
            session.stroke.smoothPressure = rawPressure;
            session.stroke.smoothTilt = rawTilt;
            return;
        }
        const clampedX = session.patternMode ? rawX : clamp(rawX, 0, session.width);
        const clampedY = session.patternMode ? rawY : clamp(rawY, 0, session.height);
        if (session.stroke.wasOutside) {
            session.stroke.wasOutside = false;
            session.stroke.lastX = null;
            session.stroke.lastY = null;
            session.stroke.lastPressure = null;
            session.stroke.smoothX = clampedX;
            session.stroke.smoothY = clampedY;
            session.stroke.smoothAngle = rawAngle;
            session.stroke.smoothPressure = rawPressure;
            session.stroke.smoothTilt = rawTilt;
            session.stroke.carry = 0;
        }
        if (typeof session.stroke.smoothX !== 'number' || typeof session.stroke.smoothY !== 'number') {
            session.stroke.smoothX = clampedX;
            session.stroke.smoothY = clampedY;
            session.stroke.smoothAngle = rawAngle;
            session.stroke.smoothPressure = rawPressure;
            session.stroke.smoothTilt = rawTilt;
        } else {
            session.stroke.smoothX += (clampedX - session.stroke.smoothX) * STROKE_SMOOTHING;
            session.stroke.smoothY += (clampedY - session.stroke.smoothY) * STROKE_SMOOTHING;
            session.stroke.smoothAngle = lerpAngleRad(session.stroke.smoothAngle, rawAngle, ANGLE_SMOOTHING);
            session.stroke.smoothPressure += (rawPressure - session.stroke.smoothPressure) * PRESSURE_SMOOTHING;
            session.stroke.smoothTilt += (rawTilt - session.stroke.smoothTilt) * TILT_SMOOTHING;
        }
        let x = session.stroke.smoothX;
        let y = session.stroke.smoothY;
        const angle = session.stroke.smoothAngle;
        const pressure = session.stroke.smoothPressure ?? rawPressure;
        const tilt = session.stroke.smoothTilt ?? rawTilt;
        const lastPressure = Number.isFinite(session.stroke.lastPressure) ? session.stroke.lastPressure : pressure;
        if (Number.isFinite(session.stroke.lastX) && Number.isFinite(session.stroke.lastY)) {
            const unwrapped = unwrapPatternStrokePoint(session.stroke.lastX, session.stroke.lastY, x, y);
            x = unwrapped.x;
            y = unwrapped.y;
        }
        const wantsLine = false;
        if (wantsLine && session.editMode === EDIT_MODE_PAINT && tool !== TOOL_RECT) {
            if (typeof session.stroke.anchorX !== 'number' || typeof session.stroke.anchorY !== 'number') {
                session.stroke.anchorX = x;
                session.stroke.anchorY = y;
            }
            session.stroke.carry = 0;
            session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
            clearOverlayCanvas();
            {
                const anchorRadius = resolveBrushRadius(tool, lastPressure);
                const spacing = resolveDabSpacing(tool, anchorRadius, { min: 0.35 });
                const anchorBaseAlpha = resolveBaseAlpha(tool, lastPressure);
                const anchorAlpha = resolveSpacingAdjustedAlpha(tool, anchorBaseAlpha, spacing, anchorRadius);
                drawDabWithParams(tool, session.stroke.anchorX, session.stroke.anchorY, angle, tilt, anchorRadius, anchorAlpha);
            }
            drawStrokeSegment(tool, session.stroke.anchorX, session.stroke.anchorY, x, y, lastPressure, pressure, angle, tilt);
            {
                const radius = resolveBrushRadius(tool, pressure);
                const spacing = resolveDabSpacing(tool, radius, { min: 0.35 });
                const baseAlpha = resolveBaseAlpha(tool, pressure);
                const alpha = resolveSpacingAdjustedAlpha(tool, baseAlpha, spacing, radius);
                drawDabWithParams(tool, x, y, angle, tilt, radius, alpha);
            }
            session.stroke.lastX = x;
            session.stroke.lastY = y;
            session.stroke.lastPressure = pressure;
            commitLiveStrokeIfNeeded();
            return;
        }
        const lastX = session.stroke.lastX;
        const lastY = session.stroke.lastY;
        if (typeof lastX !== 'number' || typeof lastY !== 'number') {
            session.stroke.lastX = x;
            session.stroke.lastY = y;
            session.stroke.lastPressure = pressure;
            {
                const radius = resolveBrushRadius(tool, pressure);
                const baseAlpha = resolveBaseAlpha(tool, pressure);
                const spacing = resolveDabSpacing(tool, radius, { min: 0.35 });
                const alpha = resolveSpacingAdjustedAlpha(tool, baseAlpha, spacing, radius);
                drawDabWithParams(tool, x, y, angle, tilt, radius, alpha);
            }
            commitLiveStrokeIfNeeded();
            return;
        }
        drawStrokeSegment(tool, lastX, lastY, x, y, lastPressure, pressure, angle, tilt);
        session.stroke.lastX = x;
        session.stroke.lastY = y;
        session.stroke.lastPressure = pressure;
        commitLiveStrokeIfNeeded();
    }

    function commitOverlayToBase(bounds, options = {}) {
        if (!session) {
            return;
        }
        const padded = computeCommitBounds(bounds);
        if (!padded) {
            clearOverlayCanvas();
            return;
        }
        const skipUndo = !!options.skipUndo;
        const capturePatch = !!options.capturePatch;
        const timelineRefreshMode = String(options.timelineRefreshMode || 'full');
        const before = (skipUndo && !capturePatch) ? null : session.baseCtx.getImageData(padded.x, padded.y, padded.width, padded.height);
        const borderOnly = !!options.borderOnly;
        const lockAlpha = !!(session.alphaLockEnabled && !session.eraserMode && before);
        if (lockAlpha) {
            const tmp = document.createElement('canvas');
            tmp.width = padded.width;
            tmp.height = padded.height;
            const tmpCtx = tmp.getContext('2d', { willReadFrequently: false });
            if (tmpCtx) {
                tmpCtx.putImageData(before, 0, 0);
                tmpCtx.save();
                tmpCtx.globalCompositeOperation = resolveBrushCompositeOperation();
                tmpCtx.globalAlpha = 1;
                if (!borderOnly) {
                    tmpCtx.drawImage(session.overlayCanvas, padded.x, padded.y, padded.width, padded.height, 0, 0, padded.width, padded.height);
                } else {
                    const overlayData = session.overlayCtx.getImageData(padded.x, padded.y, padded.width, padded.height);
                    const thickness = resolveBorderSize();
                    const borderData = extractBorderImageData(overlayData, thickness);
                    const borderCanvas = document.createElement('canvas');
                    borderCanvas.width = padded.width;
                    borderCanvas.height = padded.height;
                    const borderCtx = borderCanvas.getContext('2d', { willReadFrequently: false });
                    if (borderCtx) {
                        borderCtx.putImageData(borderData, 0, 0);
                        tmpCtx.drawImage(borderCanvas, 0, 0);
                    }
                }
                tmpCtx.restore();
                const maskCanvas = createAlphaMaskCanvas(before);
                if (maskCanvas) {
                    tmpCtx.globalCompositeOperation = 'destination-in';
                    tmpCtx.drawImage(maskCanvas, 0, 0);
                }
                const locked = tmpCtx.getImageData(0, 0, padded.width, padded.height);
                session.baseCtx.putImageData(locked, padded.x, padded.y);
            }
        } else {
            session.baseCtx.save();
            session.baseCtx.globalCompositeOperation = session.eraserMode ? 'destination-out' : resolveBrushCompositeOperation();
            session.baseCtx.globalAlpha = 1;
            if (!borderOnly) {
                session.baseCtx.drawImage(session.overlayCanvas, 0, 0);
            } else {
                const overlayData = session.overlayCtx.getImageData(padded.x, padded.y, padded.width, padded.height);
                const thickness = resolveBorderSize();
                const borderData = extractBorderImageData(overlayData, thickness);
                const tmp = document.createElement('canvas');
                tmp.width = padded.width;
                tmp.height = padded.height;
                const tmpCtx = tmp.getContext('2d', { willReadFrequently: false });
                if (tmpCtx) {
                    tmpCtx.putImageData(borderData, 0, 0);
                    session.baseCtx.drawImage(tmp, padded.x, padded.y);
                }
            }
            session.baseCtx.restore();
        }
        const after = (skipUndo && !capturePatch) ? null : session.baseCtx.getImageData(padded.x, padded.y, padded.width, padded.height);
        clearOverlayCanvas();
        if (timelineRefreshMode === 'cache-only') {
            const synced = syncCurrentFrameStateForTimeline('commitOverlayToBase.cacheOnly');
            logPaintTrace('timeline.preview.cacheOnly', {
                reason: 'commitOverlayToBase',
                synced,
                drawerOpen: paintWorkspaceState.drawerOpen === true,
                currentFrameId: String(session?.timelineStore?.currentFrameId || '')
            });
        } else if (timelineRefreshMode === 'defer-sync') {
            invalidateTimelinePreviewCacheForLayers(session.layers);
            if (shouldRefreshTimelinePreviewImmediately()) {
                refreshTimelinePreviewForCurrentFrame('commitOverlayToBase', {
                    renderBar: paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true,
                    patchDom: true,
                    syncStore: false
                });
                scheduleDeferredTimelineStoreSync('commitOverlayToBase.deferred');
            } else {
                scheduleDeferredTimelineStoreSync('commitOverlayToBase.deferred', {
                    waitMs: 240,
                    useIdleCallback: false
                });
            }
        } else {
            refreshTimelinePreviewForCurrentFrame('commitOverlayToBase', {
                renderBar: paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true,
                patchDom: true
            });
        }
        queueLayerPreviewRefresh();
        if (!skipUndo) {
            pushUndoAction({ type: 'pixels', bounds: padded, before, after });
        }
        if (capturePatch) {
            return { bounds: padded, before, after };
        }
    }

    function commitOverlayToSelectionEdit(bounds, options = {}) {
        if (!session) {
            return;
        }
        const normalized = normalizeBounds(bounds);
        if (!normalized) {
            clearOverlayCanvas();
            return;
        }
        if (!ensureSelectionEditInitialized()) {
            clearOverlayCanvas();
            return;
        }
        const timelineRefreshMode = String(options.timelineRefreshMode || 'full');
        const selectionBounds = session.selectionEdit.bounds;
        const pad = deps.ACTION_BOUNDS_PAD;
        const x0 = clamp(normalized.x - pad, 0, Math.max(0, session.width - 1));
        const y0 = clamp(normalized.y - pad, 0, Math.max(0, session.height - 1));
        const x1 = clamp(normalized.x + normalized.width + pad, 0, session.width);
        const y1 = clamp(normalized.y + normalized.height + pad, 0, session.height);
        const padded = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
        const ix0 = clamp(Math.floor(Math.max(padded.x, selectionBounds.x)), selectionBounds.x, selectionBounds.x + selectionBounds.width);
        const iy0 = clamp(Math.floor(Math.max(padded.y, selectionBounds.y)), selectionBounds.y, selectionBounds.y + selectionBounds.height);
        const ix1 = clamp(Math.ceil(Math.min(padded.x + padded.width, selectionBounds.x + selectionBounds.width)), selectionBounds.x, selectionBounds.x + selectionBounds.width);
        const iy1 = clamp(Math.ceil(Math.min(padded.y + padded.height, selectionBounds.y + selectionBounds.height)), selectionBounds.y, selectionBounds.y + selectionBounds.height);
        if (ix1 <= ix0 || iy1 <= iy0) {
            clearOverlayCanvas();
            return;
        }
        const region = { x: ix0, y: iy0, width: ix1 - ix0, height: iy1 - iy0 };
        const dx = region.x - selectionBounds.x;
        const dy = region.y - selectionBounds.y;
        const borderOnly = !!options.borderOnly;
        const editCtx = session.selectionEdit.ctx;
        const before = session.alphaLockEnabled && !session.eraserMode ? editCtx.getImageData(dx, dy, region.width, region.height) : null;
        editCtx.save();
        editCtx.globalAlpha = 1;
        editCtx.globalCompositeOperation = session.eraserMode ? 'destination-out' : 'source-over';
        if (!borderOnly) {
            editCtx.drawImage(session.overlayCanvas, region.x, region.y, region.width, region.height, dx, dy, region.width, region.height);
        } else {
            const overlayData = session.overlayCtx.getImageData(region.x, region.y, region.width, region.height);
            const thickness = resolveBorderSize();
            const borderData = extractBorderImageData(overlayData, thickness);
            const tmp = document.createElement('canvas');
            tmp.width = region.width;
            tmp.height = region.height;
            const tmpCtx = tmp.getContext('2d', { willReadFrequently: false });
            if (tmpCtx) {
                tmpCtx.putImageData(borderData, 0, 0);
                editCtx.drawImage(tmp, dx, dy);
            }
        }
        editCtx.restore();
        if (before && !session.eraserMode) {
            const maskCanvas = createAlphaMaskCanvas(before);
            const maskedCanvas = document.createElement('canvas');
            maskedCanvas.width = region.width;
            maskedCanvas.height = region.height;
            const maskedCtx = maskedCanvas.getContext('2d', { willReadFrequently: false });
            if (maskedCtx) {
                const current = editCtx.getImageData(dx, dy, region.width, region.height);
                maskedCtx.putImageData(current, 0, 0);
                if (maskCanvas) {
                    maskedCtx.globalCompositeOperation = 'destination-in';
                    maskedCtx.drawImage(maskCanvas, 0, 0);
                }
                const locked = maskedCtx.getImageData(0, 0, region.width, region.height);
                editCtx.putImageData(locked, dx, dy);
            }
        }
        session.selectionEdit.dirty = true;
        clearOverlayCanvas();
        if (timelineRefreshMode === 'cache-only') {
            const synced = syncCurrentFrameStateForTimeline('commitOverlayToSelectionEdit.cacheOnly');
            logPaintTrace('timeline.preview.cacheOnly', {
                reason: 'commitOverlayToSelectionEdit',
                synced,
                drawerOpen: paintWorkspaceState.drawerOpen === true,
                currentFrameId: String(session?.timelineStore?.currentFrameId || '')
            });
        } else if (timelineRefreshMode === 'defer-sync') {
            invalidateTimelinePreviewCacheForLayers(session.layers);
            if (shouldRefreshTimelinePreviewImmediately()) {
                refreshTimelinePreviewForCurrentFrame('commitOverlayToSelectionEdit', {
                    renderBar: paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true,
                    patchDom: true,
                    syncStore: false
                });
                scheduleDeferredTimelineStoreSync('commitOverlayToSelectionEdit.deferred');
            } else {
                scheduleDeferredTimelineStoreSync('commitOverlayToSelectionEdit.deferred', {
                    waitMs: 240,
                    useIdleCallback: false
                });
            }
        } else {
            refreshTimelinePreviewForCurrentFrame('commitOverlayToSelectionEdit', {
                renderBar: paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true,
                patchDom: true
            });
        }
        refreshSelectionEditPreview();
        renderStageUi();
        queueLayerPreviewRefresh();
    }

    function endStroke() {
        if (!bindSession() || !session || !session.isDrawing) {
            return;
        }
        const startedAt = Date.now();
        session.isDrawing = false;
        {
            const now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
            session.suppressContextMenuUntil = now + PAINT_CONTEXTMENU_SUPPRESS_MS;
            if (session.strokeWasStylusLike || session.strokePointerType === 'pen') {
                session.ignoreMouseUntil = now + IGNORE_MOUSE_AFTER_STYLUS_UP_MS;
            }
        }
        session.strokePointerType = '';
        session.strokeWasStylusLike = false;
        session.pointerId = null;
        session.cursorAlpha = 1;
        updateStageCursor();
        setCursorBlendMode('difference');
        renderCursorCanvas();
        if (session.strokeClipActive) {
            try {
                session.overlayCtx.restore();
            } catch {}
            session.strokeClipActive = false;
        }
        cancelQueuedLiveStrokeCommit();
        const borderOnly = session.strokeMode === STROKE_MODE_BORDER && session.tool !== TOOL_RECT;
        if (session.tool === TOOL_STAMP && session.stampLive) {
            commitOverlayToBase(session.currentBounds, {
                borderOnly,
                skipUndo: true,
                timelineRefreshMode: 'defer-sync'
            });
            if (session.stampLive.dirty && session.stampLive.before) {
                const bounds = { x: 0, y: 0, width: session.width, height: session.height };
                const after = session.baseCtx.getImageData(0, 0, session.width, session.height);
                pushUndoAction({ type: 'pixels', bounds, before: session.stampLive.before, after });
            } else {
                clearOverlayCanvas();
            }
            session.stampLive = null;
        } else if (session.liveStrokeCommit?.active) {
            if (session.liveStrokeCommit.mode === 'base') {
                expandLiveStrokeBeforeSnapshot(computeCommitBounds(session.currentBounds));
            }
            commitOverlayToBase(session.currentBounds, {
                borderOnly,
                skipUndo: true,
                timelineRefreshMode: 'defer-sync'
            });
            if (session.liveStrokeCommit.mode === 'base' && session.liveStrokeCommit.dirty && session.liveStrokeCommit.before && session.liveStrokeCommit.bounds) {
                const bounds = session.liveStrokeCommit.bounds;
                const after = session.baseCtx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
                pushUndoAction({ type: 'pixels', bounds, before: session.liveStrokeCommit.before, after });
            } else {
                clearOverlayCanvas();
            }
            session.liveStrokeCommit = null;
        } else {
            commitOverlayToBase(session.currentBounds, {
                borderOnly,
                timelineRefreshMode: 'defer-sync'
            });
        }
        syncOverlayCanvasPresentation('end-stroke');
        queueStageShadowRefresh();
        if (session.tool === TOOL_STAMP && !session.eraserMode) {
            const entry = captureStampEntryFromEditor();
            if (entry) {
                touchStampEntry(entry);
            }
        }
        if (session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_STAMP) {
            updateRecentColors(session.color);
            queueRecentColorSwatchRefresh();
        }
        session.rect = null;
        appendPaintPerfLog(`end-stroke ms=${Date.now() - startedAt} eraser=${session.eraserMode ? 1 : 0} tool=${session.tool}`);
    }

    return {
        resolvePressure,
        beginStroke,
        commitLiveStrokeIfNeeded,
        ensureSelectionEditInitialized,
        isStylusLikeEvent,
        resolveTiltMagnitude,
        resolvePenAngleWithFallback,
        drawBlurDab,
        drawUserStampDab,
        drawDabWithParams,
        drawInkDot,
        drawInkStrokeSegment,
        drawStrokeSegment,
        updateRectPreview,
        continueStroke,
        commitOverlayToBase,
        commitOverlayToSelectionEdit,
        endStroke
    };
};
