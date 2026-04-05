'use strict';

// MARK: MODULE
module.exports = function createPaintSelectionClipboardCropModule(deps) {
    const {
        env,
        utils,
        MAX_CANVAS_DIMENSION,
        CROP_NUDGE_STEP,
        CROP_NUDGE_STEP_FAST,
        EDIT_MODE_TRANSFORM,
        getSession,
        clamp,
        clamp01,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        normalizeKey,
        renderStageUi,
        renderCursorCanvas,
        clearUiCanvas,
        pushUndoAction,
        updateHud,
        resizeCanvases,
        getActiveLayer,
        setActiveLayerById,
        fitToScreen,
        createPaintLayer,
        refreshTimelinePreviewForCurrentFrame,
        isTimelineBarVisible,
        renderLayerBar,
        exportCanvasToPngBuffer,
        logPaintTrace,
        rebuildSelectionFromComponents,
        updateTransformPreviewGeometry
    } = deps;

    let session = null;

    function bindSession() {
        session = getSession();
        return session;
    }

    function hasActiveClipboardSelection() {
        return !!(session?.selection?.bounds && session.selection.maskCanvas && session.selection.path && !session.selection.inverted);
    }

    async function copyCanvasToClipboard(canvas) {
        const { electron } = env;
        if (!electron?.nativeImage || !electron?.clipboard) {
            utils.showToast?.('Clipboard unavailable');
            return false;
        }
        const buffer = await exportCanvasToPngBuffer(canvas);
        if (!buffer) {
            utils.showToast?.('Copy failed');
            return false;
        }
        const nativeImg = electron.nativeImage.createFromBuffer(buffer);
        if (!nativeImg || nativeImg.isEmpty()) {
            utils.showToast?.('Copy failed');
            return false;
        }
        electron.clipboard.writeImage(nativeImg);
        return true;
    }

    async function copyActiveLayerToClipboard() {
        const activeLayer = getActiveLayer();
        if (!activeLayer?.canvas) {
            return false;
        }
        const ok = await copyCanvasToClipboard(activeLayer.canvas);
        if (ok) {
            logPaintTrace('paint.layerClipboard.copy', {
                layerId: activeLayer.id || '',
                layerName: activeLayer.name || '',
                layerIndex: session?.activeLayerIndex ?? -1,
                width: Math.round(activeLayer.canvas.width || 0),
                height: Math.round(activeLayer.canvas.height || 0)
            });
        }
        return ok;
    }

    async function copySelectionOrCanvasToClipboard() {
        if (!bindSession() || !session) {
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
            utils.showToast?.('Paint: apply/cancel transform first');
            return;
        }
        const selection = session.selection;
        if (hasActiveClipboardSelection()) {
            const bounds = selection.bounds;
            const out = document.createElement('canvas');
            out.width = bounds.width;
            out.height = bounds.height;
            const outCtx = out.getContext('2d', { willReadFrequently: false });
            if (!outCtx) {
                return;
            }
            outCtx.clearRect(0, 0, out.width, out.height);
            outCtx.drawImage(session.baseCanvas, -bounds.x, -bounds.y);
            outCtx.globalCompositeOperation = 'destination-in';
            outCtx.drawImage(selection.maskCanvas, 0, 0);
            outCtx.globalCompositeOperation = 'source-over';
            const ok = await copyCanvasToClipboard(out);
            if (ok) {
                utils.showToast?.('Selection copied');
            }
            return;
        }
        const ok = await copyActiveLayerToClipboard();
        if (ok) {
            utils.showToast?.('Layer copied');
        }
    }

    async function loadImageFromDataUrl(dataUrl) {
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = dataUrl;
        try {
            await img.decode();
        } catch {}
        if (!img.naturalWidth || !img.naturalHeight) {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (error) => reject(error);
            });
        }
        return img;
    }

    async function loadImageFromBlob(blob) {
        const objectUrl = URL.createObjectURL(blob);
        try {
            return await loadImageFromDataUrl(objectUrl);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    async function resolveClipboardImageSource(clipboardInput = null) {
        if (clipboardInput?.blob && typeof clipboardInput.blob.arrayBuffer === 'function') {
            const image = await loadImageFromBlob(clipboardInput.blob);
            return {
                image,
                width: Math.max(1, Number(image.naturalWidth) || 1),
                height: Math.max(1, Number(image.naturalHeight) || 1),
                sourceKind: 'clipboard-item'
            };
        }
        if (clipboardInput && typeof clipboardInput.toDataURL === 'function') {
            const image = await loadImageFromDataUrl(clipboardInput.toDataURL());
            const size = clipboardInput.getSize?.() || {};
            return {
                image,
                width: Math.max(1, Number(size.width) || Number(image.naturalWidth) || 1),
                height: Math.max(1, Number(size.height) || Number(image.naturalHeight) || 1),
                sourceKind: 'native-image'
            };
        }
        const nativeImg = env.electron?.clipboard?.readImage?.();
        if (!nativeImg || nativeImg.isEmpty()) {
            return null;
        }
        const image = await loadImageFromDataUrl(nativeImg.toDataURL());
        const size = nativeImg.getSize?.() || {};
        return {
            image,
            width: Math.max(1, Number(size.width) || Number(image.naturalWidth) || 1),
            height: Math.max(1, Number(size.height) || Number(image.naturalHeight) || 1),
            sourceKind: 'native-image'
        };
    }

    async function replaceActiveLayerWithResolvedClipboardImage(clipboardSource, options = {}) {
        if (!bindSession() || !session || !clipboardSource?.image) {
            return false;
        }
        const activeLayer = getActiveLayer();
        if (!activeLayer?.ctx) {
            return false;
        }
        bindSession();
        const srcWidth = Math.max(1, Number(clipboardSource.width) || Number(clipboardSource.image.naturalWidth) || 1);
        const srcHeight = Math.max(1, Number(clipboardSource.height) || Number(clipboardSource.image.naturalHeight) || 1);
        if (srcWidth !== session.width || srcHeight !== session.height) {
            logPaintTrace('paint.layerClipboard.pasteMismatch', {
                layerId: activeLayer.id || '',
                srcWidth,
                srcHeight,
                canvasWidth: session.width,
                canvasHeight: session.height,
                sourceKind: clipboardSource.sourceKind || ''
            });
            return false;
        }
        const bounds = { x: 0, y: 0, width: session.width, height: session.height };
        const before = activeLayer.ctx.getImageData(0, 0, session.width, session.height);
        activeLayer.ctx.clearRect(0, 0, session.width, session.height);
        activeLayer.ctx.drawImage(clipboardSource.image, 0, 0, session.width, session.height);
        const after = activeLayer.ctx.getImageData(0, 0, session.width, session.height);
        pushUndoAction({ type: 'pixels', bounds, before, after });
        refreshTimelinePreviewForCurrentFrame(String(options.reason || 'layer-clipboard-paste'), {
            renderBar: isTimelineBarVisible(),
            patchDom: true
        });
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        logPaintTrace('paint.layerClipboard.paste', {
            layerId: activeLayer.id || '',
            layerName: activeLayer.name || '',
            layerIndex: session.activeLayerIndex ?? -1,
            width: session.width,
            height: session.height,
            sourceKind: clipboardSource.sourceKind || ''
        });
        utils.showToast?.('Layer pasted');
        return true;
    }

    async function replaceActiveLayerWithClipboardImage(clipboardInput, options = {}) {
        const clipboardSource = await resolveClipboardImageSource(clipboardInput);
        if (!clipboardSource) {
            return false;
        }
        return replaceActiveLayerWithResolvedClipboardImage(clipboardSource, options);
    }

    function beginPasteTransformMode(contentCanvas, options = {}) {
        if (!session?.selection?.bounds || !session?.selection?.path) {
            return;
        }
        if (session.transform?.active) {
            return;
        }
        const snapshot = captureFullSnapshot();
        if (!snapshot) {
            return;
        }
        const cancelSnapshot = options.cancelSnapshot || snapshot;
        const bounds = session.selection.bounds;
        const centerX = bounds.x + (bounds.width / 2);
        const centerY = bounds.y + (bounds.height / 2);
        session.transform = {
            active: true,
            dragging: false,
            mode: 'move',
            handle: null,
            startX: 0,
            startY: 0,
            dx: 0,
            dy: 0,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            centerX,
            centerY,
            startDx: 0,
            startDy: 0,
            startScaleX: 1,
            startScaleY: 1,
            startRotation: 0,
            startAngle: 0,
            startProjX: 1,
            startProjY: 1,
            startDist: 1,
            contentCanvas,
            snapshot,
            cancelSnapshot,
            opacity: clamp01(options.opacity ?? 1),
            source: String(options.source || ''),
            previewPath: session.selection.path,
            previewComponents: null,
            previewBounds: bounds,
            previewCorners: null,
            handles: null
        };
        session.editMode = EDIT_MODE_TRANSFORM;
        updateTransformPreviewGeometry();
        renderStageUi();
    }

    async function pasteClipboardImageAsTransformSelection(options = {}) {
        if (!bindSession() || !session) {
            return;
        }
        if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
            utils.showToast?.('Paint: apply/cancel transform first');
            return;
        }
        const clipboardSource = await resolveClipboardImageSource(options?.clipboardImage || null);
        if (!clipboardSource) {
            utils.showToast?.('Clipboard has no image');
            return;
        }
        const hasSelection = !!(session.selection?.path || session.selectionEdit?.dirty);
        if (!hasSelection) {
            const directPaste = await replaceActiveLayerWithResolvedClipboardImage(clipboardSource, {
                reason: 'paint-layer-clipboard-paste'
            });
            if (directPaste) {
                return;
            }
            logPaintTrace('paint.layerClipboard.pasteFallback', {
                reason: 'transform-selection',
                width: session.width,
                height: session.height,
                sourceKind: clipboardSource.sourceKind || ''
            });
        }
        const srcW = Math.max(1, Number(clipboardSource.width) || 1);
        const srcH = Math.max(1, Number(clipboardSource.height) || 1);
        const fitScale = Math.min(session.width / srcW, session.height / srcH, 1);
        const targetW = clamp(Math.round(srcW * fitScale), 1, MAX_CANVAS_DIMENSION);
        const targetH = clamp(Math.round(srcH * fitScale), 1, MAX_CANVAS_DIMENSION);
        bindSession();
        const contentCanvas = document.createElement('canvas');
        contentCanvas.width = targetW;
        contentCanvas.height = targetH;
        const ctx = contentCanvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return;
        }
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.drawImage(clipboardSource.image, 0, 0, targetW, targetH);
        const cancelSnapshot = captureFullSnapshot();
        if (!cancelSnapshot) {
            return;
        }
        if (!createPaintLayer({ name: 'Paste Layer' })) {
            return;
        }
        const x = Math.round((session.width - targetW) / 2);
        const y = Math.round((session.height - targetH) / 2);
        const rectPoints = [
            { x, y },
            { x: x + targetW, y },
            { x: x + targetW, y: y + targetH },
            { x, y: y + targetH }
        ];
        rebuildSelectionFromComponents([{ points: rectPoints, op: 'add' }], false);
        beginPasteTransformMode(contentCanvas, { opacity: 1, source: 'paste', cancelSnapshot });
        renderLayerBar();
        utils.showToast?.('Pasted to new layer');
        renderCursorCanvas();
    }

    function captureFullSnapshot() {
        if (!bindSession() || !session) {
            return null;
        }
        const width = session.width;
        const height = session.height;
        const layers = Array.isArray(session.layers) ? session.layers : [];
        const snapshotLayers = [];
        for (const layer of layers) {
            if (!layer?.ctx) {
                continue;
            }
            snapshotLayers.push({
                id: layer.id || '',
                name: layer.name || '',
                isBase: layer.isBase === true,
                visible: normalizeLayerVisibility(layer.visible, true),
                opacity: normalizeLayerOpacity(layer.opacity),
                imageData: layer.ctx.getImageData(0, 0, width, height)
            });
        }
        const activeLayer = getActiveLayer();
        return {
            width,
            height,
            imageData: activeLayer?.ctx ? activeLayer.ctx.getImageData(0, 0, width, height) : null,
            activeLayerId: activeLayer?.id || '',
            layers: snapshotLayers
        };
    }

    function clampCropRect(rect) {
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const x = Math.round(rect.x);
        const y = Math.round(rect.y);
        return { x, y, width, height };
    }

    function applyCropRect(rect) {
        if (!bindSession() || !session) {
            return;
        }
        const normalized = clampCropRect(rect);
        const before = captureFullSnapshot();
        if (!before) {
            return;
        }
        const newWidth = clamp(normalized.width, 1, MAX_CANVAS_DIMENSION);
        const newHeight = clamp(normalized.height, 1, MAX_CANVAS_DIMENSION);
        const croppedLayers = [];
        for (const layer of session.layers || []) {
            if (!layer?.canvas || !layer.id) {
                continue;
            }
            const canvas = document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: false });
            if (!ctx) {
                continue;
            }
            ctx.clearRect(0, 0, newWidth, newHeight);
            ctx.drawImage(layer.canvas, -normalized.x, -normalized.y);
            croppedLayers.push({ id: layer.id, canvas });
        }
        resizeCanvases(newWidth, newHeight);
        bindSession();
        for (const entry of croppedLayers) {
            const layer = session.layers.find((candidate) => candidate && candidate.id === entry.id);
            if (!layer?.ctx) {
                continue;
            }
            layer.ctx.clearRect(0, 0, newWidth, newHeight);
            layer.ctx.drawImage(entry.canvas, 0, 0);
        }
        setActiveLayerById(before.activeLayerId || getActiveLayer()?.id, { force: true, keepSelection: true, skipUi: true });
        const after = captureFullSnapshot();
        pushUndoAction({ type: 'resize', before, after });
        cancelCropMode();
        fitToScreen();
    }

    function resolveCropHit(x, y) {
        if (!session?.crop?.rect) {
            return null;
        }
        const rect = session.crop.rect;
        const threshold = 10 / session.view.scale;
        const left = rect.x;
        const top = rect.y;
        const right = rect.x + rect.width;
        const bottom = rect.y + rect.height;
        const nearLeft = Math.abs(x - left) <= threshold;
        const nearRight = Math.abs(x - right) <= threshold;
        const nearTop = Math.abs(y - top) <= threshold;
        const nearBottom = Math.abs(y - bottom) <= threshold;
        const inside = x >= left && x <= right && y >= top && y <= bottom;
        if (nearLeft && nearTop) return 'nw';
        if (nearRight && nearTop) return 'ne';
        if (nearLeft && nearBottom) return 'sw';
        if (nearRight && nearBottom) return 'se';
        if (nearTop && inside) return 'n';
        if (nearBottom && inside) return 's';
        if (nearLeft && inside) return 'w';
        if (nearRight && inside) return 'e';
        if (inside) return 'move';
        return null;
    }

    function updateCropRectFromDrag(handle, startRect, startX, startY, currentX, currentY) {
        const dx = currentX - startX;
        const dy = currentY - startY;
        const rect = { ...startRect };
        if (handle === 'move') {
            rect.x = startRect.x + dx;
            rect.y = startRect.y + dy;
            return rect;
        }
        if (handle.includes('w')) {
            rect.x = startRect.x + dx;
            rect.width = startRect.width - dx;
        }
        if (handle.includes('e')) {
            rect.width = startRect.width + dx;
        }
        if (handle.includes('n')) {
            rect.y = startRect.y + dy;
            rect.height = startRect.height - dy;
        }
        if (handle.includes('s')) {
            rect.height = startRect.height + dy;
        }
        if (rect.width < 1) {
            rect.width = 1;
            rect.x = startRect.x + (startRect.width - 1);
        }
        if (rect.height < 1) {
            rect.height = 1;
            rect.y = startRect.y + (startRect.height - 1);
        }
        return rect;
    }

    function renderCropOverlay() {
        if (!session || !session.crop.active || !session.crop.rect) {
            return;
        }
        renderStageUi();
    }

    function adjustCropByKeyboard(event) {
        if (!bindSession() || !session?.crop?.active || !session.crop.rect) {
            return false;
        }
        const key = normalizeKey(event);
        const step = event.shiftKey ? CROP_NUDGE_STEP_FAST : CROP_NUDGE_STEP;
        const rect = { ...session.crop.rect };
        if (key === 'arrowleft') {
            rect.x -= step;
            rect.width += step;
        } else if (key === 'arrowright') {
            rect.width += step;
        } else if (key === 'arrowup') {
            rect.y -= step;
            rect.height += step;
        } else if (key === 'arrowdown') {
            rect.height += step;
        } else if (key === 'a') {
            rect.x += step;
            rect.width = Math.max(1, rect.width - step);
        } else if (key === 'd') {
            rect.width = Math.max(1, rect.width - step);
        } else if (key === 'w') {
            rect.y += step;
            rect.height = Math.max(1, rect.height - step);
        } else if (key === 's') {
            rect.height = Math.max(1, rect.height - step);
        } else {
            return false;
        }
        session.crop.rect = rect;
        renderCropOverlay();
        return true;
    }

    function cancelCropMode() {
        if (!session) {
            return;
        }
        session.crop.active = false;
        session.crop.drag = null;
        clearUiCanvas();
    }

    return {
        copySelectionOrCanvasToClipboard,
        replaceActiveLayerWithClipboardImage,
        beginPasteTransformMode,
        pasteClipboardImageAsTransformSelection,
        captureFullSnapshot,
        applyCropRect,
        resolveCropHit,
        updateCropRectFromDrag,
        renderCropOverlay,
        adjustCropByKeyboard,
        cancelCropMode
    };
};
