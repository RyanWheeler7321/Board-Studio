'use strict';

// MARK: MODULE
module.exports = function createPaintInputKeyboardModule(deps) {
    const { paintActions, paintQueries, paintUi } = deps;
    const {
        env,
        dom,
        utils,
        paintWorkspaceState,
        paintWorkspaceUi,
        BRUSH_BLEND_MODES,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        STROKE_MODE_FILL,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        EDIT_MODE_TRANSFORM,
        DEFAULT_BRUSH_SIZE,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        TOOL_SPACING_MIN,
        TOOL_SPACING_MAX,
        PAINT_CONTEXTMENU_SUPPRESS_MS,
        IGNORE_HOVER_AFTER_UP_MS,
        IGNORE_MOUSE_AFTER_STYLUS_UP_MS,
        getSession,
        normalizeKey,
        clamp,
        clamp01,
        logPaintTrace,
        collectAdjustSettingsFromDom
    } = deps;

    const {
        resolveWorkspaceAsset,
        resolveSessionAsset,
        isFileBackedPaintSession,
        isAdjustPanelOpen,
        isTimelineBarVisible,
        isExitMenuOpen,
        isColorPopoverOpen,
        clientToStage,
        stageToImage,
        shouldIgnoreNonActivePointerEvent,
        isStylusLikeEvent,
        resolveToolSpacingFactor,
        resolveCropHit,
        resolvePressureDefaults,
        isWorkspacePlaceholderState,
        getActiveLayer
    } = paintQueries;

    const {
        hideColorPickIndicator,
        showColorPickIndicator,
        setHelpVisible,
        updateHud,
        renderCursorCanvas,
        renderPaintWorkspaceUi,
        showTimelineQuickPreview,
        isPaintLayerViewerOpen,
        togglePaintLayerViewer,
        navigatePaintLayerViewer,
        setExitMenuVisible,
        showColorPopoverAt,
        hideColorPopover,
        showPaintContextMenuAt,
        hidePaintContextMenu,
        setDebugVisible,
        renderDebugOverlay,
        queuePaintUiFocusRelease,
        renderBrushCursor,
        updateRectPreview,
        isStampPanelOpen,
        setStampPanelVisible
    } = paintUi;

    const {
        renameCurrentPaintProject,
        touchPaintSessionActivity,
        closeAdjustPanel,
        beginAdjustRender,
        toggleActiveLayerVisibility,
        toggleIsolateActiveLayer,
        fillAtHoverPoint,
        fillCanvasWithColor,
        mirrorCanvasHorizontal,
        clearSelectionAndQueueUndo,
        persistPaintPreferences,
        fitTransformToCanvas,
        setSessionColor,
        syncColorPickerFromSession,
        renderHueCanvas,
        renderSvCanvas,
        pickLayerAtImagePoint,
        setActiveLayerByIndex,
        pickVisibleColorAtImagePoint,
        cancelCropMode,
        applyCropRect,
        adjustCropByKeyboard,
        toggleCollapsedTimelineDrawer,
        triggerTimelineMotion,
        navigatePaintAnimation,
        insertTimelineFrameFromHotkey,
        togglePaintAnimationPlayback,
        undo,
        redo,
        capturePaintHistorySnapshot,
        saveCurrentPaintSession,
        copySelectionOrCanvasToClipboard,
        rebuildSelectionFromComponents,
        invertSelection,
        fitToScreen,
        clearOverlayCanvas,
        beginTransformMode,
        createPaintLayer,
        setActiveTool,
        updateStageCursor,
        setBrushBlendMode,
        captureInputSample,
        updateHoverFromPointerEvent,
        beginZoomDrag,
        endZoomDrag,
        beginPan,
        endPan,
        applySpacingDrag,
        updateToolSizeFromSession,
        syncBorderSizeToBrush,
        renderCropOverlay,
        finalizeSelection,
        beginTransformDrag,
        continueStroke,
        beginStroke,
        endStroke,
        renderStageUi,
        requestCancelPaint,
        saveAndExit,
        cachePressureForTool,
        toggleExpandedTimelineDrawer,
        cancelTransformMode,
        keepChangesAction,
        setWrapTransform,
        applyTransformMode,
        beginCropMode,
        insertBlankLayerRelative,
        duplicateActiveLayerRelative
    } = paintActions;

    async function runManualCheckpointSave(event, session, active) {
        if (!session || event.repeat) {
            return false;
        }
        event.preventDefault();
        event.stopPropagation();
        if (active && active.tagName && active.tagName.toLowerCase() === 'select') {
            queuePaintUiFocusRelease(active, { selector: 'select' });
        }
        if (isAdjustPanelOpen()) {
            utils.showToast?.('Paint: apply or cancel the current adjustment first', { position: 'bottom-right' });
            logPaintTrace('paint.save.hotkey.blocked', {
                reason: 'adjust-panel-open',
                filePath: session.filePath || '',
                assetId: resolveWorkspaceAsset()?.id || ''
            });
            return true;
        }
        if (session.isDrawing || session.pointerDown || session.crop?.active || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) || session.select?.lassoing) {
            utils.showToast?.('Paint: finish current action first', { position: 'bottom-right' });
            logPaintTrace('paint.save.hotkey.blocked', {
                reason: 'active-edit',
                filePath: session.filePath || '',
                assetId: resolveWorkspaceAsset()?.id || '',
                isDrawing: session.isDrawing === true,
                pointerDown: session.pointerDown === true,
                cropActive: session.crop?.active === true,
                transformActive: session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active === true,
                lassoing: session.select?.lassoing === true
            });
            return true;
        }
        if (session.selectionEdit?.dirty) {
            utils.showToast?.('Paint: apply selection edits first', { position: 'bottom-right' });
            logPaintTrace('paint.save.hotkey.blocked', {
                reason: 'selection-edit-dirty',
                filePath: session.filePath || '',
                assetId: resolveWorkspaceAsset()?.id || ''
            });
            return true;
        }
        logPaintTrace('paint.save.hotkey.trigger', {
            filePath: session.filePath || '',
            assetId: resolveWorkspaceAsset()?.id || ''
        });
        try {
            const result = await saveCurrentPaintSession('manual-save', {
                recordHistory: false,
                notifyCommit: false,
                captureLogSnapshot: true,
                assetReason: 'asset2d-paint-manual-save',
                boardReason: 'paint-manual-save'
            });
            if (!result?.saved) {
                utils.showToast?.('Paint save skipped', { position: 'bottom-right' });
                logPaintTrace('paint.save.hotkey.skipped', {
                    reason: result?.reason || 'unknown',
                    filePath: session.filePath || '',
                    assetId: resolveWorkspaceAsset()?.id || ''
                });
                return true;
            }
            const savedTimeLabel = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
            utils.showToast?.(`Paint saved ${savedTimeLabel}`, { position: 'bottom-right', variant: 'save', duration: 3200 });
            logPaintTrace('paint.save.hotkey.complete', {
                mode: result.mode || '',
                filePath: result.filePath || session.filePath || '',
                assetId: result.assetId || resolveWorkspaceAsset()?.id || '',
                snapshotId: result.snapshotId || ''
            });
        } catch (error) {
            utils.showToast?.('Paint save failed', { position: 'bottom-right' });
            logPaintTrace('paint.save.hotkey.error', {
                message: error?.message || String(error),
                filePath: session.filePath || '',
                assetId: resolveWorkspaceAsset()?.id || ''
            });
        }
        return true;
    }

    function shouldTrackKeyActivity(key, event) {
        if (event?.repeat) {
            return false;
        }
        return key !== 'shift'
            && key !== 'control'
            && key !== 'meta'
            && key !== 'alt';
    }

    function isTextEntryElement(element) {
        if (!element) {
            return false;
        }
        const tagName = element.tagName ? element.tagName.toLowerCase() : '';
        if (element.isContentEditable) {
            return true;
        }
        if (tagName === 'textarea') {
            return true;
        }
        if (tagName !== 'input') {
            return false;
        }
        const type = String(element.type || 'text').trim().toLowerCase();
        return type !== 'checkbox'
            && type !== 'radio'
            && type !== 'range'
            && type !== 'color'
            && type !== 'file'
            && type !== 'button'
            && type !== 'submit'
            && type !== 'reset';
    }

    function resolveKeyboardFocusState(active) {
        const element = active || document.activeElement || null;
        const tagName = element && element.tagName ? element.tagName.toLowerCase() : '';
        const workspaceField = !!(element && typeof element.closest === 'function' && element.closest('.paint-project-panel, .paint-unity-panel, .paint-animation-drawer, .paint-create-modal-card'));
        const inContextDialog = !!(element && typeof element.closest === 'function' && element.closest('.context-dialog-overlay'));
        const isSelectField = tagName === 'select';
        const isTextEntryField = isTextEntryElement(element);
        return {
            active: element,
            activeTag: tagName,
            isWorkspaceField: workspaceField,
            inContextDialog,
            isSelectField,
            isTextEntryField,
            isWorkspaceTextField: workspaceField && (isTextEntryField || isSelectField),
            shouldBlockMainHotkeys: inContextDialog
        };
    }

    function leaveSelectionToolForPaint() {
        const session = getSession();
        if (!session) {
            return;
        }
        if (session.editMode !== EDIT_MODE_SELECT && session.select?.toolLocked !== true) {
            return;
        }
        session.editMode = EDIT_MODE_PAINT;
        session.select.lassoing = false;
        session.select.points = [];
        session.select.anchorX = 0;
        session.select.anchorY = 0;
        session.select.awaitingContinuation = false;
        session.select.dragMoved = false;
        session.select.trace = null;
        session.select.toolLocked = false;
        clearOverlayCanvas();
        logPaintTrace('paint.selection.tool.unlock', {
            reason: 'paint-hotkey',
            nextTool: String(session.tool || '')
        });
    }

    function handlePaintKeyDown(event) {
        const session = getSession();
        const key = normalizeKey(event);
        const rawControlKey = event.ctrlKey || event.metaKey;
        const focusState = resolveKeyboardFocusState(document.activeElement);
        const active = focusState.active;
        const activeTag = focusState.activeTag;
        if (!session) {
            if (!rawControlKey && !event.altKey && key === 'w' && !event.repeat && isWorkspacePlaceholderState()) {
                event.preventDefault();
                event.stopPropagation();
                if (dom.paintProjectBar) {
                    paintWorkspaceState.projectMenuHidden = !paintWorkspaceState.projectMenuHidden;
                    logPaintTrace('hotkey.projectMenu.toggle.placeholder', {
                        projectMenuHidden: paintWorkspaceState.projectMenuHidden
                    });
                    renderPaintWorkspaceUi();
                }
            }
            return;
        }
        const controlKey = rawControlKey || session.ctrlDown === true;
        const allowWorkspaceHotkeyWhileSelectFocused = !!(!controlKey && !event.altKey && !event.repeat && focusState.isSelectField && (key === 'g' || key === 'k' || key === 'u' || key === 'l' || key === 'r' || key === 's' || key === ' ' || key === 'tab' || key === 'f2'));
        const allowWorkspaceFieldHotkey = !!(!controlKey && !event.altKey && !event.repeat && (key === 'tab' || key === 'f2'));
        const shouldBlockForFocus = focusState.isTextEntryField;
        const shouldBlockForModal = focusState.shouldBlockMainHotkeys
            && !focusState.isTextEntryField
            && !allowWorkspaceHotkeyWhileSelectFocused
            && !allowWorkspaceFieldHotkey;
        if (focusState.inContextDialog) {
            return;
        }
        if (focusState.isTextEntryField) {
            return;
        }
        if (focusState.isWorkspaceTextField && !allowWorkspaceHotkeyWhileSelectFocused && !allowWorkspaceFieldHotkey) {
            return;
        }
        if (shouldTrackKeyActivity(key, event)) {
            touchPaintSessionActivity(`keydown:${key || 'unknown'}`);
        }
        if (key === 's') {
            session.sDown = true;
        }
        if (key === 'shift') {
            session.shiftDown = true;
            if (session.editMode === EDIT_MODE_SELECT) {
                renderStageUi();
            }
        }
        if (!controlKey && !event.altKey && isPaintLayerViewerOpen()) {
            if (key === 'v' && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                togglePaintLayerViewer();
                return;
            }
            if (key === 'arrowleft' || key === 'arrowup') {
                event.preventDefault();
                event.stopPropagation();
                navigatePaintLayerViewer(-1);
                return;
            }
            if (key === 'arrowright' || key === 'arrowdown') {
                event.preventDefault();
                event.stopPropagation();
                navigatePaintLayerViewer(1);
                return;
            }
        }
        if (controlKey && !event.altKey && key === 's' && !event.repeat) {
            logPaintTrace('paint.save.hotkey.comboDetected', {
                key,
                rawControlKey,
                sessionCtrlDown: session.ctrlDown === true,
                activeTag
            });
            runManualCheckpointSave(event, session, active).catch((error) => {
                logPaintTrace('paint.save.hotkey.failed', {
                    message: error?.message || String(error)
                });
            });
            return;
        }

        if (!controlKey && !event.altKey && key === 'f2' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('project.rename.hotkey', {
                assetId: resolveWorkspaceAsset()?.id || '',
                assetName: resolveWorkspaceAsset()?.name || ''
            });
            renameCurrentPaintProject().catch((error) => {
                logPaintTrace('project.rename.hotkeyFailed', {
                    message: error?.message || String(error)
                });
            });
            return;
        }

        if (session.spaceKeyHeld && key && key !== ' ') {
            session.spaceTapCandidate = false;
        }

        if (isAdjustPanelOpen()) {
            if (key === 'escape' && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                closeAdjustPanel({ apply: false });
                return;
            }
            if (controlKey && key === 'enter' && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                if (session.adjustPanel) {
                    session.adjustPanel.settings = collectAdjustSettingsFromDom(session.adjustPanel.settings);
                }
                beginAdjustRender({ commit: true });
                return;
            }
            return;
        }

        if (!controlKey && !event.altKey && key === 'v' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            togglePaintLayerViewer();
            return;
        }

        if (key === 'control' || key === 'meta') {
            session.ctrlDown = true;
            if (session.spaceDown) {
                session.spaceDown = false;
                session.ctrlSpaceHeld = true;
                session.spaceTapCandidate = false;
                endPan();
                updateStageCursor();
            }
            if (session.spaceKeyHeld) {
                session.ctrlSpaceHeld = true;
                session.spaceTapCandidate = false;
                updateStageCursor();
            }
            if (session.pointerDown && session.ctrlSpaceHeld && !session.zoomDrag.active && !session.isDrawing && !session.crop.active) {
                beginZoomDrag(session.lastStageX, session.lastStageY);
                updateStageCursor();
            }
            if (session.editMode === EDIT_MODE_SELECT) {
                renderStageUi();
            }
        }

        if (isColorPopoverOpen()) {
            const activePopover = document.activeElement;
            const isPopoverFocus = !!(activePopover && dom.paintColorPopover && dom.paintColorPopover.contains(activePopover));
            if (key === 'c' && event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (key === 'escape') {
                event.preventDefault();
                event.stopPropagation();
                hideColorPopover();
                return;
            }
            if (key === 'enter') {
                event.preventDefault();
                event.stopPropagation();
                hideColorPopover();
                return;
            }
            if (isPopoverFocus) {
                event.preventDefault();
                event.stopPropagation();
                activePopover.blur?.();
            }
            hideColorPopover();
            if (key === 'c' && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }

        if (!controlKey && !event.altKey && key === '`' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            env.consoleUi?.toggle?.();
            return;
        }

        if (!controlKey && !event.altKey && key === '?' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.helpHeld = true;
            setHelpVisible(true);
            return;
        }

        if (!controlKey && !event.altKey && key === 'h' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('timeline.hotkey.toggleLayerVisibility', {
                activeLayerIndex: session?.activeLayerIndex ?? -1,
                layerId: getActiveLayer()?.id || '',
                drawerOpen: paintWorkspaceState.drawerOpen === true
            });
            toggleActiveLayerVisibility();
            return;
        }

        if (!controlKey && !event.altKey && key === 'i' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            logPaintTrace('timeline.hotkey.toggleIsolateActiveLayer', {
                activeLayerIndex: session?.activeLayerIndex ?? -1,
                layerId: getActiveLayer()?.id || '',
                isolateActiveLayer: session?.isolateActiveLayer === true
            });
            toggleIsolateActiveLayer();
            return;
        }

        if (!controlKey && !event.altKey && key === 'd' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.debug = session.debug || { visible: false };
            session.debug.visible = !session.debug.visible;
            setDebugVisible(session.debug.visible);
            renderDebugOverlay();
            return;
        }

        if (!controlKey && !event.altKey && key === 'f' && !event.repeat) {
            if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
                event.preventDefault();
                event.stopPropagation();
                fitTransformToCanvas();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            fillAtHoverPoint();
            return;
        }

        if (!controlKey && !event.altKey && key === 'backspace' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            fillCanvasWithColor();
            return;
        }

        if (!controlKey && !event.altKey && key === 'm' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            mirrorCanvasHorizontal();
            return;
        }

        if (!controlKey && !event.altKey && key === 'c' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (isColorPopoverOpen()) {
                hideColorPopover();
            } else {
                showColorPopoverAt(session.lastClientX, session.lastClientY);
            }
            logPaintTrace('hotkey.colorPopover.toggle', {
                open: isColorPopoverOpen(),
                x: Number.isFinite(session.lastClientX) ? Math.round(session.lastClientX) : -1,
                y: Number.isFinite(session.lastClientY) ? Math.round(session.lastClientY) : -1
            });
            return;
        }

        if (!controlKey && !event.altKey && key === 'x' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            clearSelectionAndQueueUndo();
            renderCursorCanvas();
            return;
        }

        if (!controlKey && !event.altKey && key === 'b' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                if (session.tool === TOOL_AIR || session.tool === TOOL_INK || session.tool === TOOL_PAINT || session.tool === TOOL_RECT) {
                    session.strokeMode = session.strokeMode === STROKE_MODE_BORDER ? STROKE_MODE_FILL : STROKE_MODE_BORDER;
                    if (session.strokeModeByTool) {
                        session.strokeModeByTool[session.tool] = session.strokeMode;
                    }
                    if (session.brushProfiles?.[session.tool]) {
                        session.brushProfiles[session.tool].fillMode = session.strokeMode === STROKE_MODE_BORDER ? STROKE_MODE_BORDER : STROKE_MODE_FILL;
                    }
                    updateHud();
                    persistPaintPreferences();
                    renderCursorCanvas();
                    if (session.tool === TOOL_RECT && session.rect) {
                        updateRectPreview(session.rect.x1, session.rect.y1);
                    }
                }
                return;
            }
            setStampPanelVisible(!isStampPanelOpen());
            return;
        }

        if (!controlKey && !event.altKey && key === 'e' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.eraserMode = !session.eraserMode;
            logPaintTrace('hotkey.eraser.toggle', {
                tool: session.tool,
                eraserMode: !!session.eraserMode
            });
            persistPaintPreferences();
            updateHud();
            renderCursorCanvas();
            return;
        }

        if (!controlKey && !event.altKey && key === 'o' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.pressureAffectsOpacity = !session.pressureAffectsOpacity;
            cachePressureForTool(session.tool);
            persistPaintPreferences();
            updateHud();
            return;
        }

        if (!controlKey && !event.altKey && key === 'p' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.pressureAffectsSize = !session.pressureAffectsSize;
            cachePressureForTool(session.tool);
            persistPaintPreferences();
            updateHud();
            renderCursorCanvas();
            return;
        }

        if (key === ' ' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (activeTag === 'select') {
                queuePaintUiFocusRelease(active, { selector: 'select' });
            }
            session.spaceKeyHeld = true;
            session.spaceTapCandidate = !(controlKey || event.altKey || event.metaKey);
            if (controlKey || session.ctrlDown) {
                session.ctrlSpaceHeld = true;
                session.spaceTapCandidate = false;
            } else {
                session.spaceDown = true;
            }
            updateStageCursor();
            return;
        }

        if (!controlKey && !event.altKey && key === 'n' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.blendHoldTriggered = false;
            if (session.blendHoldTimer) {
                clearTimeout(session.blendHoldTimer);
            }
            session.blendHoldTimer = setTimeout(() => {
                session.blendHoldTriggered = true;
                setBrushBlendMode('normal');
                persistPaintPreferences();
                session.blendHoldTimer = null;
            }, 500);
            return;
        }

        if (session.crop.active) {
            if (key === 'escape') {
                event.preventDefault();
                event.stopPropagation();
                cancelCropMode();
                return;
            }
            if (key === 'enter') {
                event.preventDefault();
                event.stopPropagation();
                applyCropRect(session.crop.rect);
                return;
            }
            if (adjustCropByKeyboard(event)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }

        if (!controlKey && !event.altKey && key === 's' && !event.repeat && !session.crop.active) {
            if (event.shiftKey) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (activeTag === 'select') {
                queuePaintUiFocusRelease(active, { selector: 'select' });
            }
            togglePaintAnimationPlayback();
            return;
        }

        if (!controlKey && !event.altKey && key === 'a' && !event.repeat && !session.crop.active) {
            event.preventDefault();
            event.stopPropagation();
            toggleCollapsedTimelineDrawer('hotkey-a').catch((error) => {
                logPaintTrace('timeline.drawer.toggle.hotkeyFailed', {
                    message: error?.message || String(error)
                });
            });
            return;
        }

        if (!controlKey && !event.altKey && key === 'w' && !event.repeat && !session.crop.active) {
            event.preventDefault();
            event.stopPropagation();
            if (dom.paintProjectBar) {
                paintWorkspaceState.projectMenuHidden = !paintWorkspaceState.projectMenuHidden;
                logPaintTrace('hotkey.projectMenu.toggle', {
                    projectMenuHidden: paintWorkspaceState.projectMenuHidden,
                    assetId: resolveWorkspaceAsset()?.id || '',
                    filePath: session.filePath || ''
                });
                renderPaintWorkspaceUi();
            }
            return;
        }

        if (!controlKey && !event.altKey) {
            if (key === 'arrowleft') {
                event.preventDefault();
                event.stopPropagation();
                logPaintTrace('timeline.hotkey.navigateFrame', {
                    direction: -1,
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true
                });
                navigatePaintAnimation(-1, 'frame');
                return;
            }
            if (key === 'arrowright') {
                event.preventDefault();
                event.stopPropagation();
                logPaintTrace('timeline.hotkey.navigateFrame', {
                    direction: 1,
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true
                });
                navigatePaintAnimation(1, 'frame');
                return;
            }
            if (key === 'arrowup') {
                event.preventDefault();
                event.stopPropagation();
                const layerCount = Math.max(1, session?.layers?.length || 1);
                const currentIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, layerCount - 1);
                const nextIndex = Math.min(currentIndex + 1, layerCount - 1);
                const previewShown = showTimelineQuickPreview('timeline-hotkey-up-preview', {
                    renderImmediately: nextIndex === currentIndex
                });
                logPaintTrace('timeline.hotkey.navigateLayer', {
                    direction: 'up',
                    currentIndex,
                    nextIndex,
                    layerCount,
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true,
                    previewShown
                });
                if (nextIndex === currentIndex) {
                    logPaintTrace('timeline.hotkey.navigateLayer.edge', {
                        direction: 'up',
                        currentIndex,
                        layerCount
                    });
                    triggerTimelineMotion('y', -1, { variant: 'edge' });
                    return;
                }
                if (paintWorkspaceState.timelineExpanded !== true && isTimelineBarVisible()) {
                    triggerTimelineMotion('y', -1);
                }
                setActiveLayerByIndex(nextIndex, { reason: 'timeline-hotkey-up' });
                return;
            }
            if (key === 'arrowdown') {
                event.preventDefault();
                event.stopPropagation();
                const layerCount = Math.max(1, session?.layers?.length || 1);
                const currentIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, layerCount - 1);
                const nextIndex = Math.max(currentIndex - 1, 0);
                const previewShown = showTimelineQuickPreview('timeline-hotkey-down-preview', {
                    renderImmediately: nextIndex === currentIndex
                });
                logPaintTrace('timeline.hotkey.navigateLayer', {
                    direction: 'down',
                    currentIndex,
                    nextIndex,
                    layerCount,
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true,
                    previewShown
                });
                if (nextIndex === currentIndex) {
                    logPaintTrace('timeline.hotkey.navigateLayer.edge', {
                        direction: 'down',
                        currentIndex,
                        layerCount
                    });
                    triggerTimelineMotion('y', 1, { variant: 'edge' });
                    return;
                }
                if (paintWorkspaceState.timelineExpanded !== true && isTimelineBarVisible()) {
                    triggerTimelineMotion('y', 1);
                }
                setActiveLayerByIndex(nextIndex, { reason: 'timeline-hotkey-down' });
                return;
            }
            if (key === 'tab') {
                event.preventDefault();
                event.stopPropagation();
                logPaintTrace('timeline.hotkey.toggleView', {
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    timelineExpanded: paintWorkspaceState.timelineExpanded === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true
                });
                toggleExpandedTimelineDrawer('hotkey-tab').catch((error) => {
                    logPaintTrace('timeline.hotkey.toggleViewFailed', {
                        message: error?.message || String(error)
                    });
                });
                return;
            }
        }

        if (controlKey && !event.altKey && !event.repeat) {
            if (event.shiftKey && (key === 'arrowup' || key === 'arrowdown')) {
                event.preventDefault();
                event.stopPropagation();
                const direction = key === 'arrowup' ? 'up' : 'down';
                logPaintTrace('timeline.hotkey.duplicateLayer', {
                    direction,
                    activeLayerIndex: clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1)),
                    layerCount: Math.max(1, session?.layers?.length || 1)
                });
                const duplicate = duplicateActiveLayerRelative(direction);
                if (!duplicate) {
                    logPaintTrace('timeline.hotkey.duplicateLayerSkipped', {
                        direction,
                        activeLayerIndex: clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1)),
                        layerCount: Math.max(1, session?.layers?.length || 1)
                    });
                }
                return;
            }
            if (key === 'arrowup' || key === 'arrowdown') {
                event.preventDefault();
                event.stopPropagation();
                const direction = key === 'arrowup' ? 'up' : 'down';
                logPaintTrace('timeline.hotkey.insertLayer', {
                    direction,
                    activeLayerIndex: clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1)),
                    layerCount: Math.max(1, session?.layers?.length || 1)
                });
                const inserted = insertBlankLayerRelative(direction);
                if (!inserted) {
                    logPaintTrace('timeline.hotkey.insertLayerSkipped', {
                        direction,
                        activeLayerIndex: clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, (session?.layers?.length || 1) - 1)),
                        layerCount: Math.max(1, session?.layers?.length || 1)
                    });
                }
                return;
            }
            if (key === 'arrowleft' || key === 'arrowright') {
                event.preventDefault();
                event.stopPropagation();
                const direction = key === 'arrowleft' ? 'left' : 'right';
                const mode = event.shiftKey ? 'duplicate' : 'blank';
                logPaintTrace('timeline.hotkey.insertFrame', {
                    direction,
                    mode,
                    drawerOpen: paintWorkspaceState.drawerOpen === true,
                    timelineExpanded: paintWorkspaceState.timelineExpanded === true,
                    quickPreview: paintWorkspaceState.timelineQuickPreview === true
                });
                insertTimelineFrameFromHotkey(direction, mode).catch((error) => {
                    logPaintTrace('timeline.hotkey.insertFrameFailed', {
                        direction,
                        mode,
                        message: error?.message || String(error)
                    });
                });
                return;
            }
        }

        if (key === 'escape') {
            if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
                event.preventDefault();
                event.stopPropagation();
                cancelTransformMode();
                return;
            }
            if (session.editMode === EDIT_MODE_SELECT || session.select?.toolLocked === true) {
                event.preventDefault();
                event.stopPropagation();
                session.editMode = EDIT_MODE_PAINT;
                session.select.lassoing = false;
                session.select.points = [];
                session.select.awaitingContinuation = false;
                session.select.dragMoved = false;
                session.select.toolLocked = false;
                logPaintTrace('paint.selection.tool.unlock', {
                    reason: 'escape'
                });
                updateHud();
                updateStageCursor();
                renderBrushCursor(session.hover?.x ?? 0, session.hover?.y ?? 0);
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (isExitMenuOpen()) {
                if (event.repeat) {
                    return;
                }
                setExitMenuVisible(false);
                keepChangesAction();
                return;
            }
            setExitMenuVisible(true);
            return;
        }
        if (key === 'enter') {
            event.preventDefault();
            event.stopPropagation();
            setExitMenuVisible(false);
            keepChangesAction();
            return;
        }
        if (controlKey && key === 'z' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
                cancelTransformMode();
                return;
            }
            undo();
            return;
        }
        if (controlKey && !event.shiftKey && key === 'c' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            copySelectionOrCanvasToClipboard().catch((error) => console.error('Paint copy failed', error));
            return;
        }
        if (controlKey && event.shiftKey && key === 'c' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
                utils.showToast?.('Paint: finish transform before cropping');
                return;
            }
            if (session.crop.active) {
                cancelCropMode();
            } else {
                beginCropMode();
            }
            return;
        }
        if (controlKey && event.shiftKey && key === 'a' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            const rectPoints = [
                { x: 0, y: 0 },
                { x: session.width, y: 0 },
                { x: session.width, y: session.height },
                { x: 0, y: session.height }
            ];
            rebuildSelectionFromComponents([{ points: rectPoints, op: 'add' }], false);
            return;
        }
        if (controlKey && key === 'a' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (paintWorkspaceUi?.panelEl && !paintWorkspaceState.createDialogOpen) {
                const switchingModes = paintWorkspaceState.panelMode !== 'asset';
                const nextHidden = switchingModes ? false : !paintWorkspaceState.panelHidden;
                if (nextHidden || switchingModes) {
                    queuePaintUiFocusRelease(active, { selector: 'button, select, input, textarea' });
                }
                paintWorkspaceState.panelMode = 'asset';
                paintWorkspaceState.panelHidden = nextHidden;
                logPaintTrace('hotkey.assetPanel.toggle', {
                    panelMode: paintWorkspaceState.panelMode,
                    panelHidden: paintWorkspaceState.panelHidden,
                    assetId: resolveWorkspaceAsset()?.id || '',
                    filePath: session.filePath || ''
                });
                renderPaintWorkspaceUi();
            }
            return;
        }
        if (controlKey && key === 'i' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            invertSelection();
            return;
        }
        if (controlKey && (key === 'y' || (event.shiftKey && key === 'z'))) {
            event.preventDefault();
            event.stopPropagation();
            redo();
            return;
        }
        if (controlKey && key === '0') {
            event.preventDefault();
            event.stopPropagation();
            fitToScreen();
            return;
        }
        if (controlKey && key === 'r' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.editMode = EDIT_MODE_SELECT;
            session.select.mode = 'rect';
            session.select.lassoing = false;
            session.select.points = [];
            session.select.anchorX = 0;
            session.select.anchorY = 0;
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            session.select.toolLocked = true;
            clearOverlayCanvas();
            logPaintTrace('paint.selection.tool.lock', {
                mode: 'rect',
                reason: 'hotkey.ctrl-r'
            });
            updateHud();
            renderBrushCursor(session.hover?.x ?? 0, session.hover?.y ?? 0);
            updateStageCursor();
            return;
        }
        if (controlKey && event.shiftKey && key === '1') {
            event.preventDefault();
            event.stopPropagation();
            session.view.scale = 1;
            const stageRect = dom.paintStage.getBoundingClientRect();
            session.view.tx = Math.round((stageRect.width - (session.width * session.view.scale)) / 2);
            session.view.ty = Math.round((stageRect.height - (session.height * session.view.scale)) / 2);
            setWrapTransform();
            return;
        }
        if (!controlKey && !event.altKey && key === 'g' && !event.repeat) {
            return;
        }
        if (!controlKey && !event.altKey && key === 'k' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (paintWorkspaceUi?.panelEl && !paintWorkspaceState.createDialogOpen) {
                const switchingModes = paintWorkspaceState.panelMode !== 'animation';
                const nextHidden = switchingModes ? false : !paintWorkspaceState.panelHidden;
                if (nextHidden || switchingModes) {
                    queuePaintUiFocusRelease(active, { selector: 'button, select, input, textarea' });
                }
                paintWorkspaceState.panelMode = 'animation';
                paintWorkspaceState.panelHidden = nextHidden;
                logPaintTrace('hotkey.animationPanel.toggle', {
                    panelMode: paintWorkspaceState.panelMode,
                    panelHidden: paintWorkspaceState.panelHidden,
                    assetId: resolveWorkspaceAsset()?.id || '',
                    filePath: session.filePath || ''
                });
                renderPaintWorkspaceUi();
                return;
            }
            return;
        }
        if (!controlKey && !event.altKey && key === 'u' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (paintWorkspaceUi?.unityPanelEl && !paintWorkspaceState.createDialogOpen) {
                const nextHidden = !paintWorkspaceState.unityPanelHidden;
                if (nextHidden) {
                    queuePaintUiFocusRelease(active, { selector: 'button, select, input, textarea' });
                }
                paintWorkspaceState.unityPanelHidden = nextHidden;
                logPaintTrace('hotkey.unityPanel.toggle', {
                    unityPanelHidden: paintWorkspaceState.unityPanelHidden,
                    assetId: resolveWorkspaceAsset()?.id || '',
                    filePath: session.filePath || ''
                });
                renderPaintWorkspaceUi();
                return;
            }
            return;
        }
        if (!controlKey && !event.altKey && key === 'q' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            session.editMode = EDIT_MODE_SELECT;
            session.select.mode = 'lasso';
            session.select.lassoing = false;
            session.select.points = [];
            session.select.anchorX = 0;
            session.select.anchorY = 0;
            session.select.awaitingContinuation = false;
            session.select.dragMoved = false;
            session.select.trace = null;
            session.select.toolLocked = true;
            clearOverlayCanvas();
            logPaintTrace('paint.selection.tool.lock', {
                mode: 'lasso',
                reason: 'hotkey.q'
            });
            updateHud();
            renderBrushCursor(session.hover?.x ?? 0, session.hover?.y ?? 0);
            updateStageCursor();
            return;
        }
        if (controlKey && !event.altKey && key === 't' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) {
                applyTransformMode();
                return;
            }
            if (session.crop.active) {
                utils.showToast?.('Paint: finish crop before transforming');
                return;
            }
            if (session.selectionEdit?.dirty) {
                utils.showToast?.('Paint: apply/cancel selection edits first');
                return;
            }
            beginTransformMode();
            return;
        }
        if (!controlKey && !event.altKey && key === 'l' && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
                createPaintLayer();
                return;
            }
            if (paintWorkspaceUi?.panelEl && !paintWorkspaceState.createDialogOpen) {
                const switchingModes = paintWorkspaceState.panelMode !== 'logs';
                const nextHidden = switchingModes ? false : !paintWorkspaceState.panelHidden;
                if (switchingModes || nextHidden) {
                    queuePaintUiFocusRelease(active, { selector: 'button, select, input, textarea' });
                }
                if (switchingModes || !nextHidden) {
                    capturePaintHistorySnapshot('logs-open', {
                        render: false
                    });
                }
                paintWorkspaceState.panelMode = 'logs';
                paintWorkspaceState.panelHidden = nextHidden;
                logPaintTrace('hotkey.logsPanel.toggle', {
                    panelMode: paintWorkspaceState.panelMode,
                    panelHidden: paintWorkspaceState.panelHidden,
                    assetId: resolveWorkspaceAsset()?.id || '',
                    filePath: session.filePath || ''
                });
                renderPaintWorkspaceUi();
                return;
            }
            return;
        }
        if (!controlKey && !event.altKey && session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active && (key === ',' || key === '.') && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            const delta = key === '.' ? 0.05 : -0.05;
            session.transform.opacity = clamp01((session.transform.opacity ?? 1) + delta);
            utils.showToast?.(`Opacity ${Math.round(session.transform.opacity * 100)}%`);
            renderStageUi();
            return;
        }
        if (key === '1') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_AIR);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
        if (key === '2') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_INK);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
        if (key === '3') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_PAINT);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
        if (key === '4') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_RECT);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
        if (key === '5') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_BLUR);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
        if (key === '6') {
            event.preventDefault();
            event.stopPropagation();
            leaveSelectionToolForPaint();
            setActiveTool(TOOL_STAMP);
            updateHud();
            persistPaintPreferences();
            updateStageCursor();
            return;
        }
    }

    function handlePaintKeyUp(event) {
        const session = getSession();
        if (!session) {
            return;
        }
        const key = normalizeKey(event);
        const focusState = resolveKeyboardFocusState(document.activeElement);
        if (key === 's') {
            session.sDown = false;
        }
        if (key === 'shift') {
            session.shiftDown = false;
            if (session.editMode === EDIT_MODE_SELECT) {
                renderStageUi();
            }
        }
        if (key === 'control' || key === 'meta') {
            session.ctrlDown = false;
            session.ctrlSpaceHeld = false;
            session.colorPickDrag = false;
            hideColorPickIndicator();
            if (session.spaceKeyHeld) {
                session.spaceDown = true;
            }
            const wasZooming = session.zoomDrag.active;
            endZoomDrag();
            if (wasZooming && session.pointerDown && session.spaceKeyHeld && !session.isDrawing && !session.crop.active) {
                beginPan(session.lastStageX, session.lastStageY);
            }
            updateStageCursor();
            if (session.editMode === EDIT_MODE_SELECT) {
                renderStageUi();
            }
        }
        if (focusState.inContextDialog || focusState.shouldBlockMainHotkeys || focusState.isTextEntryField) {
            if (key === 'n') {
                if (session.blendHoldTimer) {
                    clearTimeout(session.blendHoldTimer);
                    session.blendHoldTimer = null;
                }
                session.blendHoldTriggered = false;
            }
            return;
        }
        if (session.helpHeld && (key === '?' || key === '/' || key === 'shift' || key === 'h')) {
            session.helpHeld = false;
            setHelpVisible(false);
        }
        if (key === ' ') {
            const shouldFit = !!session.spaceTapCandidate && !session.ctrlSpaceHeld && !session.pan.active && !session.zoomDrag.active && !session.pointerDown && !session.isDrawing;
            session.spaceKeyHeld = false;
            session.spaceTapCandidate = false;
            session.spaceDown = false;
            session.ctrlSpaceHeld = false;
            endPan();
            endZoomDrag();
            updateStageCursor();
            if (shouldFit) {
                fitToScreen();
            }
        }
        if (key === 'n') {
            if (session.blendHoldTimer) {
                clearTimeout(session.blendHoldTimer);
                session.blendHoldTimer = null;
            }
            if (!session.blendHoldTriggered) {
                const nextIndex = (Number(session.brushBlendIndex) + 1) % BRUSH_BLEND_MODES.length;
                setBrushBlendMode(BRUSH_BLEND_MODES[nextIndex]);
                persistPaintPreferences();
            }
            session.blendHoldTriggered = false;
        }
    }

    function resetPaintModifierState() {
        const session = getSession();
        if (!session) {
            return;
        }
        session.sDown = false;
        session.shiftDown = false;
        session.ctrlDown = false;
        session.ctrlSpaceHeld = false;
        session.spaceKeyHeld = false;
        session.spaceTapCandidate = false;
        session.spaceDown = false;
        session.helpHeld = false;
        hideColorPickIndicator();
        setHelpVisible(false);
        endPan();
        endZoomDrag();
        updateStageCursor();
        if (session.editMode === EDIT_MODE_SELECT) {
            renderStageUi();
        }
    }


    return {
        handlePaintKeyDown,
        handlePaintKeyUp,
        resetPaintModifierState
    };
};
