'use strict';

// MARK: MODULE
module.exports = function createPaintStampLibraryModule(deps) {
    const {
        dom,
        clamp,
        DEFAULT_BRUSH_SIZE,
        DEFAULT_COLOR,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        STAMP_LIBRARY_STORAGE_KEY,
        getSession,
        persistPaintPreferences,
        updateHud,
        renderCursorCanvas,
        renderStageUi
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

    const BRUSH_SECTION_IDS = {
        [TOOL_AIR]: 'paintBrushSectionAir',
        [TOOL_INK]: 'paintBrushSectionInk',
        [TOOL_PAINT]: 'paintBrushSectionPaint',
        [TOOL_RECT]: 'paintBrushSectionShape',
        [TOOL_BLUR]: 'paintBrushSectionBlur',
        [TOOL_STAMP]: 'paintBrushSectionStamp'
    };

    const BRUSH_PANEL_LABELS = {
        [TOOL_AIR]: 'Air',
        [TOOL_INK]: 'Ink',
        [TOOL_PAINT]: 'Paint',
        [TOOL_RECT]: 'Shape',
        [TOOL_BLUR]: 'Blur',
        [TOOL_STAMP]: 'Stamp'
    };

function supportsBrushPanel(tool = session?.tool) {
    return !!BRUSH_SECTION_IDS[String(tool || '').trim()];
}

function defaultStampSettings() {
    return {
        editorVisible: false,
        sourceMode: 'alpha-mask',
        tipShape: 'custom',
        commitOnRelease: true,
        varSize: 0,
        varSizeX: 0,
        varSizeY: 0,
        varRot: 0,
        varColor: 0,
        varHue: 0,
        varVal: 0,
        varSat: 0,
        scatter: 0,
        varAlpha: 0,
        flipX: false,
        flipY: false,
        followRotation: true
    };
}

function syncStampPanelValueLabels(settings) {
    if (!settings) {
        return;
    }
    const brushProfiles = session?.brushProfiles || {};
    const air = brushProfiles[TOOL_AIR] || {};
    const paint = brushProfiles[TOOL_PAINT] || {};
    const shape = brushProfiles[TOOL_RECT] || {};
    const blur = brushProfiles[TOOL_BLUR] || {};
    if (dom.paintAirHardnessValue) {
        dom.paintAirHardnessValue.textContent = `${Math.round((Number(air.hardness) || 0) * 100)}%`;
    }
    if (dom.paintAirFlowValue) {
        dom.paintAirFlowValue.textContent = `${Math.round((Number(air.flow) || 1) * 100)}%`;
    }
    if (dom.paintPaintHardnessValue) {
        dom.paintPaintHardnessValue.textContent = `${Math.round((Number(paint.hardness) || 0) * 100)}%`;
    }
    if (dom.paintPaintFlowValue) {
        dom.paintPaintFlowValue.textContent = `${Math.round((Number(paint.flow) || 1) * 100)}%`;
    }
    if (dom.paintShapeBorderWidthValue) {
        dom.paintShapeBorderWidthValue.textContent = `${Math.round(Number(shape.borderWidth) || 0)} px`;
    }
    if (dom.paintShapeCornerRadiusValue) {
        dom.paintShapeCornerRadiusValue.textContent = `${Math.round(Number(shape.cornerRadius) || 0)} px`;
    }
    if (dom.paintBlurRadiusValue) {
        dom.paintBlurRadiusValue.textContent = `${Math.round(Number(blur.blurRadius) || 0)} px`;
    }
    if (dom.paintBlurStrengthValue) {
        dom.paintBlurStrengthValue.textContent = `${Math.round((Number(blur.blurStrength) || 0) * 100)}%`;
    }
    if (dom.paintStampVarSizeValue) {
        dom.paintStampVarSizeValue.textContent = `${Math.round(Number(settings.varSize) || 0)}%`;
    }
    if (dom.paintStampVarSizeXValue) {
        dom.paintStampVarSizeXValue.textContent = `${Math.round(Number(settings.varSizeX) || 0)}%`;
    }
    if (dom.paintStampVarSizeYValue) {
        dom.paintStampVarSizeYValue.textContent = `${Math.round(Number(settings.varSizeY) || 0)}%`;
    }
    if (dom.paintStampVarRotValue) {
        dom.paintStampVarRotValue.textContent = `${Math.round(Number(settings.varRot) || 0)}°`;
    }
    if (dom.paintStampVarColorValue) {
        dom.paintStampVarColorValue.textContent = `${Math.round(Number(settings.varColor) || 0)}%`;
    }
    if (dom.paintStampVarHueValue) {
        dom.paintStampVarHueValue.textContent = `${Math.round(Number(settings.varHue) || 0)}°`;
    }
    if (dom.paintStampVarValValue) {
        dom.paintStampVarValValue.textContent = `${Math.round(Number(settings.varVal) || 0)}%`;
    }
    if (dom.paintStampVarSatValue) {
        dom.paintStampVarSatValue.textContent = `${Math.round(Number(settings.varSat) || 0)}%`;
    }
    if (dom.paintStampScatterValue) {
        dom.paintStampScatterValue.textContent = `${Math.round(Number(settings.scatter) || 0)}%`;
    }
    if (dom.paintStampVarAlphaValue) {
        dom.paintStampVarAlphaValue.textContent = `${Math.round(Number(settings.varAlpha) || 0)}%`;
    }
}

function syncBrushPanelSectionVisibility() {
    const activeTool = supportsBrushPanel(session.tool) ? session.tool : '';
    for (const [tool, id] of Object.entries(BRUSH_SECTION_IDS)) {
        if (!dom[id]) {
            continue;
        }
        const visible = activeTool === tool;
        dom[id].hidden = !visible;
        dom[id].style.display = visible ? 'flex' : 'none';
    }
}

function positionStampPanel() {
    if (!dom.paintStampPanel || dom.paintStampPanel.hidden) {
        return;
    }
    const anchor = dom.paintHudTool || dom.paintCanvasWrap;
    if (!anchor) {
        return;
    }
    const rect = anchor.getBoundingClientRect();
    const panelWidth = Math.max(300, dom.paintStampPanel.offsetWidth || 360);
    const left = Math.max(16, Math.min((rect.left + (rect.width * 0.5)) - (panelWidth * 0.5), window.innerWidth - panelWidth - 16));
    const top = Math.max(16, rect.top - 16 - Math.min(window.innerHeight * 0.7, dom.paintStampPanel.offsetHeight || 0));
    dom.paintStampPanel.style.left = `${Math.round(left)}px`;
    dom.paintStampPanel.style.top = `${Math.round(top)}px`;
}

function syncBrushPanelHeader() {
    const label = BRUSH_PANEL_LABELS[session.tool] || 'Brush';
    if (dom.paintBrushPanelTitle) {
        dom.paintBrushPanelTitle.textContent = `${label} Brush`;
    }
    if (dom.paintBrushPanelSubtitle) {
        if (session.tool === TOOL_STAMP) {
            dom.paintBrushPanelSubtitle.textContent = 'Stamp source, mask mode, and jitter';
        } else if (session.tool === TOOL_BLUR) {
            dom.paintBrushPanelSubtitle.textContent = 'Brush size controls the domain. Radius controls the blur.';
        } else if (session.tool === TOOL_RECT) {
            dom.paintBrushPanelSubtitle.textContent = 'Shape primitive, fill mode, and edge width';
        } else {
            dom.paintBrushPanelSubtitle.textContent = `${label} brush settings`;
        }
    }
    if (dom.paintStampToggleEditor) {
        dom.paintStampToggleEditor.hidden = session.tool !== TOOL_STAMP;
    }
}

function getBrushProfile(tool = session?.tool) {
    if (!session?.brushProfiles || !tool) {
        return null;
    }
    const profile = session.brushProfiles[tool];
    return profile && typeof profile === 'object' ? profile : null;
}

function syncSessionStrokeModeFromProfile(tool = session?.tool) {
    if (!session || !tool || (tool !== TOOL_AIR && tool !== TOOL_INK && tool !== TOOL_PAINT && tool !== TOOL_RECT)) {
        return;
    }
    const profile = getBrushProfile(tool);
    const fillMode = profile?.fillMode === 'border' ? 'border' : 'fill';
    session.strokeMode = fillMode;
    if (session.strokeModeByTool) {
        session.strokeModeByTool[tool] = fillMode;
    }
}

function syncSessionStampSettingsFromProfile() {
    if (!session) {
        return;
    }
    const profile = getBrushProfile(TOOL_STAMP);
    if (!profile) {
        return;
    }
    if (!session.stampSettings || typeof session.stampSettings !== 'object') {
        session.stampSettings = defaultStampSettings();
    }
    session.stampSettings.sourceMode = profile.sourceMode === 'preserve-color' ? 'preserve-color' : 'alpha-mask';
    session.stampSettings.tipShape = String(profile.tipShape || 'custom');
    session.stampSettings.commitOnRelease = profile.commitOnRelease !== false;
    session.stampSettings.varSize = clamp(Math.round(Number(profile.varSize) || 0), 0, 100);
    session.stampSettings.varSizeX = clamp(Math.round(Number(profile.varSizeX) || 0), 0, 100);
    session.stampSettings.varSizeY = clamp(Math.round(Number(profile.varSizeY) || 0), 0, 100);
    session.stampSettings.varRot = clamp(Math.round(Number(profile.varRot) || 0), 0, 180);
    session.stampSettings.varColor = clamp(Math.round(Number(profile.varColor) || 0), 0, 100);
    session.stampSettings.varHue = clamp(Math.round(Number(profile.varHue) || 0), 0, 180);
    session.stampSettings.varVal = clamp(Math.round(Number(profile.varVal) || 0), 0, 100);
    session.stampSettings.varSat = clamp(Math.round(Number(profile.varSat) || 0), 0, 100);
    session.stampSettings.scatter = clamp(Math.round(Number(profile.scatter) || 0), 0, 100);
    session.stampSettings.varAlpha = clamp(Math.round(Number(profile.varAlpha) || 0), 0, 100);
    session.stampSettings.flipX = profile.flipX === true;
    session.stampSettings.flipY = profile.flipY === true;
    session.stampSettings.followRotation = profile.followRotation !== false;
}

function collectBrushPanelStateFromDom() {
    if (!session?.brushProfiles) {
        return;
    }
    const air = getBrushProfile(TOOL_AIR);
    const ink = getBrushProfile(TOOL_INK);
    const paint = getBrushProfile(TOOL_PAINT);
    const shape = getBrushProfile(TOOL_RECT);
    const blur = getBrushProfile(TOOL_BLUR);
    const stamp = getBrushProfile(TOOL_STAMP);
    if (air) {
        if (dom.paintAirFillMode) {
            air.fillMode = dom.paintAirFillMode.value === 'border' ? 'border' : 'fill';
        }
        if (dom.paintAirHardness) {
            air.hardness = clamp((Number(dom.paintAirHardness.value) || 0) / 100, 0, 1);
        }
        if (dom.paintAirFlow) {
            air.flow = clamp((Number(dom.paintAirFlow.value) || 100) / 100, 0.01, 1);
        }
    }
    if (ink) {
        if (dom.paintInkFillMode) {
            ink.fillMode = dom.paintInkFillMode.value === 'border' ? 'border' : 'fill';
        }
        if (dom.paintInkShape) {
            ink.tipShape = String(dom.paintInkShape.value || 'circle');
        }
    }
    if (paint) {
        if (dom.paintPaintFillMode) {
            paint.fillMode = dom.paintPaintFillMode.value === 'border' ? 'border' : 'fill';
        }
        if (dom.paintPaintTipShape) {
            paint.tipShape = String(dom.paintPaintTipShape.value || 'texture');
        }
        if (dom.paintPaintHardness) {
            paint.hardness = clamp((Number(dom.paintPaintHardness.value) || 0) / 100, 0, 1);
        }
        if (dom.paintPaintFlow) {
            paint.flow = clamp((Number(dom.paintPaintFlow.value) || 100) / 100, 0.01, 1);
        }
        if (dom.paintPaintTiltStretch) {
            paint.tiltStretch = dom.paintPaintTiltStretch.checked;
        }
    }
    if (shape) {
        if (dom.paintShapePrimitive) {
            shape.primitive = String(dom.paintShapePrimitive.value || 'rect');
        }
        if (dom.paintShapeFillMode) {
            shape.fillMode = dom.paintShapeFillMode.value === 'border' ? 'border' : 'fill';
        }
        if (dom.paintShapeBorderWidth) {
            shape.borderWidth = clamp(Math.round(Number(dom.paintShapeBorderWidth.value) || 6), 1, 240);
        }
        if (dom.paintShapeCornerRadius) {
            shape.cornerRadius = clamp(Math.round(Number(dom.paintShapeCornerRadius.value) || 0), 0, 128);
        }
        if (session.tool === TOOL_RECT) {
            session.borderSize = shape.borderWidth;
        }
    }
    if (blur) {
        if (dom.paintBlurRadius) {
            blur.blurRadius = clamp(Math.round(Number(dom.paintBlurRadius.value) || 10), 1, 120);
        }
        if (dom.paintBlurStrength) {
            blur.blurStrength = clamp((Number(dom.paintBlurStrength.value) || 70) / 100, 0.01, 1);
        }
    }
    if (stamp) {
        if (dom.paintStampSourceMode) {
            stamp.sourceMode = dom.paintStampSourceMode.value === 'preserve-color' ? 'preserve-color' : 'alpha-mask';
        }
        if (dom.paintStampTipShape) {
            stamp.tipShape = String(dom.paintStampTipShape.value || 'custom');
        }
        if (dom.paintStampCommitOnRelease) {
            stamp.commitOnRelease = dom.paintStampCommitOnRelease.checked;
        }
        if (dom.paintStampVarSize) {
            stamp.varSize = clamp(Math.round(Number(dom.paintStampVarSize.value) || 0), 0, 100);
        }
        if (dom.paintStampVarSizeX) {
            stamp.varSizeX = clamp(Math.round(Number(dom.paintStampVarSizeX.value) || 0), 0, 100);
        }
        if (dom.paintStampVarSizeY) {
            stamp.varSizeY = clamp(Math.round(Number(dom.paintStampVarSizeY.value) || 0), 0, 100);
        }
        if (dom.paintStampVarRot) {
            stamp.varRot = clamp(Math.round(Number(dom.paintStampVarRot.value) || 0), 0, 180);
        }
        if (dom.paintStampVarColor) {
            stamp.varColor = clamp(Math.round(Number(dom.paintStampVarColor.value) || 0), 0, 100);
        }
        if (dom.paintStampVarHue) {
            stamp.varHue = clamp(Math.round(Number(dom.paintStampVarHue.value) || 0), 0, 180);
        }
        if (dom.paintStampVarVal) {
            stamp.varVal = clamp(Math.round(Number(dom.paintStampVarVal.value) || 0), 0, 100);
        }
        if (dom.paintStampVarSat) {
            stamp.varSat = clamp(Math.round(Number(dom.paintStampVarSat.value) || 0), 0, 100);
        }
        if (dom.paintStampScatter) {
            stamp.scatter = clamp(Math.round(Number(dom.paintStampScatter.value) || 0), 0, 100);
        }
        if (dom.paintStampVarAlpha) {
            stamp.varAlpha = clamp(Math.round(Number(dom.paintStampVarAlpha.value) || 0), 0, 100);
        }
        if (dom.paintStampFollowRot) {
            stamp.followRotation = dom.paintStampFollowRot.checked;
        }
        if (dom.paintStampFlipX) {
            stamp.flipX = dom.paintStampFlipX.checked;
        }
        if (dom.paintStampFlipY) {
            stamp.flipY = dom.paintStampFlipY.checked;
        }
    }
    syncSessionStrokeModeFromProfile(session.tool);
    syncSessionStampSettingsFromProfile();
}

function refreshBrushPanel(options = {}) {
    if (!session) {
        return;
    }
    syncSessionStampSettingsFromProfile();
    syncStampPanelControls(session.stampSettings || defaultStampSettings());
    if (options.syncHud !== false) {
        updateHud?.();
    }
    if (options.renderCursor !== false) {
        renderCursorCanvas?.();
    }
    if (options.renderStage !== false) {
        renderStageUi?.();
    }
}

function syncStampPanelControls(settings) {
    if (!settings) {
        return;
    }
    const brushProfiles = session?.brushProfiles || {};
    const air = brushProfiles[TOOL_AIR] || {};
    const ink = brushProfiles[TOOL_INK] || {};
    const paint = brushProfiles[TOOL_PAINT] || {};
    const shape = brushProfiles[TOOL_RECT] || {};
    const blur = brushProfiles[TOOL_BLUR] || {};
    syncBrushPanelSectionVisibility();
    syncBrushPanelHeader();
    if (dom.paintAirFillMode) {
        dom.paintAirFillMode.value = air.fillMode === 'border' ? 'border' : 'fill';
    }
    if (dom.paintAirHardness) {
        dom.paintAirHardness.value = String(clamp(Math.round((Number(air.hardness) || 0) * 100), 0, 100));
    }
    if (dom.paintAirFlow) {
        dom.paintAirFlow.value = String(clamp(Math.round((Number(air.flow) || 1) * 100), 1, 100));
    }
    if (dom.paintInkFillMode) {
        dom.paintInkFillMode.value = ink.fillMode === 'border' ? 'border' : 'fill';
    }
    if (dom.paintInkShape) {
        dom.paintInkShape.value = String(ink.tipShape || 'circle');
    }
    if (dom.paintPaintFillMode) {
        dom.paintPaintFillMode.value = paint.fillMode === 'border' ? 'border' : 'fill';
    }
    if (dom.paintPaintTipShape) {
        dom.paintPaintTipShape.value = String(paint.tipShape || 'texture');
    }
    if (dom.paintPaintHardness) {
        dom.paintPaintHardness.value = String(clamp(Math.round((Number(paint.hardness) || 0) * 100), 0, 100));
    }
    if (dom.paintPaintFlow) {
        dom.paintPaintFlow.value = String(clamp(Math.round((Number(paint.flow) || 1) * 100), 1, 100));
    }
    if (dom.paintPaintTiltStretch) {
        dom.paintPaintTiltStretch.checked = paint.tiltStretch !== false;
    }
    if (dom.paintShapePrimitive) {
        dom.paintShapePrimitive.value = String(shape.primitive || 'rect');
    }
    if (dom.paintShapeFillMode) {
        dom.paintShapeFillMode.value = shape.fillMode === 'border' ? 'border' : 'fill';
    }
    if (dom.paintShapeBorderWidth) {
        dom.paintShapeBorderWidth.value = String(clamp(Math.round(Number(shape.borderWidth) || 6), 1, 240));
    }
    if (dom.paintShapeCornerRadius) {
        dom.paintShapeCornerRadius.value = String(clamp(Math.round(Number(shape.cornerRadius) || 0), 0, 128));
    }
    if (dom.paintBlurRadius) {
        dom.paintBlurRadius.value = String(clamp(Math.round(Number(blur.blurRadius) || 10), 1, 120));
    }
    if (dom.paintBlurStrength) {
        dom.paintBlurStrength.value = String(clamp(Math.round((Number(blur.blurStrength) || 0.7) * 100), 1, 100));
    }
    if (dom.paintStampSourceMode) {
        dom.paintStampSourceMode.value = settings.sourceMode === 'preserve-color' ? 'preserve-color' : 'alpha-mask';
    }
    if (dom.paintStampTipShape) {
        dom.paintStampTipShape.value = String(settings.tipShape || 'custom');
    }
    if (dom.paintStampCommitOnRelease) {
        dom.paintStampCommitOnRelease.checked = settings.commitOnRelease !== false;
    }
    if (dom.paintStampVarSize) {
        dom.paintStampVarSize.value = String(clamp(Math.round(Number(settings.varSize) || 0), 0, 100));
    }
    if (dom.paintStampVarSizeX) {
        dom.paintStampVarSizeX.value = String(clamp(Math.round(Number(settings.varSizeX) || 0), 0, 100));
    }
    if (dom.paintStampVarSizeY) {
        dom.paintStampVarSizeY.value = String(clamp(Math.round(Number(settings.varSizeY) || 0), 0, 100));
    }
    if (dom.paintStampVarRot) {
        dom.paintStampVarRot.value = String(clamp(Math.round(Number(settings.varRot) || 0), 0, 180));
    }
    if (dom.paintStampVarColor) {
        dom.paintStampVarColor.value = String(clamp(Math.round(Number(settings.varColor) || 0), 0, 100));
    }
    if (dom.paintStampVarHue) {
        dom.paintStampVarHue.value = String(clamp(Math.round(Number(settings.varHue) || 0), 0, 180));
    }
    if (dom.paintStampVarVal) {
        dom.paintStampVarVal.value = String(clamp(Math.round(Number(settings.varVal) || 0), 0, 100));
    }
    if (dom.paintStampVarSat) {
        dom.paintStampVarSat.value = String(clamp(Math.round(Number(settings.varSat) || 0), 0, 100));
    }
    if (dom.paintStampScatter) {
        dom.paintStampScatter.value = String(clamp(Math.round(Number(settings.scatter) || 0), 0, 100));
    }
    if (dom.paintStampVarAlpha) {
        dom.paintStampVarAlpha.value = String(clamp(Math.round(Number(settings.varAlpha) || 0), 0, 100));
    }
    if (dom.paintStampFollowRot) {
        dom.paintStampFollowRot.checked = settings.followRotation !== false;
    }
    if (dom.paintStampFlipX) {
        dom.paintStampFlipX.checked = !!settings.flipX;
    }
    if (dom.paintStampFlipY) {
        dom.paintStampFlipY.checked = !!settings.flipY;
    }
    syncStampPanelValueLabels(settings);
    positionStampPanel();
}

function collectStampSettingsFromDom(current) {
    const next = { ...(current || defaultStampSettings()) };
    if (dom.paintStampSourceMode) {
        next.sourceMode = dom.paintStampSourceMode.value === 'preserve-color' ? 'preserve-color' : 'alpha-mask';
    }
    if (dom.paintStampTipShape) {
        next.tipShape = String(dom.paintStampTipShape.value || 'custom');
    }
    if (dom.paintStampCommitOnRelease) {
        next.commitOnRelease = dom.paintStampCommitOnRelease.checked;
    }
    if (dom.paintStampVarSize) {
        next.varSize = clamp(Math.round(Number(dom.paintStampVarSize.value) || 0), 0, 100);
    }
    if (dom.paintStampVarSizeX) {
        next.varSizeX = clamp(Math.round(Number(dom.paintStampVarSizeX.value) || 0), 0, 100);
    }
    if (dom.paintStampVarSizeY) {
        next.varSizeY = clamp(Math.round(Number(dom.paintStampVarSizeY.value) || 0), 0, 100);
    }
    if (dom.paintStampVarRot) {
        next.varRot = clamp(Math.round(Number(dom.paintStampVarRot.value) || 0), 0, 180);
    }
    if (dom.paintStampVarColor) {
        next.varColor = clamp(Math.round(Number(dom.paintStampVarColor.value) || 0), 0, 100);
    }
    if (dom.paintStampVarHue) {
        next.varHue = clamp(Math.round(Number(dom.paintStampVarHue.value) || 0), 0, 180);
    }
    if (dom.paintStampVarVal) {
        next.varVal = clamp(Math.round(Number(dom.paintStampVarVal.value) || 0), 0, 100);
    }
    if (dom.paintStampVarSat) {
        next.varSat = clamp(Math.round(Number(dom.paintStampVarSat.value) || 0), 0, 100);
    }
    if (dom.paintStampScatter) {
        next.scatter = clamp(Math.round(Number(dom.paintStampScatter.value) || 0), 0, 100);
    }
    if (dom.paintStampVarAlpha) {
        next.varAlpha = clamp(Math.round(Number(dom.paintStampVarAlpha.value) || 0), 0, 100);
    }
    if (dom.paintStampFollowRot) {
        next.followRotation = dom.paintStampFollowRot.checked;
    }
    if (dom.paintStampFlipX) {
        next.flipX = dom.paintStampFlipX.checked;
    }
    if (dom.paintStampFlipY) {
        next.flipY = dom.paintStampFlipY.checked;
    }
    return next;
}

function isStampPanelOpen() {
    return !!(session?.stampPanelOpen);
}

function setStampPanelVisible(visible) {
    if (!dom.paintStampPanel) {
        return;
    }
    const nextVisible = !!visible && supportsBrushPanel(session?.tool);
    session.stampPanelOpen = nextVisible;
    if (session.tool !== TOOL_STAMP) {
        setStampEditorVisible(false);
    }
    if (nextVisible) {
        refreshBrushPanel({ syncHud: false, renderStage: false });
        dom.paintStampPanel.hidden = false;
        requestAnimationFrame(() => {
            positionStampPanel();
            dom.paintStampPanel.classList.add('is-open');
        });
        return;
    }
    dom.paintStampPanel.classList.remove('is-open');
    window.setTimeout(() => {
        if (dom.paintStampPanel && !dom.paintStampPanel.classList.contains('is-open')) {
            dom.paintStampPanel.hidden = true;
        }
    }, 190);
}

function isStampEditorVisible() {
    return !!(dom.paintStampInline && !dom.paintStampInline.hidden);
}

function positionStampEditorInline() {
    if (!dom.paintStampInline || !dom.paintCanvasWrap || !dom.paintStage) {
        return;
    }
    if (dom.paintStampInline.hidden) {
        return;
    }
    const wrapRect = dom.paintCanvasWrap.getBoundingClientRect();
    const gap = 14;
    const cardWidth = 304;
    const cardHeight = 12 + 30 + 10 + 256 + 10 + 34 + 12;

    let left = wrapRect.right + gap;
    if (left + cardWidth > window.innerWidth - 12) {
        left = Math.max(12, wrapRect.right - cardWidth - gap);
    }
    const reservedTop = 72;
    const reservedBottom = 84;
    let top = wrapRect.top + ((wrapRect.height - cardHeight) / 2);
    top = Math.max(reservedTop, Math.min(top, window.innerHeight - cardHeight - reservedBottom));
    dom.paintStampInline.style.left = `${Math.round(left)}px`;
    dom.paintStampInline.style.top = `${Math.round(top)}px`;
}

function setStampEditorVisible(visible, options = {}) {
    if (!dom.paintStampInline) {
        return;
    }
    const next = !!visible;
    dom.paintStampInline.hidden = !next;
    if (session?.stampSettings) {
        session.stampSettings.editorVisible = next;
    }
    if (next) {
        positionStampEditorInline();
    }
    if (options.persist) {
        persistPaintPreferences();
    }
}

function readStampLibrary() {
    try {
        const raw = window.localStorage.getItem(STAMP_LIBRARY_STORAGE_KEY);
        if (!raw) {
            return { entries: [] };
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return { entries: [] };
        }
        const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
        const cleaned = [];
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') {
                continue;
            }
            const id = String(entry.id || '');
            const dataUrl = String(entry.dataUrl || '');
            if (!id || !dataUrl.startsWith('data:image/')) {
                continue;
            }
            cleaned.push({
                id,
                dataUrl,
                sourceMode: entry.sourceMode === 'alpha-mask' ? 'alpha-mask' : 'preserve-color',
                favorite: !!entry.favorite,
                lastUsed: Number.isFinite(Number(entry.lastUsed)) ? Number(entry.lastUsed) : 0
            });
            if (cleaned.length >= 120) {
                break;
            }
        }
        return { entries: cleaned };
    } catch {
        return { entries: [] };
    }
}

