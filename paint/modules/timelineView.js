'use strict';

// MARK: MODULE
module.exports = function createPaintTimelineViewModule(deps) {
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
        isLayerPinned,
        renderTimelineLayerControl,
        escapeWorkspaceText,
        logTimelineDomMetrics,
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
    } = deps;

    let timelineMotionTimer = null;
    let timelineQuickPreviewTimer = null;
    let timelineDeferredSyncTimer = null;
    let timelineDeferredPreviewToken = 0;
    let timelineDeferredLayerPreviewToken = 0;
    let timelineLastDomMetricsAt = 0;

    const {
        ensureTimelineSequenceContext,
        ensureTimelineAnimation,
        ensureSessionTimelineStore,
        loadAnimationFrameIntoSession,
        triggerTimelineMotion,
        clearTimelineMotion,
        captureCurrentAnimationFrameState,
        getCurrentTimelineFrameId,
        syncCurrentFrameStateForTimeline,
        resolveTimelineCellPreviewUrl,
        buildTimelineCellCheckerStyle
    } = deps;

    const centerTimelineOnActiveFrame = (...args) => deps.centerTimelineOnActiveFrame?.(...args);
    const patchTimelineVisibleFrames = (...args) => deps.patchTimelineVisibleFrames?.(...args);

    function syncTimelineVisibilityFlags() {
        paintWorkspaceState.timelineExpanded = paintWorkspaceState.expandedTimelineVisible === true;
        paintWorkspaceState.drawerOpen = paintWorkspaceState.expandedTimelineVisible === true;
    }

    function isCollapsedTimelineVisible() {
        return paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.timelineQuickPreview === true;
    }

    function isExpandedTimelineVisible() {
        return paintWorkspaceState.expandedTimelineVisible === true;
    }

    function getTimelineTarget(mode = 'collapsed') {
        if (mode === 'expanded') {
            return {
                mode: 'expanded',
                barEl: dom.paintTimelinePanel || null,
                listEl: dom.paintTimelinePanelList || null,
                isExpanded: true,
                visible: isExpandedTimelineVisible(),
                signatureKey: 'expandedTimelineRenderSignature'
            };
        }
        return {
            mode: 'collapsed',
            barEl: dom.paintLayerBar || null,
            listEl: dom.paintLayerList || null,
            isExpanded: false,
            visible: isCollapsedTimelineVisible(),
            signatureKey: 'collapsedTimelineRenderSignature'
        };
    }

    function scheduleTimelineDomMetrics(reason = 'timeline-dom', options = {}) {
        if (options.logDomMetrics === false || typeof window === 'undefined') {
            return false;
        }
        const now = Date.now();
        if ((now - timelineLastDomMetricsAt) < 900) {
            return false;
        }
        timelineLastDomMetricsAt = now;
        window.requestAnimationFrame(() => {
            logTimelineDomMetrics(reason);
        });
        return true;
    }

    function scheduleDeferredTimelinePreviewPatch(frameEntries = [], reason = 'timeline-preview-deferred') {
        if (typeof window === 'undefined') {
            return false;
        }
        const frameIds = Array.from(new Set((Array.isArray(frameEntries) ? frameEntries : [])
            .filter((entry) => entry?.spacer !== true)
            .map((entry) => String(entry?.id || ''))
            .filter(Boolean)));
        if (!frameIds.length) {
            return false;
        }
        const token = timelineDeferredPreviewToken + 1;
        timelineDeferredPreviewToken = token;
        window.requestAnimationFrame(() => {
            if (token !== timelineDeferredPreviewToken || !isTimelineBarVisible()) {
                return;
            }
            const startedAt = Date.now();
            const patched = patchTimelineVisibleFrames(frameIds, reason);
            appendPaintPerfLog(`timeline-preview-deferred ms=${Date.now() - startedAt} reason=${reason} patched=${patched ? 1 : 0} frames=${frameIds.length}`);
            logPaintTrace('timeline.preview.deferredRender', {
                reason,
                frameIds,
                patched
            });
        });
        return true;
    }

    function scheduleDeferredLayerPreviewRefresh(reason = 'timeline-layer-preview-deferred') {
        if (typeof window === 'undefined') {
            return false;
        }
        const token = timelineDeferredLayerPreviewToken + 1;
        timelineDeferredLayerPreviewToken = token;
        window.requestAnimationFrame(() => {
            if (token !== timelineDeferredLayerPreviewToken || !isTimelineBarVisible()) {
                return;
            }
            const startedAt = Date.now();
            refreshLayerPreviewCanvases();
            appendPaintPerfLog(`timeline-layer-preview-deferred ms=${Date.now() - startedAt} reason=${reason}`);
            logPaintTrace('timeline.layerPreview.deferredRefresh', {
                reason
            });
        });
        return true;
    }

    function buildTimelineRenderSignature(options = {}) {
        const {
            activeIndex = -1,
            currentFrameId = '',
            frameEntries = [],
            renderedRows = [],
            isExpanded = false,
            deferPreviewImages = false,
            timelineWidth = 0
        } = options;
        const rowSignature = renderedRows.map(({ layer, index }) => [
            index,
            String(layer?.id || ''),
            String(layer?.name || ''),
            normalizeLayerVisibility(layer?.visible, true) ? '1' : '0',
            normalizeLayerOpacity(layer?.opacity).toFixed(3),
            normalizeLayerThumbnailTone(layer?.thumbnailTone).toFixed(3),
            isLayerPinned(layer?.id) ? '1' : '0'
        ].join(':')).join('|');
        const frameSignature = frameEntries.map((frame) => [
            String(frame?.id || ''),
            Number.isFinite(Number(frame?.index)) ? Number(frame.index) : -1,
            frame?.spacer === true ? '1' : '0',
            frame?.disabled === true ? '1' : '0',
            frame?.keyframe === true ? '1' : '0',
            Math.max(1, Number(frame?.hold) || 1),
            String(frame?.slot || '')
        ].join(':')).join('|');
        return [
            isExpanded ? 'expanded' : 'collapsed',
            activeIndex,
            String(currentFrameId || ''),
            paintWorkspaceState.timelineQuickPreview === true ? '1' : '0',
            String(paintWorkspaceState.timelineMotion || ''),
            deferPreviewImages ? '1' : '0',
            Math.round(Number(timelineWidth) || 0),
            rowSignature,
            frameSignature
        ].join('||');
    }

    async function setTimelineDrawerOpen(open, reason = 'timeline-drawer-toggle') {
        const session = getSession();
        const nextOpen = open === true;
        const previousQuickPreview = paintWorkspaceState.timelineQuickPreview === true;
        const previousOpen = paintWorkspaceState.expandedTimelineVisible === true;
        clearTimelineQuickPreview(`${reason}-drawer-sync`, { render: false });
        logPaintTrace('timeline.drawer.toggle.begin', {
            reason,
            nextOpen,
            previousOpen,
            previousQuickPreview,
            filePath: session?.filePath || '',
            launchMode: resolveSessionLaunchTarget()?.mode || ''
        });
        if (nextOpen) {
            const asset = resolveWorkspaceAsset();
            const context = resolveSessionAnimationContext(asset);
            const needsEnsure = !context.animation?.id || !context.frame?.id || framePathUsesRootImagePath(resolveFramePath(context.frame));
            if (needsEnsure) {
                try {
                    await ensureTimelineSequenceContext(`${reason}-open`);
                } catch (error) {
                    logPaintTrace('timeline.drawer.toggle.ensureFailed', {
                        reason,
                        message: error?.message || String(error)
                    });
                }
            }
            paintWorkspaceState.expandedTimelineVisible = true;
            syncTimelineVisibilityFlags();
            paintWorkspaceState.timelineMotion = '';
            renderLayerBar({
                syncCurrentFrame: false,
                deferPreviewImages: true,
                deferLayerPreviews: true,
                logDomMetrics: false
            });
            logPaintTrace('timeline.drawer.toggle.end', {
                reason,
                nextOpen,
                currentFrameId: getCurrentTimelineFrameId(resolveWorkspaceAsset(), resolveSessionAnimationContext(resolveWorkspaceAsset()).animation, resolveSessionAnimationContext(resolveWorkspaceAsset()))
            });
            return true;
        }
        paintWorkspaceState.expandedTimelineVisible = false;
        syncTimelineVisibilityFlags();
        timelineDeferredPreviewToken += 1;
        timelineDeferredLayerPreviewToken += 1;
        paintWorkspaceState.playing = false;
        paintWorkspaceState.activePlaybackRangeId = '';
        paintWorkspaceState.timelineMotion = '';
        clearPaintWorkspacePlaybackTimer();
        paintWorkspaceState.timelineMenu.open = false;
        paintWorkspaceState.timelineMenu.kind = '';
        paintWorkspaceState.timelineMenu.layerIndex = -1;
        paintWorkspaceState.timelineMenu.frameId = '';
        paintWorkspaceState.timelineMenu.pseudoFrame = false;
        renderLayerBar({ syncCurrentFrame: false });
        logPaintTrace('timeline.drawer.toggle.end', {
            reason,
            nextOpen,
            currentFrameId: ''
        });
        return true;
    }

    async function buildFrameBufferFromCurrentState(mode = 'blank') {
        const session = getSession();
        logPaintTrace('buildFrameBufferFromCurrentState.begin', {
            mode
        });
        if (mode === 'duplicate') {
            const flattened = createFlattenedLayersCanvas();
            if (!flattened) {
                throw new Error('Could not capture current frame');
            }
            const duplicateBuffer = await exportCanvasToPngBuffer(flattened);
            if (!duplicateBuffer) {
                throw new Error('Could not encode current frame');
            }
            logPaintTrace('buildFrameBufferFromCurrentState.complete', {
                mode,
                blank: false,
                bytes: duplicateBuffer.length
            });
            return duplicateBuffer;
        }
        const blankCanvas = document.createElement('canvas');
        blankCanvas.width = Math.max(1, Number(session?.width) || 1);
        blankCanvas.height = Math.max(1, Number(session?.height) || 1);
        const blankBuffer = await exportCanvasToPngBuffer(blankCanvas);
        if (!blankBuffer) {
            throw new Error('Could not encode blank frame');
        }
        logPaintTrace('buildFrameBufferFromCurrentState.complete', {
            mode,
            blank: true,
            bytes: blankBuffer.length
        });
        return blankBuffer;
    }

    async function insertAnimationFrameRelative(asset, animation, targetFrameId, direction, mode = 'blank') {
        const session = getSession();
        logPaintTrace('insertAnimationFrameRelative.begin', {
            assetId: asset?.id || '',
            animationId: animation?.id || '',
            targetFrameId,
            direction,
            mode
        });
        const preferredAnimation = animation?.id
            ? (projectStore.getAsset(asset.id)?.animations?.[animation.id] || animation)
            : null;
        const ensuredAnimation = preferredAnimation || ensureTimelineAnimation(asset);
        const currentAnimation = ensuredAnimation?.id ? (projectStore.getAsset(asset.id)?.animations?.[ensuredAnimation.id] || ensuredAnimation) : null;
        if (!currentAnimation) {
            throw new Error('No animation available');
        }
        logPaintTrace('insertAnimationFrameRelative.resolvedAnimation', {
            requestedAnimationId: animation?.id || '',
            resolvedAnimationId: currentAnimation.id || '',
            usedPreferredAnimation: !!preferredAnimation
        });
        const frames = frameListForPaint(currentAnimation);
        const targetIndex = Math.max(0, frames.findIndex((entry) => entry.id === targetFrameId));
        const insertAt = direction === 'left' ? targetIndex : (targetIndex + 1);
        const frameId = utils.createId('frame');
        const buffer = await buildFrameBufferFromCurrentState(mode);
        const relativePath = `animations/${currentAnimation.id}/frames/working/${frameId}.png`;
        projectStore.writeBufferToAsset(asset.id, relativePath, buffer);
        projectStore.updateAnimation(asset.id, currentAnimation.id, (draft) => {
            const nextFrames = frameListForPaint(draft);
            nextFrames.splice(insertAt, 0, {
                id: frameId,
                index: insertAt,
                workingPath: relativePath,
                approvedPath: relativePath,
                originalPath: relativePath,
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
            return draft;
        }, mode === 'duplicate' ? 'asset2d-frame-duplicate' : 'asset2d-frame-create');
        const refreshedAsset = projectStore.getAsset(asset.id) || asset;
        const refreshedAnimation = refreshedAsset.animations?.[currentAnimation.id] || currentAnimation;
        const insertedFrame = frameListForPaint(refreshedAnimation).find((entry) => entry.id === frameId) || null;
        const templateLayers = Array.isArray(session?.layers) && session.layers.length ? session.layers : [];
        const store = ensureSessionTimelineStore(currentAnimation.id);
        if (store) {
            store.frameStates[frameId] = {
                frameId,
                layers: mode === 'duplicate'
                    ? cloneLayerSnapshots(templateLayers)
                    : templateLayers.map((layer, index) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(1, Number(session?.width) || 1);
                        canvas.height = Math.max(1, Number(session?.height) || 1);
                        return {
                            id: String(layer?.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`)),
                            name: String(layer?.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
                            isBase: index === 0 || layer?.isBase === true,
                            visible: normalizeLayerVisibility(layer?.visible, true),
                            opacity: normalizeLayerOpacity(layer?.opacity),
                            thumbnailTone: normalizeLayerThumbnailTone(layer?.thumbnailTone),
                            canvas
                        };
                    })
            };
            logPaintTrace('insertAnimationFrameRelative.frameStateCreated', {
                assetId: asset.id,
                animationId: currentAnimation.id,
                frameId,
                mode,
                layerCount: store.frameStates[frameId].layers.length,
                blankFrame: mode !== 'duplicate'
            });
        }
        if (insertedFrame && store?.frameStates?.[frameId]?.layers?.length) {
            await persistTimelineFrameState(refreshedAsset, refreshedAnimation, frameId, store.frameStates[frameId].layers, {
                reason: mode === 'duplicate' ? 'frame-duplicate' : 'frame-insert'
            });
        }
        if (insertedFrame) {
            await loadAnimationFrameIntoSession(refreshedAsset, refreshedAnimation, insertedFrame, { reason: 'insert-frame' });
        }
    }

    async function insertTimelineFrameFromHotkey(direction, mode = 'blank') {
        const session = getSession();
        if (!session) {
            return false;
        }
        const reason = `timeline-hotkey-insert-${mode}-${direction}`;
        const ensuredContext = await ensureTimelineSequenceContext(reason);
        const asset = ensuredContext?.asset || resolveWorkspaceAsset();
        const context = ensuredContext || resolveSessionAnimationContext(asset);
        const animation = context?.animation || null;
        const frame = context?.frame || null;
        if (!asset?.id || !animation?.id || !frame?.id) {
            logPaintTrace('timeline.hotkey.insertFrame.skipped', {
                direction,
                mode,
                assetId: asset?.id || '',
                animationId: animation?.id || '',
                frameId: frame?.id || ''
            });
            return false;
        }
        logPaintTrace('timeline.hotkey.insertFrame.begin', {
            direction,
            mode,
            assetId: asset.id,
            animationId: animation.id,
            frameId: frame.id,
            frameIndex: Number.isFinite(Number(frame.index)) ? Number(frame.index) : -1,
            drawerOpen: paintWorkspaceState.drawerOpen === true,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true
        });
        await insertAnimationFrameRelative(asset, animation, frame.id, direction, mode);
        const previewShown = showTimelineQuickPreview(reason, {
            renderImmediately: true
        });
        logPaintTrace('timeline.hotkey.insertFrame.end', {
            direction,
            mode,
            assetId: asset.id,
            animationId: animation.id,
            previewShown,
            currentFrameId: resolveSessionAnimationContext(resolveWorkspaceAsset()).frame?.id || ''
        });
        return true;
    }

    async function deleteTimelineFrame(asset, animation, frameId) {
        const session = getSession();
        const currentAnimation = ensureTimelineAnimation(asset);
        if (!currentAnimation) {
            return;
        }
        const frames = frameListForPaint(currentAnimation);
        if (frames.length <= 1) {
            utils.showToast?.('Keep at least one frame');
            return;
        }
        const currentIndex = Math.max(0, frames.findIndex((entry) => entry.id === frameId));
        const nextFrame = frames[currentIndex + 1] || frames[currentIndex - 1] || null;
        captureCurrentAnimationFrameState('before-frame-delete');
        projectStore.updateAnimation(asset.id, currentAnimation.id, (draft) => {
            draft.frames = frameListForPaint(draft)
                .filter((entry) => entry.id !== frameId)
                .map((entry, index) => ({ ...entry, index }));
            draft.frameCount = draft.frames.length;
            return draft;
        }, 'asset2d-frame-delete');
        if (session?.timelineStore?.frameStates) {
            delete session.timelineStore.frameStates[frameId];
        }
        try {
            const layerDir = projectStore.resolveAssetPath(asset, resolveAnimationFrameLayerDirRelativePath(currentAnimation.id, frameId));
            if (layerDir && env.fs.existsSync(layerDir)) {
                env.fs.rmSync(layerDir, { recursive: true, force: true });
            }
        } catch {}
        logPaintTrace('deleteTimelineFrame.complete', {
            assetId: asset.id,
            animationId: currentAnimation.id,
            deletedFrameId: frameId,
            nextFrameId: nextFrame?.id || ''
        });
        if (nextFrame && resolveFramePath(nextFrame)) {
            const refreshedAsset = projectStore.getAsset(asset.id) || asset;
            const refreshedAnimation = refreshedAsset.animations?.[currentAnimation.id] || currentAnimation;
            const refreshedNextFrame = frameListForPaint(refreshedAnimation).find((entry) => entry.id === nextFrame.id) || nextFrame;
            await loadAnimationFrameIntoSession(refreshedAsset, refreshedAnimation, refreshedNextFrame, { reason: 'delete-frame' });
        } else {
            renderLayerBar();
        }
    }

    function schedulePaintAnimationPlayback() {
        clearPaintWorkspacePlaybackTimer();
        if (!paintWorkspaceState.playing) {
            return;
        }
        const context = resolveSessionAnimationContext();
        if (!context.animation) {
            paintWorkspaceState.playing = false;
            paintWorkspaceState.activePlaybackRangeId = '';
            renderPaintWorkspaceUi();
            return;
        }
        const frames = frameListForPaint(context.animation);
        if (!frames.length) {
            paintWorkspaceState.playing = false;
            paintWorkspaceState.activePlaybackRangeId = '';
            renderPaintWorkspaceUi();
            return;
        }
        const frame = context.frame || frames[Math.max(0, context.frameIndex)] || frames[0];
        const fallbackRange = {
            id: 'full-animation',
            title: 'Full Animation',
            startFrameIndex: 0,
            endFrameIndex: frames.length - 1
        };
        const playbackRange = resolveActivePlaybackRange(context.asset, context.animation, context.frameIndex);
        const activeRange = playbackRange && Number.isFinite(Number(playbackRange.startFrameIndex)) && Number.isFinite(Number(playbackRange.endFrameIndex))
            ? playbackRange
            : fallbackRange;
        const playbackSettings = resolveProjectPlaybackSettings(context.asset);
        const fps = resolvePlaybackFps(context.asset, context.animation, activeRange);
        const hold = Math.max(1, Number(frame?.hold) || 1);
        paintWorkspaceState.activePlaybackRangeId = String(activeRange.id || fallbackRange.id);
        logPaintTrace('timeline.playback.schedule', {
            assetId: context.asset?.id || '',
            animationId: context.animation?.id || '',
            frameId: frame?.id || '',
            frameIndex: Number.isFinite(Number(frame?.index)) ? Number(frame.index) : context.frameIndex,
            hold,
            fps,
            loop: playbackSettings.playbackLoop !== false,
            rangeId: paintWorkspaceState.activePlaybackRangeId,
            rangeStart: activeRange.startFrameIndex,
            rangeEnd: activeRange.endFrameIndex
        });
        paintWorkspaceState.playTimer = setTimeout(async () => {
            if (!paintWorkspaceState.playing) {
                return;
            }
            const refreshedContext = resolveSessionAnimationContext();
            const refreshedFrames = frameListForPaint(refreshedContext.animation);
            if (!refreshedContext.asset || !refreshedContext.animation || !refreshedFrames.length) {
                paintWorkspaceState.playing = false;
                paintWorkspaceState.activePlaybackRangeId = '';
                renderPaintWorkspaceUi();
                return;
            }
            const refreshedRange = resolveActivePlaybackRange(refreshedContext.asset, refreshedContext.animation, refreshedContext.frameIndex);
            const refreshedPlaybackSettings = resolveProjectPlaybackSettings(refreshedContext.asset);
            const rangeStart = clamp(Number(refreshedRange?.startFrameIndex) || 0, 0, refreshedFrames.length - 1);
            const rangeEnd = clamp(Number(refreshedRange?.endFrameIndex) || rangeStart, rangeStart, refreshedFrames.length - 1);
            paintWorkspaceState.activePlaybackRangeId = String(refreshedRange?.id || 'full-animation');
            const currentIndex = clamp(refreshedContext.frameIndex >= 0 ? refreshedContext.frameIndex : rangeStart, rangeStart, rangeEnd);
            let nextIndex = currentIndex + 1;
            if (nextIndex > rangeEnd) {
                if (refreshedPlaybackSettings.playbackLoop === false) {
                    paintWorkspaceState.playing = false;
                    clearPaintWorkspacePlaybackTimer();
                    renderPaintWorkspaceUi();
                    logPaintTrace('timeline.playback.stopAtRangeEnd', {
                        assetId: refreshedContext.asset.id,
                        animationId: refreshedContext.animation.id,
                        rangeId: paintWorkspaceState.activePlaybackRangeId,
                        frameIndex: currentIndex
                    });
                    return;
                }
                nextIndex = rangeStart;
                logPaintTrace('timeline.playback.wrap', {
                    assetId: refreshedContext.asset.id,
                    animationId: refreshedContext.animation.id,
                    rangeId: paintWorkspaceState.activePlaybackRangeId,
                    fromIndex: currentIndex,
                    toIndex: nextIndex
                });
            }
            const nextFrame = refreshedFrames[nextIndex] || null;
            if (!nextFrame) {
                paintWorkspaceState.playing = false;
                clearPaintWorkspacePlaybackTimer();
                renderPaintWorkspaceUi();
                return;
            }
            if (paintWorkspaceState.timelineExpanded !== true) {
                triggerTimelineMotion('x', nextIndex >= currentIndex ? 1 : -1);
            }
            await loadAnimationFrameIntoSession(refreshedContext.asset, refreshedContext.animation, nextFrame, {
                reason: 'playback-tick'
            });
            schedulePaintAnimationPlayback();
        }, Math.max(40, Math.round((1000 / fps) * hold)));
    }

    function togglePaintAnimationPlayback() {
        const context = resolveSessionAnimationContext();
        if (!context.animation || !frameListForPaint(context.animation).length) {
            paintWorkspaceState.playing = false;
            paintWorkspaceState.activePlaybackRangeId = '';
            logPaintTrace('timeline.playback.toggleSkipped', {
                assetId: context.asset?.id || '',
                animationId: context.animation?.id || ''
            });
            renderPaintWorkspaceUi();
            return false;
        }
        paintWorkspaceState.playing = !paintWorkspaceState.playing;
        logPaintTrace('timeline.playback.toggle', {
            playing: paintWorkspaceState.playing,
            assetId: context.asset?.id || '',
            animationId: context.animation?.id || '',
            frameId: context.frame?.id || '',
            frameIndex: context.frameIndex
        });
        if (!paintWorkspaceState.playing) {
            clearPaintWorkspacePlaybackTimer();
            paintWorkspaceState.activePlaybackRangeId = '';
        } else {
            schedulePaintAnimationPlayback();
        }
        renderPaintWorkspaceUi();
        return paintWorkspaceState.playing;
    }

    async function handlePaintAnimationDrawerClick(event) {
        try {
            const target = event.target?.closest?.('[data-action]');
            if (!target) {
                return;
            }
            const action = String(target.dataset.action || '');
            if (action === 'close-drawer') {
                await setTimelineDrawerOpen(false, 'drawer-close-action');
                return;
            }
            if (action === 'toggle-playback') {
                togglePaintAnimationPlayback();
                return;
            }
            if (action === 'frame-prev') {
                await navigatePaintAnimation(-1, 'frame');
                return;
            }
            if (action === 'frame-next') {
                await navigatePaintAnimation(1, 'frame');
                return;
            }
            if (action === 'animation-prev') {
                await navigatePaintAnimation(-1, 'animation');
                return;
            }
            if (action === 'animation-next') {
                await navigatePaintAnimation(1, 'animation');
                return;
            }
            const context = resolveSessionAnimationContext();
            const asset = context.asset;
            const animation = context.animation;
            const frame = context.frame;
            if (!asset) {
                return;
            }
            if (action === 'animation-new') {
                const created = projectStore.createAnimation(asset.id, {
                    starterImagePath: asset.still.approvedImagePath || asset.still.workingImagePath || asset.still.sourceImages?.[0] || '',
                    motionPrompt: asset.still.prompt || ''
                }, 'asset2d-animation-create');
                const refreshedAsset = projectStore.getAsset(asset.id) || asset;
                const refreshedAnimation = refreshedAsset.animations?.[created.id] || created;
                const targetPath = refreshedAnimation.starterImagePath || refreshedAsset.still.approvedImagePath || refreshedAsset.still.workingImagePath;
                if (targetPath) {
                    await switchPaintFile(projectStore.resolveAssetPath(refreshedAsset, targetPath));
                } else {
                    renderPaintWorkspaceUi();
                }
                return;
            }
            if (action === 'animation-import-sheet') {
                await importAnimationSheetInPaint(asset);
                return;
            }
            if (!animation) {
                return;
            }
            if (action === 'animation-delete') {
                const confirmed = window.confirm(`Delete animation "${animation.name}" from "${asset.name}"?`);
                if (!confirmed) {
                    return;
                }
                projectStore.deleteAnimation(asset.id, animation.id, 'asset2d-animation-delete');
                const refreshedAsset = projectStore.getAsset(asset.id) || asset;
                const nextAnimation = refreshedAsset.activeAnimationId ? refreshedAsset.animations?.[refreshedAsset.activeAnimationId] : Object.values(refreshedAsset.animations || {})[0];
                const nextFrame = frameListForPaint(nextAnimation)[0];
                const targetPath = nextFrame ? resolveFramePath(nextFrame) : (refreshedAsset.still.approvedImagePath || refreshedAsset.still.workingImagePath || refreshedAsset.still.sourceImages?.[0] || '');
                if (targetPath) {
                    await switchPaintFile(projectStore.resolveAssetPath(refreshedAsset, targetPath));
                } else {
                    renderPaintWorkspaceUi();
                }
                return;
            }
            if (action === 'animation-slice') {
                await sliceAnimationSheetInPaint(asset, animation);
                return;
            }
            if (action === 'animation-rebuild-sheet') {
                await rebuildAnimationSheetInPaint(asset, animation);
                paintWorkspaceState.jobStatus = 'done';
                paintWorkspaceState.jobMessage = 'Rebuilt sprite sheet';
                paintWorkspaceState.jobProgress = 1;
                renderPaintWorkspaceUi();
                return;
            }
            if (action === 'animation-export') {
                const result = await exportAnimationBundle(asset, animation);
                paintWorkspaceState.jobStatus = 'done';
                paintWorkspaceState.jobMessage = 'Exported frames, sheet, and manifest';
                paintWorkspaceState.jobProgress = 1;
                renderPaintWorkspaceUi();
                await env.electron.ipcRenderer.invoke('workboard:2d-open-path', {
                    targetPath: projectStore.resolveAssetPath(asset, result.manifestPath)
                });
                return;
            }
            const frames = frameListForPaint(animation);
            const targetFrameId = String(target.dataset.frameId || '');
            const targetFrame = targetFrameId ? frames.find((entry) => entry.id === targetFrameId) : frame;
            if (action === 'frame-open') {
                if (!targetFrame || !resolveFramePath(targetFrame)) {
                    return;
                }
                projectStore.updateAsset(asset.id, (draft) => {
                    draft.activeAnimationId = animation.id;
                    return draft;
                }, 'asset2d-select-animation');
                await switchPaintFile(projectStore.resolveAssetPath(asset, resolveFramePath(targetFrame)));
                return;
            }
            if (action === 'frame-select') {
                if (!targetFrame) {
                    return;
                }
                projectStore.updateAnimation(asset.id, animation.id, (draft) => {
                    draft.frames = frameListForPaint(draft).map((entry) => (
                        entry.id === targetFrame.id
                            ? { ...entry, selected: !entry.selected }
                            : entry
                    ));
                    return syncAnimationFlags(draft);
                }, 'asset2d-frame-select');
                renderPaintWorkspaceUi();
                return;
            }
            if (action === 'frame-keyframe') {
                if (!targetFrame) {
                    return;
                }
                projectStore.updateAnimation(asset.id, animation.id, (draft) => {
                    draft.frames = frameListForPaint(draft).map((entry) => (
                        entry.id === targetFrame.id
                            ? { ...entry, keyframe: !entry.keyframe }
                            : entry
                    ));
                    return syncAnimationFlags(draft);
                }, 'asset2d-frame-keyframe');
                renderPaintWorkspaceUi();
                return;
            }
            if (action === 'frame-reference') {
                if (!targetFrame) {
                    return;
                }
                projectStore.updateAnimation(asset.id, animation.id, (draft) => {
                    draft.frames = frameListForPaint(draft).map((entry) => (
                        entry.id === targetFrame.id
                            ? { ...entry, isReference: !entry.isReference }
                            : entry
                    ));
                    return syncAnimationFlags(draft);
                }, 'asset2d-frame-reference');
                renderPaintWorkspaceUi();
                return;
            }
            if (action === 'frame-repair') {
                await runCurrentFrameRepair(asset, animation, frame);
                return;
            }
            if (action === 'rerun-selected') {
                const selectedFrames = frames.filter((entry) => entry.selected);
                await runAnimationFrameBatch(asset, animation, selectedFrames, 'Rerun selected');
                return;
            }
            if (action === 'rerun-all') {
                const ensuredAnimation = ensureAnimationFramesForPaint(asset, animation);
                await runAnimationFrameBatch(asset, ensuredAnimation, frameListForPaint(ensuredAnimation), 'Rerun all');
                return;
            }
        } catch (error) {
            utils.showToast?.(error?.message || 'Animation drawer action failed');
        }
    }

    function isTimelineBarVisible() {
        return isCollapsedTimelineVisible() || isExpandedTimelineVisible();
    }

    function clearTimelineQuickPreview(reason = 'timeline-quick-preview-clear', options = {}) {
        const wasVisible = paintWorkspaceState.timelineQuickPreview === true;
        if (timelineQuickPreviewTimer) {
            clearTimeout(timelineQuickPreviewTimer);
            timelineQuickPreviewTimer = null;
        }
        timelineDeferredPreviewToken += 1;
        timelineDeferredLayerPreviewToken += 1;
        paintWorkspaceState.timelineQuickPreview = false;
        if (wasVisible) {
            logPaintTrace('timeline.quickPreview.hide', {
                reason,
                drawerOpen: paintWorkspaceState.drawerOpen === true,
                timelineExpanded: paintWorkspaceState.timelineExpanded === true
            });
            if (options.render !== false) {
                renderLayerBar({ syncCurrentFrame: false });
            }
        }
        return wasVisible;
    }

    function showTimelineQuickPreview(reason = 'timeline-quick-preview-show', options = {}) {
        const session = getSession();
        if (!session?.layers?.length || paintWorkspaceState.collapsedTimelineVisible === true || paintWorkspaceState.expandedTimelineVisible === true) {
            return false;
        }
        const durationMs = Math.max(280, Number(options.durationMs) || 900);
        const renderImmediately = options.renderImmediately !== false;
        if (timelineQuickPreviewTimer) {
            clearTimeout(timelineQuickPreviewTimer);
            timelineQuickPreviewTimer = null;
        }
        paintWorkspaceState.timelineQuickPreview = true;
        paintWorkspaceState.timelineExpanded = false;
        paintWorkspaceState.timelineMotion = '';
        if (renderImmediately) {
            renderLayerBar({
                syncCurrentFrame: false,
                deferPreviewImages: true,
                deferLayerPreviews: true,
                logDomMetrics: false
            });
        }
        timelineQuickPreviewTimer = setTimeout(() => {
            timelineQuickPreviewTimer = null;
            if (paintWorkspaceState.drawerOpen === true) {
                return;
            }
            paintWorkspaceState.timelineQuickPreview = false;
            logPaintTrace('timeline.quickPreview.hide', {
                reason: `${reason}-timeout`,
                drawerOpen: false,
                timelineExpanded: paintWorkspaceState.timelineExpanded === true
            });
            renderLayerBar({
                syncCurrentFrame: false,
                deferPreviewImages: true,
                deferLayerPreviews: true,
                logDomMetrics: false
            });
        }, durationMs);
        logPaintTrace('timeline.quickPreview.show', {
            reason,
            durationMs,
            renderImmediately,
            activeLayerIndex: session?.activeLayerIndex ?? -1,
            frameId: resolveSessionAnimationContext(resolveWorkspaceAsset()).frame?.id || ''
        });
        return true;
    }

    function renderLayerBar(options = {}) {
        const session = getSession();
        syncTimelineVisibilityFlags();
        renderTimelineBarTarget(getTimelineTarget('collapsed'), options, session);
        renderTimelineBarTarget(getTimelineTarget('expanded'), options, session);
        ensureLayerControlsEnabled();
        updatePaintTopDockLayout();
    }

    function renderTimelineBarTarget(target, options = {}, session = getSession()) {
        const barEl = target?.barEl || null;
        const listEl = target?.listEl || null;
        const isExpanded = target?.isExpanded === true;
        const visible = target?.visible === true;
        const signatureKey = String(target?.signatureKey || '');
        if (!barEl || !listEl || !signatureKey) {
            return;
        }
        if (!isExpanded && dom.paintLayerAdd?.parentElement) {
            dom.paintLayerAdd.parentElement.hidden = true;
        }
        const layers = session?.layers;
        if (!Array.isArray(layers) || !layers.length || !visible) {
            if ((paintWorkspaceState.timelineMenu?.host || 'collapsed') === target.mode) {
                paintWorkspaceState.timelineMenu.open = false;
                paintWorkspaceState.timelineMenu.kind = '';
                paintWorkspaceState.timelineMenu.layerIndex = -1;
                paintWorkspaceState.timelineMenu.frameId = '';
                paintWorkspaceState.timelineMenu.pseudoFrame = false;
                paintWorkspaceState.timelineMenu.host = 'collapsed';
                refreshTimelineContextMenuOverlay();
            }
            barEl.hidden = true;
            barEl.style.width = '';
            paintWorkspaceState[signatureKey] = '';
            listEl.dataset.timelineRenderSignature = '';
            return;
        }
        const activeIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, layers.length - 1);
        if (options.syncCurrentFrame !== false) {
            syncCurrentFrameStateForTimeline('renderLayerBar');
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        const animation = context.animation || null;
        const currentFrameId = getCurrentTimelineFrameId(asset, animation, context);
        const totalFrameCount = frameListForPaint(animation).length || (session?.timelineStore?.currentFrameId ? 1 : 0);
        const frameEntries = buildTimelineFrameEntries(asset, animation, context, { expanded: isExpanded });
        const displayRows = buildTimelineDisplayRows(layers);
        const deferPreviewImages = options.deferPreviewImages === true;
        const deferLayerPreviews = options.deferLayerPreviews === true;
        const renderedRows = isExpanded
            ? displayRows
            : displayRows.filter(({ index }) => index === activeIndex);
        const minBarWidth = isExpanded ? TIMELINE_LAYOUT.expandedBarMinWidth : TIMELINE_LAYOUT.collapsedBarMinWidth;
        const frameBucket = isExpanded ? TIMELINE_LAYOUT.expandedFrameBucket : TIMELINE_LAYOUT.collapsedFrameBucket;
        const chromeWidth = isExpanded ? TIMELINE_LAYOUT.expandedChromeWidth : TIMELINE_LAYOUT.collapsedChromeWidth;
        const widthCap = isExpanded
            ? Math.max(minBarWidth, Math.round(parseFloat(String(barEl.style.maxWidth || '0')) || ((window.innerWidth || minBarWidth) * 0.66)))
            : Math.max(minBarWidth, Math.round(window.innerWidth - 28));
        const timelineWidth = Math.min(
            widthCap,
            Math.max(minBarWidth, ((frameEntries.length * frameBucket) + chromeWidth))
        );
        barEl.style.width = `${timelineWidth}px`;
        logPaintTrace('renderLayerBar', {
            target: target.mode,
            assetId: asset?.id || '',
            animationId: animation?.id || '',
            currentFrameId,
            activeLayerIndex: activeIndex,
            displayRowCount: displayRows.length,
            renderedRowCount: renderedRows.length,
            totalLayerCount: layers.length,
            frameCount: frameEntries.length,
            totalFrameCount,
            visibleFrameIds: frameEntries.filter((entry) => entry?.spacer !== true).map((entry) => entry.id),
            frameDebug: buildTimelineFrameDebugSummary(frameEntries, currentFrameId),
            timelineExpanded: isExpanded,
            timelineQuickPreview: paintWorkspaceState.timelineQuickPreview === true,
            timelineWidth,
            motion: paintWorkspaceState.timelineMotion || ''
        });
        const renderSignature = buildTimelineRenderSignature({
            activeIndex,
            currentFrameId,
            frameEntries,
            renderedRows,
            isExpanded,
            deferPreviewImages,
            timelineWidth
        });
        if (listEl.dataset.timelineRenderSignature === renderSignature && paintWorkspaceState[signatureKey] === renderSignature) {
            barEl.hidden = false;
            barEl.classList.toggle('is-timeline', !isExpanded);
            if (isExpanded) {
                centerTimelineOnActiveFrame({
                    behavior: 'auto'
                });
            }
            logPaintTrace('renderLayerBar.reuse', {
                target: target.mode,
                currentFrameId,
                activeLayerIndex: activeIndex,
                timelineExpanded: isExpanded,
                timelineQuickPreview: paintWorkspaceState.timelineQuickPreview === true
            });
            return;
        }
        const rowMarkup = renderedRows.map(({ layer, index }) => {
            const checkerStyle = buildTimelineCellCheckerStyle(layer);
            const isActiveRow = index === activeIndex;
            const cellMarkup = frameEntries.map((frame) => {
                if (frame?.spacer === true) {
                    return `<span class="paint-timeline-cell-spacer paint-timeline-cell-spacer--${frame.slot || 'center'}" aria-hidden="true"></span>`;
                }
                const frameUrl = deferPreviewImages ? '' : resolveTimelineCellPreviewUrl(asset, frame, index, currentFrameId);
                const isActiveCell = isActiveRow && frame.id === currentFrameId;
                const isCurrentColumn = !frame.disabled && frame.id === currentFrameId && (isExpanded || isActiveRow);
                return `
                    <button class="paint-timeline-cell paint-timeline-cell--${frame.slot || 'center'}${isCurrentColumn ? ' is-current-column' : ''}${isActiveCell ? ' is-active-cell' : ''}${frame.disabled ? ' is-disabled' : ''}" type="button" data-action="timeline-cell-open" data-layer-index="${index}" data-frame-id="${frame.id}" data-frame-index="${Number.isFinite(Number(frame.index)) ? Number(frame.index) : -1}" data-frame-path="${escapeWorkspaceText(String(frame.path || ''))}" data-slot="${escapeWorkspaceText(String(frame.slot || 'center'))}" data-disabled="${frame.disabled ? '1' : '0'}" data-pseudo-frame="${frame.pseudo ? '1' : ''}" style="${checkerStyle}" title="Layer ${escapeWorkspaceText(layer.name || `Layer ${index + 1}`)}, Frame ${frame.index + 1}"${frame.disabled ? ' disabled' : ''}>
                        ${frameUrl ? `<img src="${frameUrl}" alt="Frame ${frame.index + 1}">` : '<span class="paint-timeline-cell-fallback"></span>'}
                    </button>
                `;
            }).join('');
            return `
                <div class="paint-timeline-row${isActiveRow ? ' is-active' : ''}${isLayerPinned(layer.id) ? ' is-pinned' : ''}${isExpanded ? ' is-expanded-row' : ' is-collapsed-row'}" data-layer-index="${index}" title="${escapeWorkspaceText(layer.name || `Layer ${index + 1}`)}">
                    ${isExpanded ? renderTimelineLayerControl(layer, index, isActiveRow) : ''}
                    <div class="paint-timeline-row-viewport">
                        <div class="paint-timeline-row-cells">${cellMarkup}</div>
                    </div>
                </div>
            `;
        }).join('');
        listEl.innerHTML = `
            <div class="paint-timeline-shell${isExpanded ? ' is-expanded' : ' is-collapsed'}${paintWorkspaceState.timelineMotion ? ` is-motion-${paintWorkspaceState.timelineMotion}` : ''}">
                <div class="paint-timeline-scroll">
                    <div class="paint-timeline-grid">
                        <div class="paint-timeline-rows">${rowMarkup}</div>
                    </div>
                </div>
            </div>
        `;
        listEl.dataset.timelineRenderSignature = renderSignature;
        paintWorkspaceState[signatureKey] = renderSignature;
        barEl.hidden = false;
        barEl.classList.toggle('is-timeline', !isExpanded);
        refreshTimelineContextMenuOverlay();
        if (!isExpanded && deferLayerPreviews) {
            scheduleDeferredLayerPreviewRefresh('render-layer-bar-deferred');
        } else if (!isExpanded) {
            refreshLayerPreviewCanvases();
        }
        if (isExpanded) {
            centerTimelineOnActiveFrame({
                behavior: 'auto'
            });
        }
        if (asset?.id && animation?.id) {
            primeTimelineFrameStates(asset, animation, frameEntries, {
                render: false,
                patchDom: true,
                reason: 'render-layer-bar-visible'
            }).catch((error) => {
                logPaintTrace('timeline.frameState.primeFailed', {
                    assetId: asset.id,
                    animationId: animation.id,
                    message: error?.message || String(error)
                });
            });
        }
        if (deferPreviewImages) {
            scheduleDeferredTimelinePreviewPatch(frameEntries, 'render-layer-bar-deferred');
        }
        scheduleTimelineDomMetrics(`renderLayerBar:${target.mode}`, options);
    }

    function primeTimelineFrameStates(asset, animation, frameEntries = [], options = {}) {
        if (!asset?.id || !animation?.id || !Array.isArray(frameEntries) || !frameEntries.length) {
            return Promise.resolve(false);
        }
        let workingAsset = asset;
        let workingAnimation = animation;
        const store = ensureSessionTimelineStore(animation.id);
        if (!store) {
            return Promise.resolve(false);
        }
        store.pendingFrameIds = store.pendingFrameIds instanceof Set ? store.pendingFrameIds : new Set();
        return (async () => {
            let hydratedAny = false;
            const hydratedFrameIds = [];
            for (const frameEntry of frameEntries) {
                const frameId = String(frameEntry?.id || '');
                if (!frameId || store.frameStates?.[frameId] || store.pendingFrameIds.has(frameId)) {
                    continue;
                }
                const frame = frameListForPaint(animation).find((entry) => entry.id === frameId);
                if (!frame) {
                    continue;
                }
                store.pendingFrameIds.add(frameId);
                try {
                    const normalizedContext = await ensureAnimationFrameHasDedicatedFile(workingAsset, workingAnimation, frame);
                    workingAsset = normalizedContext.asset || workingAsset;
                    workingAnimation = normalizedContext.animation || workingAnimation;
                    const normalizedFrame = normalizedContext.frame || frame;
                    const frameState = await loadPersistedTimelineFrameState(workingAsset, workingAnimation, normalizedFrame, {
                        fallbackLayers: getSession()?.layers || []
                    });
                    if (frameState?.layers?.length) {
                        store.frameStates[frameId] = frameState;
                        hydratedAny = true;
                        hydratedFrameIds.push(frameId);
                    }
                } catch (error) {
                    logPaintTrace('timeline.frameState.primeFailed', {
                        assetId: asset.id,
                        animationId: animation.id,
                        frameId,
                        message: error?.message || String(error)
                    });
                } finally {
                    store.pendingFrameIds.delete(frameId);
                }
            }
            if (hydratedAny) {
                const patched = options.patchDom === false
                    ? false
                    : patchTimelineVisibleFrames(hydratedFrameIds, options.reason || 'timeline-frame-prime');
                logPaintTrace('timeline.frameState.primePatched', {
                    assetId: asset.id,
                    animationId: animation.id,
                    hydratedFrameIds,
                    patched,
                    patchDom: options.patchDom !== false,
                    renderRequested: options.render !== false
                });
                if (!patched && options.render !== false) {
                    renderLayerBar();
                }
            }
            return hydratedAny;
        })();
    }


    return {
        setTimelineDrawerOpen,
        buildFrameBufferFromCurrentState,
        insertAnimationFrameRelative,
        insertTimelineFrameFromHotkey,
        deleteTimelineFrame,
        schedulePaintAnimationPlayback,
        togglePaintAnimationPlayback,
        handlePaintAnimationDrawerClick,
        isTimelineBarVisible,
        clearTimelineQuickPreview,
        showTimelineQuickPreview,
        renderLayerBar
    };
};
