'use strict';

// MARK: MODULE
module.exports = function createPaintPersistenceModule(deps) {
    const {
        env,
        state,
        projectStore,
        launchTargets,
        utils,
        PAINT_AUTOSAVE_INTERVAL_MS,
        PAINT_AUTOSAVE_IDLE_MS,
        PAINT_AUTOSAVE_RETRY_MS,
        PAINT_AUTOSAVE_TICK_MS,
        PAINT_LIVE_PREVIEW_DEBOUNCE_MS,
        getSession,
        isPaintEditorWindow,
        resolveWorkspaceAsset,
        resolveSessionAnimationContext,
        resolveBoardImageBlock,
        resolveSessionAsset,
        persistActiveTimelineFrameState,
        persistLoadedTimelineStates,
        createFlattenedLayersCanvas,
        getActiveLayer,
        cloneViewportSnapshot,
        paintWorkspaceState,
        capturePaintHistorySnapshot,
        appendPaintPerfLog,
        renderPaintJobHud,
        logPaintTrace,
        clamp
    } = deps;

    // MARK: AUTOSAVE
    function createInitialPaintAutosaveState() {
        return {
            dirty: false,
            dirtyAt: 0,
            lastActivityAt: 0,
            lastActivityReason: '',
            lastActivityLoggedAt: 0,
            lastSavedAt: 0,
            nextDueAt: 0,
            changeToken: 0,
            savedToken: 0,
            inFlight: false,
            timer: null,
            failureCount: 0,
            lastBlockedReason: '',
            lastBlockedLoggedAt: 0
        };
    }

    function ensurePaintAutosaveState() {
        const session = getSession();
        if (!session) {
            return null;
        }
        if (!session.autosave || typeof session.autosave !== 'object') {
            session.autosave = createInitialPaintAutosaveState();
        }
        return session.autosave;
    }

    function touchPaintSessionActivity(reason = '') {
        const session = getSession();
        const autosave = ensurePaintAutosaveState();
        if (!session || !autosave) {
            return false;
        }
        const now = Date.now();
        autosave.lastActivityAt = now;
        if (!reason) {
            return true;
        }
        const normalizedReason = String(reason || '').trim();
        const throttleMs = normalizedReason === 'overlay-input'
            ? 400
            : (normalizedReason.startsWith('keydown:') ? 120 : 0);
        if (
            throttleMs > 0
            && autosave.lastActivityReason === normalizedReason
            && ((now - (Number(autosave.lastActivityLoggedAt) || 0)) < throttleMs)
        ) {
            return true;
        }
        autosave.lastActivityReason = normalizedReason;
        autosave.lastActivityLoggedAt = now;
        logPaintTrace('paint.autosave.activity', {
            reason: normalizedReason,
            filePath: session.filePath || '',
            boardId: session.boardId || '',
            blockId: session.blockId || ''
        });
        return true;
    }

    function markPaintSessionDirty(reason = 'change', payload = {}) {
        const session = getSession();
        const autosave = ensurePaintAutosaveState();
        if (!session || !autosave) {
            return false;
        }
        const now = Date.now();
        autosave.changeToken = Math.max(0, Number(autosave.changeToken) || 0) + 1;
        autosave.dirty = true;
        autosave.dirtyAt = now;
        autosave.lastActivityAt = now;
        autosave.nextDueAt = now + PAINT_AUTOSAVE_INTERVAL_MS;
        autosave.lastBlockedReason = '';
        autosave.lastBlockedLoggedAt = 0;
        logPaintTrace('paint.autosave.markDirty', {
            reason,
            changeToken: autosave.changeToken,
            nextDueAt: autosave.nextDueAt,
            filePath: session.filePath || '',
            boardId: session.boardId || '',
            blockId: session.blockId || '',
            ...payload
        });
        return true;
    }

    function resolvePaintAutosaveBlockReason(now = Date.now()) {
        const session = getSession();
        const autosave = ensurePaintAutosaveState();
        if (!session || !autosave?.dirty) {
            return 'clean';
        }
        if (autosave.inFlight) {
            return 'in-flight';
        }
        if (!session.filePath && !resolveBoardImageBlock(session.blockId) && !isPaintEditorWindow()) {
            return 'missing-target';
        }
        if (Number(autosave.nextDueAt) > now) {
            return 'waiting-due';
        }
        if ((now - (Number(autosave.lastActivityAt) || 0)) < PAINT_AUTOSAVE_IDLE_MS) {
            return 'waiting-idle';
        }
        if (session.isDrawing || session.pointerDown) {
            return 'painting';
        }
        if (session.sizeDrag?.active) {
            return 'size-drag';
        }
        if (session.zoomDrag?.active || session.pan?.active) {
            return 'viewport-drag';
        }
        if (session.crop?.active) {
            return 'crop-active';
        }
        if (session.editMode === 'select' && session.select?.lassoing) {
            return 'lasso-active';
        }
        if (session.editMode === 'transform' && session.transform?.active) {
            return 'transform-active';
        }
        if (session.selectionEdit?.dirty) {
            return 'selection-edit-dirty';
        }
        if (String(paintWorkspaceState?.jobStatus || '').trim().toLowerCase() === 'running') {
            return '2d-job-active';
        }
        if (session.adjustPanel?.job) {
            return 'adjust-job-active';
        }
        return '';
    }

    function stopPaintAutosaveLoop(reason = 'stop') {
        const session = getSession();
        if (!session?.autosave?.timer) {
            return false;
        }
        clearInterval(session.autosave.timer);
        session.autosave.timer = null;
        logPaintTrace('paint.autosave.loop.stop', {
            reason,
            filePath: session.filePath || ''
        });
        return true;
    }

    // MARK: PREVIEW
    function clearScheduledLivePreview() {
        const session = getSession();
        if (!session?.livePreviewTimer) {
            return;
        }
        clearTimeout(session.livePreviewTimer);
        session.livePreviewTimer = null;
    }

    function notifyPreviewCleared() {
        const session = getSession();
        if (!isPaintEditorWindow() || !session?.blockId || !session?.livePreviewEnabled || !env.electron?.ipcRenderer?.send) {
            return;
        }
        env.electron.ipcRenderer.send('workboard:paint-clear-preview', {
            boardId: session.boardId || state.currentBoardId,
            blockId: session.blockId
        });
    }

    function scheduleLivePreviewSync(reason = 'update', options = {}) {
        const session = getSession();
        if (!isPaintEditorWindow() || !session?.blockId || !session?.livePreviewEnabled || !env.electron?.ipcRenderer?.send) {
            return;
        }
        if (reason === 'pixels' && session?.eraserMode) {
            return;
        }
        clearScheduledLivePreview();
        const requestId = (Number(session.livePreviewRequestId) || 0) + 1;
        session.livePreviewRequestId = requestId;
        const delay = options.immediate ? 0 : PAINT_LIVE_PREVIEW_DEBOUNCE_MS;
        session.livePreviewTimer = setTimeout(async () => {
            const currentSession = getSession();
            if (currentSession) {
                currentSession.livePreviewTimer = null;
            }
            if (!currentSession || requestId !== currentSession.livePreviewRequestId) {
                return;
            }
            const exportStart = Date.now();
            const flattened = createFlattenedLayersCanvas();
            if (!flattened) {
                return;
            }
            let dataUrl = '';
            try {
                const blob = await new Promise((resolve) => flattened.toBlob(resolve, 'image/png'));
                if (!blob) {
                    return;
                }
                const latestSession = getSession();
                if (!latestSession || requestId !== latestSession.livePreviewRequestId) {
                    return;
                }
                const buffer = Buffer.from(await blob.arrayBuffer());
                dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
            } catch (error) {
                console.warn('Paint preview export failed', error);
                return;
            }
            const latestSession = getSession();
            if (!latestSession || requestId !== latestSession.livePreviewRequestId) {
                return;
            }
            appendPaintPerfLog(`preview-sync reason=${reason} ms=${Date.now() - exportStart} width=${latestSession.width} height=${latestSession.height}`);
            env.electron.ipcRenderer.send('workboard:paint-preview', {
                boardId: latestSession.boardId || state.currentBoardId,
                blockId: latestSession.blockId,
                dataUrl,
                reason
            });
        }, delay);
    }

    async function exportCanvasToPngBuffer(canvas) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
            return null;
        }
        return Buffer.from(await blob.arrayBuffer());
    }

    function resolvePaintProjectThumbnailRelativePath() {
        return 'paint/preview/current-selection.png';
    }

    function buildProjectThumbnailCanvas(sourceCanvas) {
        if (!sourceCanvas?.width || !sourceCanvas?.height) {
            return null;
        }
        const maxSide = 384;
        const sourceWidth = Math.max(1, Math.round(Number(sourceCanvas.width) || 1));
        const sourceHeight = Math.max(1, Math.round(Number(sourceCanvas.height) || 1));
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return null;
        }
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
        return canvas;
    }

    async function buildPaintProjectSelectionSnapshot(asset, animationContext, reason = 'paint-save') {
        const session = getSession();
        if (!asset?.id || !session) {
            return null;
        }
        const activeLayerIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, Math.max(0, (session.layers?.length || 1) - 1));
        const activeLayer = session.layers?.[activeLayerIndex] || getActiveLayer() || null;
        const sourceCanvas = createFlattenedLayersCanvas() || activeLayer?.canvas || null;
        const thumbnailCanvas = buildProjectThumbnailCanvas(sourceCanvas);
        let thumbnailPath = '';
        let thumbnailBytes = 0;
        const layerCount = Math.max(1, Array.isArray(session.layers) ? session.layers.length : 1);
        const frameCount = Math.max(1, Array.isArray(animationContext?.animation?.frames)
            ? animationContext.animation.frames.length
            : Number(animationContext?.animation?.frameCount) || 1);
        if (thumbnailCanvas) {
            const thumbnailBuffer = await exportCanvasToPngBuffer(thumbnailCanvas);
            if (thumbnailBuffer?.length) {
                thumbnailPath = projectStore.writeBufferToAsset(asset.id, resolvePaintProjectThumbnailRelativePath(), thumbnailBuffer);
                thumbnailBytes = thumbnailBuffer.length;
            }
        }
        const lastOpenedTarget = launchTargets.normalizePaintLaunchTarget({
            ...(session.launchTarget && typeof session.launchTarget === 'object' ? session.launchTarget : {}),
            assetId: asset.id,
            animationId: animationContext?.animation?.id || '',
            frameId: animationContext?.frame?.id || '',
            filePath: session.filePath || ''
        });
        lastOpenedTarget.filePath = projectStore.resolvePreferredPaintFilePath(asset, lastOpenedTarget) || String(session.filePath || '');
        const snapshot = {
            thumbnailPath,
            thumbnailBytes,
            layerCount,
            frameCount,
            selectedLayerId: String(activeLayer?.id || ''),
            selectedLayerIndex: activeLayerIndex,
            selectedAnimationId: String(animationContext?.animation?.id || ''),
            selectedFrameId: String(animationContext?.frame?.id || ''),
            selectedFrameIndex: Number.isFinite(Number(animationContext?.frameIndex)) ? Number(animationContext.frameIndex) : -1,
            lastOpenedTarget
        };
        logPaintTrace('paint.projectThumbnail.snapshot', {
            reason,
            assetId: asset.id,
            filePath: session.filePath || '',
            thumbnailPath,
            thumbnailBytes,
            layerCount,
            frameCount,
            selectedLayerId: snapshot.selectedLayerId,
            selectedLayerIndex: snapshot.selectedLayerIndex,
            selectedAnimationId: snapshot.selectedAnimationId,
            selectedFrameId: snapshot.selectedFrameId,
            selectedFrameIndex: snapshot.selectedFrameIndex
        });
        return snapshot;
    }

    function refreshTwoDLibraryIfVisible(reason = 'paint-save') {
        if (isPaintEditorWindow()) {
            return false;
        }
        if (state?.sublists?.isVisible !== true || state?.sublists?.activeView !== 'tool-2d') {
            return false;
        }
        try {
            env.toolShell?.renderActiveTool?.();
            logPaintTrace('paint.library.refreshVisible', {
                reason,
                activeView: state?.sublists?.activeView || '',
                visible: state?.sublists?.isVisible === true
            });
            return true;
        } catch (error) {
            logPaintTrace('paint.library.refreshVisibleFailed', {
                reason,
                message: error?.message || String(error)
            });
            return false;
        }
    }

    function shouldShowSaveHud(reason = '', options = {}) {
        if (options.showSaveHud === false) {
            return false;
        }
        return String(reason || '').trim().toLowerCase() === 'manual-save';
    }

    function renderSaveHud(status = 'running', message = '', progress = 0, detailMessage = '') {
        paintWorkspaceState.jobStatus = String(status || 'running').trim() || 'running';
        paintWorkspaceState.jobMessage = String(message || '').trim();
        paintWorkspaceState.jobDetailMessage = String(detailMessage || '').trim();
        paintWorkspaceState.jobProgress = clamp(Number(progress) || 0, 0, 1);
        paintWorkspaceState.jobStartedAt = 0;
        paintWorkspaceState.jobEstimateMs = 0;
        paintWorkspaceState.jobTimeoutMs = 0;
        paintWorkspaceState.jobTimingKey = '';
        paintWorkspaceState.jobAttemptIndex = 0;
        paintWorkspaceState.jobAttemptMax = 0;
        renderPaintJobHud();
    }

    async function flushSaveHudFrame() {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    async function writePaintBufferToFile(filePath, buffer) {
        if (env.fs?.promises?.writeFile) {
            await env.fs.promises.writeFile(filePath, buffer);
            return;
        }
        env.fs.writeFileSync(filePath, buffer);
    }

    // MARK: SAVE
    async function saveCurrentPaintSession(reason = 'paint-save', options = {}) {
        const session = getSession();
        if (!session) {
            return {
                saved: false,
                reason: 'missing-session'
            };
        }
        const sessionAsset = resolveWorkspaceAsset();
        const animationContext = resolveSessionAnimationContext(sessionAsset);
        const block = resolveBoardImageBlock(session.blockId);
        const recordHistory = options.recordHistory === true;
        const notifyCommit = options.notifyCommit === true;
        const saveReason = String(reason || 'paint-save');
        const showSaveHud = shouldShowSaveHud(saveReason, options);
        const captureLogSnapshot = options.captureLogSnapshot === true
            || (options.captureLogSnapshot !== false && saveReason !== 'autosave' && saveReason !== 'negate-exit');
        logPaintTrace('paint.save.begin', {
            reason: saveReason,
            assetId: sessionAsset?.id || '',
            animationId: animationContext.animation?.id || '',
            frameId: animationContext.frame?.id || '',
            filePath: session.filePath || '',
            boardId: session.boardId || '',
            blockId: session.blockId || '',
            recordHistory,
            notifyCommit
        });
        if (showSaveHud) {
            renderSaveHud('running', 'Saving paint...', 0.08, 'Capturing current state');
            logPaintTrace('paint.save.hud.begin', {
                reason: saveReason,
                assetId: sessionAsset?.id || '',
                filePath: session.filePath || ''
            });
            await flushSaveHudFrame();
        }
        try {
            if (sessionAsset?.id && animationContext.animation?.id) {
                await persistActiveTimelineFrameState(`${saveReason}-active`);
                await persistLoadedTimelineStates(sessionAsset, animationContext.animation, {
                    reason: saveReason
                });
                if (showSaveHud) {
                    renderSaveHud('running', 'Saving paint...', 0.24, 'Syncing timeline state');
                }
            }
        if (!session.filePath && !block && !isPaintEditorWindow()) {
            if (showSaveHud) {
                renderSaveHud('error', 'Paint save skipped', 1, 'Missing save target');
            }
            logPaintTrace('paint.save.skipped', {
                reason: saveReason,
                skip: 'missing-target',
                filePath: session.filePath || '',
                boardId: session.boardId || '',
                blockId: session.blockId || ''
            });
            return {
                saved: false,
                reason: 'missing-target'
            };
        }
        if (showSaveHud) {
            renderSaveHud('running', 'Saving paint...', 0.46, 'Exporting image');
        }
        const flattened = createFlattenedLayersCanvas();
        if (!flattened) {
            throw new Error('Paint save failed: flattened canvas missing');
        }
        const buffer = await exportCanvasToPngBuffer(flattened);
        if (!buffer) {
            throw new Error('Paint save failed: png export missing');
        }
        const savedAt = new Date().toISOString();
        const projectSelectionSnapshot = sessionAsset?.id
            ? await buildPaintProjectSelectionSnapshot(sessionAsset, animationContext, saveReason)
            : null;
        if (showSaveHud) {
            renderSaveHud('running', 'Saving paint...', 0.76, sessionAsset?.id ? 'Updating project preview' : 'Preparing save data');
        }
        const captureSaveSnapshot = () => {
            if (!captureLogSnapshot || typeof capturePaintHistorySnapshot !== 'function') {
                return null;
            }
            const snapshotEntry = capturePaintHistorySnapshot('manual-save', {
                render: paintWorkspaceState?.panelMode === 'logs'
            });
            logPaintTrace('paint.save.snapshotCapture', {
                reason: saveReason,
                snapshotId: snapshotEntry?.id || '',
                assetId: sessionAsset?.id || '',
                filePath: session.filePath || '',
                boardId: session.boardId || '',
                blockId: session.blockId || ''
            });
            return snapshotEntry;
        };
        if (session.filePath) {
            await writePaintBufferToFile(session.filePath, buffer);
            const asset = resolveSessionAsset();
            if (asset) {
                projectStore.updateAsset(asset.id, (draft) => {
                    draft.paint.lastEditedPath = projectStore.toRelativeAssetPath(draft.id, session.filePath);
                    draft.paint.editedAt = savedAt;
                    if (recordHistory) {
                        draft.still.generationHistory = Array.isArray(draft.still.generationHistory) ? draft.still.generationHistory : [];
                        draft.still.generationHistory.unshift({
                            type: 'paint-save',
                            prompt: draft.still.prompt || '',
                            variantCount: 0,
                            at: savedAt
                        });
                    }
                    draft.paint = draft.paint && typeof draft.paint === 'object' ? draft.paint : {};
                    draft.paint.thumbnailPath = String(projectSelectionSnapshot?.thumbnailPath || draft.paint.thumbnailPath || '');
                    draft.paint.thumbnailUpdatedAt = savedAt;
                    draft.paint.layerCount = Number.isFinite(Number(projectSelectionSnapshot?.layerCount))
                        ? Math.max(1, Math.round(Number(projectSelectionSnapshot.layerCount)))
                        : Math.max(1, Number(draft.paint.layerCount) || 1);
                    draft.paint.frameCount = Number.isFinite(Number(projectSelectionSnapshot?.frameCount))
                        ? Math.max(1, Math.round(Number(projectSelectionSnapshot.frameCount)))
                        : Math.max(1, Number(draft.paint.frameCount) || 1);
                    draft.paint.selectedLayerId = String(projectSelectionSnapshot?.selectedLayerId || '');
                    draft.paint.selectedLayerIndex = Number.isFinite(Number(projectSelectionSnapshot?.selectedLayerIndex))
                        ? Math.max(0, Math.round(Number(projectSelectionSnapshot.selectedLayerIndex)))
                        : 0;
                    draft.paint.selectedAnimationId = String(projectSelectionSnapshot?.selectedAnimationId || '');
                    draft.paint.selectedFrameId = String(projectSelectionSnapshot?.selectedFrameId || '');
                    draft.paint.selectedFrameIndex = Number.isFinite(Number(projectSelectionSnapshot?.selectedFrameIndex))
                        ? Math.max(-1, Math.round(Number(projectSelectionSnapshot.selectedFrameIndex)))
                        : -1;
                    draft.workspace = draft.workspace && typeof draft.workspace === 'object' ? draft.workspace : {};
                    if (projectSelectionSnapshot?.lastOpenedTarget) {
                        draft.workspace.lastOpenedTarget = projectSelectionSnapshot.lastOpenedTarget;
                    }
                    draft.workspace.lastOpenedAt = savedAt;
                    Object.values(draft.animations || {}).forEach((animation) => {
                        animation.frames = Array.isArray(animation.frames) ? animation.frames.map((frame) => {
                            const workingAbsolute = frame.workingPath ? projectStore.resolveAssetPath(draft, frame.workingPath) : '';
                            if (workingAbsolute && env.path.resolve(workingAbsolute) === env.path.resolve(session.filePath)) {
                                return {
                                    ...frame,
                                    manualEdited: true,
                                    approved: true,
                                    status: 'paint-edited'
                                };
                            }
                            return frame;
                        }) : [];
                    });
                    return draft;
                }, options.assetReason || 'asset2d-paint-save');
            }
            if (notifyCommit) {
                env.electron?.ipcRenderer?.send?.('workboard:paint-commit', {
                    filePath: session.filePath
                });
            }
            const saveSnapshot = captureSaveSnapshot();
            refreshTwoDLibraryIfVisible(saveReason);
            if (showSaveHud) {
                const savedTimeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
                renderSaveHud('done', `Saved ${savedTimeLabel}`, 1, 'Checkpoint captured');
                logPaintTrace('paint.save.hud.complete', {
                    reason: saveReason,
                    mode: 'file',
                    assetId: asset?.id || '',
                    filePath: session.filePath || '',
                    snapshotId: saveSnapshot?.id || ''
                });
            }
            logPaintTrace('paint.save.complete', {
                reason: saveReason,
                mode: 'file',
                assetId: asset?.id || '',
                filePath: session.filePath,
                bytes: buffer.length,
                thumbnailPath: projectSelectionSnapshot?.thumbnailPath || '',
                recordHistory,
                notifyCommit,
                snapshotId: saveSnapshot?.id || ''
            });
            return {
                saved: true,
                mode: 'file',
                assetId: asset?.id || '',
                filePath: session.filePath,
                snapshotId: saveSnapshot?.id || ''
            };
        }
        const assetName = await env.blocks.image.persistImageBuffer(buffer, 'png');
        if (isPaintEditorWindow()) {
            if (notifyCommit) {
                env.electron?.ipcRenderer?.send?.('workboard:paint-commit', {
                    boardId: session.boardId || state.currentBoardId,
                    blockId: session.blockId,
                    assetName
                });
            }
        } else {
            block.assetName = assetName;
            block.updatedAt = savedAt;
            const viewport = cloneViewportSnapshot(session.entryViewport) || cloneViewportSnapshot(env.movement?.getCurrentViewportSnapshot?.());
            env.management.renderBoard({ targetViewport: viewport, preserveViewport: false, skipViewportCommit: true });
            env.data.queueSave(options.boardReason || 'paint-save');
        }
        const saveSnapshot = captureSaveSnapshot();
        if (showSaveHud) {
            const savedTimeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            renderSaveHud('done', `Saved ${savedTimeLabel}`, 1, 'Checkpoint captured');
            logPaintTrace('paint.save.hud.complete', {
                reason: saveReason,
                mode: 'board-image',
                boardId: session.boardId || state.currentBoardId || '',
                blockId: session.blockId || '',
                snapshotId: saveSnapshot?.id || ''
            });
        }
        logPaintTrace('paint.save.complete', {
            reason: saveReason,
            mode: 'board-image',
            boardId: session.boardId || state.currentBoardId || '',
            blockId: session.blockId || '',
            assetName,
            bytes: buffer.length,
            notifyCommit,
            snapshotId: saveSnapshot?.id || ''
        });
        return {
            saved: true,
            mode: 'board-image',
            assetName,
            snapshotId: saveSnapshot?.id || ''
        };
        } catch (error) {
            if (showSaveHud) {
                renderSaveHud('error', 'Paint save failed', 1, error?.message || 'Save failed');
                logPaintTrace('paint.save.hud.error', {
                    reason: saveReason,
                    assetId: sessionAsset?.id || '',
                    filePath: session.filePath || '',
                    message: error?.message || String(error)
                });
            }
            throw error;
        }
    }

    async function runPaintAutosaveTick(reason = 'interval') {
        const session = getSession();
        const autosave = ensurePaintAutosaveState();
        if (!session || !autosave?.dirty) {
            return false;
        }
        const now = Date.now();
        const blockedReason = resolvePaintAutosaveBlockReason(now);
        if (blockedReason) {
            if (blockedReason !== 'waiting-due' && blockedReason !== 'clean') {
                const lastLoggedAt = Number(autosave.lastBlockedLoggedAt) || 0;
                if (autosave.lastBlockedReason !== blockedReason || (now - lastLoggedAt) >= 5000) {
                    autosave.lastBlockedReason = blockedReason;
                    autosave.lastBlockedLoggedAt = now;
                    logPaintTrace('paint.autosave.skipped', {
                        reason,
                        blockedReason,
                        dirty: autosave.dirty === true,
                        changeToken: autosave.changeToken,
                        savedToken: autosave.savedToken,
                        dueInMs: Math.max(0, Math.round((Number(autosave.nextDueAt) || 0) - now)),
                        idleForMs: Math.max(0, now - (Number(autosave.lastActivityAt) || 0)),
                        filePath: session.filePath || ''
                    });
                }
            }
            return false;
        }
        autosave.inFlight = true;
        autosave.lastBlockedReason = '';
        const saveToken = Math.max(0, Number(autosave.changeToken) || 0);
        logPaintTrace('paint.autosave.begin', {
            reason,
            changeToken: saveToken,
            filePath: session.filePath || '',
            boardId: session.boardId || '',
            blockId: session.blockId || ''
        });
        try {
            const result = await saveCurrentPaintSession('autosave', {
                recordHistory: false,
                notifyCommit: isPaintEditorWindow() && !session.filePath,
                assetReason: 'asset2d-paint-autosave',
                boardReason: 'paint-autosave'
            });
            if (!result?.saved || !getSession()?.autosave) {
                const latestSession = getSession();
                if (latestSession?.autosave) {
                    latestSession.autosave.nextDueAt = Date.now() + PAINT_AUTOSAVE_RETRY_MS;
                }
                logPaintTrace('paint.autosave.incomplete', {
                    reason,
                    saveReason: result?.reason || 'unknown',
                    filePath: latestSession?.filePath || ''
                });
                return false;
            }
            const latest = getSession().autosave;
            latest.savedToken = Math.max(Number(latest.savedToken) || 0, saveToken);
            latest.lastSavedAt = Date.now();
            latest.failureCount = 0;
            latest.dirty = (Number(latest.changeToken) || 0) > (Number(latest.savedToken) || 0);
            latest.dirtyAt = latest.dirty ? latest.lastSavedAt : 0;
            latest.nextDueAt = latest.dirty ? (latest.lastSavedAt + PAINT_AUTOSAVE_INTERVAL_MS) : 0;
            logPaintTrace('paint.autosave.complete', {
                reason,
                mode: result.mode || '',
                changeToken: latest.changeToken,
                savedToken: latest.savedToken,
                dirty: latest.dirty === true,
                filePath: getSession()?.filePath || ''
            });
            return true;
        } catch (error) {
            const latestSession = getSession();
            if (latestSession?.autosave) {
                latestSession.autosave.failureCount = Math.max(0, Number(latestSession.autosave.failureCount) || 0) + 1;
                latestSession.autosave.nextDueAt = Date.now() + PAINT_AUTOSAVE_RETRY_MS;
            }
            logPaintTrace('paint.autosave.error', {
                reason,
                message: error?.message || String(error),
                failureCount: Number(getSession()?.autosave?.failureCount) || 0,
                filePath: getSession()?.filePath || ''
            });
            return false;
        } finally {
            const latestSession = getSession();
            if (latestSession?.autosave) {
                latestSession.autosave.inFlight = false;
            }
        }
    }

    function startPaintAutosaveLoop(reason = 'start') {
        const session = getSession();
        const autosave = ensurePaintAutosaveState();
        if (!session || !autosave) {
            return false;
        }
        stopPaintAutosaveLoop(`${reason}-reset`);
        autosave.lastActivityAt = Date.now();
        autosave.timer = setInterval(() => {
            runPaintAutosaveTick('interval').catch((error) => {
                logPaintTrace('paint.autosave.tickFailed', {
                    reason: 'interval',
                    message: error?.message || String(error),
                    filePath: getSession()?.filePath || ''
                });
            });
        }, PAINT_AUTOSAVE_TICK_MS);
        logPaintTrace('paint.autosave.loop.start', {
            reason,
            intervalMs: PAINT_AUTOSAVE_INTERVAL_MS,
            idleMs: PAINT_AUTOSAVE_IDLE_MS,
            tickMs: PAINT_AUTOSAVE_TICK_MS,
            filePath: session.filePath || ''
        });
        return true;
    }

    return {
        createInitialPaintAutosaveState,
        ensurePaintAutosaveState,
        touchPaintSessionActivity,
        markPaintSessionDirty,
        resolvePaintAutosaveBlockReason,
        stopPaintAutosaveLoop,
        clearScheduledLivePreview,
        notifyPreviewCleared,
        scheduleLivePreviewSync,
        exportCanvasToPngBuffer,
        saveCurrentPaintSession,
        runPaintAutosaveTick,
        startPaintAutosaveLoop
    };
};