function writeStampLibrary(library) {
    try {
        window.localStorage.setItem(STAMP_LIBRARY_STORAGE_KEY, JSON.stringify(library || { entries: [] }));
    } catch {}
}

function hashStampImageData(imageData) {
    if (!imageData || !imageData.data) {
        return '';
    }
    const data = imageData.data;
    let hash = 2166136261;
    let alphaSum = 0;
    const stride = 64;
    for (let i = 0; i < data.length; i += 4 * stride) {
        hash ^= data[i];
        hash = Math.imul(hash, 16777619);
        hash ^= data[i + 1];
        hash = Math.imul(hash, 16777619);
        hash ^= data[i + 2];
        hash = Math.imul(hash, 16777619);
        const a = data[i + 3];
        alphaSum += a;
        hash ^= a;
        hash = Math.imul(hash, 16777619);
    }
    if (alphaSum <= 8) {
        return '';
    }
    return `st_${(hash >>> 0).toString(16)}`;
}

function captureStampEntryFromEditor() {
    if (!session?.stamp?.editorCanvas || !session.stamp.editorCtx) {
        return null;
    }
    const canvas = session.stamp.editorCanvas;
    let imageData = null;
    try {
        imageData = session.stamp.editorCtx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
        return null;
    }
    const id = hashStampImageData(imageData);
    if (!id) {
        return null;
    }
    let dataUrl = '';
    try {
        dataUrl = canvas.toDataURL('image/png');
    } catch {
        return null;
    }
    return {
        id,
        dataUrl,
        sourceMode: session?.stampSettings?.sourceMode === 'preserve-color' ? 'preserve-color' : 'alpha-mask',
        favorite: false,
        lastUsed: Date.now()
    };
}

