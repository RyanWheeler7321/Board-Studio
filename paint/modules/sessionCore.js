'use strict';

// MARK: MODULE
module.exports = function createPaintSessionCoreModule(deps) {
    const {
        env,
        dom,
        state,
        projectStore,
        launchTargets,
        assetActions,
        paintWorkspaceState,
        timelinePreviewUrlCache,
        LAYER_THUMBNAIL_TONE_DEFAULT,
        LAYER_THUMBNAIL_TONE_MIN,
        LAYER_THUMBNAIL_TONE_MAX,
        LAYER_OPACITY_DEFAULT,
        getSession,
        setSession,
        clamp,
        clamp01,
        logPaintTrace,
        resetWorkspaceUiState,
        startPaintTheme,
        stopPaintAutosaveLoop,
        clearPaintWorkspacePlaybackTimer,
        clearPaintWorkspaceVariantPreview,
        clearPaintWorkspaceStage,
        renderPaintWorkspaceUi
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

function isFileBackedPaintSession() {
    return !!session?.filePath;
}

function resolveSessionAsset() {
    if (!session?.filePath) {
        return null;
    }
    return projectStore.findAssetContextByFilePath(session.filePath)?.asset || null;
}

function resolveSessionLaunchTarget() {
    let target = null;
    if (session?.launchTarget && typeof session.launchTarget === 'object') {
        target = launchTargets.normalizePaintLaunchTarget(session.launchTarget);
        logPaintTrace('resolveSessionLaunchTarget.session', {
            mode: target.mode,
            boardId: target.boardId,
            blockId: target.blockId,
            assetId: target.assetId,
            filePath: target.filePath
        });
        return target;
    }
    if (paintWorkspaceState.placeholderLaunchTarget && typeof paintWorkspaceState.placeholderLaunchTarget === 'object') {
        target = launchTargets.normalizePaintLaunchTarget(paintWorkspaceState.placeholderLaunchTarget);
        logPaintTrace('resolveSessionLaunchTarget.placeholder', {
            mode: target.mode,
            boardId: target.boardId,
            blockId: target.blockId,
            assetId: target.assetId,
            filePath: target.filePath
        });
        return target;
    }
    if (session?.filePath) {
        target = projectStore.findAssetContextByFilePath(session.filePath)?.target || launchTargets.normalizePaintLaunchTarget({
            mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
            boardId: session?.boardId || state.currentBoardId || '',
            blockId: session?.blockId || '',
            filePath: session.filePath
        });
        logPaintTrace('resolveSessionLaunchTarget.filePath', {
            mode: target.mode,
            boardId: target.boardId,
            blockId: target.blockId,
            assetId: target.assetId,
            filePath: target.filePath
        });
        return target;
    }
    target = launchTargets.normalizePaintLaunchTarget(env.windowContext?.paintLaunchTarget || {});
    logPaintTrace('resolveSessionLaunchTarget.windowContext', {
        mode: target.mode,
        boardId: target.boardId,
        blockId: target.blockId,
        assetId: target.assetId,
        filePath: target.filePath
    });
    return target;
}

function resolveWorkspaceAsset() {
    const launchTarget = resolveSessionLaunchTarget();
    const sessionAsset = resolveSessionAsset();
    let asset = null;
    if (launchTarget.assetId) {
        asset = projectStore.getAsset(launchTarget.assetId) || sessionAsset || projectStore.getSelectedAsset() || projectStore.listAssets()[0] || null;
        logPaintTrace('resolveWorkspaceAsset.byLaunchTarget', {
            launchMode: launchTarget.mode,
            launchAssetId: launchTarget.assetId,
            resolvedAssetId: asset?.id || '',
            resolvedAssetName: asset?.name || ''
        });
        return asset;
    }
    if (sessionAsset) {
        logPaintTrace('resolveWorkspaceAsset.bySessionAsset', {
            resolvedAssetId: sessionAsset?.id || '',
            resolvedAssetName: sessionAsset?.name || ''
        });
        return sessionAsset;
    }
    if (session?.filePath) {
        logPaintTrace('resolveWorkspaceAsset.fileBackedStandalone', {
            filePath: session.filePath
        });
        return null;
    }
    asset = projectStore.getSelectedAsset() || projectStore.listAssets()[0] || null;
    logPaintTrace('resolveWorkspaceAsset.fallbackSelection', {
        resolvedAssetId: asset?.id || '',
        resolvedAssetName: asset?.name || ''
    });
    return asset;
}

function isWorkspacePlaceholderState() {
    const launchTarget = resolveSessionLaunchTarget();
    return launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE && !session?.filePath;
}

function isStandaloneBoardImageSession() {
    if (!session?.filePath) {
        return false;
    }
    const launchTarget = resolveSessionLaunchTarget();
    if (launchTarget.mode !== launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE) {
        return false;
    }
    return !resolveSessionAsset();
}

function showEmptyPaintWorkspace(target = {}) {
    logPaintTrace('showEmptyPaintWorkspace.begin', {
        target,
        previousSessionFilePath: session?.filePath || '',
        previousSessionBoardId: session?.boardId || '',
        previousSessionBlockId: session?.blockId || ''
    });
    state.paintModeActive = true;
    stopPaintAutosaveLoop('workspace-placeholder');
    setSession(null);
    resetWorkspaceUiState();
    paintWorkspaceState.placeholderLaunchTarget = launchTargets.normalizePaintLaunchTarget({
        mode: launchTargets.PAINT_LAUNCH_MODES.WORKSPACE,
        ...target
    });
    if (dom.paintOverlay) {
        dom.paintOverlay.hidden = false;
    }
    startPaintTheme(null, 'workspace-placeholder');
    paintWorkspaceState.panelHidden = true;
    paintWorkspaceState.drawerOpen = false;
    paintWorkspaceState.collapsedTimelineVisible = false;
    paintWorkspaceState.expandedTimelineVisible = false;
    paintWorkspaceState.timelineExpanded = false;
    paintWorkspaceState.previewVariantId = '';
    paintWorkspaceState.layerViewerOpen = false;
    paintWorkspaceState.layerViewerMode = 'survey';
    paintWorkspaceState.layerViewerFocusedLayerId = '';
    paintWorkspaceState.layerViewerRecency = [];
    paintWorkspaceState.projectMenuHidden = true;
    paintWorkspaceState.noBoundaryClip = true;
    paintWorkspaceState.quickAnimationPeek = false;
    clearPaintWorkspacePlaybackTimer();
    clearPaintWorkspaceVariantPreview();
    clearPaintWorkspaceStage();
    renderPaintWorkspaceUi();
    logPaintTrace('showEmptyPaintWorkspace.end', {
        placeholderTarget: paintWorkspaceState.placeholderLaunchTarget
    });
}

function shouldDefaultPaintWorkspacePanelHidden() {
    return true;
}

function resolveBoardImageAbsolutePath(block) {
    if (!block) {
        return '';
    }
    const raw = String(block.filePath || '').trim();
    if (raw && env.path.isAbsolute(raw)) {
        return raw;
    }
    if (block.assetName && env.blocks?.image?.resolveImageAssetPath) {
        return String(env.blocks.image.resolveImageAssetPath(block.assetName) || '').trim();
    }
    return raw;
}

function isTemporaryWorkspaceAsset(asset = resolveWorkspaceAsset()) {
    return !!asset && projectStore.isTemporaryAsset(asset);
}

async function ensureTemporaryBoardImageAsset(block, boardId) {
    if (!block || block.type !== 'image') {
        return null;
    }
    const existingTempLink = block.tempTwoDLink && typeof block.tempTwoDLink === 'object'
        ? launchTargets.normalizePaintLaunchTarget(block.tempTwoDLink)
        : null;
    if (existingTempLink?.assetId && projectStore.getAsset(existingTempLink.assetId)) {
        logPaintTrace('ensureTemporaryBoardImageAsset.reuse', {
            boardId,
            blockId: block.id || '',
            assetId: existingTempLink.assetId
        });
        return existingTempLink;
    }
    const sourcePath = resolveBoardImageAbsolutePath(block);
    if (!sourcePath) {
        logPaintTrace('ensureTemporaryBoardImageAsset.missingSource', {
            boardId,
            blockId: block.id || '',
            assetName: block.assetName || ''
        });
        return null;
    }
    const previousSelectedAssetId = projectStore.getSelectedAsset({ includeTemporary: true })?.id || '';
    const result = await assetActions.importStillImageAsset(sourcePath, {
        name: String(block.label || block.text || block.title || '').trim() || env.path.basename(sourcePath, env.path.extname(sourcePath)),
        type: 'concept'
    });
    const promoted = projectStore.updateAsset(result.asset.id, (draft) => {
        draft.workspace = draft.workspace && typeof draft.workspace === 'object' ? draft.workspace : {};
        draft.workspace.temporary = true;
        draft.workspace.temporaryBoardId = String(boardId || '').trim();
        draft.workspace.temporaryBlockId = String(block.id || '').trim();
        draft.workspace.lastOpenedTarget = launchTargets.normalizePaintLaunchTarget({
            ...result.launchTarget,
            boardId,
            blockId: String(block.id || '').trim(),
            source: 'board-image-temp'
        });
        return draft;
    }, 'asset2d-temp-board-image');
    if (previousSelectedAssetId) {
        projectStore.selectAsset(previousSelectedAssetId, 'asset2d-restore-selection-after-temp');
    }
    const tempTarget = launchTargets.normalizePaintLaunchTarget({
        ...result.launchTarget,
        assetId: promoted?.id || result.asset.id,
        boardId,
        blockId: String(block.id || '').trim(),
        source: 'board-image-temp'
    });
    block.tempTwoDLink = tempTarget;
    env.data.queueSave?.('asset2d-temp-board-image-link');
    logPaintTrace('ensureTemporaryBoardImageAsset.created', {
        boardId,
        blockId: block.id || '',
        sourcePath,
        assetId: tempTarget.assetId,
        filePath: tempTarget.filePath
    });
    return tempTarget;
}

function cloneCanvasSurface(sourceCanvas) {
    if (!sourceCanvas) {
        return null;
    }
    const clone = document.createElement('canvas');
    clone.width = Math.max(1, Number(sourceCanvas.width) || 1);
    clone.height = Math.max(1, Number(sourceCanvas.height) || 1);
    const ctx = clone.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    ctx.clearRect(0, 0, clone.width, clone.height);
    ctx.drawImage(sourceCanvas, 0, 0);
    return clone;
}

function normalizeLayerThumbnailTone(value, fallback = LAYER_THUMBNAIL_TONE_DEFAULT) {
    const parsed = Number(value);
    const base = Number.isFinite(parsed) ? parsed : fallback;
    return clamp(base, LAYER_THUMBNAIL_TONE_MIN, LAYER_THUMBNAIL_TONE_MAX);
}

function normalizeLayerOpacity(value, fallback = LAYER_OPACITY_DEFAULT) {
    const parsed = Number(value);
    const base = Number.isFinite(parsed) ? parsed : fallback;
    return clamp01(base);
}

function normalizeLayerVisibility(value, fallback = true) {
    if (typeof value === 'boolean') {
        return value;
    }
    return fallback !== false;
}

function cloneLayerSnapshots(layers = []) {
    return (Array.isArray(layers) ? layers : [])
        .filter((layer) => !!layer?.canvas)
        .map((layer) => ({
            id: String(layer.id || ''),
            name: String(layer.name || ''),
            isBase: layer.isBase === true,
            visible: normalizeLayerVisibility(layer.visible, true),
            opacity: normalizeLayerOpacity(layer.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(layer.thumbnailTone),
            canvas: cloneCanvasSurface(layer.canvas)
        }))
        .filter((entry) => !!entry.canvas);
}

function invalidateTimelinePreviewCacheForLayers(layers = []) {
    (Array.isArray(layers) ? layers : []).forEach((layer) => {
        if (layer?.canvas) {
            timelinePreviewUrlCache.delete(layer.canvas);
        }
    });
}

function resolveAssetPrimaryImageRelativePath(asset) {
    if (!asset) {
        return '';
    }
    return String(
        asset.still?.approvedImagePath
        || asset.still?.workingImagePath
        || asset.still?.sourceImages?.[0]
        || ''
    ).trim();
}

function resolveFrameCanvasExtension(...paths) {
    for (const value of paths) {
        const ext = String(env.path.extname(String(value || '').trim()) || '').trim();
        if (ext) {
            return ext;
        }
    }
    return '.png';
}

    return {
        isFileBackedPaintSession,
        resolveSessionAsset,
        resolveSessionLaunchTarget,
        resolveWorkspaceAsset,
        isWorkspacePlaceholderState,
        isStandaloneBoardImageSession,
        showEmptyPaintWorkspace,
        shouldDefaultPaintWorkspacePanelHidden,
        resolveBoardImageAbsolutePath,
        isTemporaryWorkspaceAsset,
        ensureTemporaryBoardImageAsset,
        cloneCanvasSurface,
        normalizeLayerThumbnailTone,
        normalizeLayerOpacity,
        normalizeLayerVisibility,
        cloneLayerSnapshots,
        invalidateTimelinePreviewCacheForLayers,
        resolveAssetPrimaryImageRelativePath,
        resolveFrameCanvasExtension
    };
};
