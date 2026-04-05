'use strict';

// MARK: MODULE
module.exports = function createPaintEventsModule(deps) {
    const {
        dom,
        env,
        projectStore,
        paintWorkspaceState,
        TOOL_LABELS,
        TOOL_STAMP,
        TOOL_INK,
        DEFAULT_BRUSH_SIZE,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        TOOL_SPACING_MIN,
        TOOL_SPACING_MAX,
        STROKE_MODE_BORDER,
        STROKE_MODE_FILL,
        getSession,
        clamp,
        logPaintTrace,
        touchPaintSessionActivity,
        isExitMenuOpen,
        setExitMenuVisible,
        isCanvasMenuOpen,
        setCanvasMenuVisible,
        isBlendMenuOpen,
        setBlendMenuVisible,
        isToolMenuOpen,
        setToolMenuVisible,
        isColorPopoverOpen,
        hideColorPopover,
        handleColorSvPointerDown,
        handleColorSvPointerMove,
        handleColorHuePointerDown,
        handleColorHuePointerMove,
        handleColorPickerPointerUp,
        handleColorHexInput,
        handleColorSwatchClick,
        setHelpVisible,
        setConfirmVisible,
        closePaintMode,
        requestCancelPaint,
        keepChangesAction,
        negateChangesAndExit,
        toggleIsolateActiveLayer,
        persistPaintPreferences,
        updateHud,
        renderStageUi,
        queueStagePatternRefresh,
        wrapPaintUiAction,
        renderToolMenu,
        renderBlendMenu,
        setActiveTool,
        showColorPopoverAt,
        setBrushBlendMode,
        promptForPaintText,
        updateToolSizeFromSession,
        syncBorderSizeToBrush,
        renderCursorCanvas,
        resolveToolSpacingFactor,
        beginTimelineLayerDrag,
        updateTimelineLayerDrag,
        endTimelineLayerDrag,
        toggleExpandedTimelineDrawer,
        closeTimelineContextMenu,
        loadAnimationFrameIntoSession,
        openTimelineContextMenu,
        refreshLayerSelectionUi,
        moveActiveLayerDown,
        insertBlankLayerRelative,
        duplicateActiveLayerRelative,
        setActiveLayerByIndex,
        renameLayerAtIndex,
        updateLayerThumbnailTone,
        togglePinnedLayer,
        createPaintLayer,
        duplicateActiveLayer,
        deleteActiveLayer,
        mergeActiveLayerDown,
        mergeAllLayers,
        switchPaintFile,
        resolveWorkspaceAsset,
        resolveSessionAnimationContext,
        resolveFramePath,
        frameListForPaint,
        syncAnimationFlags,
        insertAnimationFrameRelative,
        deleteTimelineFrame,
        clampFrameHoldValue,
        ensureOpacityCapsInitialized,
        isAdjustPanelOpen,
        openAdjustPanel,
        closeAdjustPanel,
        collectAdjustSettingsFromDom,
        getAdjustSettingsSignature,
        syncAdjustPanelValueLabels,
        beginAdjustRender,
        scheduleAdjustHighQuality,
        isAdjustGradientMenuOpen,
        setAdjustGradientMenuVisible,
        syncAdjustGradientPicker,
        defaultAdjustSettings,
        cancelAdjustJob,
        syncAdjustPanelControls,
        isStampPanelOpen,
        isStampEditorVisible,
        setStampPanelVisible,
        setStampEditorVisible,
        updateStageCursor,
        collectBrushPanelStateFromDom,
        collectStampSettingsFromDom,
        refreshBrushPanel,
        syncStampPanelValueLabels,
        syncStampPanelControls,
        loadStampEntryIntoEditor,
        writeStampLibrary,
        renderStampLibrary,
        toggleStampFavorite,
        snapshotStampEditorStrokeSource,
        stampEditorDrawDot,
        stampEditorDrawLine,
        handlePaintContextMenu,
        handlePaintWheel,
        handlePaintPointerDown,
        handlePaintPointerMove,
        handlePaintPointerUp,
        handleStagePointerDown,
        handleStagePointerMove,
        handleStagePointerUp,
        handlePaintKeyDown,
        handlePaintKeyUp,
        resetPaintModifierState,
        ensureStageUiSized,
        fitToScreen,
        notifyPreviewCleared,
        isPaintEditorWindow,
        renderPaintWorkspaceUi,
        queuePaintUiFocusRelease,
        refreshPaintStageView,
        updatePaintTopDockLayout
    } = deps;

    let handlersAttached = false;
    let paintAdjustGradientOutsideListenerAttached = false;
    let paintWorkspaceProgressListenerAttached = false;
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

    function persistProjectPaintMenuState(reason = 'asset2d-paint-menu-state') {
        const asset = resolveWorkspaceAsset();
        if (!asset?.id) {
            return false;
        }
        projectStore.updateAsset(asset.id, (draft) => {
            draft.paint = draft.paint && typeof draft.paint === 'object' ? draft.paint : {};
            draft.paint.noBoundaryClip = paintWorkspaceState.noBoundaryClip !== false;
            draft.paint.quickAnimationPeek = paintWorkspaceState.quickAnimationPeek === true;
            return draft;
        }, reason);
        return true;
    }

function attachPaintEventHandlers() {
    dom.paintUiCanvas.addEventListener('pointerdown', handlePaintPointerDown, { passive: false });
    dom.paintUiCanvas.addEventListener('pointermove', handlePaintPointerMove, { passive: false });
    dom.paintUiCanvas.addEventListener('pointerrawupdate', handlePaintPointerMove, { passive: false });
    dom.paintUiCanvas.addEventListener('pointerup', handlePaintPointerUp, { passive: false });
    dom.paintUiCanvas.addEventListener('pointercancel', handlePaintPointerUp, { passive: false });
    dom.paintUiCanvas.addEventListener('contextmenu', handlePaintContextMenu, { passive: false });
    dom.paintStage.addEventListener('wheel', handlePaintWheel, { passive: false });
    dom.paintStage.addEventListener('pointerdown', handleStagePointerDown, { passive: false });
    dom.paintStage.addEventListener('pointermove', handleStagePointerMove, { passive: false });
    dom.paintStage.addEventListener('pointerrawupdate', handleStagePointerMove, { passive: false });
    dom.paintStage.addEventListener('pointerup', handleStagePointerUp, { passive: false });
    dom.paintStage.addEventListener('pointercancel', handleStagePointerUp, { passive: false });
    dom.paintStage.addEventListener('contextmenu', handlePaintContextMenu, { passive: false });
    if (dom.paintOverlay) {
        dom.paintOverlay.addEventListener('pointerdown', () => {
            touchPaintSessionActivity('overlay-pointerdown');
        }, { passive: true, capture: true });
        dom.paintOverlay.addEventListener('input', () => {
            touchPaintSessionActivity('overlay-input');
        }, { passive: true, capture: true });
        dom.paintOverlay.addEventListener('change', () => {
            touchPaintSessionActivity('overlay-change');
        }, { passive: true, capture: true });
        dom.paintOverlay.addEventListener('wheel', () => {
            touchPaintSessionActivity('overlay-wheel');
        }, { passive: true, capture: true });
        dom.paintOverlay.addEventListener('pointerdown', (event) => {
            if (isExitMenuOpen()) {
                const menu = dom.paintExitMenu;
                const openBtn = dom.paintExitOpen;
                if (!(menu && menu.contains(event.target)) && !(openBtn && openBtn.contains(event.target))) {
                    setExitMenuVisible(false);
                }
            }
            if (isCanvasMenuOpen()) {
                const menu = dom.paintCanvasMenu;
                const openBtn = dom.paintCanvasMenuToggle;
                if (!(menu && menu.contains(event.target)) && !(openBtn && openBtn.contains(event.target))) {
                    setCanvasMenuVisible(false);
                }
            }
            if (isBlendMenuOpen()) {
                const menu = dom.paintBlendMenu;
                const openBtn = dom.paintHudBlend;
                if (!(menu && menu.contains(event.target)) && !(openBtn && openBtn.contains(event.target))) {
                    setBlendMenuVisible(false);
                }
            }
            if (isToolMenuOpen()) {
                const menu = dom.paintToolMenu;
                const openBtn = dom.paintHudTool;
                if (!(menu && menu.contains(event.target)) && !(openBtn && openBtn.contains(event.target))) {
                    setToolMenuVisible(false);
                }
            }
            if (isStampPanelOpen()) {
                const panel = dom.paintStampPanel;
                const openBtn = dom.paintHudTool;
                if (!(panel && panel.contains(event.target)) && !(openBtn && openBtn.contains(event.target))) {
                    setStampPanelVisible(false);
                }
            }
            if (!isColorPopoverOpen()) {
                return;
            }
            const popover = dom.paintColorPopover;
            if (popover && popover.contains(event.target)) {
                return;
            }
            hideColorPopover();
        }, { passive: true, capture: true });
    }
    if (dom.paintColorSvCanvas) {
        dom.paintColorSvCanvas.addEventListener('pointerdown', handleColorSvPointerDown, { passive: false });
        dom.paintColorSvCanvas.addEventListener('pointermove', handleColorSvPointerMove, { passive: false });
        dom.paintColorSvCanvas.addEventListener('pointerup', handleColorPickerPointerUp, { passive: false });
        dom.paintColorSvCanvas.addEventListener('pointercancel', handleColorPickerPointerUp, { passive: false });
    }
    if (dom.paintColorHueCanvas) {
        dom.paintColorHueCanvas.addEventListener('pointerdown', handleColorHuePointerDown, { passive: false });
        dom.paintColorHueCanvas.addEventListener('pointermove', handleColorHuePointerMove, { passive: false });
        dom.paintColorHueCanvas.addEventListener('pointerup', handleColorPickerPointerUp, { passive: false });
        dom.paintColorHueCanvas.addEventListener('pointercancel', handleColorPickerPointerUp, { passive: false });
    }
    if (dom.paintColorHexInput) {
        dom.paintColorHexInput.addEventListener('input', handleColorHexInput, { passive: true });
    }
    if (dom.paintColorSwatches) {
        dom.paintColorSwatches.addEventListener('click', handleColorSwatchClick, { passive: false });
    }
    if (dom.paintColorNeutrals) {
        dom.paintColorNeutrals.addEventListener('click', handleColorSwatchClick, { passive: false });
    }
    if (dom.paintColorRelated) {
        dom.paintColorRelated.addEventListener('click', handleColorSwatchClick, { passive: false });
    }
    if (dom.paintHelpOverlay) {
        dom.paintHelpOverlay.addEventListener('click', (event) => {
            if (event.target === dom.paintHelpOverlay) {
                setHelpVisible(false);
            }
        }, { passive: true });
    }
    if (dom.paintConfirmCancel) {
        dom.paintConfirmCancel.addEventListener('click', () => {
            setConfirmVisible(false);
        }, { passive: true });
    }
    if (dom.paintConfirmDiscard) {
        dom.paintConfirmDiscard.addEventListener('click', () => {
            setConfirmVisible(false);
            closePaintMode({ reason: 'cancel' });
        }, { passive: true });
    }
    if (dom.paintExitKeep) {
        dom.paintExitKeep.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setExitMenuVisible(false);
            keepChangesAction();
        }, { passive: false });
    }
    if (dom.paintExitOpen) {
        dom.paintExitOpen.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setExitMenuVisible(!isExitMenuOpen());
        }, { passive: false });
    }
    if (dom.paintExitCancel) {
        dom.paintExitCancel.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setExitMenuVisible(false);
        }, { passive: false });
    }
    if (dom.paintExitNegate) {
        dom.paintExitNegate.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setExitMenuVisible(false);
            negateChangesAndExit();
        }, { passive: false });
    }
    if (dom.paintJobHudCancel) {
        dom.paintJobHudCancel.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            requestCancelPaint();
        }, { passive: false });
    }
    if (dom.paintHelpToggle) {
        dom.paintHelpToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setCanvasMenuVisible(false);
            setBlendMenuVisible(false);
            setHelpVisible(dom.paintHelpOverlay?.hidden === true);
        }, { passive: false });
    }
    if (dom.paintMirrorXToggle) {
        dom.paintMirrorXToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.mirrorX = !session.mirrorX;
            persistPaintPreferences();
            updateHud();
            renderStageUi();
        }, { passive: false });
    }
    if (dom.paintMirrorYToggle) {
        dom.paintMirrorYToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.mirrorY = !session.mirrorY;
            persistPaintPreferences();
            updateHud();
            renderStageUi();
        }, { passive: false });
    }
    if (dom.paintPatternToggle) {
        dom.paintPatternToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.patternMode = !session.patternMode;
            persistPaintPreferences();
            updateHud();
            queueStagePatternRefresh();
        }, { passive: false });
    }
    if (dom.paintAlphaLockToggle) {
        dom.paintAlphaLockToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.alphaLockEnabled = !session.alphaLockEnabled;
            persistPaintPreferences();
            updateHud();
        }, { passive: false });
    }
    if (dom.paintInvisibleBgToggle) {
        dom.paintInvisibleBgToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.invisibleBackground = !session.invisibleBackground;
            persistPaintPreferences();
            updateHud();
        }, { passive: false });
    }
    if (dom.paintIsolateToggle) {
        dom.paintIsolateToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleIsolateActiveLayer();
        }, { passive: false });
    }
    if (dom.paintDisplayScaleModeToggle) {
        dom.paintDisplayScaleModeToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            const currentMode = session.displayScaleMode === 'pixelated' || session.displayScaleMode === 'smooth'
                ? session.displayScaleMode
                : 'auto';
            session.displayScaleMode = currentMode === 'auto'
                ? 'pixelated'
                : (currentMode === 'pixelated' ? 'smooth' : 'auto');
            persistPaintPreferences();
            updateHud();
        }, { passive: false });
    }
    if (dom.paintCanvasMenuToggle) {
        dom.paintCanvasMenuToggle.addEventListener('click', wrapPaintUiAction('paintCanvasMenuToggle.click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('paintCanvasMenuToggle.click', {
                menuOpen: isCanvasMenuOpen()
            });
            setHelpVisible(false);
            setBlendMenuVisible(false);
            setToolMenuVisible(false);
            setCanvasMenuVisible(!isCanvasMenuOpen());
        }), { passive: false });
    }
    if (dom.paintHudTool) {
        dom.paintHudTool.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setHelpVisible(false);
            setCanvasMenuVisible(false);
            setBlendMenuVisible(false);
            setToolMenuVisible(false);
            setStampPanelVisible(!isStampPanelOpen());
        }, { passive: false });
    }
    if (dom.paintNoBoundaryClipToggle) {
        dom.paintNoBoundaryClipToggle.addEventListener('click', wrapPaintUiAction('paintNoBoundaryClipToggle.click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('paintNoBoundaryClipToggle.click', {
                previous: paintWorkspaceState.noBoundaryClip !== false
            });
            paintWorkspaceState.noBoundaryClip = paintWorkspaceState.noBoundaryClip === false;
            persistProjectPaintMenuState('asset2d-paint-no-boundary-clip');
            updateHud();
            renderStageUi();
            setCanvasMenuVisible(false);
        }), { passive: false });
    }
    if (dom.paintQuickAnimationPeekToggle) {
        dom.paintQuickAnimationPeekToggle.addEventListener('click', wrapPaintUiAction('paintQuickAnimationPeekToggle.click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('paintQuickAnimationPeekToggle.click', {
                previous: paintWorkspaceState.quickAnimationPeek === true
            });
            paintWorkspaceState.quickAnimationPeek = paintWorkspaceState.quickAnimationPeek !== true;
            persistProjectPaintMenuState('asset2d-paint-quick-animation-peek');
            updateHud();
            setCanvasMenuVisible(false);
        }), { passive: false });
    }
    if (dom.paintCanvasEdgeToggle) {
        dom.paintCanvasEdgeToggle.addEventListener('click', wrapPaintUiAction('paintCanvasEdgeToggle.click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            logPaintTrace('paintCanvasEdgeToggle.click', {
                previous: session.canvasBorderVisible !== false
            });
            session.canvasBorderVisible = session.canvasBorderVisible === false;
            persistPaintPreferences();
            updateHud();
            renderStageUi();
            setCanvasMenuVisible(false);
        }), { passive: false });
    }
    if (dom.paintCanvasFitView) {
        dom.paintCanvasFitView.addEventListener('click', wrapPaintUiAction('paintCanvasFitView.click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('paintCanvasFitView.click', {
                scale: session?.view?.scale || 0
            });
            fitToScreen();
            setCanvasMenuVisible(false);
        }), { passive: false });
    }
    if (dom.paintHudBlend) {
        dom.paintHudBlend.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setCanvasMenuVisible(false);
            setToolMenuVisible(false);
            renderBlendMenu();
            setBlendMenuVisible(!isBlendMenuOpen());
        }, { passive: false });
    }
    if (dom.paintToolMenu) {
        dom.paintToolMenu.addEventListener('click', (event) => {
            const button = event.target?.closest?.('[data-tool]');
            if (!button || !session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const tool = String(button.dataset.tool || '');
            logPaintTrace('paintToolMenu.select', {
                tool,
                previousTool: session.tool,
                eraserMode: !!session.eraserMode
            });
            if (tool && Object.prototype.hasOwnProperty.call(TOOL_LABELS, tool)) {
                setActiveTool(tool);
                persistPaintPreferences();
            }
            setToolMenuVisible(false);
        }, { passive: false });
    }
    if (dom.paintHudColor) {
        dom.paintHudColor.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const x = Number.isFinite(event.clientX) ? event.clientX : session?.lastClientX || 0;
            const y = Number.isFinite(event.clientY) ? event.clientY : session?.lastClientY || 0;
            showColorPopoverAt(x, y);
        }, { passive: false });
    }
    if (dom.paintBlendMenu) {
        dom.paintBlendMenu.addEventListener('click', (event) => {
            const button = event.target?.closest?.('[data-blend-mode]');
            if (!button || !session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            setBrushBlendMode(String(button.dataset.blendMode || 'normal'));
            persistPaintPreferences();
            setBlendMenuVisible(false);
        }, { passive: false });
    }
    if (dom.paintHudSize) {
        dom.paintHudSize.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            promptForPaintText({
                title: 'Brush size',
                placeholder: 'Enter brush size in pixels',
                initialValue: String(Math.round(session?.size || DEFAULT_BRUSH_SIZE)),
                confirmLabel: 'Apply'
            }).then((value) => {
                if (value == null || !session) {
                    return;
                }
                const next = clamp(Math.round(Number(value) || session.size), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
                session.size = next;
                updateToolSizeFromSession();
                syncBorderSizeToBrush();
                updateHud();
                persistPaintPreferences();
                renderCursorCanvas();
            }).catch((error) => console.error('Brush size edit failed', error));
        }, { passive: false });
    }
    if (dom.paintHudSpacing) {
        dom.paintHudSpacing.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const currentPercent = resolveToolSpacingFactor(session?.tool) * 100;
            promptForPaintText({
                title: 'Brush spacing',
                placeholder: 'Enter spacing percentage',
                initialValue: String(Math.round(currentPercent * 100) / 100),
                confirmLabel: 'Apply'
            }).then((value) => {
                if (value == null || !session) {
                    return;
                }
                const factor = clamp((Number(value) || currentPercent) / 100, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
                session.toolSpacing[session.tool] = factor;
                updateHud();
                persistPaintPreferences();
                renderCursorCanvas();
            }).catch((error) => console.error('Brush spacing edit failed', error));
        }, { passive: false });
    }
    if (dom.paintHudMode) {
        dom.paintHudMode.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            if (session.tool === TOOL_STAMP || session.tool === TOOL_BLUR) {
                return;
            }
            setStampPanelVisible(true);
        }, { passive: false });
    }
    [
        { listEl: dom.paintLayerList || null, host: 'collapsed' },
        { listEl: dom.paintTimelinePanelList || null, host: 'expanded' }
    ].forEach(({ listEl, host }) => {
        if (!listEl) {
            return;
        }
        listEl.addEventListener('pointerdown', (event) => {
            const visibilityButton = event.target?.closest?.('[data-action="timeline-layer-visibility"]');
            if (!visibilityButton || !session) {
                return;
            }
            const layerIndex = Number(visibilityButton.dataset.layerIndex);
            if (!Number.isFinite(layerIndex)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (visibilityButton.setPointerCapture) {
                try {
                    visibilityButton.setPointerCapture(event.pointerId);
                } catch {}
            }
            beginTimelineLayerDrag(layerIndex, event.pointerId, event.clientY, visibilityButton);
        }, { passive: false });
        listEl.addEventListener('click', async (event) => {
            const actionTarget = event.target?.closest?.('[data-action]');
            if (!actionTarget || !session) {
                closeTimelineContextMenu();
                return;
            }
            const action = String(actionTarget.dataset.action || '');
            const layerIndex = Number(actionTarget.dataset.layerIndex);
            const frameId = String(actionTarget.dataset.frameId || '');
            logPaintTrace('timeline.click', {
                action,
                layerIndex,
                frameId,
                host,
                currentFrameId: resolveSessionAnimationContext(resolveWorkspaceAsset()).frame?.id || '',
                activeLayerIndex: session?.activeLayerIndex,
                timelineExpanded: paintWorkspaceState.timelineExpanded === true
            });
            if (action === 'timeline-layer-visibility') {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (action === 'timeline-cell-open' || action === 'timeline-frame-open') {
                event.preventDefault();
                event.stopPropagation();
                closeTimelineContextMenu();
                const asset = resolveWorkspaceAsset();
                const context = resolveSessionAnimationContext(asset);
                const animation = context.animation;
                const currentFrameId = context.frame?.id || '';
                const targetFrame = frameId && animation ? frameListForPaint(animation).find((entry) => entry.id === frameId) : null;
                const targetFramePath = targetFrame ? resolveFramePath(targetFrame) : '';
                const targetLayerIndex = Number.isFinite(layerIndex)
                    ? clamp(Math.round(layerIndex), 0, Math.max(0, (session?.layers?.length || 1) - 1))
                    : -1;
                const needsFrameLoad = !!(targetFrame && targetFramePath && targetFrame.id !== currentFrameId);
                logPaintTrace('timeline.click.resolve', {
                    action,
                    requestedFrameId: frameId,
                    requestedLayerIndex: layerIndex,
                    currentFrameId,
                    targetFrameId: targetFrame?.id || '',
                    targetFrameIndex: Number.isFinite(Number(targetFrame?.index)) ? Number(targetFrame.index) : -1,
                    targetFramePath,
                    targetLayerIndex,
                    needsFrameLoad,
                    timelineExpanded: paintWorkspaceState.timelineExpanded === true
                });
                const layerChanged = Number.isFinite(layerIndex)
                    ? setActiveLayerByIndex(targetLayerIndex, {
                        skipUi: true,
                        reason: needsFrameLoad ? 'timeline-click-preload' : 'timeline-click'
                    })
                    : false;
                logPaintTrace('timeline.click.layerSelection', {
                    requestedLayerIndex: layerIndex,
                    targetLayerIndex,
                    layerChanged,
                    currentActiveLayerIndex: session?.activeLayerIndex ?? -1,
                    needsFrameLoad
                });
                if (targetFrame && targetFramePath) {
                    logPaintTrace('timeline.click.frameTarget', {
                        requestedFrameId: frameId,
                        requestedLayerIndex: layerIndex,
                        targetFrameId: targetFrame.id,
                        targetFrameIndex: targetFrame.index,
                        targetFramePath,
                        needsFrameLoad
                    });
                    if (!needsFrameLoad) {
                        if (layerChanged) {
                            refreshLayerSelectionUi('timeline-click-layer-only');
                        } else {
                            logPaintTrace('timeline.click.noop', {
                                requestedFrameId: frameId,
                                requestedLayerIndex: layerIndex,
                                currentFrameId,
                                activeLayerIndex: session?.activeLayerIndex ?? -1
                            });
                        }
                        return;
                    }
                    try {
                        await loadAnimationFrameIntoSession(asset, animation, targetFrame, { reason: 'timeline-click' });
                    } catch (error) {
                        logPaintTrace('timeline.click.frameLoadFailed', {
                            frameId,
                            error: error?.message || String(error)
                        });
                        await switchPaintFile(projectStore.resolveAssetPath(asset, targetFramePath));
                    }
                    return;
                }
                if (layerChanged) {
                    refreshLayerSelectionUi('timeline-click-layer-only-no-frame');
                } else {
                    logPaintTrace('timeline.click.ignored', {
                        requestedFrameId: frameId,
                        requestedLayerIndex: layerIndex,
                        currentFrameId,
                        targetFrameId: targetFrame?.id || ''
                    });
                }
                return;
            }
            if (action === 'timeline-toggle-view') {
                event.preventDefault();
                event.stopPropagation();
                toggleExpandedTimelineDrawer('timeline-click-toggle-view').catch((error) => {
                    logPaintTrace('timeline.click.toggleViewFailed', {
                        message: error?.message || String(error)
                    });
                });
                return;
            }
            if (action.startsWith('timeline-menu-')) {
                event.preventDefault();
                event.stopPropagation();
                const asset = resolveWorkspaceAsset();
                const context = resolveSessionAnimationContext(asset);
                const animation = context.animation;
                const menuState = paintWorkspaceState.timelineMenu || {};
                const menuLayerIndex = Number(menuState.layerIndex);
                const menuFrameId = String(menuState.frameId || '');
                logPaintTrace('timeline.menu.action', {
                    action,
                    menuLayerIndex,
                    menuFrameId,
                    assetId: asset?.id || '',
                    animationId: animation?.id || ''
                });
                closeTimelineContextMenu();
                if (action === 'timeline-menu-layer-above' && Number.isFinite(menuLayerIndex)) {
                    setActiveLayerByIndex(menuLayerIndex);
                    insertBlankLayerRelative('up');
                    return;
                }
                if (action === 'timeline-menu-layer-below' && Number.isFinite(menuLayerIndex)) {
                    setActiveLayerByIndex(menuLayerIndex);
                    insertBlankLayerRelative('down');
                    return;
                }
                if (action === 'timeline-menu-layer-duplicate-above') {
                    setActiveLayerByIndex(menuLayerIndex);
                    duplicateActiveLayerRelative('up');
                    return;
                }
                if (action === 'timeline-menu-layer-duplicate-below') {
                    setActiveLayerByIndex(menuLayerIndex);
                    duplicateActiveLayerRelative('down');
                    return;
                }
                if (action === 'timeline-menu-layer-move-down') {
                    setActiveLayerByIndex(menuLayerIndex);
                    moveActiveLayerDown();
                    return;
                }
                if (action === 'timeline-menu-layer-merge-down') {
                    setActiveLayerByIndex(menuLayerIndex);
                    mergeActiveLayerDown();
                    return;
                }
                if (action === 'timeline-menu-layer-toggle-pin' && Number.isFinite(menuLayerIndex)) {
                    togglePinnedLayer(session.layers?.[menuLayerIndex]?.id || '');
                    return;
                }
                if (action === 'timeline-menu-layer-delete') {
                    setActiveLayerByIndex(menuLayerIndex);
                    deleteActiveLayer();
                    return;
                }
                if (!asset) {
                    return;
                }
                if (action === 'timeline-menu-frame-blank-left') {
                    insertAnimationFrameRelative(asset, animation, menuFrameId, 'left', 'blank').catch((error) => console.error('Frame create failed', error));
                    return;
                }
                if (action === 'timeline-menu-frame-blank-right') {
                    insertAnimationFrameRelative(asset, animation, menuFrameId, 'right', 'blank').catch((error) => console.error('Frame create failed', error));
                    return;
                }
                if (action === 'timeline-menu-frame-duplicate-left') {
                    insertAnimationFrameRelative(asset, animation, menuFrameId, 'left', 'duplicate').catch((error) => console.error('Frame duplicate failed', error));
                    return;
                }
                if (action === 'timeline-menu-frame-duplicate-right') {
                    insertAnimationFrameRelative(asset, animation, menuFrameId, 'right', 'duplicate').catch((error) => console.error('Frame duplicate failed', error));
                    return;
                }
                if (action === 'timeline-menu-frame-delete') {
                    deleteTimelineFrame(asset, animation, menuFrameId).catch((error) => console.error('Frame delete failed', error));
                }
                return;
            }
        }, { passive: false });
        listEl.addEventListener('dblclick', (event) => {
            const button = event.target?.closest?.('.paint-timeline-layer-button, .paint-layer-pill');
            if (!button || !session) {
                return;
            }
            const index = Number(button.dataset.layerIndex);
            if (!Number.isFinite(index)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            renameLayerAtIndex(index).catch((error) => console.error('Layer rename failed', error));
        }, { passive: false });
        listEl.addEventListener('input', (event) => {
            const role = String(event.target?.dataset?.role || '');
            if (role === 'timeline-layer-thumbnail-tone') {
                const layerIndex = Number(event.target.dataset.layerIndex);
                const thumbnailTone = Number(event.target.value);
                logPaintTrace('timeline.menu.thumbnailTone.input', {
                    layerIndex,
                    thumbnailTone
                });
                updateLayerThumbnailTone(layerIndex, thumbnailTone, { persist: false, render: false });
                return;
            }
            if (role !== 'timeline-frame-hold') {
                return;
            }
            const asset = resolveWorkspaceAsset();
            const context = resolveSessionAnimationContext(asset);
            if (!asset?.id || !context.animation?.id) {
                return;
            }
            const frameId = String(event.target.dataset.frameId || paintWorkspaceState.timelineMenu?.frameId || '');
            const nextHold = clampFrameHoldValue(event.target.value, 1);
            logPaintTrace('timeline.menu.frameHold.input', {
                frameId,
                nextHold,
                animationId: context.animation.id
            });
            projectStore.updateAnimation(asset.id, context.animation.id, (draft) => {
                draft.frames = frameListForPaint(draft).map((frame) => (
                    frame.id === frameId
                        ? { ...frame, hold: nextHold }
                        : frame
                ));
                return syncAnimationFlags(draft);
            }, 'asset2d-frame-hold');
            renderPaintWorkspaceUi();
        }, { passive: true });
        listEl.addEventListener('change', (event) => {
            const role = String(event.target?.dataset?.role || '');
            if (role === 'timeline-layer-thumbnail-tone') {
                const layerIndex = Number(event.target.dataset.layerIndex);
                const thumbnailTone = Number(event.target.value);
                logPaintTrace('timeline.menu.thumbnailTone.change', {
                    layerIndex,
                    thumbnailTone
                });
                updateLayerThumbnailTone(layerIndex, thumbnailTone, { persist: true });
                return;
            }
            if (role !== 'timeline-frame-hold') {
                return;
            }
            renderPaintWorkspaceUi();
        }, { passive: true });
        listEl.addEventListener('contextmenu', (event) => {
            const frameButton = event.target?.closest?.('.paint-timeline-cell');
            if (!frameButton) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const hostEl = listEl.closest('.paint-layer-bar, .paint-timeline-panel');
            const barRect = hostEl?.getBoundingClientRect?.();
            const menuX = barRect ? Math.round(event.clientX - barRect.left) : Math.round(event.clientX || 0);
            const menuY = barRect ? Math.round(event.clientY - barRect.top) : Math.round(event.clientY || 0);
            logPaintTrace('timeline.contextMenu', {
                host,
                menuX,
                menuY,
                layerIndex: Number(frameButton.dataset.layerIndex),
                frameId: String(frameButton.dataset.frameId || '')
            });
            openTimelineContextMenu({
                host,
                kind: 'cell',
                x: menuX,
                y: menuY,
                layerIndex: Number(frameButton.dataset.layerIndex),
                frameId: String(frameButton.dataset.frameId || ''),
                pseudoFrame: String(frameButton.dataset.pseudoFrame || '') === '1'
            });
        }, { passive: false });
    });
    if (dom.paintLayerAdd) {
        dom.paintLayerAdd.addEventListener('click', (event) => {
            if (!session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            createPaintLayer();
        }, { passive: false });
    }
    if (dom.paintLayerDuplicate) {
        dom.paintLayerDuplicate.addEventListener('click', (event) => {
            if (!session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            duplicateActiveLayer();
        }, { passive: false });
    }
    if (dom.paintLayerDelete) {
        dom.paintLayerDelete.addEventListener('click', (event) => {
            if (!session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            deleteActiveLayer();
        }, { passive: false });
    }
    if (dom.paintLayerMergeDown) {
        dom.paintLayerMergeDown.addEventListener('click', (event) => {
            if (!session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            mergeActiveLayerDown();
        }, { passive: false });
    }
    if (dom.paintLayerMergeAll) {
        dom.paintLayerMergeAll.addEventListener('click', (event) => {
            if (!session) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            mergeAllLayers();
        }, { passive: false });
    }
    document.addEventListener('pointerdown', (event) => {
        if (!paintWorkspaceState.timelineMenu.open) {
            return;
        }
        const target = event.target;
        if (dom.paintLayerBar?.contains?.(target) || dom.paintTimelinePanel?.contains?.(target)) {
            if (target?.closest?.('.paint-timeline-menu')) {
                return;
            }
            if (target?.closest?.('.paint-timeline-layer-button, .paint-timeline-cell, .paint-timeline-frame-head')) {
                return;
            }
        }
        closeTimelineContextMenu();
    }, { passive: true });
    document.addEventListener('pointermove', (event) => {
        if (!paintWorkspaceState.timelineDrag) {
            return;
        }
        updateTimelineLayerDrag(event.pointerId, event.clientY);
    }, { passive: true });
    document.addEventListener('pointerup', (event) => {
        if (!paintWorkspaceState.timelineDrag) {
            return;
        }
        endTimelineLayerDrag(event.pointerId);
    }, { passive: true });
    document.addEventListener('pointercancel', (event) => {
        if (!paintWorkspaceState.timelineDrag) {
            return;
        }
        endTimelineLayerDrag(event.pointerId);
    }, { passive: true });
    document.addEventListener('click', (event) => {
        queuePaintUiFocusRelease(event.target, { selector: 'button' });
    }, { capture: true, passive: true });
    if (dom.paintHudOpacitySlider) {
        dom.paintHudOpacitySlider.addEventListener('input', (event) => {
            if (!session) {
                return;
            }
            const value = clamp(Number(event.target.value) / 100, 0, 1);
            ensureOpacityCapsInitialized();
            session.opacityCapByTool[session.tool] = value;
            updateHud();
        }, { passive: true });
        dom.paintHudOpacitySlider.addEventListener('change', (event) => {
            if (!session) {
                return;
            }
            const value = clamp(Number(event.target.value) / 100, 0, 1);
            ensureOpacityCapsInitialized();
            session.opacityCapByTool[session.tool] = value;
            persistPaintPreferences();
            updateHud();
        }, { passive: true });
    }
    if (dom.paintHudAdjustBtn) {
        dom.paintHudAdjustBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isAdjustPanelOpen()) {
                closeAdjustPanel({ apply: false });
            } else {
                openAdjustPanel();
            }
        }, { passive: false });
    }
    if (dom.paintHudPressureSize) {
        dom.paintHudPressureSize.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.pressureAffectsSize = session.pressureAffectsSize === false;
            cachePressureForTool(session.tool);
            persistPaintPreferences();
            updateHud();
        }, { passive: false });
    }
    if (dom.paintHudPressureOpacity) {
        dom.paintHudPressureOpacity.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.pressureAffectsOpacity = session.pressureAffectsOpacity === false;
            cachePressureForTool(session.tool);
            persistPaintPreferences();
            updateHud();
        }, { passive: false });
    }
    if (dom.paintHudEraser) {
        dom.paintHudEraser.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session) {
                return;
            }
            session.eraserMode = !session.eraserMode;
            logPaintTrace('paintHudEraser.toggle', {
                tool: session.tool,
                eraserMode: !!session.eraserMode
            });
            persistPaintPreferences();
            updateHud();
            renderCursorCanvas();
        }, { passive: false });
    }
    if (dom.paintAdjustClose) {
        dom.paintAdjustClose.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeAdjustPanel({ apply: false });
        }, { passive: false });
    }
    const syncAdjustSettingsFromDom = () => {
        if (!session?.adjustPanel?.open) {
            return null;
        }
        const current = session.adjustPanel.settings || defaultAdjustSettings();
        const currentSignature = getAdjustSettingsSignature(current);
        const next = collectAdjustSettingsFromDom(current);
        const nextSignature = getAdjustSettingsSignature(next);
        const changed = nextSignature !== currentSignature;
        session.adjustPanel.settings = changed ? next : current;
        return {
            changed,
            settings: session.adjustPanel.settings,
            signature: nextSignature
        };
    };
    const handleAdjustInput = () => {
        const update = syncAdjustSettingsFromDom();
        if (!update) {
            return;
        }
        syncAdjustPanelValueLabels(update.settings);
        if (!update.changed) {
            return;
        }
        beginAdjustRender({ quality: 'fast', commit: false });
        scheduleAdjustHighQuality();
    };
    const handleAdjustChange = () => {
        const update = syncAdjustSettingsFromDom();
        if (!update) {
            return;
        }
        syncAdjustPanelValueLabels(update.settings);
        if (!update.changed) {
            return;
        }
        beginAdjustRender({ quality: 'hq', commit: false });
    };
    if (dom.paintAdjustHue) {
        dom.paintAdjustHue.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustHue.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustSat) {
        dom.paintAdjustSat.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustSat.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustVal) {
        dom.paintAdjustVal.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustVal.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustContrast) {
        dom.paintAdjustContrast.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustContrast.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustGamma) {
        dom.paintAdjustGamma.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustGamma.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustColorizeStrength) {
        dom.paintAdjustColorizeStrength.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustColorizeStrength.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustShadowColor) {
        dom.paintAdjustShadowColor.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustShadowColor.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustMidColor) {
        dom.paintAdjustMidColor.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustMidColor.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustLightColor) {
        dom.paintAdjustLightColor.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustLightColor.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustGradientBtn && dom.paintAdjustGradientMenu && dom.paintAdjustGradientMap) {
        dom.paintAdjustGradientBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session?.adjustPanel?.open) {
                return;
            }
            setAdjustGradientMenuVisible(!isAdjustGradientMenuOpen());
        }, { passive: false });

        dom.paintAdjustGradientMenu.addEventListener('click', (event) => {
            const btn = event.target?.closest?.('.paint-adjust-gradient-option');
            if (!btn) {
                return;
            }
            const key = String(btn.getAttribute('data-gradient-key') || 'none');
            dom.paintAdjustGradientMap.value = key;
            if (session?.adjustPanel?.open) {
                const update = syncAdjustSettingsFromDom();
                if (update) {
                    syncAdjustGradientPicker(update.settings);
                    if (update.changed) {
                        beginAdjustRender({ quality: 'fast', commit: false });
                        scheduleAdjustHighQuality();
                    }
                }
            }
            setAdjustGradientMenuVisible(false);
        }, { passive: true });

        if (!paintAdjustGradientOutsideListenerAttached) {
            paintAdjustGradientOutsideListenerAttached = true;
            window.addEventListener('pointerdown', (event) => {
                if (!isAdjustGradientMenuOpen()) {
                    return;
                }
                const target = event.target;
                if (!target) {
                    return;
                }
                if (dom.paintAdjustGradientMenu.contains(target) || dom.paintAdjustGradientBtn.contains(target)) {
                    return;
                }
                setAdjustGradientMenuVisible(false);
            }, { capture: true, passive: true });
        }
    }
    if (dom.paintAdjustGradientStrength) {
        dom.paintAdjustGradientStrength.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustGradientStrength.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustBlur) {
        dom.paintAdjustBlur.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustBlur.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustNoise) {
        dom.paintAdjustNoise.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustNoise.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustPosterize) {
        dom.paintAdjustPosterize.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustPosterize.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustHalftoneStrength) {
        dom.paintAdjustHalftoneStrength.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustHalftoneStrength.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustHalftoneScale) {
        dom.paintAdjustHalftoneScale.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustHalftoneScale.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustHalftoneMin) {
        dom.paintAdjustHalftoneMin.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustHalftoneMin.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustHalftoneMax) {
        dom.paintAdjustHalftoneMax.addEventListener('input', handleAdjustInput, { passive: true });
        dom.paintAdjustHalftoneMax.addEventListener('change', handleAdjustChange, { passive: true });
    }
    if (dom.paintAdjustReset) {
        dom.paintAdjustReset.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session?.adjustPanel?.open) {
                return;
            }
            cancelAdjustJob();
            session.adjustPanel.settings = defaultAdjustSettings();
            syncAdjustPanelControls(session.adjustPanel.settings);
            if (session.adjustPanel.original && session.baseCtx) {
                try {
                    session.baseCtx.putImageData(session.adjustPanel.original, 0, 0);
                } catch {}
            }
            renderStageUi();
        }, { passive: false });
    }
    if (dom.paintAdjustApply) {
        dom.paintAdjustApply.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session?.adjustPanel?.open) {
                return;
            }
            session.adjustPanel.settings = collectAdjustSettingsFromDom(session.adjustPanel.settings);
            beginAdjustRender({ commit: true });
        }, { passive: false });
    }
    if (dom.paintStampClose) {
        dom.paintStampClose.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setStampPanelVisible(false);
        }, { passive: false });
    }
    if (dom.paintStampToggleEditor) {
        dom.paintStampToggleEditor.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session?.stampSettings) {
                return;
            }
            setStampEditorVisible(!isStampEditorVisible(), { persist: true });
        }, { passive: false });
    }
    if (dom.paintStampInlineHide) {
        dom.paintStampInlineHide.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            setStampEditorVisible(false, { persist: true });
        }, { passive: false });
    }
    if (dom.paintStampClear) {
        dom.paintStampClear.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!session?.stamp?.editorCtx || !session.stamp.editorCanvas) {
                return;
            }
            session.stamp.editorCtx.clearRect(0, 0, session.stamp.editorCanvas.width, session.stamp.editorCanvas.height);
            if (session.stampSettings) {
                session.stampSettings.tipShape = 'custom';
            }
            if (session.brushProfiles?.[TOOL_STAMP]) {
                session.brushProfiles[TOOL_STAMP].tipShape = 'custom';
            }
            refreshBrushPanel({ syncHud: true, renderStage: false });
            persistPaintPreferences();
        }, { passive: false });
    }
    const handleBrushPanelInput = () => {
        if (!session) {
            return;
        }
        collectBrushPanelStateFromDom();
        refreshBrushPanel({ syncHud: true, renderStage: false });
        if (session.tool === TOOL_RECT && session.rect) {
            updateRectPreview(session.rect.x1, session.rect.y1);
        }
    };
    const handleBrushPanelChange = () => {
        if (!session) {
            return;
        }
        collectBrushPanelStateFromDom();
        refreshBrushPanel({ syncHud: true, renderStage: true });
        if (session.tool === TOOL_RECT && session.rect) {
            updateRectPreview(session.rect.x1, session.rect.y1);
        }
        persistPaintPreferences();
    };
    for (const el of [
        dom.paintAirFillMode,
        dom.paintAirHardness,
        dom.paintAirFlow,
        dom.paintInkFillMode,
        dom.paintInkShape,
        dom.paintPaintFillMode,
        dom.paintPaintTipShape,
        dom.paintPaintHardness,
        dom.paintPaintFlow,
        dom.paintPaintTiltStretch,
        dom.paintShapePrimitive,
        dom.paintShapeFillMode,
        dom.paintShapeBorderWidth,
        dom.paintShapeCornerRadius,
        dom.paintBlurRadius,
        dom.paintBlurStrength,
        dom.paintStampSourceMode,
        dom.paintStampTipShape
    ]) {
        if (!el) {
            continue;
        }
        el.addEventListener('input', handleBrushPanelInput, { passive: true });
        el.addEventListener('change', handleBrushPanelChange, { passive: true });
    }
    const handleStampSettingsInput = () => {
        if (!session) {
            return;
        }
        collectBrushPanelStateFromDom();
        session.stampSettings = collectStampSettingsFromDom(session.stampSettings);
        refreshBrushPanel({ syncHud: true, renderStage: false });
    };
    const handleStampSettingsChange = () => {
        if (!session) {
            return;
        }
        collectBrushPanelStateFromDom();
        session.stampSettings = collectStampSettingsFromDom(session.stampSettings);
        refreshBrushPanel({ syncHud: true, renderStage: true });
        persistPaintPreferences();
    };
    for (const el of [
        dom.paintStampVarSize,
        dom.paintStampVarSizeX,
        dom.paintStampVarSizeY,
        dom.paintStampVarRot,
        dom.paintStampVarColor,
        dom.paintStampVarHue,
        dom.paintStampVarVal,
        dom.paintStampVarSat,
        dom.paintStampScatter,
        dom.paintStampVarAlpha
    ]) {
        if (!el) {
            continue;
        }
        el.addEventListener('input', handleStampSettingsInput, { passive: true });
        el.addEventListener('change', handleStampSettingsChange, { passive: true });
    }
    if (dom.paintStampCommitOnRelease) {
        dom.paintStampCommitOnRelease.addEventListener('change', handleStampSettingsChange, { passive: true });
    }
    if (dom.paintStampFollowRot) {
        dom.paintStampFollowRot.addEventListener('change', handleStampSettingsChange, { passive: true });
    }
    if (dom.paintStampFlipX) {
        dom.paintStampFlipX.addEventListener('change', handleStampSettingsChange, { passive: true });
    }
    if (dom.paintStampFlipY) {
        dom.paintStampFlipY.addEventListener('change', handleStampSettingsChange, { passive: true });
    }
    const handleStampLibraryClick = (event) => {
        const target = event.target.closest?.('[data-stamp-id]');
        if (!target || !session?.stamp?.library) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const stampId = target.getAttribute('data-stamp-id');
        const entry = session.stamp.library.entries?.find((e) => e && e.id === stampId);
        if (!entry) {
            return;
        }
        loadStampEntryIntoEditor(entry).catch(() => {});
        entry.lastUsed = Date.now();
        writeStampLibrary(session.stamp.library);
        renderStampLibrary();
        persistPaintPreferences();
    };
    const handleStampLibraryContext = (event) => {
        const target = event.target.closest?.('[data-stamp-id]');
        if (!target) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const stampId = target.getAttribute('data-stamp-id');
        toggleStampFavorite(stampId);
    };
    if (dom.paintStampFavorites) {
        dom.paintStampFavorites.addEventListener('click', handleStampLibraryClick, { passive: false });
        dom.paintStampFavorites.addEventListener('contextmenu', handleStampLibraryContext, { passive: false });
    }
    if (dom.paintStampRecents) {
        dom.paintStampRecents.addEventListener('click', handleStampLibraryClick, { passive: false });
        dom.paintStampRecents.addEventListener('contextmenu', handleStampLibraryContext, { passive: false });
    }
    if (dom.paintStampEditCanvas) {
        dom.paintStampEditCanvas.addEventListener('pointerdown', (event) => {
            if (!session?.stamp?.editor || !session.stamp.editorCanvas) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            try {
                dom.paintStampEditCanvas.setPointerCapture(event.pointerId);
            } catch {}
            const rect = dom.paintStampEditCanvas.getBoundingClientRect();
            const x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * session.stamp.editorCanvas.width, 0, session.stamp.editorCanvas.width);
            const y = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * session.stamp.editorCanvas.height, 0, session.stamp.editorCanvas.height);
            session.stamp.editor.drawing = true;
            session.stamp.editor.pointerId = event.pointerId;
            session.stamp.editor.lastX = x;
            session.stamp.editor.lastY = y;
            if (session.stampSettings) {
                session.stampSettings.tipShape = 'custom';
            }
            if (session.brushProfiles?.[TOOL_STAMP]) {
                session.brushProfiles[TOOL_STAMP].tipShape = 'custom';
            }
            refreshBrushPanel({ syncHud: true, renderStage: false });
            session.stamp.editorStroke = {
                sourceCanvas: session.tool === TOOL_STAMP ? snapshotStampEditorStrokeSource() : null
            };
            stampEditorDrawDot(x, y);
        }, { passive: false });
        dom.paintStampEditCanvas.addEventListener('pointermove', (event) => {
            if (!session?.stamp?.editor?.drawing || !session.stamp.editorCanvas) {
                return;
            }
            if (session.stamp.editor.pointerId != null && event.pointerId !== session.stamp.editor.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const rect = dom.paintStampEditCanvas.getBoundingClientRect();
            const x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * session.stamp.editorCanvas.width, 0, session.stamp.editorCanvas.width);
            const y = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * session.stamp.editorCanvas.height, 0, session.stamp.editorCanvas.height);
            stampEditorDrawLine(session.stamp.editor.lastX, session.stamp.editor.lastY, x, y);
            session.stamp.editor.lastX = x;
            session.stamp.editor.lastY = y;
        }, { passive: false });
        const endStampEdit = (event) => {
            if (!session?.stamp?.editor?.drawing) {
                return;
            }
            if (session.stamp.editor.pointerId != null && event.pointerId !== session.stamp.editor.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            session.stamp.editor.drawing = false;
            session.stamp.editor.pointerId = null;
            session.stamp.editorStroke = null;
            persistPaintPreferences();
            try {
                dom.paintStampEditCanvas.releasePointerCapture(event.pointerId);
            } catch {}
        };
        dom.paintStampEditCanvas.addEventListener('pointerup', endStampEdit, { passive: false });
        dom.paintStampEditCanvas.addEventListener('pointercancel', endStampEdit, { passive: false });
    }
    window.addEventListener('keydown', handlePaintKeyDown, { passive: false, capture: true });
    window.addEventListener('keyup', handlePaintKeyUp, { passive: false });
    window.addEventListener('blur', () => {
        resetPaintModifierState();
    });
    window.addEventListener('resize', () => {
        if (!session) {
            return;
        }
        if (isStampPanelOpen()) {
            refreshBrushPanel({ syncHud: false, renderCursor: false, renderStage: false });
        }
        ensureStageUiSized();
        if (!session.crop?.active) {
            fitToScreen();
        } else {
            renderStageUi();
        }
        updatePaintTopDockLayout();
    });
    window.addEventListener('beforeunload', () => {
        if (!isPaintEditorWindow() || !session || session.externalCommitSent) {
            return;
        }
        notifyPreviewCleared();
    });
    if (!paintWorkspaceProgressListenerAttached && env.electron?.ipcRenderer?.on) {
        paintWorkspaceProgressListenerAttached = true;
        env.electron.ipcRenderer.on('workboard:2d-job-progress', (_event, payload = {}) => {
            const jobId = String(payload.jobId || '').trim();
            if (!jobId || jobId !== paintWorkspaceState.activeJobId) {
                return;
            }
            const currentStatus = String(paintWorkspaceState.jobStatus || '').trim().toLowerCase();
            const nextStatus = typeof payload.status === 'string' ? String(payload.status).trim().toLowerCase() : currentStatus;
            if ((currentStatus === 'done' || currentStatus === 'error' || currentStatus === 'canceled') && nextStatus === 'running') {
                logPaintTrace('paint.job.progressIgnored', {
                    jobId,
                    currentStatus,
                    nextStatus,
                    title: typeof payload.title === 'string' ? payload.title : '',
                    detailMessage: typeof payload.detailMessage === 'string' ? payload.detailMessage : (typeof payload.message === 'string' ? payload.message : '')
                });
                return;
            }
            paintWorkspaceState.jobStatus = typeof payload.status === 'string' ? payload.status : paintWorkspaceState.jobStatus;
            if (typeof payload.title === 'string' && payload.title.trim()) {
                paintWorkspaceState.jobMessage = payload.title;
                paintWorkspaceState.jobDetailMessage = typeof payload.detailMessage === 'string'
                    ? payload.detailMessage
                    : (typeof payload.message === 'string' ? payload.message : paintWorkspaceState.jobDetailMessage);
            } else {
                paintWorkspaceState.jobMessage = typeof payload.message === 'string' ? payload.message : paintWorkspaceState.jobMessage;
                if (typeof payload.detailMessage === 'string') {
                    paintWorkspaceState.jobDetailMessage = payload.detailMessage;
                }
            }
            if (Number.isFinite(Number(payload.progress))) {
                const rangeStart = Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgressRangeStart) || 0));
                const rangeSize = Math.max(0, Math.min(1 - rangeStart, Number(paintWorkspaceState.jobProgressRangeSize) || 1));
                const normalizedProgress = Math.max(0, Math.min(1, Number(payload.progress) || 0));
                const mappedProgress = rangeStart + (normalizedProgress * rangeSize);
                paintWorkspaceState.jobProgress = payload.allowProgressDecrease === true || paintWorkspaceState.jobStatus !== 'running'
                    ? mappedProgress
                    : Math.max(Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgress) || 0)), mappedProgress);
            }
            logPaintTrace('paint.job.progress', {
                jobId,
                status: paintWorkspaceState.jobStatus,
                title: paintWorkspaceState.jobMessage,
                detailMessage: paintWorkspaceState.jobDetailMessage,
                reportedProgress: Number.isFinite(Number(payload.progress)) ? Math.max(0, Math.min(1, Number(payload.progress) || 0)) : null,
                mappedProgress: Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgress) || 0)),
                rangeStart: Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgressRangeStart) || 0)),
                rangeSize: Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgressRangeSize) || 1))
            });
            if (typeof paintWorkspaceState.jobProgressHandler === 'function') {
                Promise.resolve(paintWorkspaceState.jobProgressHandler(payload)).catch((error) => {
                    logPaintTrace('paint.job.progressHandler.error', {
                        jobId,
                        message: error?.message || String(error)
                    });
                });
            }
            renderPaintWorkspaceUi();
        });
    }
}

    function ensureHandlers() {
        if (handlersAttached) {
            return;
        }
        handlersAttached = true;
        attachPaintEventHandlers();
    }

    return {
        attachPaintEventHandlers,
        ensureHandlers
    };
};