async function loadStampEntryIntoEditor(entry) {
    if (!session?.stamp?.editorCanvas || !session.stamp.editorCtx || !entry) {
        return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = entry.dataUrl;
    try {
        await img.decode();
    } catch {}
    session.stamp.editorCtx.save();
    session.stamp.editorCtx.setTransform(1, 0, 0, 1, 0, 0);
    session.stamp.editorCtx.clearRect(0, 0, session.stamp.editorCanvas.width, session.stamp.editorCanvas.height);
    session.stamp.editorCtx.drawImage(img, 0, 0, session.stamp.editorCanvas.width, session.stamp.editorCanvas.height);
    session.stamp.editorCtx.restore();
    if (session.stampSettings) {
        session.stampSettings.sourceMode = entry.sourceMode === 'alpha-mask' ? 'alpha-mask' : 'preserve-color';
        session.stampSettings.tipShape = 'custom';
    }
    const profile = getBrushProfile(TOOL_STAMP);
    if (profile) {
        profile.sourceMode = session.stampSettings?.sourceMode || 'alpha-mask';
        profile.tipShape = 'custom';
    }
    refreshBrushPanel({ renderStage: false });
}

function renderStampLibrary() {
    if (!session?.stamp?.library) {
        return;
    }
    const entries = Array.isArray(session.stamp.library.entries) ? session.stamp.library.entries : [];
    const sorted = entries.slice().sort((a, b) => (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0));
    const favorites = sorted.filter((e) => e.favorite);
    const recents = sorted.filter((e) => !e.favorite);

    const renderInto = (container, list) => {
        if (!container) {
            return;
        }
        container.innerHTML = '';
        for (const entry of list) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'paint-stamp-thumb';
            btn.setAttribute('data-stamp-id', entry.id);
            const img = document.createElement('img');
            img.alt = 'stamp';
            img.src = entry.dataUrl;
            btn.appendChild(img);
            container.appendChild(btn);
        }
    };

    renderInto(dom.paintStampFavorites, favorites);
    renderInto(dom.paintStampRecents, recents);
}

