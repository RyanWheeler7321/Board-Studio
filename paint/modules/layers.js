'use strict';

// MARK: MODULE
module.exports = function createPaintLayersModule(deps) {
    const {
        utils,
        paintWorkspaceState,
        LAYER_MAX,
        LAYER_BASE_NAME,
        getSession,
        clamp,
        logPaintTrace,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        normalizeLayerThumbnailTone,
        resolveSessionAnimationContext,
        resolveWorkspaceAsset,
        getCurrentTimelineFrameId,
        persistAnimationLayerSchema,
        patchExpandedTimelineSelection,
        patchCollapsedTimelineSelection,
        renderLayerBar,
        updateHud,
        renderStageUi,
        renderCursorCanvas,
        updateStageCursor,
        syncTimelineFrameStatesAfterLayerThumbnailToneChange,
        applyTimelineCheckerStyleToLayerRow,
        syncTimelineFrameStatesAfterLayerDisplayChange,
        syncPaintLayerCanvasOrder,
        syncOverlayCanvasPresentation,
        markPaintSessionDirty,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        queueStagePatternRefresh,
        scheduleLivePreviewSync,
        invalidateTimelinePreviewCacheForLayers,
        refreshTimelinePreviewForCurrentFrame,
        persistLoadedTimelineStates,
        captureCurrentAnimationFrameState,
        repairSessionLayerStructureIfNeeded,
        createDynamicPaintLayerCanvas,
        createLayerRecord,
        nextLayerId,
        buildLayerName,
        setActiveLayerRefs,
        syncTimelineFrameStatesAfterLayerInsert,
        syncTimelineFrameStatesAfterLayerSwap,
        syncTimelineFrameStatesAfterLayerDuplicate,
        getActiveLayer,
        clearSelection,
        resetUndoRedoStacks,
        syncTimelineFrameStatesAfterLayerDelete,
        syncTimelineFrameStatesAfterLayerMergeDown,
        createFlattenedLayersCanvas,
        ensureLayerStackEditable,
        queuePaintLayerViewerRefresh
    } = deps;

    function persistTimelineLayerSchemaFromSession(reason = 'timeline-layer-schema') {
        const session = getSession();
        const context = resolveSessionAnimationContext();
        if (!session || !context.asset?.id || !context.animation?.id) {
            return Promise.resolve(false);
        }
        return persistAnimationLayerSchema(context.asset, context.animation, session.layers || [], { reason }).catch((error) => {
            logPaintTrace('timeline.schema.persistFailed', {
                assetId: context.asset.id,
                animationId: context.animation.id,
                reason,
                message: error?.message || String(error)
            });
            return false;
        });
    }

    function persistLoadedTimelineStatesForCurrentAnimation(reason) {
        const context = resolveSessionAnimationContext();
        if (context.asset?.id && context.animation?.id) {
            persistLoadedTimelineStates(context.asset, context.animation, { reason }).catch((error) => {
                logPaintTrace('timeline.frameState.persistLoadedFailed', {
                    assetId: context.asset.id,
                    animationId: context.animation.id,
                    reason,
                    message: error?.message || String(error)
                });
            });
        }
    }

    function refreshLayerSelectionUi(reason = 'layer-selection-refresh', options = {}) {
        const session = getSession();
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const currentFrameId = getCurrentTimelineFrameId(asset, context.animation || null, context);
        const refreshFrameIds = currentFrameId ? [currentFrameId] : [];
        const patchedExpandedSelection = options.renderBar !== false
            && patchExpandedTimelineSelection(reason, {
                centerActiveFrame: options.centerActiveFrame === true,
                refreshFrameIds
            });
        const patchedCollapsedSelection = options.renderBar !== false
            && typeof patchCollapsedTimelineSelection === 'function'
            && patchCollapsedTimelineSelection(reason);
        logPaintTrace('timeline.layerUi.refresh', {
            reason,
            renderBar: options.renderBar !== false,
            patchedExpandedSelection,
            patchedCollapsedSelection,
            currentFrameId,
            activeLayerIndex: session?.activeLayerIndex ?? -1,
            drawerOpen: paintWorkspaceState.drawerOpen === true,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true
        });
        if (options.renderBar !== false && !patchedExpandedSelection && !patchedCollapsedSelection) {
            renderLayerBar();
        }
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        updateStageCursor();
        queuePaintLayerViewerRefresh(reason);
    }

    function updateLayerThumbnailTone(layerIndex, value, options = {}) {
        const session = getSession();
        const safeIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const layer = session?.layers?.[safeIndex];
        if (!layer) {
            return false;
        }
        const thumbnailTone = normalizeLayerThumbnailTone(value);
        layer.thumbnailTone = thumbnailTone;
        syncTimelineFrameStatesAfterLayerThumbnailToneChange(safeIndex, thumbnailTone);
        logPaintTrace('updateLayerThumbnailTone', {
            layerIndex: safeIndex,
            layerId: layer.id || '',
            thumbnailTone
        });
        if (options.persist !== false) {
            persistTimelineLayerSchemaFromSession('layer-thumbnail-tone');
        }
        if (options.render === false) {
            applyTimelineCheckerStyleToLayerRow(safeIndex, thumbnailTone);
        } else {
            renderLayerBar();
        }
        return true;
    }

    function updateLayerVisibility(layerIndex, visible, options = {}) {
        const session = getSession();
        const safeIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const layer = session?.layers?.[safeIndex];
        if (!layer) {
            return false;
        }
        const nextVisible = normalizeLayerVisibility(visible, true);
        if (layer.visible === nextVisible && options.force !== true) {
            return false;
        }
        layer.visible = nextVisible;
        syncTimelineFrameStatesAfterLayerDisplayChange(safeIndex, {
            visible: nextVisible,
            opacity: layer.opacity
        });
        syncPaintLayerCanvasOrder();
        syncOverlayCanvasPresentation('layer-visibility');
        if (options.render === false) {
            refreshTimelineLayerControlUi(safeIndex);
        } else {
            renderLayerBar();
        }
        renderStageUi();
        if (options.markDirty !== false) {
            markPaintSessionDirty('layer-visibility', {
                layerIndex: safeIndex,
                layerId: layer.id || '',
                visible: nextVisible
            });
        }
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('layer-visibility');
        queuePaintLayerViewerRefresh('layer-visibility');
        logPaintTrace('timeline.layerVisibility', {
            layerIndex: safeIndex,
            layerId: layer.id || '',
            visible: nextVisible,
            render: options.render !== false
        });
        if (options.persist !== false) {
            persistTimelineLayerSchemaFromSession('layer-visibility');
        }
        return true;
    }

    function updateLayerOpacity(layerIndex, opacity, options = {}) {
        const session = getSession();
        const safeIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const layer = session?.layers?.[safeIndex];
        if (!layer) {
            return false;
        }
        const nextOpacity = normalizeLayerOpacity(opacity);
        if (Math.abs((layer.opacity ?? 1) - nextOpacity) <= 0.0001 && options.force !== true) {
            return false;
        }
        layer.opacity = nextOpacity;
        syncTimelineFrameStatesAfterLayerDisplayChange(safeIndex, {
            visible: layer.visible,
            opacity: nextOpacity
        });
        syncPaintLayerCanvasOrder();
        syncOverlayCanvasPresentation('layer-opacity');
        if (options.render === false) {
            refreshTimelineLayerControlUi(safeIndex);
        } else {
            renderLayerBar();
        }
        renderStageUi();
        if (options.markDirty !== false) {
            markPaintSessionDirty('layer-opacity', {
                layerIndex: safeIndex,
                layerId: layer.id || '',
                opacity: nextOpacity
            });
        }
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('layer-opacity');
        queuePaintLayerViewerRefresh('layer-opacity');
        logPaintTrace('timeline.layerOpacity', {
            layerIndex: safeIndex,
            layerId: layer.id || '',
            opacity: nextOpacity,
            render: options.render !== false
        });
        if (options.persist !== false) {
            persistTimelineLayerSchemaFromSession('layer-opacity');
        }
        return true;
    }

    function toggleActiveLayerVisibility() {
        const session = getSession();
        if (!session?.layers?.length) {
            return false;
        }
        const activeIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        const layer = session.layers[activeIndex];
        return updateLayerVisibility(activeIndex, !(layer?.visible !== false));
    }

    function setIsolateActiveLayerEnabled(enabled, options = {}) {
        const session = getSession();
        if (!session) {
            return false;
        }
        const nextEnabled = enabled === true;
        if (session.isolateActiveLayer === nextEnabled && options.force !== true) {
            return false;
        }
        session.isolateActiveLayer = nextEnabled;
        syncPaintLayerCanvasOrder();
        syncOverlayCanvasPresentation('layer-isolate');
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        updateStageCursor();
        queueStageShadowRefresh();
        queueStagePatternRefresh();
        logPaintTrace('timeline.layerIsolate', {
            activeLayerIndex: session.activeLayerIndex ?? -1,
            layerId: getActiveLayer()?.id || '',
            enabled: nextEnabled
        });
        return true;
    }

    function toggleIsolateActiveLayer() {
        const session = getSession();
        if (!session) {
            return false;
        }
        return setIsolateActiveLayerEnabled(session.isolateActiveLayer !== true);
    }

    function beginTimelineLayerDrag(layerIndex, pointerId, startY, buttonEl = null) {
        const session = getSession();
        const safeIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const layer = session?.layers?.[safeIndex];
        if (!layer) {
            return false;
        }
        paintWorkspaceState.timelineDrag = {
            pointerId,
            layerIndex: safeIndex,
            startY: Number(startY) || 0,
            startOpacity: normalizeLayerOpacity(layer.opacity),
            moved: false,
            cursorActive: false,
            buttonEl
        };
        logPaintTrace('timeline.layerDrag.start', {
            layerIndex: safeIndex,
            layerId: layer.id || '',
            pointerId,
            startOpacity: normalizeLayerOpacity(layer.opacity),
            startY: Number(startY) || 0
        });
        return true;
    }

    function setTimelineLayerDragCursor(active, buttonEl = null) {
        document.body?.classList.toggle('paint-timeline-layer-dragging', active === true);
        if (buttonEl) {
            buttonEl.classList.toggle('is-dragging', active === true);
        }
    }

    function updateTimelineLayerDrag(pointerId, clientY) {
        const drag = paintWorkspaceState.timelineDrag;
        if (!drag || drag.pointerId !== pointerId) {
            return false;
        }
        const deltaY = Number(clientY) - drag.startY;
        if (Math.abs(deltaY) < 4) {
            return false;
        }
        if (!drag.moved) {
            drag.moved = true;
        }
        if (!drag.cursorActive) {
            drag.cursorActive = true;
            setTimelineLayerDragCursor(true, drag.buttonEl);
        }
        const nextOpacity = normalizeLayerOpacity(drag.startOpacity - (deltaY / 220));
        updateLayerOpacity(drag.layerIndex, nextOpacity, { persist: false, render: false, markDirty: false });
        logPaintTrace('timeline.layerDrag.move', {
            layerIndex: drag.layerIndex,
            pointerId,
            deltaY,
            startY: drag.startY,
            clientY: Number(clientY) || 0,
            opacity: nextOpacity
        });
        return true;
    }

    function endTimelineLayerDrag(pointerId) {
        const session = getSession();
        const drag = paintWorkspaceState.timelineDrag;
        if (!drag || drag.pointerId !== pointerId) {
            return false;
        }
        const layer = session?.layers?.[drag.layerIndex] || null;
        const moved = drag.moved === true;
        if (drag.buttonEl?.releasePointerCapture) {
            try {
                drag.buttonEl.releasePointerCapture(pointerId);
            } catch {}
        }
        setTimelineLayerDragCursor(false, drag.buttonEl);
        paintWorkspaceState.timelineDrag = null;
        if (!moved) {
            const nextVisible = !(layer?.visible !== false);
            updateLayerVisibility(drag.layerIndex, nextVisible, { render: false });
            logPaintTrace('timeline.layerDrag.toggleVisibility', {
                layerIndex: drag.layerIndex,
                pointerId,
                visible: nextVisible
            });
            return true;
        }
        persistTimelineLayerSchemaFromSession('layer-opacity-drag');
        markPaintSessionDirty('layer-opacity-drag', {
            layerIndex: drag.layerIndex,
            layerId: layer?.id || '',
            opacity: normalizeLayerOpacity(layer?.opacity)
        });
        logPaintTrace('timeline.layerDrag.end', {
            layerIndex: drag.layerIndex,
            pointerId,
            moved,
            opacity: normalizeLayerOpacity(layer?.opacity)
        });
        return true;
    }

    function renderTimelineEyeIcon(visible) {
        if (visible) {
            return `
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M2.5 12c2.3-3.4 5.7-5.1 9.5-5.1S19.2 8.6 21.5 12c-2.3 3.4-5.7 5.1-9.5 5.1S4.8 15.4 2.5 12Z"></path>
                    <circle cx="12" cy="12" r="3.2"></circle>
                </svg>
            `;
        }
        return `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 12c2.2-3.2 5.5-4.8 9-4.8 3.4 0 6.7 1.6 9 4.8-2.3 3.2-5.6 4.8-9 4.8-3.5 0-6.8-1.6-9-4.8Z"></path>
                <path d="M5 5l14 14"></path>
            </svg>
        `;
    }

    function refreshTimelineLayerControlUi(layerIndex) {
        const session = getSession();
        const safeIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const layer = session?.layers?.[safeIndex];
        const timelineLists = [deps.dom?.paintLayerList, deps.dom?.paintTimelinePanelList].filter(Boolean);
        if (!layer || !timelineLists.length) {
            return false;
        }
        const visible = normalizeLayerVisibility(layer.visible, true);
        const opacity = normalizeLayerOpacity(layer.opacity);
        timelineLists.forEach((listEl) => {
            listEl.querySelectorAll(`.paint-timeline-layer-control[data-layer-index="${safeIndex}"]`).forEach((control) => {
                control.classList.toggle('is-hidden', !visible);
                const button = control.querySelector('.paint-timeline-layer-eye');
                const opacityNode = control.querySelector('.paint-timeline-layer-opacity');
                if (button) {
                    button.classList.toggle('is-hidden', !visible);
                    button.classList.toggle('is-dragging', paintWorkspaceState.timelineDrag?.buttonEl === button && paintWorkspaceState.timelineDrag?.cursorActive === true);
                    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
                    button.setAttribute('title', visible ? 'Hide layer' : 'Show layer');
                    button.innerHTML = renderTimelineEyeIcon(visible);
                }
                if (opacityNode) {
                    opacityNode.textContent = `${Math.round(opacity * 100)}%`;
                }
            });
        });
        return true;
    }

    function createPaintLayerAt(insertIndex, options = {}) {
        const session = getSession();
        if (!session) {
            return null;
        }
        if (!ensureLayerStackEditable()) {
            return null;
        }
        repairSessionLayerStructureIfNeeded('before-create-layer', { skipUi: true });
        if (session.layers.length >= LAYER_MAX) {
            utils.showToast?.(`Paint: max ${LAYER_MAX} layers`);
            return null;
        }
        const canvas = createDynamicPaintLayerCanvas(session.width, session.height);
        if (!canvas) {
            return null;
        }
        const record = createLayerRecord(canvas, {
            id: nextLayerId(),
            name: options.name || buildLayerName(),
            dynamic: true,
            isBase: false,
            visible: normalizeLayerVisibility(options.visible, true),
            opacity: normalizeLayerOpacity(options.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(options.thumbnailTone)
        });
        if (!record) {
            canvas.remove();
            return null;
        }
        const safeIndex = clamp(Math.round(Number(insertIndex)), 0, session.layers.length);
        logPaintTrace('createPaintLayerAt.begin', {
            insertIndex: safeIndex,
            requestedIndex: insertIndex,
            layerCountBefore: session.layers.length,
            name: options.name || '',
            hasSourceCanvas: !!options.sourceCanvas
        });
        if (options.sourceCanvas) {
            record.ctx.clearRect(0, 0, session.width, session.height);
            record.ctx.drawImage(options.sourceCanvas, 0, 0);
        }
        session.layers.splice(safeIndex, 0, record);
        syncPaintLayerCanvasOrder();
        setActiveLayerRefs(safeIndex);
        syncTimelineFrameStatesAfterLayerInsert(safeIndex, record);
        captureCurrentAnimationFrameState('layer-insert');
        markPaintSessionDirty('layer-insert', {
            layerIndex: safeIndex,
            layerId: record.id || '',
            layerCount: session.layers.length
        });
        logPaintTrace('createPaintLayerAt.complete', {
            insertIndex: safeIndex,
            layerId: record.id,
            layerName: record.name,
            layerCount: session.layers.length
        });
        persistLoadedTimelineStatesForCurrentAnimation('layer-insert');
        queuePaintLayerViewerRefresh('layer-insert');
        return record;
    }

    function insertBlankLayerRelative(direction = 'up', options = {}) {
        const session = getSession();
        if (!session?.layers?.length) {
            return null;
        }
        const activeLayerIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        const normalizedDirection = String(direction || '').trim().toLowerCase() === 'down' ? 'down' : 'up';
        const insertIndex = normalizedDirection === 'down'
            ? Math.max(1, activeLayerIndex)
            : activeLayerIndex + 1;
        logPaintTrace('insertBlankLayerRelative', {
            direction: normalizedDirection,
            activeLayerIndex,
            insertIndex,
            layerCount: session.layers.length
        });
        return createPaintLayerAt(insertIndex, options);
    }

    function moveActiveLayerDown() {
        const session = getSession();
        if (!session?.layers?.length) {
            return;
        }
        if (!ensureLayerStackEditable()) {
            return;
        }
        const index = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        if (index <= 1) {
            if (index === 1) {
                const next = session.layers[index];
                session.layers[index] = session.layers[index - 1];
                session.layers[index - 1] = next;
                setActiveLayerRefs(index - 1, { skipUi: true });
                syncPaintLayerCanvasOrder();
                syncTimelineFrameStatesAfterLayerSwap(index, index - 1);
                captureCurrentAnimationFrameState('layer-swap-down');
                markPaintSessionDirty('layer-swap-down', {
                    fromIndex: index,
                    toIndex: index - 1,
                    activeLayerId: session.layers[index - 1]?.id || ''
                });
                persistLoadedTimelineStatesForCurrentAnimation('layer-swap-down');
                renderLayerBar();
                renderStageUi();
                queuePaintLayerViewerRefresh('layer-swap-down');
            }
            return;
        }
        const moving = session.layers[index];
        session.layers[index] = session.layers[index - 1];
        session.layers[index - 1] = moving;
        setActiveLayerRefs(index - 1, { skipUi: true });
        syncPaintLayerCanvasOrder();
        syncTimelineFrameStatesAfterLayerSwap(index, index - 1);
        captureCurrentAnimationFrameState('layer-swap-down');
        markPaintSessionDirty('layer-swap-down', {
            fromIndex: index,
            toIndex: index - 1,
            activeLayerId: session.layers[index - 1]?.id || ''
        });
        logPaintTrace('moveActiveLayerDown.complete', {
            fromIndex: index,
            toIndex: index - 1,
            activeLayerId: session.layers[index - 1]?.id || ''
        });
        persistLoadedTimelineStatesForCurrentAnimation('layer-swap-down');
        renderLayerBar();
        renderStageUi();
        queuePaintLayerViewerRefresh('layer-swap-down');
    }

    function duplicateLayerAtIndex(sourceIndex, insertIndex) {
        const session = getSession();
        if (!session?.layers?.length) {
            return null;
        }
        if (!ensureLayerStackEditable()) {
            return null;
        }
        const safeSourceIndex = clamp(Math.round(Number(sourceIndex) || 0), 0, session.layers.length - 1);
        const source = session.layers[safeSourceIndex];
        if (!source?.canvas) {
            return null;
        }
        const safeInsertIndex = clamp(Math.round(Number(insertIndex) || 0), 0, session.layers.length);
        logPaintTrace('duplicateLayerAtIndex.begin', {
            sourceIndex: safeSourceIndex,
            insertIndex: safeInsertIndex,
            sourceLayerId: source.id || '',
            sourceLayerName: source.name || ''
        });
        const duplicate = createPaintLayerAt(safeInsertIndex, {
            name: `${source.name || 'Layer'} Copy`,
            visible: source.visible,
            opacity: source.opacity,
            thumbnailTone: source.thumbnailTone,
            sourceCanvas: source.canvas
        });
        if (!duplicate?.ctx) {
            return null;
        }
        invalidateTimelinePreviewCacheForLayers([duplicate]);
        const duplicateIndex = clamp(Math.round(Number(session.activeLayerIndex) || safeInsertIndex), 0, session.layers.length - 1);
        const adjustedSourceIndex = duplicateIndex <= safeSourceIndex ? safeSourceIndex + 1 : safeSourceIndex;
        syncTimelineFrameStatesAfterLayerDuplicate(adjustedSourceIndex, duplicateIndex, duplicate);
        captureCurrentAnimationFrameState('duplicate-layer');
        logPaintTrace('duplicateLayerAtIndex.complete', {
            sourceIndex: safeSourceIndex,
            adjustedSourceIndex,
            duplicateIndex,
            sourceLayerId: source.id || '',
            duplicateLayerId: duplicate.id || ''
        });
        persistLoadedTimelineStatesForCurrentAnimation('duplicate-layer');
        refreshLayerSelectionUi('duplicate-layer', {
            centerActiveFrame: true
        });
        refreshTimelinePreviewForCurrentFrame('duplicate-layer', {
            renderBar: true,
            patchDom: true
        });
        markPaintSessionDirty('duplicate-layer', {
            sourceLayerId: source.id || '',
            duplicateLayerId: duplicate.id || '',
            layerCount: session.layers.length
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('duplicate-layer');
        queuePaintLayerViewerRefresh('duplicate-layer');
        return duplicate;
    }

    function duplicateActiveLayer() {
        const session = getSession();
        if (!session?.layers?.length) {
            return null;
        }
        const sourceIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        return duplicateLayerAtIndex(sourceIndex, session.layers.length || 0);
    }

    function duplicateActiveLayerRelative(direction = 'up') {
        const session = getSession();
        if (!session?.layers?.length) {
            return null;
        }
        const sourceIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        const insertIndex = String(direction || '').trim().toLowerCase() === 'down'
            ? Math.max(1, sourceIndex)
            : sourceIndex + 1;
        return duplicateLayerAtIndex(sourceIndex, insertIndex);
    }

    async function renameLayerAtIndex(index) {
        const session = getSession();
        if (!session?.layers?.length) {
            return;
        }
        const safeIndex = clamp(Math.round(Number(index) || 0), 0, session.layers.length - 1);
        const layer = session.layers[safeIndex];
        if (!layer) {
            return;
        }
        const value = await deps.promptForPaintText({
            title: 'Rename layer',
            placeholder: 'Layer name',
            initialValue: layer.name || `Layer ${safeIndex + 1}`,
            confirmLabel: 'Rename'
        });
        if (value === null) {
            return;
        }
        const nextName = String(value).trim() || `Layer ${safeIndex + 1}`;
        layer.name = nextName;
        persistLoadedTimelineStatesForCurrentAnimation('rename-layer');
        renderLayerBar();
        queuePaintLayerViewerRefresh('rename-layer');
    }

    function deleteActiveLayer() {
        const session = getSession();
        if (!session?.layers?.length) {
            return;
        }
        if (!ensureLayerStackEditable()) {
            return;
        }
        const layer = getActiveLayer();
        if (!layer || session.layers.length <= 1) {
            return;
        }
        if (layer.isBase) {
            utils.showToast?.('Paint: base layer cannot be deleted');
            return;
        }
        clearSelection();
        const index = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        if (layer.dynamic && layer.canvas?.parentElement) {
            layer.canvas.remove();
        }
        session.layers.splice(index, 1);
        const nextIndex = clamp(index - 1, 0, session.layers.length - 1);
        setActiveLayerRefs(nextIndex, { skipUi: true });
        syncPaintLayerCanvasOrder();
        syncTimelineFrameStatesAfterLayerDelete(index);
        captureCurrentAnimationFrameState('delete-layer');
        markPaintSessionDirty('delete-layer', {
            deletedIndex: index,
            deletedLayerId: layer.id || '',
            nextIndex,
            layerCount: session.layers.length
        });
        logPaintTrace('deleteActiveLayer.complete', {
            deletedIndex: index,
            nextIndex,
            deletedLayerId: layer.id || '',
            layerCount: session.layers.length
        });
        persistLoadedTimelineStatesForCurrentAnimation('delete-layer');
        resetUndoRedoStacks();
        renderLayerBar();
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('delete-layer');
        queuePaintLayerViewerRefresh('delete-layer');
    }

    function mergeActiveLayerDown() {
        const session = getSession();
        if (!session?.layers?.length || session.layers.length <= 1) {
            return;
        }
        if (!ensureLayerStackEditable()) {
            return;
        }
        const index = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
        if (index <= 0) {
            utils.showToast?.('Paint: no layer below to merge into');
            return;
        }
        clearSelection();
        const topLayer = session.layers[index];
        const lowerLayer = session.layers[index - 1];
        if (!topLayer?.canvas || !lowerLayer?.ctx) {
            return;
        }
        lowerLayer.ctx.save();
        lowerLayer.ctx.globalCompositeOperation = 'source-over';
        lowerLayer.ctx.globalAlpha = normalizeLayerVisibility(topLayer.visible, true) === false ? 0 : normalizeLayerOpacity(topLayer.opacity);
        lowerLayer.ctx.drawImage(topLayer.canvas, 0, 0);
        lowerLayer.ctx.restore();
        if (topLayer.dynamic && topLayer.canvas?.parentElement) {
            topLayer.canvas.remove();
        }
        session.layers.splice(index, 1);
        setActiveLayerRefs(index - 1, { skipUi: true });
        syncPaintLayerCanvasOrder();
        syncTimelineFrameStatesAfterLayerMergeDown(index);
        captureCurrentAnimationFrameState('merge-layer-down');
        markPaintSessionDirty('merge-layer', {
            mergedIndex: index,
            targetIndex: index - 1,
            removedLayerId: topLayer.id || '',
            targetLayerId: lowerLayer.id || ''
        });
        logPaintTrace('mergeActiveLayerDown.complete', {
            mergedIndex: index,
            targetIndex: index - 1,
            removedLayerId: topLayer.id || '',
            targetLayerId: lowerLayer.id || ''
        });
        persistLoadedTimelineStatesForCurrentAnimation('merge-layer');
        resetUndoRedoStacks();
        renderLayerBar();
        renderStageUi();
        renderCursorCanvas();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('merge-layer');
        queuePaintLayerViewerRefresh('merge-layer');
    }

    function mergeAllLayers() {
        const session = getSession();
        if (!session?.layers?.length || session.layers.length <= 1) {
            return;
        }
        if (!ensureLayerStackEditable()) {
            return;
        }
        clearSelection();
        const flattened = createFlattenedLayersCanvas();
        const baseLayer = session.layers[0];
        if (!flattened || !baseLayer?.ctx) {
            return;
        }
        baseLayer.ctx.save();
        baseLayer.ctx.setTransform(1, 0, 0, 1, 0, 0);
        baseLayer.ctx.clearRect(0, 0, session.width, session.height);
        baseLayer.ctx.drawImage(flattened, 0, 0);
        baseLayer.ctx.restore();
        for (let i = session.layers.length - 1; i >= 1; i -= 1) {
            const layer = session.layers[i];
            if (layer?.dynamic && layer.canvas?.parentElement) {
                layer.canvas.remove();
            }
        }
        session.layers = [baseLayer];
        setActiveLayerRefs(0, { skipUi: true });
        syncPaintLayerCanvasOrder();
        if (session.timelineStore?.frameStates) {
            Object.values(session.timelineStore.frameStates).forEach((frameState) => {
                const mergedCanvas = document.createElement('canvas');
                mergedCanvas.width = session.width;
                mergedCanvas.height = session.height;
                const mergedCtx = mergedCanvas.getContext('2d', { willReadFrequently: false });
                if (!mergedCtx) {
                    return;
                }
                (Array.isArray(frameState.layers) ? frameState.layers : []).forEach((layer) => {
                    if (layer?.canvas && normalizeLayerVisibility(layer.visible, true) !== false) {
                        mergedCtx.save();
                        mergedCtx.globalAlpha = normalizeLayerOpacity(layer.opacity);
                        mergedCtx.drawImage(layer.canvas, 0, 0);
                        mergedCtx.restore();
                    }
                });
                frameState.layers = [{
                    id: 'layer-base',
                    name: LAYER_BASE_NAME,
                    isBase: true,
                    visible: true,
                    opacity: 1,
                    thumbnailTone: normalizeLayerThumbnailTone(baseLayer?.thumbnailTone),
                    canvas: mergedCanvas
                }];
            });
        }
        captureCurrentAnimationFrameState('merge-all-layers');
        markPaintSessionDirty('merge-all-layers', {
            layerCount: session.layers.length,
            frameStateCount: Object.keys(session.timelineStore?.frameStates || {}).length
        });
        logPaintTrace('mergeAllLayers.complete', {
            layerCount: session.layers.length,
            frameStateCount: Object.keys(session.timelineStore?.frameStates || {}).length
        });
        persistLoadedTimelineStatesForCurrentAnimation('merge-all-layers');
        resetUndoRedoStacks();
        renderLayerBar();
        renderStageUi();
        renderCursorCanvas();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('merge-all-layers');
        queuePaintLayerViewerRefresh('merge-all-layers');
    }

    return {
        refreshLayerSelectionUi,
        updateLayerThumbnailTone,
        updateLayerVisibility,
        updateLayerOpacity,
        toggleActiveLayerVisibility,
        setIsolateActiveLayerEnabled,
        toggleIsolateActiveLayer,
        beginTimelineLayerDrag,
        updateTimelineLayerDrag,
        endTimelineLayerDrag,
        renderTimelineEyeIcon,
        refreshTimelineLayerControlUi,
        createPaintLayerAt,
        insertBlankLayerRelative,
        moveActiveLayerDown,
        duplicateLayerAtIndex,
        duplicateActiveLayer,
        duplicateActiveLayerRelative,
        renameLayerAtIndex,
        deleteActiveLayer,
        mergeActiveLayerDown,
        mergeAllLayers
    };
};
