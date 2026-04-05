'use strict';

// MARK: MODULE
module.exports = function createPaintLifecycleModule(deps) {
    const {
        env,
        dom,
        state,
        utils,
        projectStore,
        launchTargets,
        paintWorkspaceState,
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
        MAX_CANVAS_DIMENSION,
        STROKE_MODE_FILL,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        LAYER_BASE_NAME,
        RECENT_COLORS_MAX,
        BRUSH_BLEND_MODES,
        TOOL_SPACING_MIN,
        TOOL_SPACING_MAX,
        getSession,
        setSession,
        clamp,
        logPaintTrace,
        isPaintEditorWindow,
        PAINT_EXIT_HOTKEY_BLOCK_MS,
        resolveImageBlockByBoard,
        resolveBoardImageBlock,
        ensureTemporaryBoardImageAsset,
        resolvePaintTargetForBlock,
        ensureDom,
        ensureHandlers,
        loadImageForAsset,
        loadImageForPath,
        resolvePaintCanvasSize,
        cloneViewportSnapshot,
        restoreBoardViewportAfterPaint,
        startPaintTheme,
        stopPaintTheme,
        stopPaintAutosaveLoop,
        showEmptyPaintWorkspace,
        shouldDefaultPaintWorkspacePanelHidden,
        destroyDynamicPaintLayerCanvases,
        setHelpVisible,
        createInitialPaintAutosaveState,
        normalizeHexColor,
        readLocalPaintPrefs,
        normalizeBrushProfiles,
        buildLegacyBrushStateFromProfiles,
        resolvePressureDefaults,
        setActiveLayerRefs,
        applyPressureForTool,
        applyToolSettingsForTool,
        applyOverlayBlendMode,
        updateStageCursor,
        renderRecentColorSwatches,
        renderRelatedColorSwatches,
        renderBlendMenu,
        ensureBrushMaskLoaded,
        initializeStampSupport,
        setDebugVisible,
        ensureStageUiSized,
        setCursorBlendMode,
        setDefaultZoom,
        updateHud,
        renderLayerBar,
        renderStageUi,
        renderPaintWorkspaceUi,
        renderCursorCanvas,
        queueStageShadowRefresh,
        capturePaintHistorySnapshot,
        schedulePaintViewPostOpen,
        clearScheduledLivePreview,
        notifyPreviewCleared,
        clearStageShadowCanvas,
        clearStagePatternCanvas,
        clearOverlayCanvas,
        clearUiCanvas,
        hideColorPopover,
        hidePaintContextMenu,
        setExitMenuVisible,
        persistPaintPreferences,
        clearPaintWorkspacePlaybackTimer,
        clearPaintJobHudTimer,
        scheduleLivePreviewSync,
        startPaintAutosaveLoop,
        saveCurrentPaintSession,
        loadAnimationFrameIntoSession,
        resetWorkspaceUiState,
        paintWorkspaceUi,
        fitToScreen
    } = deps;

    function handlePaintWindowOpenResponse(response, fallbackMessage = 'Paint window failed to open') {
        if (response?.success) {
            return false;
        }
        if (response?.error === 'paint-window-already-open') {
            utils.showToast?.('Finish the current paint edit first');
            return true;
        }
        utils.showToast?.(fallbackMessage);
        return true;
    }

    function hasValidPaintLaunchTarget(target) {
        if (!target || typeof target !== 'object') {
            return false;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE) {
            return true;
        }
        if (target.filePath) {
            return true;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE) {
            return !!target.boardId && !!target.blockId;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL) {
            return !!target.assetId;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET) {
            return !!target.assetId && !!target.animationId;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME) {
            return !!target.assetId && !!target.animationId && !!target.frameId;
        }
        return false;
    }

    async function openPaintWindowForTarget(target) {
        const normalizedTarget = launchTargets.normalizePaintLaunchTarget(target);
        logPaintTrace('openPaintWindowForTarget.begin', {
            target: normalizedTarget
        });
        if (!hasValidPaintLaunchTarget(normalizedTarget)) {
            console.warn('Paint window open skipped: invalid target', normalizedTarget);
            logPaintTrace('openPaintWindowForTarget.invalid', {
                target: normalizedTarget
            });
            return { success: false, error: 'missing-paint-target' };
        }
        if (!env.electron?.ipcRenderer?.invoke) {
            return { success: false, error: 'ipc-unavailable' };
        }
        try {
            const response = await env.electron.ipcRenderer.invoke('workboard:open-paint-window', normalizedTarget);
            logPaintTrace('openPaintWindowForTarget.response', {
                target: normalizedTarget,
                response
            });
            return response;
        } catch (error) {
            console.error('Paint window open failed', error);
            logPaintTrace('openPaintWindowForTarget.error', {
                target: normalizedTarget,
                error: error?.message || String(error)
            });
            return { success: false, error: error.message || 'paint-window-open-failed' };
        }
    }

    async function openPaintWindowForBlock(blockId) {
        const boardId = String(state.currentBoardId || '').trim();
        logPaintTrace('openPaintWindowForBlock.begin', {
            boardId,
            blockId
        });
        if (!boardId || !blockId) {
            return { success: false, error: 'missing-target' };
        }
        const block = resolveImageBlockByBoard(boardId, blockId);
        logPaintTrace('openPaintWindowForBlock.block', {
            boardId,
            blockId,
            blockType: block?.type || '',
            assetName: block?.assetName || ''
        });
        if (!block || block.type !== 'image') {
            return { success: false, error: 'missing-target' };
        }
        const tempTarget = !block.twoDLink ? await ensureTemporaryBoardImageAsset(block, boardId) : null;
        const target = tempTarget || resolvePaintTargetForBlock(block, boardId);
        logPaintTrace('openPaintWindowForBlock.target', {
            boardId,
            blockId,
            target
        });
        return openPaintWindowForTarget(target);
    }

    async function openPaintWindowForFile(filePath, options = {}) {
        const resolved = typeof filePath === 'string' ? filePath.trim() : '';
        if (!resolved) {
            return { success: false, error: 'missing-target' };
        }
        const inferredTarget = projectStore.findAssetContextByFilePath(resolved)?.target;
        return openPaintWindowForTarget(options.paintLaunchTarget || inferredTarget || {
            mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
            boardId: String(options.boardId || state.currentBoardId || '').trim(),
            filePath: resolved,
            source: 'file-open'
        });
    }

    async function openPaintWindowForWorkspace(options = {}) {
        logPaintTrace('openPaintWindowForWorkspace.begin', {
            assetId: String(options.assetId || '').trim()
        });
        return openPaintWindowForTarget({
            mode: launchTargets.PAINT_LAUNCH_MODES.WORKSPACE,
            assetId: String(options.assetId || '').trim(),
            source: 'workspace'
        });
    }

    function resolveRequestedPaintFilePath(launchTarget, fallbackFilePath = '') {
        const normalizedTarget = launchTargets.normalizePaintLaunchTarget(launchTarget);
        if (normalizedTarget.assetId && (
            normalizedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE
            || normalizedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL
            || normalizedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET
            || normalizedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME
        )) {
            const asset = projectStore.getAsset(normalizedTarget.assetId);
            if (asset) {
                const resolved = projectStore.resolvePreferredPaintFilePath(asset, normalizedTarget);
                if (resolved) {
                    logPaintTrace('resolveRequestedPaintFilePath.fromAssetTarget', {
                        assetId: normalizedTarget.assetId,
                        mode: normalizedTarget.mode,
                        resolved
                    });
                    return resolved;
                }
            }
        }
        const fallback = String(fallbackFilePath || '').trim();
        if (fallback) {
            logPaintTrace('resolveRequestedPaintFilePath.fallback', {
                fallback
            });
            return fallback;
        }
        if (normalizedTarget.filePath) {
            logPaintTrace('resolveRequestedPaintFilePath.fromTarget', {
                filePath: normalizedTarget.filePath,
                mode: normalizedTarget.mode
            });
            return normalizedTarget.filePath;
        }
        if (normalizedTarget.assetId) {
            const asset = projectStore.getAsset(normalizedTarget.assetId);
            if (asset) {
                const resolved = projectStore.resolvePreferredPaintFilePath(asset, normalizedTarget);
                logPaintTrace('resolveRequestedPaintFilePath.fromAsset', {
                    assetId: normalizedTarget.assetId,
                    mode: normalizedTarget.mode,
                    resolved
                });
                return resolved;
            }
        }
        logPaintTrace('resolveRequestedPaintFilePath.none', {
            launchTarget: normalizedTarget
        });
        return '';
    }

    function buildDirectPaintLaunchTarget(blockId, options = {}) {
        const normalizedBlockId = String(blockId || '').trim();
        const normalizedBoardId = String(options.boardId || env.windowContext?.boardId || state.currentBoardId || '').trim();
        const normalizedFilePath = String(options.filePath || '').trim();
        if (normalizedFilePath) {
            return launchTargets.normalizePaintLaunchTarget({
                mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
                boardId: normalizedBoardId,
                blockId: normalizedBlockId,
                filePath: normalizedFilePath
            });
        }
        if (normalizedBlockId) {
            return launchTargets.normalizePaintLaunchTarget({
                mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
                boardId: normalizedBoardId,
                blockId: normalizedBlockId
            });
        }
        return null;
    }

    function schedulePaintViewPostOpenImpl() {
        const applyPostOpenFit = () => {
            const session = getSession();
            if (!session) {
                return;
            }
            ensureStageUiSized();
            fitToScreen();
            renderStageUi();
            renderCursorCanvas();
            logPaintTrace('schedulePaintViewPostOpen.applied', {
                stageWidth: Math.round(dom.paintStage?.getBoundingClientRect?.().width || 0),
                stageHeight: Math.round(dom.paintStage?.getBoundingClientRect?.().height || 0),
                scale: session.view.scale,
                tx: session.view.tx,
                ty: session.view.ty,
                width: session.width,
                height: session.height
            });
        };
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(applyPostOpenFit);
        });
        window.setTimeout(applyPostOpenFit, 80);
    }

    async function openPaintModeForBlock(blockId, options = {}) {
        let launchTarget = launchTargets.normalizePaintLaunchTarget(
            options.paintLaunchTarget
            || buildDirectPaintLaunchTarget(blockId, options)
            || env.windowContext?.paintLaunchTarget
            || {
                mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
                boardId: options.boardId || env.windowContext?.boardId || state.currentBoardId || '',
                blockId,
                filePath: options.filePath || env.windowContext?.filePath || ''
            }
        );
        logPaintTrace('openPaintModeForBlock.begin', {
            blockId,
            options: {
                inline: !!options.inline,
                boardId: options.boardId || '',
                filePath: options.filePath || '',
                paintLaunchTarget: options.paintLaunchTarget || null
            },
            launchTarget
        });
        if (!options.inline && !isPaintEditorWindow()) {
            const response = launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE
                ? await openPaintWindowForWorkspace({ assetId: launchTarget.assetId || '' })
                : (blockId
                    ? await openPaintWindowForBlock(blockId)
                    : (launchTarget.filePath
                        ? await openPaintWindowForFile(launchTarget.filePath, { paintLaunchTarget: launchTarget })
                        : await openPaintWindowForTarget(launchTarget)));
            handlePaintWindowOpenResponse(response);
            logPaintTrace('openPaintModeForBlock.forwardedToWindow', {
                launchTarget,
                response
            });
            return response;
        }
        if (!ensureDom()) {
            console.warn('Paint mode unavailable: DOM missing');
            return;
        }
        if (!state.boardData) {
            console.error('Paint mode unavailable: board data missing', {
                hasBoardData: !!state.boardData,
                currentBoardId: state.currentBoardId || ''
            });
            return;
        }
        const targetBoardId = String(launchTarget.boardId || options.boardId || env.windowContext?.boardId || state.currentBoardId || '').trim();
        if (launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE && targetBoardId && blockId && !launchTarget.assetId) {
            const targetBlock = resolveImageBlockByBoard(targetBoardId || state.currentBoardId, blockId);
            if (targetBlock?.type === 'image' && !targetBlock.twoDLink) {
                const tempTarget = await ensureTemporaryBoardImageAsset(targetBlock, targetBoardId);
                if (tempTarget?.assetId) {
                    launchTarget = launchTargets.normalizePaintLaunchTarget(tempTarget);
                    logPaintTrace('openPaintModeForBlock.tempTargetAttached', {
                        blockId,
                        boardId: targetBoardId,
                        assetId: launchTarget.assetId,
                        filePath: launchTarget.filePath
                    });
                }
            }
        }
        const requestedFilePath = resolveRequestedPaintFilePath(launchTarget, options.filePath || env.windowContext?.filePath || '');
        console.info('Paint open requested', {
            blockId,
            requestedFilePath,
            targetBoardId,
            launchMode: launchTarget.mode,
            currentBoardId: state.currentBoardId || '',
            inline: !!options.inline,
            windowMode: env.windowMode || 'board'
        });
        if (launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE && !requestedFilePath) {
            showEmptyPaintWorkspace(launchTarget);
            logPaintTrace('openPaintModeForBlock.workspacePlaceholder', {
                launchTarget
            });
            return { success: true, workspace: true };
        }
        const block = requestedFilePath
            ? { id: '', type: 'image', assetName: requestedFilePath, width: 0, height: 0, filePath: requestedFilePath, __fileBacked: true }
            : resolveImageBlockByBoard(targetBoardId || state.currentBoardId, blockId);
        if (!block || block.type !== 'image' || !block.assetName) {
            console.error('Paint mode target block missing or invalid', {
                blockId,
                requestedFilePath,
                targetBoardId,
                currentBoardId: state.currentBoardId || ''
            });
            utils.showToast?.('Paint target could not be opened');
            if (isPaintEditorWindow()) {
                window.setTimeout(() => window.close(), 0);
            }
            logPaintTrace('openPaintModeForBlock.invalidBlock', {
                blockId,
                requestedFilePath,
                targetBoardId,
                launchTarget
            });
            return;
        }
        if (targetBoardId && state.currentBoardId !== targetBoardId) {
            state.currentBoardId = targetBoardId;
        }
        console.info('Paint target resolved', {
            blockId,
            requestedFilePath,
            boardId: targetBoardId || state.currentBoardId,
            assetName: block.assetName,
            launchMode: launchTarget.mode
        });
        const entryViewport = cloneViewportSnapshot(env.movement?.getCurrentViewportSnapshot?.());
        ensureHandlers();
        state.paintModeActive = true;
        dom.paintOverlay.hidden = false;
        startPaintTheme(null, 'open-begin');
        setHelpVisible(false);
        destroyDynamicPaintLayerCanvases();

        let img = null;
        try {
            img = requestedFilePath ? await loadImageForPath(requestedFilePath) : await loadImageForAsset(block.assetName);
        } catch (error) {
            console.error('Paint mode image load failed', error);
            logPaintTrace('openPaintModeForBlock.imageLoadFailed', {
                requestedFilePath,
                assetName: block.assetName,
                error: error?.message || String(error)
            });
            utils.showToast?.('Image load failed');
            closePaintMode({ reason: 'load-failed' });
            return;
        }

        const resolvedSize = resolvePaintCanvasSize(img, block);
        const width = resolvedSize.width;
        const height = resolvedSize.height;
        dom.paintCanvasWrap.style.width = `${width}px`;
        dom.paintCanvasWrap.style.height = `${height}px`;

        const baseCanvas = dom.paintCanvas;
        baseCanvas.removeAttribute('data-paint-layer-dynamic');
        const selectionCanvas = dom.paintSelectionCanvas;
        const overlayCanvas = dom.paintOverlayCanvas;
        const uiCanvas = dom.paintUiCanvas;
        const stageShadowCanvas = dom.paintStageShadowCanvas;
        const stagePatternCanvas = dom.paintStagePatternCanvas;
        const stageUiCanvas = dom.paintStageUiCanvas;
        const cursorCanvas = dom.paintCursorCanvas;
        baseCanvas.width = width;
        baseCanvas.height = height;
        selectionCanvas.width = width;
        selectionCanvas.height = height;
        overlayCanvas.width = width;
        overlayCanvas.height = height;
        uiCanvas.width = width;
        uiCanvas.height = height;

        const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
        const selectionCtx = selectionCanvas.getContext('2d', { willReadFrequently: false });
        const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: false });
        const uiCtx = uiCanvas.getContext('2d', { willReadFrequently: false });
        const stageShadowCtx = stageShadowCanvas?.getContext?.('2d', { willReadFrequently: false });
        const stagePatternCtx = stagePatternCanvas?.getContext?.('2d', { willReadFrequently: false });
        const stageUiCtx = stageUiCanvas?.getContext?.('2d', { willReadFrequently: false });
        const cursorCtx = cursorCanvas?.getContext?.('2d', { willReadFrequently: false });
        if (!baseCtx || !selectionCtx || !overlayCtx || !uiCtx || !stageShadowCtx || !stagePatternCtx || !stageUiCtx || !cursorCtx) {
            utils.showToast?.('Canvas init failed');
            closePaintMode({ reason: 'canvas-failed' });
            return;
        }
        baseCtx.clearRect(0, 0, width, height);
        baseCtx.drawImage(img, 0, 0, width, height);
        selectionCtx.clearRect(0, 0, width, height);
        overlayCtx.clearRect(0, 0, width, height);
        uiCtx.clearRect(0, 0, width, height);

        const boardPaintPrefs = state.boardData?.settings?.paint && typeof state.boardData.settings.paint === 'object' ? state.boardData.settings.paint : {};
        const localPaintPrefs = readLocalPaintPrefs() || {};
        const paintPrefs = { ...boardPaintPrefs, ...localPaintPrefs };
        const mergePrefMap = (boardValue, localValue) => {
            const boardMap = boardValue && typeof boardValue === 'object' ? boardValue : null;
            const localMap = localValue && typeof localValue === 'object' ? localValue : null;
            if (!boardMap && !localMap) {
                return null;
            }
            return { ...(boardMap || {}), ...(localMap || {}) };
        };
        const prefSizes = mergePrefMap(boardPaintPrefs.sizes, localPaintPrefs.sizes);
        const prefSpacings = mergePrefMap(boardPaintPrefs.spacings, localPaintPrefs.spacings);
        const prefPressureByTool = mergePrefMap(boardPaintPrefs.pressureByTool, localPaintPrefs.pressureByTool);
        const prefOpacityCaps = mergePrefMap(boardPaintPrefs.opacityCaps, localPaintPrefs.opacityCaps);
        const prefStrokeModes = mergePrefMap(boardPaintPrefs.strokeModes, localPaintPrefs.strokeModes);
        const prefBlendModes = mergePrefMap(boardPaintPrefs.blendModes, localPaintPrefs.blendModes);
        const prefBorderSize = Number(paintPrefs.borderSize);
        const prefRecentColors = Array.isArray(paintPrefs.recentColors) ? paintPrefs.recentColors : null;
        const prefSymmetryAxisX = Number(paintPrefs.symmetryAxisX);
        const prefSymmetryAxisY = Number(paintPrefs.symmetryAxisY);
        const prefDisplayScaleMode = String(paintPrefs.displayScaleMode || '').trim().toLowerCase();

        if (prefRecentColors) {
            deps.recentColors.length = 0;
            for (const entry of prefRecentColors) {
                const normalized = normalizeHexColor(entry);
                if (!normalized) {
                    continue;
                }
                if (deps.recentColors.includes(normalized)) {
                    continue;
                }
                deps.recentColors.push(normalized);
                if (deps.recentColors.length >= RECENT_COLORS_MAX) {
                    break;
                }
            }
        }
        const defaultSizes = {
            [TOOL_AIR]: DEFAULT_BRUSH_SIZE,
            [TOOL_INK]: DEFAULT_BRUSH_SIZE,
            [TOOL_PAINT]: DEFAULT_BRUSH_SIZE,
            [TOOL_RECT]: DEFAULT_BRUSH_SIZE,
            [TOOL_BLUR]: DEFAULT_BRUSH_SIZE,
            [TOOL_STAMP]: DEFAULT_BRUSH_SIZE
        };
        const brushProfiles = normalizeBrushProfiles(paintPrefs.brushProfiles, {
            sizes: prefSizes,
            spacings: prefSpacings,
            pressureByTool: prefPressureByTool,
            opacityCaps: prefOpacityCaps,
            strokeModes: prefStrokeModes,
            blendModes: prefBlendModes,
            stampSettings: paintPrefs.stampSettings
        });
        const legacyBrushState = buildLegacyBrushStateFromProfiles(brushProfiles);
        const toolSizes = legacyBrushState.toolSizes;
        const toolSpacing = legacyBrushState.toolSpacing;
        const pressureByTool = legacyBrushState.pressureByTool;
        const opacityCapByTool = legacyBrushState.opacityCapByTool;
        const strokeModeByTool = legacyBrushState.strokeModeByTool;
        const blendModeByTool = legacyBrushState.blendModeByTool;
        const prefTool = typeof paintPrefs.tool === 'string' ? paintPrefs.tool : '';
        const initialTool = Object.prototype.hasOwnProperty.call(defaultSizes, prefTool) ? prefTool : TOOL_INK;
        const initialSize = toolSizes[initialTool] || DEFAULT_BRUSH_SIZE;
        const initialMode = strokeModeByTool[initialTool] || STROKE_MODE_FILL;
        const initialColor = normalizeHexColor(paintPrefs.color) || DEFAULT_COLOR;
        const initialBorderSize = Number.isFinite(prefBorderSize)
            ? clamp(Math.round(prefBorderSize), 1, 240)
            : clamp(Math.round(initialSize * DEFAULT_BORDER_SIZE_RATIO), 1, 240);
        const initialBlendMode = blendModeByTool[initialTool] || 'normal';
        const initialBlendIndex = Math.max(0, BRUSH_BLEND_MODES.indexOf(initialBlendMode));
        const initialEraserMode = false;
        if (!Number.isFinite(opacityCapByTool[initialTool]) || opacityCapByTool[initialTool] <= 0.01) {
            opacityCapByTool[initialTool] = 1;
        }

        paintWorkspaceState.placeholderLaunchTarget = null;
        deps.resetWorkspaceUiState();
        stopPaintAutosaveLoop('open-reset');
        const nextSession = {
            blockId,
            boardId: targetBoardId || state.currentBoardId,
            filePath: requestedFilePath,
            launchTarget,
            entryViewport,
            livePreviewEnabled: isPaintEditorWindow() && !requestedFilePath,
            livePreviewTimer: null,
            externalCommitSent: false,
            tool: initialTool,
            color: initialColor,
            size: initialSize,
            strokeMode: initialMode,
            pressureAffectsOpacity: resolvePressureDefaults(initialTool).opacity !== false,
            pressureAffectsSize: resolvePressureDefaults(initialTool).size !== false,
            pressureByTool,
            opacityCapByTool,
            brushProfiles,
            toolSizes,
            toolSpacing,
            borderSize: initialBorderSize,
            brushBlendMode: initialBlendMode,
            brushBlendIndex: initialBlendIndex,
            editMode: EDIT_MODE_PAINT,
            selection: null,
            selectionEdit: null,
            eraserMode: initialEraserMode,
            strokeModeByTool,
            blendModeByTool,
            select: { lassoing: false, points: [], op: 'replace', mode: 'lasso', anchorX: 0, anchorY: 0, awaitingContinuation: false, dragMoved: false, toolLocked: false },
            transform: null,
            width,
            height,
            baseCanvas,
            selectionCanvas,
            overlayCanvas,
            uiCanvas,
            stageUiCanvas,
            cursorCanvas,
            baseCtx,
            selectionCtx,
            overlayCtx,
            uiCtx,
            stageShadowCtx,
            stagePatternCtx,
            stageUiCtx,
            cursorCtx,
            stageShadowSource: null,
            blurCanvas: null,
            blurCtx: null,
            stageUi: null,
            lastClientX: Math.round(window.innerWidth / 2),
            lastClientY: Math.round(window.innerHeight / 2),
            lastStageX: 0,
            lastStageY: 0,
            pointerDown: false,
            pointerId: null,
            activePointerType: '',
            activeWasStylusLike: false,
            isDrawing: false,
            cursorAlpha: 1,
            sizeDrag: { active: false, mode: 'size', startX: 0, startY: 0, startSize: DEFAULT_BRUSH_SIZE, startSpacing: 1 },
            currentBounds: null,
            stroke: null,
            rect: null,
            layers: [
                {
                    id: 'layer-base',
                    name: LAYER_BASE_NAME,
                    isBase: true,
                    dynamic: false,
                    canvas: baseCanvas,
                    ctx: baseCtx
                }
            ],
            activeLayerIndex: 0,
            layerIdCounter: 1,
            undo: [],
            redo: [],
            view: { scale: 1, tx: 0, ty: 0 },
            pan: { active: false, startX: 0, startY: 0, baseTx: 0, baseTy: 0 },
            spaceDown: false,
            spaceKeyHeld: false,
            spaceTapCandidate: false,
            sDown: false,
            shiftDown: false,
            ctrlDown: false,
            ctrlSpaceHeld: false,
            zoomDrag: { active: false, startY: 0, startScale: 1, startTx: 0, startTy: 0, anchorX: 0, anchorY: 0 },
            helpHeld: false,
            crop: { active: false, rect: null, drag: null },
            colorPicker: null,
            hover: { x: 0, y: 0, stageX: 0, stageY: 0, inBounds: false },
            cursorAngle: 0,
            cursorTilt: 0,
            lastInput: null,
            lastPen: null,
            colorPickDrag: false,
            suppressContextMenuUntil: 0,
            ignoreMouseUntil: 0,
            ignoreHoverUntil: 0,
            ignoreHoverPointerType: '',
            ignoreHoverWasStylusLike: false,
            strokePointerType: '',
            strokeWasStylusLike: false,
            liveStrokeCommit: null,
            stampSettings: legacyBrushState.stampSettings,
            stampLive: null,
            blendHoldTimer: null,
            blendHoldTriggered: false,
            debug: { visible: false },
            canvasBorderVisible: paintPrefs.canvasBorderVisible !== false,
            mirrorX: paintPrefs.mirrorX === true,
            mirrorY: paintPrefs.mirrorY === true,
            patternMode: paintPrefs.patternMode === true,
            alphaLockEnabled: false,
            invisibleBackground: paintPrefs.invisibleBackground === true,
            isolateActiveLayer: false,
            displayScaleMode: prefDisplayScaleMode === 'pixelated' || prefDisplayScaleMode === 'smooth' ? prefDisplayScaleMode : 'auto',
            symmetryAxisX: Number.isFinite(prefSymmetryAxisX) ? clamp(prefSymmetryAxisX, 0, width) : (width / 2),
            symmetryAxisY: Number.isFinite(prefSymmetryAxisY) ? clamp(prefSymmetryAxisY, 0, height) : (height / 2),
            symmetryDrag: null,
            zoomHudHideTimer: null,
            lastZoomHudValue: '',
            autosave: createInitialPaintAutosaveState()
        };
        setSession(nextSession);
        startPaintTheme(baseCanvas, 'session-open');
        paintWorkspaceState.panelHidden = shouldDefaultPaintWorkspacePanelHidden();
        paintWorkspaceState.projectMenuHidden = true;

        const sessionAsset = launchTarget.assetId
            ? projectStore.getAsset(launchTarget.assetId)
            : projectStore.findAssetContextByFilePath(nextSession.filePath)?.asset;
        const sessionPaintState = sessionAsset?.paint && typeof sessionAsset.paint === 'object' ? sessionAsset.paint : null;
        paintWorkspaceState.noBoundaryClip = sessionPaintState ? sessionPaintState.noBoundaryClip !== false : true;
        paintWorkspaceState.quickAnimationPeek = sessionPaintState ? sessionPaintState.quickAnimationPeek === true : false;
        if (sessionAsset?.id) {
            projectStore.setLastOpenedTarget(sessionAsset.id, {
                ...launchTarget,
                filePath: nextSession.filePath
            });
        }
        let initialActiveLayerIndex = 0;
        if (launchTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME && sessionAsset?.id) {
            const animation = sessionAsset.animations?.[String(launchTarget.animationId || '').trim()] || null;
            const frame = Array.isArray(animation?.frames)
                ? animation.frames.find((entry) => String(entry?.id || '') === String(launchTarget.frameId || '').trim())
                : null;
            if (animation && frame) {
                const hydrated = await loadAnimationFrameIntoSession(sessionAsset, animation, frame, {
                    reason: 'session-open-animation-frame'
                });
                const paintState = sessionAsset.paint && typeof sessionAsset.paint === 'object' ? sessionAsset.paint : {};
                const selectedLayerId = String(paintState.selectedLayerId || '').trim();
                const selectedLayerIndex = Number.isFinite(Number(paintState.selectedLayerIndex))
                    ? Math.max(0, Math.round(Number(paintState.selectedLayerIndex)))
                    : 0;
                const shouldRestoreLayerSelection = hydrated
                    && String(paintState.selectedAnimationId || '').trim() === String(animation.id || '')
                    && String(paintState.selectedFrameId || '').trim() === String(frame.id || '');
                if (shouldRestoreLayerSelection) {
                    initialActiveLayerIndex = selectedLayerId
                        ? nextSession.layers.findIndex((entry) => String(entry?.id || '') === selectedLayerId)
                        : -1;
                    if (initialActiveLayerIndex < 0) {
                        initialActiveLayerIndex = selectedLayerIndex;
                    }
                }
                logPaintTrace('openPaintModeForBlock.animationFrameHydrated', {
                    assetId: sessionAsset.id,
                    animationId: animation.id,
                    frameId: frame.id,
                    hydrated,
                    layerCount: Array.isArray(nextSession.layers) ? nextSession.layers.length : 0,
                    restoredLayerId: shouldRestoreLayerSelection ? selectedLayerId : '',
                    restoredLayerIndex: shouldRestoreLayerSelection ? initialActiveLayerIndex : -1
                });
            } else {
                logPaintTrace('openPaintModeForBlock.animationFrameHydrateSkipped', {
                    assetId: sessionAsset.id,
                    animationId: String(launchTarget.animationId || ''),
                    frameId: String(launchTarget.frameId || ''),
                    hasAnimation: !!animation,
                    hasFrame: !!frame
                });
            }
        }

        setActiveLayerRefs(initialActiveLayerIndex, { skipUi: true });
        applyPressureForTool(initialTool);
        applyToolSettingsForTool(initialTool);
        applyOverlayBlendMode();
        updateStageCursor();
        renderRecentColorSwatches();
        renderRelatedColorSwatches();
        renderBlendMenu();
        ensureBrushMaskLoaded().catch(() => {});
        initializeStampSupport(paintPrefs);
        setDebugVisible(false);
        ensureStageUiSized();
        setCursorBlendMode('difference');
        setDefaultZoom();
        paintWorkspaceState.collapsedTimelineVisible = false;
        paintWorkspaceState.expandedTimelineVisible = false;
        paintWorkspaceState.drawerOpen = false;
        paintWorkspaceState.timelineExpanded = false;
        updateHud();
        renderLayerBar();
        renderStageUi();
        renderPaintWorkspaceUi();
        renderCursorCanvas();
        capturePaintHistorySnapshot('session-open', {
            markEntry: true,
            render: false
        });
        queueStageShadowRefresh();
        schedulePaintViewPostOpen();
        scheduleLivePreviewSync('open', { immediate: true });
        startPaintAutosaveLoop('session-open');
        console.info('Paint mode opened', { blockId, width, height });
    }

    async function createBlank1920x1080AndPaint() {
        if (!state.boardData || !state.currentBoardId || !env.blocks?.image?.persistImageBuffer || !env.blocks?.image?.createImageBlock) {
            return;
        }
        const clipboard = env.electron?.clipboard;
        if (clipboard && typeof clipboard.readImage === 'function') {
            const clipboardImage = clipboard.readImage();
            if (clipboardImage && !clipboardImage.isEmpty()) {
                const size = typeof clipboardImage.getSize === 'function' ? clipboardImage.getSize() : null;
                const rawWidth = size?.width || 0;
                const rawHeight = size?.height || 0;
                if (rawWidth > 0 && rawHeight > 0) {
                    let width = rawWidth;
                    let height = rawHeight;
                    const maxSide = Math.max(width, height);
                    if (maxSide > MAX_CANVAS_DIMENSION) {
                        const ratio = MAX_CANVAS_DIMENSION / maxSide;
                        width = Math.max(1, Math.round(width * ratio));
                        height = Math.max(1, Math.round(height * ratio));
                    }
                    const resized = clipboardImage.resize({ width, height, quality: 'best' });
                    const finalImage = resized && !resized.isEmpty() ? resized : clipboardImage;
                    const buffer = finalImage.toPNG();
                    const assetName = await env.blocks.image.persistImageBuffer(buffer, 'png');
                    const block = env.blocks.image.createImageBlock({
                        assetName,
                        width,
                        height,
                        position: state.lastPointerBoardPos
                    });
                    if (block) {
                        await openPaintModeForBlock(block.id);
                    }
                    return;
                }
            }
        }

        const width = 1920;
        const height = 1080;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            return;
        }
        const buffer = await deps.exportCanvasToPngBuffer(canvas);
        if (!buffer) {
            return;
        }
        const assetName = await env.blocks.image.persistImageBuffer(buffer, 'png');
        const block = env.blocks.image.createImageBlock({
            assetName,
            width,
            height,
            position: state.lastPointerBoardPos
        });
        if (!block) {
            return;
        }
        await openPaintModeForBlock(block.id);
    }

    async function openPaintWorkspace() {
        logPaintTrace('openPaintWorkspace.begin', {
            isPaintEditorWindow: isPaintEditorWindow(),
            selectedAssetId: projectStore.getSelectedAsset()?.id || '',
            selectedAssetName: projectStore.getSelectedAsset()?.name || ''
        });
        if (!isPaintEditorWindow()) {
            const selectedAsset = projectStore.getSelectedAsset() || projectStore.listAssets()[0] || null;
            const response = await openPaintWindowForWorkspace({ assetId: selectedAsset?.id || '' });
            handlePaintWindowOpenResponse(response);
            logPaintTrace('openPaintWorkspace.externalResponse', {
                selectedAssetId: selectedAsset?.id || '',
                response
            });
            return response;
        }
        const selectedAsset = projectStore.getSelectedAsset() || projectStore.listAssets()[0] || null;
        if (selectedAsset) {
            const target = projectStore.resolveLastOpenedTarget(selectedAsset.id);
            if (target.filePath) {
                return openPaintModeForBlock('', {
                    inline: true,
                    boardId: target.boardId || getSession()?.boardId || state.currentBoardId,
                    filePath: target.filePath,
                    paintLaunchTarget: target
                });
            }
        }
        showEmptyPaintWorkspace({
            mode: launchTargets.PAINT_LAUNCH_MODES.WORKSPACE,
            source: 'workspace-open'
        });
        return { success: true, workspace: true };
    }

    async function openPaintModeFromWindowContext() {
        const target = launchTargets.normalizePaintLaunchTarget(env.windowContext?.paintLaunchTarget || {});
        logPaintTrace('openPaintModeFromWindowContext.begin', {
            target,
            windowContext: env.windowContext || null
        });
        if (!target.blockId && !target.filePath && target.mode !== launchTargets.PAINT_LAUNCH_MODES.WORKSPACE && !target.assetId) {
            console.error('Paint editor launch skipped: missing target in window context', env.windowContext || null);
            logPaintTrace('openPaintModeFromWindowContext.missingTarget', {
                target,
                windowContext: env.windowContext || null
            });
            return;
        }
        if (target.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE && !target.filePath) {
            showEmptyPaintWorkspace(target);
            return;
        }
        await openPaintModeForBlock(target.blockId, {
            inline: true,
            boardId: target.boardId || env.windowContext?.boardId || state.currentBoardId,
            filePath: target.filePath,
            paintLaunchTarget: target
        });
    }

    async function saveAndExit() {
        const session = getSession();
        if (!session) {
            return;
        }
        clearScheduledLivePreview();
        const block = resolveBoardImageBlock(session.blockId);
        let result = null;
        try {
            result = await saveCurrentPaintSession('save-exit', {
                recordHistory: true,
                notifyCommit: true,
                assetReason: 'asset2d-paint-save',
                boardReason: 'paint-save'
            });
        } catch (error) {
            utils.showToast?.('Paint save failed');
            throw error;
        }
        if (!result?.saved && !session.filePath && !block && !isPaintEditorWindow()) {
            closePaintMode({ reason: 'save-missing-block' });
            return;
        }
        if (!result?.saved) {
            utils.showToast?.('Paint save failed');
            return;
        }
        session.externalCommitSent = isPaintEditorWindow();
        closePaintMode({ reason: 'save', skipViewportRestore: true });
    }

    function closePaintMode(options = {}) {
        const session = getSession();
        if (!session) {
            state.paintModeActive = false;
            state.paintModeHotkeyBlockUntil = Date.now() + PAINT_EXIT_HOTKEY_BLOCK_MS;
            stopPaintTheme();
            resetWorkspaceUiState();
            clearPaintJobHudTimer();
            paintWorkspaceState.jobStatus = 'idle';
            paintWorkspaceState.jobMessage = '';
            paintWorkspaceState.jobDetailMessage = '';
            paintWorkspaceState.jobProgress = 0;
            paintWorkspaceState.panelMode = 'asset';
            paintWorkspaceState.panelHidden = true;
            paintWorkspaceState.unityPanelHidden = true;
            paintWorkspaceState.activePlaybackRangeId = '';
            destroyDynamicPaintLayerCanvases();
            if (dom.paintLayerBar) {
                dom.paintLayerBar.hidden = true;
            }
            if (dom.paintLayerList) {
                dom.paintLayerList.innerHTML = '';
            }
            if (dom.paintTimelinePanel) {
                dom.paintTimelinePanel.hidden = true;
            }
            if (dom.paintTimelinePanelList) {
                dom.paintTimelinePanelList.innerHTML = '';
            }
            if (dom.paintOverlay) {
                dom.paintOverlay.hidden = true;
            }
            if (paintWorkspaceUi.panelEl) {
                paintWorkspaceUi.panelEl.hidden = true;
            }
            if (paintWorkspaceUi.unityPanelEl) {
                paintWorkspaceUi.unityPanelEl.hidden = true;
            }
            if (paintWorkspaceUi.drawerEl) {
                paintWorkspaceUi.drawerEl.hidden = true;
            }
            if (paintWorkspaceUi.emptyStateEl) {
                paintWorkspaceUi.emptyStateEl.hidden = true;
            }
            if (dom.paintJobHud) {
                dom.paintJobHud.hidden = true;
            }
            return;
        }
        const reason = options.reason || 'close';
        const entryViewport = cloneViewportSnapshot(session.entryViewport);
        clearScheduledLivePreview();
        stopPaintAutosaveLoop(`close-${reason}`);
        if (isPaintEditorWindow() && reason !== 'save' && !session.externalCommitSent) {
            notifyPreviewCleared();
        }
        try {
            clearStageShadowCanvas();
            clearStagePatternCanvas();
            clearOverlayCanvas();
            clearUiCanvas();
        } catch {}
        hideColorPopover();
        hidePaintContextMenu();
        setExitMenuVisible(false);
        try {
            persistPaintPreferences();
        } catch {}
        if (dom.paintStampPanel) {
            dom.paintStampPanel.hidden = true;
            dom.paintStampPanel.classList.remove('is-open');
        }
        if (dom.paintStampInline) {
            dom.paintStampInline.hidden = true;
        }
        destroyDynamicPaintLayerCanvases();
        if (dom.paintLayerBar) {
            dom.paintLayerBar.hidden = true;
        }
        if (dom.paintLayerList) {
            dom.paintLayerList.innerHTML = '';
        }
        if (dom.paintTimelinePanel) {
            dom.paintTimelinePanel.hidden = true;
        }
        if (dom.paintTimelinePanelList) {
            dom.paintTimelinePanelList.innerHTML = '';
        }
        clearPaintJobHudTimer();
        stopPaintTheme();
        dom.paintOverlay.hidden = true;
        if (paintWorkspaceUi.panelEl) {
            paintWorkspaceUi.panelEl.hidden = true;
        }
        if (paintWorkspaceUi.unityPanelEl) {
            paintWorkspaceUi.unityPanelEl.hidden = true;
        }
        if (paintWorkspaceUi.drawerEl) {
            paintWorkspaceUi.drawerEl.hidden = true;
        }
        if (paintWorkspaceUi.emptyStateEl) {
            paintWorkspaceUi.emptyStateEl.hidden = true;
        }
        if (paintWorkspaceUi.createModalEl) {
            paintWorkspaceUi.createModalEl.hidden = true;
            paintWorkspaceUi.createModalEl.innerHTML = '';
        }
        if (dom.paintJobHud) {
            dom.paintJobHud.hidden = true;
        }
        paintWorkspaceState.showNewMenu = false;
        paintWorkspaceState.previewVariantId = '';
        paintWorkspaceState.jobStatus = 'idle';
        paintWorkspaceState.jobMessage = '';
        paintWorkspaceState.jobDetailMessage = '';
        paintWorkspaceState.jobProgress = 0;
        paintWorkspaceState.panelMode = 'asset';
        paintWorkspaceState.panelHidden = true;
        paintWorkspaceState.unityPanelHidden = true;
        paintWorkspaceState.playing = false;
        paintWorkspaceState.activePlaybackRangeId = '';
        resetWorkspaceUiState();
        clearPaintWorkspacePlaybackTimer();
        setHelpVisible(false);
        state.paintModeActive = false;
        state.paintModeHotkeyBlockUntil = Date.now() + PAINT_EXIT_HOTKEY_BLOCK_MS;
        const selection = window.getSelection?.();
        if (selection) {
            selection.removeAllRanges();
        }
        const active = document.activeElement;
        if (active && active !== document.body) {
            active.blur?.();
        }
        if (!options.skipViewportRestore) {
            restoreBoardViewportAfterPaint(entryViewport);
        }
        setSession(null);
        console.info('Paint mode closed', { reason });
        if (isPaintEditorWindow()) {
            window.setTimeout(() => {
                window.close();
            }, 0);
        }
    }

    return {
        handlePaintWindowOpenResponse,
        openPaintWindowForTarget,
        openPaintWindowForBlock,
        openPaintWindowForFile,
        openPaintWindowForWorkspace,
        resolveRequestedPaintFilePath,
        buildDirectPaintLaunchTarget,
        schedulePaintViewPostOpen: schedulePaintViewPostOpenImpl,
        openPaintModeForBlock,
        createBlank1920x1080AndPaint,
        openPaintWorkspace,
        openPaintModeFromWindowContext,
        saveAndExit,
        closePaintMode
    };
};