function stampEditorHasVisiblePixels() {
    if (!session?.stamp?.editorCtx || !session.stamp.editorCanvas) {
        return false;
    }
    try {
        const imageData = session.stamp.editorCtx.getImageData(0, 0, session.stamp.editorCanvas.width, session.stamp.editorCanvas.height);
        const data = imageData.data;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] > 8) {
                return true;
            }
        }
    } catch {}
    return false;
}

function drawDefaultStampEditorShape() {
    if (!session?.stamp?.editorCtx || !session.stamp.editorCanvas) {
        return;
    }
    const ctx = session.stamp.editorCtx;
    const canvas = session.stamp.editorCanvas;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.3;
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.16, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.58, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function touchStampEntry(entry) {
    if (!session?.stamp?.library || !entry) {
        return;
    }
    const entries = Array.isArray(session.stamp.library.entries) ? session.stamp.library.entries : [];
    const idx = entries.findIndex((e) => e && e.id === entry.id);
    const favorite = idx >= 0 ? !!entries[idx].favorite : !!entry.favorite;
    const next = {
        id: entry.id,
        dataUrl: entry.dataUrl,
        sourceMode: entry.sourceMode === 'alpha-mask' ? 'alpha-mask' : 'preserve-color',
        favorite,
        lastUsed: Date.now()
    };
    if (idx >= 0) {
        entries.splice(idx, 1);
    }
    entries.unshift(next);
    while (entries.length > 120) {
        entries.pop();
    }
    session.stamp.library.entries = entries;
    writeStampLibrary(session.stamp.library);
    renderStampLibrary();
}

function toggleStampFavorite(stampId) {
    if (!session?.stamp?.library || !stampId) {
        return;
    }
    const entries = session.stamp.library.entries || [];
    const entry = entries.find((e) => e && e.id === stampId);
    if (!entry) {
        return;
    }
    entry.favorite = !entry.favorite;
    writeStampLibrary(session.stamp.library);
    renderStampLibrary();
}

function initializeStampSupport(paintPrefs) {
    if (!session) {
        return;
    }
    const saved = paintPrefs?.stampSettings && typeof paintPrefs.stampSettings === 'object' ? paintPrefs.stampSettings : null;
    session.stampSettings = { ...defaultStampSettings(), ...(saved || {}) };
    syncSessionStampSettingsFromProfile();
    syncStampPanelControls(session.stampSettings);
    setStampEditorVisible(!!session.stampSettings.editorVisible);

    if (!dom.paintStampEditCanvas) {
        session.stamp = null;
        return;
    }
    const canvas = dom.paintStampEditCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        session.stamp = null;
        return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    session.stamp = {
        editorCanvas: canvas,
        editorCtx: ctx,
        editor: { drawing: false, pointerId: null, lastX: 0, lastY: 0 },
        editorStroke: null,
        library: readStampLibrary()
    };
    if (!stampEditorHasVisiblePixels()) {
        const favorite = session.stamp.library.entries?.find((entry) => entry?.favorite) || session.stamp.library.entries?.[0] || null;
        if (favorite) {
            loadStampEntryIntoEditor(favorite).catch(() => drawDefaultStampEditorShape());
        } else {
            drawDefaultStampEditorShape();
        }
    }
    renderStampLibrary();
    setStampPanelVisible(!!session.stampPanelOpen);
}

function resolveStampEditorBrushRadius() {
    const size = Number(session?.size) || DEFAULT_BRUSH_SIZE;
    return clamp(Math.round(size / 3), 1, 50);
}

function snapshotStampEditorStrokeSource() {
    if (!session?.stamp?.editorCanvas) {
        return null;
    }
    const source = document.createElement('canvas');
    source.width = session.stamp.editorCanvas.width;
    source.height = session.stamp.editorCanvas.height;
    const ctx = source.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    ctx.clearRect(0, 0, source.width, source.height);
    ctx.drawImage(session.stamp.editorCanvas, 0, 0);
    return source;
}

function drawStampEditorStampDot(x, y, sourceCanvas) {
    if (!session?.stamp?.editorCtx || !session.stamp.editorCanvas || !sourceCanvas) {
        return;
    }
    const ctx = session.stamp.editorCtx;
    const radius = resolveStampEditorBrushRadius();
    const width = sourceCanvas.width || 1;
    const height = sourceCanvas.height || 1;
    const baseScale = (radius * 2) / Math.max(1, Math.max(width, height));
    ctx.save();
    ctx.globalCompositeOperation = session.eraserMode ? 'destination-out' : 'source-over';
    ctx.globalAlpha = 1;
    ctx.translate(x, y);
    ctx.scale(baseScale, baseScale);
    ctx.drawImage(sourceCanvas, -(width / 2), -(height / 2));
    ctx.restore();
}

function stampEditorDrawDot(x, y) {
    if (!session?.stamp?.editorCtx || !session.stamp.editorCanvas) {
        return;
    }
    if (session.tool === TOOL_STAMP && session.stamp?.editorStroke?.sourceCanvas) {
        drawStampEditorStampDot(x, y, session.stamp.editorStroke.sourceCanvas);
        return;
    }
    const ctx = session.stamp.editorCtx;
    const radius = resolveStampEditorBrushRadius();
    ctx.save();
    ctx.globalCompositeOperation = session.eraserMode ? 'destination-out' : 'source-over';
    ctx.fillStyle = session.color || DEFAULT_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function stampEditorDrawLine(x0, y0, x1, y1) {
    if (!session?.stamp?.editorCtx) {
        return;
    }
    const ctx = session.stamp.editorCtx;
    const radius = resolveStampEditorBrushRadius();
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(0.8, radius * 0.55);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= steps; i += 1) {
        const t = steps <= 0 ? 1 : (i / steps);
        const x = x0 + (dx * t);
        const y = y0 + (dy * t);
        stampEditorDrawDot(x, y);
    }
}

    return {
        defaultStampSettings,
        syncStampPanelValueLabels,
        syncStampPanelControls,
        collectStampSettingsFromDom,
        collectBrushPanelStateFromDom,
        refreshBrushPanel,
        isStampPanelOpen,
        setStampPanelVisible,
        isStampEditorVisible,
        positionStampPanel,
        positionStampEditorInline,
        setStampEditorVisible,
        writeStampLibrary,
        captureStampEntryFromEditor,
        loadStampEntryIntoEditor,
        renderStampLibrary,
        touchStampEntry,
        toggleStampFavorite,
        initializeStampSupport,
        snapshotStampEditorStrokeSource,
        stampEditorDrawDot,
        stampEditorDrawLine
    };
};
