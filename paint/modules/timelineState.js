'use strict';

// MARK: MODULE
module.exports = function createPaintTimelineStateModule(deps) {
    const {
        env,
        dom,
        utils,
        projectStore,
        launchTargets,
        paintWorkspaceState,
        timelinePreviewUrlCache,
        TIMELINE_LAYOUT,
        LAYER_BASE_NAME,
        LAYER_MAX,
        getSession,
        clamp,
        logPaintTrace,
        appendPaintPerfLog,
        resolveWorkspaceAsset,
        resolveSessionAnimationContext,
        resolveSessionLaunchTarget,
        cloneLayerSnapshots,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        normalizeLayerThumbnailTone,
        buildCanonicalAnimationLayerSchema,
        normalizeTimelineLayerSnapshots,
        repairLoadedTimelineFrameStates,
        loadPersistedTimelineFrameState,
        persistTimelineFrameState,
        persistActiveTimelineFrameState,
        createFlattenedLayersCanvas,
        exportCanvasToPngBuffer,
        applyTimelineLayerSnapshotsToSession,
        buildTimelineFrameEntries,
        buildTimelineDisplayRows,
        buildTimelineFrameDebugSummary,
        frameListForPaint,
        resolveFramePath,
        framePathUsesRootImagePath,
        ensureAnimationFrameHasDedicatedFile,
        resolveAssetPrimaryImageRelativePath,
        resolveFrameCanvasExtension,
        refreshTimelineContextMenuOverlay,
        ensureLayerControlsEnabled,
        refreshLayerPreviewCanvases,
        updatePaintTopDockLayout,
        isTimelineBarVisible,
        isLayerPinned,
        renderTimelineLayerControl,
        escapeWorkspaceText,
        updateHud,
        renderStageUi,
        renderCursorCanvas,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        clearPaintWorkspacePlaybackTimer,
        renderPaintWorkspaceUi,
        switchPaintFile,
        resolveAnimationFrameLayerDirRelativePath,
        syncAnimationFlags,
        resolveActivePlaybackRange,
        resolvePlaybackFps,
        resolveProjectPlaybackSettings,
        importAnimationSheetInPaint,
        sliceAnimationSheetInPaint,
        rebuildAnimationSheetInPaint,
        exportAnimationBundle,
        runCurrentFrameRepair,
        runAnimationFrameBatch,
        ensureAnimationFramesForPaint,
        primeTimelineFrameStates,
    } = deps;

    let timelineMotionTimer = null;
    let timelineQuickPreviewTimer = null;
    let timelineDeferredSyncTimer = null;
    const TIMELINE_PREVIEW_MAX_SIDE = 200;

    const renderLayerBar = (...args) => deps.renderLayerBar?.(...args);

    function getCollapsedTimelineList() {
        return dom.paintLayerList || null;
    }

    function getExpandedTimelineList() {
        return dom.paintTimelinePanelList || null;
    }

    function getVisibleTimelineLists() {
        const lists = [];
        if (dom.paintLayerBar && dom.paintLayerBar.hidden !== true && getCollapsedTimelineList()) {
            lists.push(getCollapsedTimelineList());
        }
        if (dom.paintTimelinePanel && dom.paintTimelinePanel.hidden !== true && getExpandedTimelineList()) {
            lists.push(getExpandedTimelineList());
        }
        return lists;
    }

    function ensureSessionTimelineStore(animationId = '') {
        const session = getSession();
        if (!session) {
            return null;
        }
        if (!session.timelineStore || session.timelineStore.animationId !== animationId) {
            session.timelineStore = {
                animationId: String(animationId || ''),
                frameStates: {},
                currentFrameId: ''
            };
            logPaintTrace('timelineStore.reset', {
                animationId: String(animationId || '')
            });
        }
        return session.timelineStore;
    }

    function cacheSessionLayersInTimelineStore(animationId = '', frameId = 'timeline-session-frame', reason = 'timeline-cache', metadata = {}) {
        const session = getSession();
        if (!session || !Array.isArray(session.layers) || !session.layers.length) {
            return false;
        }
        const store = ensureSessionTimelineStore(String(animationId || ''));
        if (!store) {
            return false;
        }
        const layers = cloneLayerSnapshots(session.layers);
        store.frameStates[String(frameId || 'timeline-session-frame')] = {
            frameId: String(frameId || 'timeline-session-frame'),
            layers
        };
        store.currentFrameId = String(frameId || 'timeline-session-frame');
        logPaintTrace('timeline.frameState.cached', {
            reason,
            assetId: String(metadata.assetId || ''),
            animationId: String(animationId || ''),
            frameId: String(frameId || 'timeline-session-frame'),
            frameIndex: Number.isFinite(Number(metadata.frameIndex)) ? Number(metadata.frameIndex) : -1,
            launchMode: resolveSessionLaunchTarget()?.mode || '',
            layerCount: layers.length,
            fallbackSingleFrame: !animationId,
            layers: layers.map((layer, index) => ({
                index,
                id: String(layer?.id || ''),
                name: String(layer?.name || ''),
                visible: normalizeLayerVisibility(layer?.visible, true),
                opacity: normalizeLayerOpacity(layer?.opacity)
            }))
        });
        return true;
    }

    function captureCurrentAnimationFrameState(reason = 'capture') {
        const session = getSession();
        if (!session) {
            return false;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        if (!context.animation?.id || !context.frame?.id) {
            return false;
        }
        const store = ensureSessionTimelineStore(context.animation.id);
        if (!store) {
            return false;
        }
        store.frameStates[context.frame.id] = {
            frameId: context.frame.id,
            layers: cloneLayerSnapshots(session.layers)
        };
        store.currentFrameId = context.frame.id;
        logPaintTrace('timelineFrame.capture', {
            reason,
            assetId: asset?.id || '',
            animationId: context.animation.id,
            frameId: context.frame.id,
            layerCount: store.frameStates[context.frame.id].layers.length
        });
        return true;
    }

    function syncCurrentFrameStateForTimeline(reason = 'timeline-sync') {
        const session = getSession();
        if (!session || !Array.isArray(session.layers) || !session.layers.length) {
            return false;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        if (!context.animation?.id || !context.frame?.id) {
            return cacheSessionLayersInTimelineStore('', session?.timelineStore?.currentFrameId || 'timeline-session-frame', reason, {
                assetId: asset?.id || '',
                frameIndex: 0
            });
        }
        return cacheSessionLayersInTimelineStore(context.animation.id, context.frame.id, reason, {
            assetId: asset?.id || '',
            frameIndex: context.frameIndex
        });
    }

    function clearDeferredTimelineSync() {
        if (!timelineDeferredSyncTimer) {
            return;
        }
        if (typeof timelineDeferredSyncTimer === 'number') {
            clearTimeout(timelineDeferredSyncTimer);
        } else if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(timelineDeferredSyncTimer);
        }
        timelineDeferredSyncTimer = null;
    }

    function scheduleDeferredTimelineStoreSync(reason = 'timeline-sync-deferred', options = {}) {
        const session = getSession();
        if (!session || !Array.isArray(session.layers) || !session.layers.length) {
            return false;
        }
        clearDeferredTimelineSync();
        const waitMs = Math.max(0, Math.round(Number(options.waitMs) || 90));
        const useIdleCallback = options.useIdleCallback !== false;
        const runSync = () => {
            timelineDeferredSyncTimer = null;
            const startedAt = Date.now();
            const synced = syncCurrentFrameStateForTimeline(reason);
            logPaintTrace('timeline.frameState.deferredSync', {
                reason,
                synced,
                currentFrameId: String(session?.timelineStore?.currentFrameId || '')
            });
            appendPaintPerfLog(`timeline-sync-deferred ms=${Date.now() - startedAt} reason=${reason}`);
        };
        if (useIdleCallback && typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            timelineDeferredSyncTimer = window.requestIdleCallback(() => {
                runSync();
            }, { timeout: waitMs + 180 });
            return true;
        }
        timelineDeferredSyncTimer = setTimeout(runSync, waitMs);
        return true;
    }

    function refreshTimelinePreviewForCurrentFrame(reason = 'timeline-preview-refresh', options = {}) {
        const session = getSession();
        const synced = options.syncStore === false ? false : syncCurrentFrameStateForTimeline(reason);
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const currentFrameId = String(
            session?.timelineStore?.currentFrameId
            || getCurrentTimelineFrameId(asset, context.animation || null, context)
            || ''
        );
        const shouldRenderBar = isTimelineBarVisible() && options.renderBar !== false;
        const patchDom = shouldRenderBar && options.patchDom !== false;
        let patched = false;
        if (patchDom && currentFrameId) {
            patched = patchTimelineVisibleFramePreviews(currentFrameId, reason);
        }
        logPaintTrace('timeline.preview.refresh', {
            reason,
            synced,
            drawerOpen: paintWorkspaceState.drawerOpen === true,
            quickPreview: paintWorkspaceState.timelineQuickPreview === true,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true,
            renderBar: shouldRenderBar,
            patchDom,
            patched,
            currentFrameId
        });
        if (shouldRenderBar && !patched) {
            renderLayerBar();
        }
        return synced;
    }

    async function loadAnimationFrameIntoSession(asset, animation, frame, options = {}) {
        const session = getSession();
        if (!session || !asset?.id || !animation?.id || !frame?.id) {
            return false;
        }
        const previousFrameContext = resolveSessionAnimationContext(resolveWorkspaceAsset());
        const previousFrameId = String(previousFrameContext.frame?.id || '');
        const normalizedContext = await ensureAnimationFrameHasDedicatedFile(asset, animation, frame);
        const targetAsset = normalizedContext.asset || asset;
        const targetAnimation = normalizedContext.animation || animation;
        const targetFrame = normalizedContext.frame || frame;
        const absolutePath = projectStore.resolveAssetPath(targetAsset, resolveFramePath(targetFrame));
        if (!absolutePath) {
            return false;
        }
        const deferredPersist = previousFrameId && previousFrameId !== String(targetFrame.id || '')
            ? persistActiveTimelineFrameState(options.reason || 'before-frame-switch').catch((error) => {
                logPaintTrace('timeline.framePersist.deferredFailed', {
                    assetId: asset?.id || '',
                    animationId: animation?.id || '',
                    previousFrameId,
                    targetFrameId: String(targetFrame.id || ''),
                    reason: options.reason || 'before-frame-switch',
                    message: error?.message || String(error)
                });
                return false;
            })
            : null;
        logPaintTrace('timeline.framePersist.deferred', {
            assetId: asset?.id || '',
            animationId: animation?.id || '',
            previousFrameId,
            targetFrameId: String(targetFrame.id || ''),
            deferred: !!deferredPersist,
            reason: options.reason || 'before-frame-switch'
        });
        const store = ensureSessionTimelineStore(targetAnimation.id);
        let frameState = store.frameStates[targetFrame.id] || null;
        if (!frameState) {
            frameState = await loadPersistedTimelineFrameState(targetAsset, targetAnimation, targetFrame, {
                fallbackLayers: session.layers || []
            });
            store.frameStates[targetFrame.id] = frameState;
            logPaintTrace('timelineFrame.seededFromDisk', {
                assetId: targetAsset.id,
                animationId: targetAnimation.id,
                frameId: targetFrame.id,
                absolutePath,
                layerCount: frameState.layers.length
            });
        }
        const canonicalLayerSchema = buildCanonicalAnimationLayerSchema(targetAsset, targetAnimation, session.layers || []);
        frameState.layers = normalizeTimelineLayerSnapshots(frameState.layers || [], canonicalLayerSchema, {
            cloneCanvas: false,
            reason: 'frame-load-current-frame',
            assetId: targetAsset.id,
            animationId: targetAnimation.id,
            frameId: targetFrame.id
        });
        repairLoadedTimelineFrameStates(canonicalLayerSchema, 'frame-load-reconcile');
        session.filePath = absolutePath;
        session.launchTarget = launchTargets.normalizePaintLaunchTarget({
            mode: launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME,
            boardId: session.boardId || '',
            blockId: session.blockId || '',
            assetId: targetAsset.id,
            animationId: targetAnimation.id,
            frameId: targetFrame.id,
            filePath: absolutePath,
            source: 'timeline-switch'
        });
        store.currentFrameId = targetFrame.id;
        applyTimelineLayerSnapshotsToSession(frameState.layers, {
            activeLayerIndex: Math.min(Math.max(0, Number(session.activeLayerIndex) || 0), Math.max(0, frameState.layers.length - 1)),
            skipUi: true,
            layerSchema: canonicalLayerSchema,
            reason: 'frame-load-apply',
            assetId: targetAsset.id,
            animationId: targetAnimation.id,
            frameId: targetFrame.id
        });
        syncCurrentFrameStateForTimeline('frame-load-post-apply');
        if (isTimelineBarVisible()) {
            const patchedExpandedSelection = patchExpandedTimelineSelection('frame-load-post-apply', {
                refreshFrameIds: [targetFrame.id],
                centerActiveFrame: true
            });
            logPaintTrace('timeline.frameLoad.renderBar', {
                assetId: targetAsset.id,
                animationId: targetAnimation.id,
                frameId: targetFrame.id,
                previousFrameId,
                timelineExpanded: paintWorkspaceState.timelineExpanded === true,
                motion: paintWorkspaceState.timelineMotion || '',
                patchedExpandedSelection,
                deferredPersist: !!deferredPersist
            });
            if (!patchedExpandedSelection) {
                renderLayerBar({ syncCurrentFrame: false });
            }
        }
        projectStore.setLastOpenedTarget(targetAsset.id, session.launchTarget, 'asset2d-timeline-switch');
        const visibleTimelineEntries = buildTimelineFrameEntries(targetAsset, targetAnimation, {
            asset: targetAsset,
            animation: targetAnimation,
            frame: targetFrame,
            frameIndex: frameListForPaint(targetAnimation).findIndex((entry) => entry.id === targetFrame.id)
        });
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        logPaintTrace('timeline.frameLoad.refreshUi', {
            assetId: targetAsset.id,
            animationId: targetAnimation.id,
            frameId: targetFrame.id,
            reason: options.reason || ''
        });
        logPaintTrace('timelineFrame.loaded', {
            assetId: targetAsset.id,
            animationId: targetAnimation.id,
            frameId: targetFrame.id,
            frameIndex: targetFrame.index,
            absolutePath,
            activeLayerIndex: session.activeLayerIndex,
            layerCount: session.layers.length,
            visibleFrameIds: visibleTimelineEntries.map((entry) => entry.id),
            visibleFrameDebug: buildTimelineFrameDebugSummary(visibleTimelineEntries, targetFrame.id)
        });
        primeTimelineFrameStates(targetAsset, targetAnimation, visibleTimelineEntries, {
            render: isTimelineBarVisible(),
            reason: 'frame-load-visible'
        }).catch((error) => {
            logPaintTrace('timeline.frameState.primeVisibleFailed', {
                assetId: targetAsset.id,
                animationId: targetAnimation.id,
                frameId: targetFrame.id,
                message: error?.message || String(error)
            });
        });
        primeTimelineFrameStates(targetAsset, targetAnimation, frameListForPaint(targetAnimation)).catch((error) => {
            logPaintTrace('timeline.frameState.primeFailed', {
                assetId: targetAsset.id,
                animationId: targetAnimation.id,
                frameId: targetFrame.id,
                message: error?.message || String(error)
            });
        });
        return true;
    }

    function clearTimelineMotion(reason = 'clear') {
        const motion = String(paintWorkspaceState.timelineMotion || '');
        if (timelineMotionTimer) {
            clearTimeout(timelineMotionTimer);
            timelineMotionTimer = null;
        }
        const shell = dom.paintLayerList?.querySelector?.('.paint-timeline-shell');
        if (shell && motion) {
            shell.classList.remove(`is-motion-${motion}`);
        }
        paintWorkspaceState.timelineMotion = '';
        if (motion) {
            logPaintTrace('timeline.motion.clear', {
                motion,
                reason
            });
        }
    }

    function triggerTimelineMotion(axis, direction, options = {}) {
        const axisKey = axis === 'y' ? 'y' : 'x';
        const variant = options.variant === 'edge' ? 'edge' : 'slide';
        const visualDirection = axisKey === 'x'
            ? (Number(direction) < 0 ? 'pos' : 'neg')
            : (Number(direction) < 0 ? 'neg' : 'pos');
        const motion = variant === 'edge'
            ? `${axisKey}-edge-${visualDirection}`
            : `${axisKey}-${visualDirection}`;
        const durationMs = variant === 'edge'
            ? 110
            : (axisKey === 'x' ? 120 : 130);
        clearTimelineMotion('replace');
        paintWorkspaceState.timelineMotion = motion;
        const shell = dom.paintLayerList?.querySelector?.('.paint-timeline-shell');
        if (shell && variant === 'edge') {
            shell.classList.remove(`is-motion-${motion}`);
            void shell.offsetWidth;
            shell.classList.add(`is-motion-${motion}`);
        }
        logPaintTrace('timeline.motion.start', {
            axis: axisKey,
            direction,
            visualDirection,
            motion,
            variant,
            durationMs,
            applyTarget: variant === 'edge' ? 'live-shell' : 'next-render'
        });
        timelineMotionTimer = setTimeout(() => {
            clearTimelineMotion('timeout');
            logPaintTrace('timeline.motion.end', {
                motion
            });
        }, durationMs);
    }

    function logTimelineDomMetrics(reason = 'timeline-dom') {
        if (!dom.paintLayerList) {
            return;
        }
        const shell = dom.paintLayerList.querySelector('.paint-timeline-shell');
        const rows = Array.from(dom.paintLayerList.querySelectorAll('.paint-timeline-row'));
        const rowMetrics = rows.map((row) => {
            const viewport = row.querySelector('.paint-timeline-row-viewport');
            const cells = Array.from(row.querySelectorAll('.paint-timeline-cell')).map((cell, cellIndex) => ({
                cellIndex,
                frameId: String(cell.dataset.frameId || ''),
                layerIndex: Number(cell.dataset.layerIndex ?? -1),
                pseudo: String(cell.dataset.pseudoFrame || '') === '1',
                current: cell.classList.contains('is-current-column'),
                active: cell.classList.contains('is-active-cell'),
                disabled: cell.classList.contains('is-disabled'),
                left: Math.round(cell.offsetLeft || 0),
                width: Math.round(cell.offsetWidth || 0)
            }));
            return {
                layerIndex: Number(row.dataset.layerIndex ?? -1),
                activeRow: row.classList.contains('is-active'),
                expandedRow: row.classList.contains('is-expanded-row'),
                viewportWidth: Math.round(viewport?.clientWidth || 0),
                viewportScrollLeft: Math.round(viewport?.scrollLeft || 0),
                cellCount: cells.length,
                cells
            };
        });
        logPaintTrace('timeline.dom.metrics', {
            reason,
            expanded: shell?.classList.contains('is-expanded') === true,
            motion: paintWorkspaceState.timelineMotion || '',
            rowCount: rows.length,
            rowMetrics
        });
    }

    function buildTimelineCellCheckerStyle(layer) {
        const tone = normalizeLayerThumbnailTone(layer?.thumbnailTone);
        const base = Math.round(tone * 255);
        const delta = 22;
        const light = clamp(base + delta, 0, 255);
        const dark = clamp(base - delta, 0, 255);
        return `--paint-thumb-checker-light: rgb(${light}, ${light}, ${light}); --paint-thumb-checker-dark: rgb(${dark}, ${dark}, ${dark}); --paint-thumb-checker-base: rgb(${base}, ${base}, ${base});`;
    }

    function resolveTimelineFrameLayers(frameId, currentFrameId) {
        const session = getSession();
        const targetFrameId = String(frameId || '');
        if (!targetFrameId) {
            return [];
        }
        if (targetFrameId === String(currentFrameId || '') && Array.isArray(session?.layers) && session.layers.length) {
            return session.layers;
        }
        const frameLayers = session?.timelineStore?.frameStates?.[targetFrameId]?.layers;
        if (!Array.isArray(frameLayers) || !frameLayers.length) {
            logPaintTrace('timeline.frameLayers.missing', {
                requestedFrameId: targetFrameId,
                currentFrameId: String(currentFrameId || ''),
                storeAnimationId: String(session?.timelineStore?.animationId || ''),
                storeFrameIds: Object.keys(session?.timelineStore?.frameStates || {})
            });
        }
        return Array.isArray(frameLayers) ? frameLayers : [];
    }

    function resolveTimelineCanvasPreviewUrl(canvas, trace = {}) {
        if (!canvas || typeof canvas.toDataURL !== 'function') {
            return '';
        }
        const cachedUrl = timelinePreviewUrlCache.get(canvas);
        if (cachedUrl) {
            return cachedUrl;
        }
        try {
            let previewSource = canvas;
            const sourceWidth = Math.max(1, Math.round(Number(canvas.width) || 1));
            const sourceHeight = Math.max(1, Math.round(Number(canvas.height) || 1));
            const maxSourceSide = Math.max(sourceWidth, sourceHeight);
            if (maxSourceSide > TIMELINE_PREVIEW_MAX_SIDE && typeof document !== 'undefined') {
                const scale = TIMELINE_PREVIEW_MAX_SIDE / maxSourceSide;
                const previewCanvas = document.createElement('canvas');
                previewCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
                previewCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
                const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: false });
                if (previewCtx) {
                    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                    previewCtx.imageSmoothingEnabled = true;
                    previewCtx.imageSmoothingQuality = 'high';
                    previewCtx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, previewCanvas.width, previewCanvas.height);
                    previewSource = previewCanvas;
                }
            }
            const dataUrl = previewSource.toDataURL('image/png');
            timelinePreviewUrlCache.set(canvas, dataUrl);
            logPaintTrace('timeline.thumbnail.resolve', {
                ...trace,
                cacheHit: false,
                previewWidth: Math.round(Number(previewSource.width) || 0),
                previewHeight: Math.round(Number(previewSource.height) || 0)
            });
            return dataUrl;
        } catch {}
        return '';
    }

    function resolveTimelineCellPreviewUrl(asset, frameEntry, layerIndex, currentFrameId) {
        const frameLayers = resolveTimelineFrameLayers(frameEntry?.id || '', currentFrameId);
        const layer = Array.isArray(frameLayers) ? frameLayers[layerIndex] : null;
        if (layer?.canvas && typeof layer.canvas.toDataURL === 'function') {
            const resolved = resolveTimelineCanvasPreviewUrl(layer.canvas, {
                frameId: frameEntry?.id || '',
                frameIndex: Number(frameEntry?.index ?? -1),
                layerIndex,
                slot: String(frameEntry?.slot || ''),
                pseudo: frameEntry?.pseudo === true,
                currentFrameId: String(currentFrameId || ''),
                layerId: String(layer?.id || ''),
                layerName: String(layer?.name || ''),
                layerVisible: normalizeLayerVisibility(layer?.visible, true),
                layerOpacity: normalizeLayerOpacity(layer?.opacity),
                canvasWidth: Math.round(layer?.canvas?.width || 0),
                canvasHeight: Math.round(layer?.canvas?.height || 0),
                source: frameEntry?.id === currentFrameId ? 'session-current' : 'timeline-store'
            });
            if (resolved) {
                return resolved;
            }
        }
        if (layerIndex === 0 && asset && frameEntry?.path) {
            try {
                logPaintTrace('timeline.thumbnail.resolve', {
                    frameId: frameEntry?.id || '',
                    frameIndex: Number(frameEntry?.index ?? -1),
                    layerIndex,
                    slot: String(frameEntry?.slot || ''),
                    pseudo: frameEntry?.pseudo === true,
                    currentFrameId: String(currentFrameId || ''),
                    source: 'frame-file'
                });
                return projectStore.toFileUrl(asset, frameEntry.path);
            } catch {}
        }
        logPaintTrace('timeline.thumbnail.resolve', {
            frameId: frameEntry?.id || '',
            frameIndex: Number(frameEntry?.index ?? -1),
            layerIndex,
            slot: String(frameEntry?.slot || ''),
            pseudo: frameEntry?.pseudo === true,
            currentFrameId: String(currentFrameId || ''),
            hasFrameLayers: Array.isArray(frameLayers),
            frameLayerCount: Array.isArray(frameLayers) ? frameLayers.length : 0,
            source: 'blank'
        });
        return '';
    }

    function buildTimelineFrameEntryFromCellNode(cell) {
        if (!cell) {
            return null;
        }
        return {
            id: String(cell.dataset.frameId || ''),
            index: Number.isFinite(Number(cell.dataset.frameIndex)) ? Number(cell.dataset.frameIndex) : -1,
            path: String(cell.dataset.framePath || ''),
            pseudo: String(cell.dataset.pseudoFrame || '') === '1',
            disabled: cell.disabled === true || String(cell.dataset.disabled || '') === '1',
            slot: String(cell.dataset.slot || 'center')
        };
    }

    function updateTimelineCellSelectionState(cell, currentFrameId, activeLayerIndex) {
        if (!cell) {
            return false;
        }
        const layerIndex = Number(cell.dataset.layerIndex);
        const frameId = String(cell.dataset.frameId || '');
        const disabled = cell.disabled === true || String(cell.dataset.disabled || '') === '1';
        const isCurrentColumn = !disabled && frameId === String(currentFrameId || '');
        const isActiveCell = isCurrentColumn && Number.isFinite(layerIndex) && layerIndex === activeLayerIndex;
        cell.classList.toggle('is-current-column', isCurrentColumn);
        cell.classList.toggle('is-active-cell', isActiveCell);
        return true;
    }

    function updateTimelineCellPreviewNode(cell, asset, currentFrameId, activeLayerIndex) {
        if (!cell) {
            return false;
        }
        const layerIndex = Number(cell.dataset.layerIndex);
        if (!Number.isFinite(layerIndex)) {
            return false;
        }
        const frameEntry = buildTimelineFrameEntryFromCellNode(cell);
        if (!frameEntry?.id) {
            return false;
        }
        const frameUrl = resolveTimelineCellPreviewUrl(asset, frameEntry, layerIndex, currentFrameId);
        let img = cell.querySelector('img');
        let fallback = cell.querySelector('.paint-timeline-cell-fallback');
        if (frameUrl) {
            if (!img) {
                img = document.createElement('img');
                img.alt = `Frame ${Math.max(1, frameEntry.index + 1)}`;
                if (fallback) {
                    fallback.replaceWith(img);
                    fallback = null;
                } else {
                    cell.appendChild(img);
                }
            }
            if (img.getAttribute('src') !== frameUrl) {
                img.setAttribute('src', frameUrl);
            }
        } else {
            if (img) {
                img.remove();
            }
            if (!fallback) {
                fallback = document.createElement('span');
                fallback.className = 'paint-timeline-cell-fallback';
                cell.appendChild(fallback);
            }
        }
        updateTimelineCellSelectionState(cell, currentFrameId, activeLayerIndex);
        return true;
    }

    function patchTimelineVisibleFramePreviews(frameId, reason = 'timeline-preview-patch') {
        const session = getSession();
        const timelineLists = getVisibleTimelineLists();
        if (!timelineLists.length || !isTimelineBarVisible() || !frameId) {
            return false;
        }
        const cells = timelineLists.flatMap((listEl) => Array.from(listEl.querySelectorAll('.paint-timeline-cell')))
            .filter((cell) => String(cell.dataset.frameId || '') === String(frameId || ''));
        if (!cells.length) {
            logPaintTrace('timeline.preview.patchDomMissing', {
                reason,
                frameId: String(frameId || '')
            });
            return false;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const currentFrameId = getCurrentTimelineFrameId(asset, context.animation || null, context);
        const activeLayerIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        let patchedCount = 0;
        cells.forEach((cell) => {
            if (updateTimelineCellPreviewNode(cell, asset, currentFrameId, activeLayerIndex)) {
                patchedCount += 1;
            }
        });
        logPaintTrace('timeline.preview.patchDom', {
            reason,
            requestedFrameId: String(frameId || ''),
            currentFrameId,
            activeLayerIndex,
            cellCount: cells.length,
            patchedCount,
            expanded: paintWorkspaceState.timelineExpanded === true
        });
        return patchedCount > 0;
    }

    function patchTimelineVisibleFrames(frameIds = [], reason = 'timeline-visible-frame-patch') {
        const uniqueFrameIds = Array.from(new Set((Array.isArray(frameIds) ? frameIds : []).map((entry) => String(entry || '')).filter(Boolean)));
        if (!uniqueFrameIds.length) {
            return false;
        }
        let patchedAny = false;
        uniqueFrameIds.forEach((frameId) => {
            if (patchTimelineVisibleFramePreviews(frameId, `${reason}:${frameId}`)) {
                patchedAny = true;
            }
        });
        logPaintTrace('timeline.preview.patchFrames', {
            reason,
            frameIds: uniqueFrameIds,
            patchedAny,
            drawerOpen: paintWorkspaceState.drawerOpen === true,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true
        });
        return patchedAny;
    }

    function patchExpandedTimelineSelection(reason = 'timeline-selection-patch', options = {}) {
        const session = getSession();
        const expandedList = getExpandedTimelineList();
        if (!expandedList || paintWorkspaceState.expandedTimelineVisible !== true) {
            return false;
        }
        const shell = expandedList.querySelector('.paint-timeline-shell.is-expanded');
        const rows = Array.from(expandedList.querySelectorAll('.paint-timeline-row'));
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const animation = context.animation || null;
        const displayRows = buildTimelineDisplayRows(session?.layers || []);
        if (!shell || !rows.length || rows.length !== displayRows.length) {
            logPaintTrace('timeline.selection.patchDomSkipped', {
                reason,
                shellFound: !!shell,
                domRowCount: rows.length,
                expectedRowCount: displayRows.length
            });
            return false;
        }
        const expectedFrameIds = frameListForPaint(animation).map((frame) => String(frame.id || ''));
        const firstRowFrameIds = Array.from(rows[0].querySelectorAll('.paint-timeline-cell')).map((cell) => String(cell.dataset.frameId || ''));
        if (expectedFrameIds.length !== firstRowFrameIds.length || expectedFrameIds.some((frameId, index) => frameId !== firstRowFrameIds[index])) {
            logPaintTrace('timeline.selection.patchDomSkipped', {
                reason,
                shellFound: !!shell,
                domRowCount: rows.length,
                expectedRowCount: displayRows.length,
                expectedFrameIds,
                firstRowFrameIds
            });
            return false;
        }
        const currentFrameId = getCurrentTimelineFrameId(asset, animation, context);
        const activeLayerIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const refreshFrameIds = new Set((Array.isArray(options.refreshFrameIds) ? options.refreshFrameIds : []).map((entry) => String(entry || '')).filter(Boolean));
        let updatedCellCount = 0;
        rows.forEach((row) => {
            const rowLayerIndex = Number(row.dataset.layerIndex);
            const isActiveRow = Number.isFinite(rowLayerIndex) && rowLayerIndex === activeLayerIndex;
            row.classList.toggle('is-active', isActiveRow);
            const control = row.querySelector('.paint-timeline-layer-control');
            if (control) {
                control.classList.toggle('is-active', isActiveRow);
            }
            row.querySelectorAll('.paint-timeline-cell').forEach((cell) => {
                const frameId = String(cell.dataset.frameId || '');
                const shouldRefreshPreview = options.refreshAllPreviews === true || refreshFrameIds.has(frameId);
                const updated = shouldRefreshPreview
                    ? updateTimelineCellPreviewNode(cell, asset, currentFrameId, activeLayerIndex)
                    : updateTimelineCellSelectionState(cell, currentFrameId, activeLayerIndex);
                if (updated) {
                    updatedCellCount += 1;
                }
            });
        });
        if (options.centerActiveFrame === true) {
            centerTimelineOnActiveFrame({
                behavior: 'auto'
            });
        }
        logPaintTrace('timeline.selection.patchDom', {
            reason,
            currentFrameId,
            activeLayerIndex,
            rowCount: rows.length,
            frameCount: expectedFrameIds.length,
            updatedCellCount,
            refreshFrameIds: Array.from(refreshFrameIds),
            centerActiveFrame: options.centerActiveFrame === true
        });
        return true;
    }

    function patchCollapsedTimelineSelection(reason = 'timeline-selection-collapsed-patch') {
        const session = getSession();
        const collapsedList = getCollapsedTimelineList();
        if (!collapsedList || dom.paintLayerBar?.hidden === true) {
            return false;
        }
        const shell = collapsedList.querySelector('.paint-timeline-shell.is-collapsed');
        const row = collapsedList.querySelector('.paint-timeline-row.is-collapsed-row');
        if (!shell || !row) {
            return false;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const animation = context.animation || null;
        const displayRows = buildTimelineDisplayRows(session?.layers || []);
        const activeLayerIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1));
        const activeRow = displayRows.find((entry) => entry.index === activeLayerIndex);
        if (!activeRow?.layer) {
            return false;
        }
        const visibleFrames = buildTimelineFrameEntries(asset, animation, context, { expanded: false }).filter((entry) => entry?.spacer !== true);
        const cells = Array.from(row.querySelectorAll('.paint-timeline-cell'));
        if (!visibleFrames.length || cells.length !== visibleFrames.length) {
            logPaintTrace('timeline.selection.patchCollapsedSkipped', {
                reason,
                visibleFrameCount: visibleFrames.length,
                domCellCount: cells.length,
                activeLayerIndex
            });
            return false;
        }
        const currentFrameId = getCurrentTimelineFrameId(asset, animation, context);
        const checkerStyle = buildTimelineCellCheckerStyle(activeRow.layer);
        row.dataset.layerIndex = String(activeLayerIndex);
        row.classList.add('is-active');
        row.classList.toggle('is-pinned', isLayerPinned(activeRow.layer.id));
        row.setAttribute('title', String(activeRow.layer.name || `Layer ${activeLayerIndex + 1}`));
        let patchedCount = 0;
        cells.forEach((cell, index) => {
            const frameEntry = visibleFrames[index];
            cell.dataset.layerIndex = String(activeLayerIndex);
            cell.setAttribute('style', checkerStyle);
            cell.setAttribute('title', `Layer ${String(activeRow.layer.name || `Layer ${activeLayerIndex + 1}`)}, Frame ${frameEntry.index + 1}`);
            if (updateTimelineCellPreviewNode(cell, asset, currentFrameId, activeLayerIndex)) {
                patchedCount += 1;
            }
        });
        logPaintTrace('timeline.selection.patchCollapsed', {
            reason,
            currentFrameId,
            activeLayerIndex,
            cellCount: cells.length,
            patchedCount
        });
        return patchedCount > 0;
    }

    function centerTimelineOnActiveFrame(options = {}) {
        const expandedList = getExpandedTimelineList();
        const rowViewports = Array.from(expandedList?.querySelectorAll?.('.paint-timeline-row-viewport') || []);
        if (!rowViewports.length) {
            return;
        }
        const behavior = options.behavior === 'smooth' ? 'smooth' : 'auto';
        let targetLeft = 0;
        let targetTop = 0;
        rowViewports.forEach((scroller) => {
            const activeCell = scroller.querySelector('.paint-timeline-cell.is-current-column');
            if (!activeCell) {
                return;
            }
            targetLeft = Math.max(0, activeCell.offsetLeft - ((scroller.clientWidth - activeCell.clientWidth) / 2));
            scroller.scrollTo({
                left: Math.round(targetLeft),
                behavior
            });
        });
        const panelScroller = dom.paintTimelinePanel || null;
        const activeRow = expandedList?.querySelector?.('.paint-timeline-row.is-active') || null;
        if (panelScroller && activeRow) {
            targetTop = Math.max(0, activeRow.offsetTop - Math.max(0, (panelScroller.clientHeight - activeRow.clientHeight) / 2));
            panelScroller.scrollTo({
                top: Math.round(targetTop),
                behavior
            });
        }
        logPaintTrace('timeline.centerOnFrame', {
            frameId: String(expandedList?.querySelector?.('.paint-timeline-cell.is-current-column')?.dataset?.frameId || ''),
            left: Math.round(targetLeft),
            top: Math.round(targetTop),
            behavior,
            viewportCount: rowViewports.length
        });
    }

    function getCurrentTimelineFrameId(asset, animation, context) {
        const session = getSession();
        if (session?.timelineStore?.animationId && animation?.id && session.timelineStore.animationId === animation.id && session.timelineStore.currentFrameId) {
            return String(session.timelineStore.currentFrameId || '');
        }
        if (context?.frame?.id) {
            return context.frame.id;
        }
        const frames = frameListForPaint(animation);
        if (frames.length) {
            return frames[0]?.id || '';
        }
        const entries = buildTimelineFrameEntries(asset, animation, context);
        return entries.find((entry) => entry.slot === 'center' && entry.pseudo !== true)?.id || entries[0]?.id || '';
    }

    async function navigatePaintAnimation(direction, mode) {
        const context = resolveSessionAnimationContext();
        if (!context.asset || !context.animation) {
            logPaintTrace('navigatePaintAnimation.noContext', {
                direction,
                mode,
                assetId: context.asset?.id || '',
                animationId: context.animation?.id || ''
            });
            return;
        }
        logPaintTrace('navigatePaintAnimation.begin', {
            direction,
            mode,
            assetId: context.asset.id,
            animationId: context.animation.id,
            frameId: context.frame?.id || '',
            frameIndex: context.frameIndex,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true
        });
        const animations = Object.values(context.asset.animations || {}).sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')));
        if (mode === 'animation') {
            if (!animations.length) {
                return;
            }
            const currentIndex = Math.max(0, animations.findIndex((entry) => entry.id === context.animation.id));
            const nextAnimation = animations[(currentIndex + direction + animations.length) % animations.length];
            const frames = Array.isArray(nextAnimation.frames) ? nextAnimation.frames.slice().sort((a, b) => a.index - b.index) : [];
            const targetPath = frames[0]?.workingPath || frames[0]?.originalPath || nextAnimation.starterImagePath || context.asset.still.approvedImagePath || context.asset.still.workingImagePath;
            if (targetPath) {
                projectStore.updateAsset(context.asset.id, (draft) => {
                    draft.activeAnimationId = nextAnimation.id;
                    return draft;
                }, 'asset2d-select-animation');
                const refreshedAsset = projectStore.getAsset(context.asset.id) || context.asset;
                const refreshedAnimation = refreshedAsset.animations?.[nextAnimation.id] || nextAnimation;
                const targetFrame = frameListForPaint(refreshedAnimation)[0] || null;
                if (targetFrame?.id) {
                    await loadAnimationFrameIntoSession(refreshedAsset, refreshedAnimation, targetFrame, { reason: 'navigate-animation' });
                } else {
                    await switchPaintFile(projectStore.resolveAssetPath(context.asset, targetPath));
                }
            }
            return;
        }
        const frames = Array.isArray(context.animation.frames) ? context.animation.frames.slice().sort((a, b) => a.index - b.index) : [];
        if (!frames.length) {
            return;
        }
        const currentIndex = Math.max(0, context.frameIndex >= 0 ? context.frameIndex : 0);
        const nextIndex = clamp(currentIndex + direction, 0, frames.length - 1);
        logPaintTrace('navigatePaintAnimation.framePlan', {
            direction,
            mode,
            currentIndex,
            nextIndex,
            currentFrameId: frames[currentIndex]?.id || '',
            nextFrameId: frames[nextIndex]?.id || '',
            orderedFrameIds: frames.map((frame) => frame.id)
        });
        if (nextIndex === currentIndex) {
            logPaintTrace('navigatePaintAnimation.edge', {
                direction,
                mode,
                assetId: context.asset.id,
                animationId: context.animation.id,
                frameId: context.frame?.id || '',
                frameIndex: currentIndex
            });
            triggerTimelineMotion('x', direction, { variant: 'edge' });
            return;
        }
        const nextFrame = frames[nextIndex];
        if (paintWorkspaceState.timelineExpanded !== true) {
            triggerTimelineMotion('x', direction);
        }
        const targetPath = nextFrame.workingPath || nextFrame.originalPath;
        if (targetPath) {
            await loadAnimationFrameIntoSession(context.asset, context.animation, nextFrame, { reason: 'navigate-frame' });
            logPaintTrace('navigatePaintAnimation.complete', {
                direction,
                mode,
                assetId: context.asset.id,
                animationId: context.animation.id,
                nextFrameId: nextFrame.id,
                nextFrameIndex: nextFrame.index
            });
        }
    }

    function ensureTimelineAnimation(asset) {
        if (!asset) {
            return null;
        }
        const existing = resolveSessionAnimationContext(asset).animation
            || (asset.activeAnimationId ? asset.animations?.[asset.activeAnimationId] : null)
            || Object.values(asset.animations || {})[0]
            || null;
        if (existing) {
            if (frameListForPaint(existing).length > 0) {
                return existing;
            }
            const starterPath = resolveAssetPrimaryImageRelativePath(asset);
            projectStore.updateAnimation(asset.id, existing.id, (draft) => {
                draft.starterImagePath = draft.starterImagePath || starterPath;
                draft.frames = [{
                    id: utils.createId('frame'),
                    index: 0,
                    workingPath: starterPath,
                    approvedPath: starterPath,
                    originalPath: starterPath,
                    hold: 1,
                    keyframe: true,
                    approved: true
                }];
                draft.frameCount = 1;
                return draft;
            }, 'asset2d-animation-seed');
            return projectStore.getAsset(asset.id)?.animations?.[existing.id] || existing;
        }
        const starterPath = resolveAssetPrimaryImageRelativePath(asset);
        const created = projectStore.createAnimation(asset.id, {
            name: `Animation ${Object.keys(asset.animations || {}).length + 1}`,
            starterImagePath: starterPath,
            frames: starterPath ? [{
                id: utils.createId('frame'),
                index: 0,
                workingPath: starterPath,
                approvedPath: starterPath,
                originalPath: starterPath,
                hold: 1,
                keyframe: true,
                approved: true
            }] : [],
            frameCount: starterPath ? 1 : 0
        }, 'asset2d-animation-create-timeline');
        return projectStore.getAsset(asset.id)?.animations?.[created.id] || created;
    }

    async function buildCompositeBufferFromSessionLayers(reason = 'timeline-sequence-capture') {
        const session = getSession();
        const flattened = createFlattenedLayersCanvas();
        if (!flattened) {
            throw new Error('Could not capture layered frame');
        }
        const buffer = await exportCanvasToPngBuffer(flattened);
        if (!buffer) {
            throw new Error('Could not encode layered frame');
        }
        logPaintTrace('timeline.sequence.captureBuffer', {
            reason,
            bytes: buffer.length,
            width: flattened.width,
            height: flattened.height,
            layerCount: Array.isArray(session?.layers) ? session.layers.length : 0
        });
        return buffer;
    }

    function bindSessionToSequenceFrame(asset, animation, frame, reason = 'timeline-sequence-bind') {
        const session = getSession();
        if (!session || !asset?.id || !animation?.id || !frame?.id) {
            return false;
        }
        const relativePath = resolveFramePath(frame);
        const absolutePath = relativePath
            ? projectStore.resolveAssetPath(asset, relativePath)
            : String(session.filePath || '').trim();
        if (!absolutePath) {
            return false;
        }
        session.filePath = absolutePath;
        session.launchTarget = launchTargets.normalizePaintLaunchTarget({
            ...session.launchTarget,
            mode: launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME,
            boardId: session.boardId || '',
            blockId: session.blockId || '',
            assetId: asset.id,
            animationId: animation.id,
            frameId: frame.id,
            filePath: absolutePath,
            source: reason
        });
        const store = ensureSessionTimelineStore(animation.id);
        if (store) {
            store.currentFrameId = frame.id;
        }
        projectStore.setLastOpenedTarget(asset.id, session.launchTarget, 'asset2d-sequence-bind-session');
        logPaintTrace('timeline.sequence.bindSession', {
            reason,
            assetId: asset.id,
            animationId: animation.id,
            frameId: frame.id,
            filePath: absolutePath,
            launchMode: session.launchTarget?.mode || ''
        });
        return true;
    }

    async function persistSessionIntoSequenceFrame(asset, animation, frame, options = {}) {
        const session = getSession();
        if (!session || !asset?.id || !animation?.id || !Array.isArray(session.layers) || !session.layers.length) {
            return null;
        }
        let workingAsset = projectStore.getAsset(asset.id) || asset;
        let workingAnimation = workingAsset.animations?.[animation.id] || animation;
        let workingFrame = frame?.id
            ? (frameListForPaint(workingAnimation).find((entry) => entry.id === frame.id) || frame)
            : null;
        if (!workingFrame?.id) {
            const frameId = utils.createId('frame');
            const targetRelativePath = `animations/${workingAnimation.id}/frames/working/${frameId}${resolveFrameCanvasExtension(session.filePath, resolveAssetPrimaryImageRelativePath(workingAsset))}`;
            projectStore.updateAnimation(workingAsset.id, workingAnimation.id, (draft) => {
                const nextFrames = frameListForPaint(draft);
                nextFrames.push({
                    id: frameId,
                    index: nextFrames.length,
                    workingPath: targetRelativePath,
                    approvedPath: targetRelativePath,
                    originalPath: targetRelativePath,
                    hold: 1,
                    keyframe: true,
                    approved: true,
                    selected: false,
                    isReference: false
                });
                draft.frames = nextFrames.map((entry, index) => ({
                    ...entry,
                    index
                }));
                draft.frameCount = draft.frames.length;
                draft.starterImagePath = draft.starterImagePath || targetRelativePath;
                return draft;
            }, 'asset2d-sequence-create-frame');
            workingAsset = projectStore.getAsset(workingAsset.id) || workingAsset;
            workingAnimation = workingAsset.animations?.[workingAnimation.id] || workingAnimation;
            workingFrame = frameListForPaint(workingAnimation).find((entry) => entry.id === frameId) || null;
        }
        if (!workingFrame?.id) {
            return null;
        }
        const targetRelativePath = `animations/${workingAnimation.id}/frames/working/${workingFrame.id}${resolveFrameCanvasExtension(resolveFramePath(workingFrame), session.filePath, resolveAssetPrimaryImageRelativePath(workingAsset))}`;
        const compositeBuffer = await buildCompositeBufferFromSessionLayers(options.reason || 'timeline-sequence-sync');
        projectStore.writeBufferToAsset(workingAsset.id, targetRelativePath, compositeBuffer);
        projectStore.updateAnimation(workingAsset.id, workingAnimation.id, (draft) => {
            const nextFrames = frameListForPaint(draft).map((entry, index) => (
                entry.id === workingFrame.id
                    ? {
                        ...entry,
                        index,
                        workingPath: targetRelativePath,
                        approvedPath: targetRelativePath,
                        originalPath: targetRelativePath,
                        hold: Math.max(1, Number(entry.hold) || 1),
                        keyframe: entry.keyframe !== false,
                        approved: true
                    }
                    : {
                        ...entry,
                        index
                    }
            ));
            draft.frames = nextFrames;
            draft.frameCount = nextFrames.length;
            draft.starterImagePath = draft.starterImagePath || targetRelativePath;
            return draft;
        }, 'asset2d-sequence-sync-frame');
        workingAsset = projectStore.getAsset(workingAsset.id) || workingAsset;
        workingAnimation = workingAsset.animations?.[workingAnimation.id] || workingAnimation;
        workingFrame = frameListForPaint(workingAnimation).find((entry) => entry.id === workingFrame.id) || workingFrame;
        const frameLayers = cloneLayerSnapshots(session.layers);
        const store = ensureSessionTimelineStore(workingAnimation.id);
        if (store) {
            store.frameStates[workingFrame.id] = {
                frameId: workingFrame.id,
                layers: frameLayers
            };
            store.currentFrameId = workingFrame.id;
        }
        await persistTimelineFrameState(workingAsset, workingAnimation, workingFrame.id, frameLayers, {
            reason: options.reason || 'timeline-sequence-sync'
        });
        bindSessionToSequenceFrame(workingAsset, workingAnimation, workingFrame, options.reason || 'timeline-sequence-sync');
        logPaintTrace('timeline.sequence.persistSessionFrame', {
            reason: options.reason || '',
            assetId: workingAsset.id,
            animationId: workingAnimation.id,
            frameId: workingFrame.id,
            frameIndex: workingFrame.index,
            targetRelativePath,
            layerCount: frameLayers.length
        });
        return {
            asset: workingAsset,
            animation: workingAnimation,
            frame: workingFrame,
            frameIndex: frameListForPaint(workingAnimation).findIndex((entry) => entry.id === workingFrame.id)
        };
    }

    async function ensureTimelineSequenceContext(reason = 'timeline-sequence') {
        const session = getSession();
        if (!session) {
            return null;
        }
        const asset = resolveWorkspaceAsset();
        if (!asset?.id) {
            return null;
        }
        const context = resolveSessionAnimationContext(asset);
        logPaintTrace('timeline.sequence.ensure.begin', {
            reason,
            assetId: asset.id,
            animationId: context.animation?.id || '',
            frameId: context.frame?.id || '',
            frameIndex: context.frameIndex,
            launchMode: resolveSessionLaunchTarget()?.mode || '',
            filePath: session.filePath || ''
        });
        if (context.animation?.id && context.frame?.id) {
            if (framePathUsesRootImagePath(resolveFramePath(context.frame))) {
                const normalized = await persistSessionIntoSequenceFrame(context.asset || asset, context.animation, context.frame, {
                    reason: `${reason}-normalize-root-image`
                });
                logPaintTrace('timeline.sequence.ensure.end', {
                    reason,
                    assetId: normalized?.asset?.id || asset.id,
                    animationId: normalized?.animation?.id || context.animation.id,
                    frameId: normalized?.frame?.id || context.frame.id,
                    normalized: true
                });
                return normalized;
            }
            cacheSessionLayersInTimelineStore(context.animation.id, context.frame.id, `${reason}-existing`, {
                assetId: asset.id,
                frameIndex: context.frameIndex
            });
            bindSessionToSequenceFrame(context.asset || asset, context.animation, context.frame, `${reason}-existing`);
            logPaintTrace('timeline.sequence.ensure.end', {
                reason,
                assetId: asset.id,
                animationId: context.animation.id,
                frameId: context.frame.id,
                normalized: false
            });
            return resolveSessionAnimationContext(projectStore.getAsset(asset.id) || asset);
        }
        const ensuredAnimation = ensureTimelineAnimation(asset);
        const refreshedAsset = projectStore.getAsset(asset.id) || asset;
        const workingAnimation = ensuredAnimation?.id
            ? (refreshedAsset.animations?.[ensuredAnimation.id] || ensuredAnimation)
            : null;
        if (!workingAnimation?.id) {
            logPaintTrace('timeline.sequence.ensure.failed', {
                reason,
                assetId: asset.id
            });
            return null;
        }
        const animationFrames = frameListForPaint(workingAnimation);
        const promotionTargetFrame = animationFrames.length === 1 && framePathUsesRootImagePath(resolveFramePath(animationFrames[0]))
            ? animationFrames[0]
            : null;
        const promoted = await persistSessionIntoSequenceFrame(refreshedAsset, workingAnimation, promotionTargetFrame, {
            reason: `${reason}-promote-image`
        });
        logPaintTrace('timeline.sequence.ensure.end', {
            reason,
            assetId: promoted?.asset?.id || refreshedAsset.id,
            animationId: promoted?.animation?.id || workingAnimation.id,
            frameId: promoted?.frame?.id || '',
            normalized: true
        });
        return promoted;
    }


    return {
        ensureSessionTimelineStore,
        cacheSessionLayersInTimelineStore,
        captureCurrentAnimationFrameState,
        syncCurrentFrameStateForTimeline,
        clearDeferredTimelineSync,
        scheduleDeferredTimelineStoreSync,
        refreshTimelinePreviewForCurrentFrame,
        loadAnimationFrameIntoSession,
        clearTimelineMotion,
        triggerTimelineMotion,
        logTimelineDomMetrics,
        buildTimelineCellCheckerStyle,
        resolveTimelineFrameLayers,
        resolveTimelineCanvasPreviewUrl,
        resolveTimelineCellPreviewUrl,
        buildTimelineFrameEntryFromCellNode,
        updateTimelineCellSelectionState,
        updateTimelineCellPreviewNode,
        patchTimelineVisibleFramePreviews,
        patchTimelineVisibleFrames,
        patchExpandedTimelineSelection,
        patchCollapsedTimelineSelection,
        centerTimelineOnActiveFrame,
        getCurrentTimelineFrameId,
        primeTimelineFrameStates,
        navigatePaintAnimation,
        ensureTimelineAnimation,
        buildCompositeBufferFromSessionLayers,
        bindSessionToSequenceFrame,
        persistSessionIntoSequenceFrame,
        ensureTimelineSequenceContext
    };
};
