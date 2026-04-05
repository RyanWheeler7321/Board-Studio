'use strict';

// MARK: MODULE
module.exports = function createPaintTimelinePersistenceModule(deps) {
    const {
        env,
        projectStore,
        paintWorkspaceState,
        LAYER_BASE_NAME,
        MAX_CANVAS_DIMENSION,
        getSession,
        clamp,
        logPaintTrace,
        escapeWorkspaceText,
        renderWorkspaceSelectOptions,
        frameListForPaint,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        normalizeLayerThumbnailTone,
        cloneCanvasSurface,
        captureCurrentAnimationFrameState,
        resolveWorkspaceAsset,
        resolveSessionAnimationContext,
        getActiveLayer,
        destroyDynamicPaintLayerCanvases,
        createDynamicPaintLayerCanvas,
        createLayerRecord,
        nextLayerId,
        syncPaintLayerCanvasOrder,
        setActiveLayerRefs,
        renderLayerBar,
        updateHud,
        renderStageUi,
        renderCursorCanvas,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        loadImageForPath,
        exportCanvasToPngBuffer
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

function clampPlaybackFps(value, fallback = 12) {
    return clamp(Math.round(Number(value) || Number(fallback) || 12), 1, 60);
}

function clampFrameHoldValue(value, fallback = 1) {
    return clamp(Math.round(Number(value) || Number(fallback) || 1), 1, 24);
}

function defaultUnitySheetBindingConfig() {
    return {
        enabled: false,
        targetPath: '',
        columns: 4,
        rows: 4,
        frameWidth: 0,
        frameHeight: 0,
        downscale: 1
    };
}

function defaultAnimationUnityBindingConfig() {
    return {
        useProjectBinding: true,
        enabled: false,
        targetPath: '',
        columns: 0,
        rows: 0,
        frameWidth: 0,
        frameHeight: 0,
        downscale: 1
    };
}

function normalizeUnitySheetBindingConfig(binding, fallback = {}) {
    const next = {
        ...defaultUnitySheetBindingConfig(),
        ...(fallback && typeof fallback === 'object' ? fallback : {}),
        ...(binding && typeof binding === 'object' ? binding : {})
    };
    next.enabled = next.enabled === true;
    next.targetPath = typeof next.targetPath === 'string' ? next.targetPath : '';
    next.columns = Math.max(1, Math.round(Number(next.columns) || 4));
    next.rows = Math.max(1, Math.round(Number(next.rows) || 4));
    next.frameWidth = Math.max(0, Math.round(Number(next.frameWidth) || 0));
    next.frameHeight = Math.max(0, Math.round(Number(next.frameHeight) || 0));
    next.downscale = Number.isFinite(Number(next.downscale)) && Number(next.downscale) >= 1 ? Number(next.downscale) : 1;
    return next;
}

function normalizeAnimationUnityBindingConfig(binding) {
    const next = {
        ...defaultAnimationUnityBindingConfig(),
        ...(binding && typeof binding === 'object' ? binding : {})
    };
    next.useProjectBinding = next.useProjectBinding !== false;
    next.enabled = next.enabled === true;
    next.targetPath = typeof next.targetPath === 'string' ? next.targetPath : '';
    next.columns = Math.max(0, Math.round(Number(next.columns) || 0));
    next.rows = Math.max(0, Math.round(Number(next.rows) || 0));
    next.frameWidth = Math.max(0, Math.round(Number(next.frameWidth) || 0));
    next.frameHeight = Math.max(0, Math.round(Number(next.frameHeight) || 0));
    next.downscale = Number.isFinite(Number(next.downscale)) && Number(next.downscale) >= 1 ? Number(next.downscale) : 1;
    return next;
}

function resolveProjectPlaybackSettings(asset) {
    const source = asset?.playback && typeof asset.playback === 'object' ? asset.playback : {};
    return {
        defaultPlaybackFps: clampPlaybackFps(source.defaultPlaybackFps, 12),
        playbackLoop: source.playbackLoop !== false
    };
}

function normalizePlaybackRangeRecord(range, index = 0) {
    const title = typeof range?.title === 'string' && range.title.trim()
        ? range.title.trim()
        : `Animation ${index + 1}`;
    const startFrameIndex = Math.max(0, Math.round(Number(range?.startFrameIndex) || 0));
    const endFrameIndex = Math.max(startFrameIndex, Math.round(Number(range?.endFrameIndex) || startFrameIndex));
    return {
        id: typeof range?.id === 'string' ? range.id : '',
        title,
        startFrameIndex,
        endFrameIndex,
        fpsOverrideEnabled: range?.fpsOverrideEnabled === true,
        fpsOverride: clampPlaybackFps(range?.fpsOverride, 12)
    };
}

function getAnimationPlaybackRanges(animation) {
    const lastFrameIndex = Math.max(0, frameListForPaint(animation).length - 1);
    return Array.isArray(animation?.playbackRanges)
        ? animation.playbackRanges.map((entry, index) => {
            const normalized = normalizePlaybackRangeRecord(entry, index);
            const startFrameIndex = clamp(normalized.startFrameIndex, 0, lastFrameIndex);
            const endFrameIndex = clamp(normalized.endFrameIndex, startFrameIndex, lastFrameIndex);
            return {
                ...normalized,
                startFrameIndex,
                endFrameIndex
            };
        })
        : [];
}

function resolvePlaybackFallbackRange(animation) {
    const frames = frameListForPaint(animation);
    const lastIndex = Math.max(0, frames.length - 1);
    return {
        id: 'full-animation',
        title: 'Full Animation',
        startFrameIndex: 0,
        endFrameIndex: lastIndex,
        fpsOverrideEnabled: false,
        fpsOverride: 0,
        fallback: true
    };
}

function resolveActivePlaybackRange(asset, animation, frameIndex = -1) {
    const ranges = getAnimationPlaybackRanges(animation);
    const fallback = resolvePlaybackFallbackRange(animation);
    const safeFrameIndex = Number.isFinite(Number(frameIndex)) && Number(frameIndex) >= 0
        ? Math.round(Number(frameIndex))
        : fallback.startFrameIndex;
    const match = ranges.find((entry) => safeFrameIndex >= entry.startFrameIndex && safeFrameIndex <= entry.endFrameIndex);
    return match || fallback;
}

function resolvePlaybackFps(asset, animation, range) {
    if (range?.fpsOverrideEnabled === true) {
        return clampPlaybackFps(range.fpsOverride, 12);
    }
    return resolveProjectPlaybackSettings(asset).defaultPlaybackFps;
}

function resolveProjectUnityBinding(asset) {
    return normalizeUnitySheetBindingConfig(asset?.integrations?.unity?.defaultSheetBinding);
}

function resolveAnimationUnityBinding(animation) {
    return normalizeAnimationUnityBindingConfig(animation?.export?.unity);
}

function resolveEffectiveUnitySheetBinding(asset, animation) {
    const projectBinding = resolveProjectUnityBinding(asset);
    const animationBinding = resolveAnimationUnityBinding(animation);
    if (animationBinding.useProjectBinding !== false) {
        return {
            scope: 'project',
            binding: projectBinding
        };
    }
    return {
        scope: 'animation',
        binding: normalizeUnitySheetBindingConfig(animationBinding, projectBinding)
    };
}

function describePlaybackRangeFrames(range) {
    const start = Math.max(0, Math.round(Number(range?.startFrameIndex) || 0)) + 1;
    const end = Math.max(start, Math.round(Number(range?.endFrameIndex) || (start - 1)) + 1);
    return `${start} to ${end}`;
}

function renderPlaybackRangesMarkup(asset, animation, context = {}) {
    const ranges = getAnimationPlaybackRanges(animation);
    const fallback = resolvePlaybackFallbackRange(animation);
    const activeRange = resolveActivePlaybackRange(asset, animation, context.frameIndex);
    paintWorkspaceState.activePlaybackRangeId = String(activeRange?.id || fallback.id || '');
    const maxFrameNumber = Math.max(1, fallback.endFrameIndex + 1);
    const rows = ranges.length
        ? ranges.map((range, index) => `
            <div class="paint-playback-range${range.id === activeRange.id ? ' is-active' : ''}">
                <div class="paint-playback-range-top">
                    <div class="paint-playback-range-title-wrap">
                        <input class="paint-project-text-input paint-playback-range-title" type="text" data-role="playback-range-title" data-range-id="${escapeWorkspaceText(range.id)}" value="${escapeWorkspaceText(range.title)}" title="Range title">
                        <div class="paint-playback-range-meta">${escapeWorkspaceText(describePlaybackRangeFrames(range))}${range.id === activeRange.id ? ' | Active' : ''}</div>
                    </div>
                    <div class="paint-playback-range-actions">
                        <button type="button" class="paint-project-icon" data-action="playback-range-move-up" data-range-id="${escapeWorkspaceText(range.id)}" title="Move range up"${index === 0 ? ' disabled' : ''}>Up</button>
                        <button type="button" class="paint-project-icon" data-action="playback-range-move-down" data-range-id="${escapeWorkspaceText(range.id)}" title="Move range down"${index === ranges.length - 1 ? ' disabled' : ''}>Dn</button>
                        <button type="button" class="paint-project-icon paint-project-icon--danger" data-action="playback-range-delete" data-range-id="${escapeWorkspaceText(range.id)}" title="Delete range">Del</button>
                    </div>
                </div>
                <div class="paint-project-grid paint-project-grid--playback-range">
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Start Frame</span>
                        <input class="paint-project-number paint-project-number--full" type="number" min="1" max="${maxFrameNumber}" step="1" data-role="playback-range-start" data-range-id="${escapeWorkspaceText(range.id)}" value="${range.startFrameIndex + 1}">
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>End Frame</span>
                        <input class="paint-project-number paint-project-number--full" type="number" min="1" max="${maxFrameNumber}" step="1" data-role="playback-range-end" data-range-id="${escapeWorkspaceText(range.id)}" value="${range.endFrameIndex + 1}">
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Override FPS</span>
                        <select class="paint-project-select" data-role="playback-range-fps-override-enabled" data-range-id="${escapeWorkspaceText(range.id)}">
                            ${renderWorkspaceSelectOptions([
                                { value: 'false', label: 'Use Project FPS' },
                                { value: 'true', label: 'Override This Range' }
                            ], String(range.fpsOverrideEnabled === true))}
                        </select>
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Range FPS</span>
                        <input class="paint-project-number paint-project-number--full" type="number" min="1" max="60" step="1" data-role="playback-range-fps-override" data-range-id="${escapeWorkspaceText(range.id)}" value="${clampPlaybackFps(range.fpsOverride, 12)}"${range.fpsOverrideEnabled === true ? '' : ' disabled'}>
                    </label>
                </div>
            </div>
        `).join('')
        : '<div class="paint-project-subtle">No custom ranges yet. Playback falls back to the full animation unless you add one.</div>';
    return `
        <div class="paint-playback-range-list">
            ${rows}
            <div class="paint-playback-range paint-playback-range--fallback${fallback.id === activeRange.id ? ' is-active' : ''}">
                <div class="paint-playback-range-top">
                    <div class="paint-playback-range-title-wrap">
                        <div class="paint-playback-range-label">Full Animation</div>
                        <div class="paint-playback-range-meta">${escapeWorkspaceText(describePlaybackRangeFrames(fallback))}${fallback.id === activeRange.id ? ' | Active' : ''}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderPlaybackHoldSummaryMarkup(animation) {
    const heldFrames = frameListForPaint(animation).filter((frame) => clampFrameHoldValue(frame?.hold, 1) > 1);
    if (!heldFrames.length) {
        return '<div class="paint-project-subtle">No frame holds above 1.</div>';
    }
    return `
        <div class="paint-playback-hold-summary">
            ${heldFrames.map((frame) => `
                <div class="paint-playback-hold-row">
                    <span>Frame ${Math.max(1, Number(frame.index) + 1)}</span>
                    <span>${clampFrameHoldValue(frame.hold, 1)}x</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAnimationPanelMarkup(asset, context = {}) {
    const playbackSettings = resolveProjectPlaybackSettings(asset);
    const animation = context.animation || null;
    const activeRange = resolveActivePlaybackRange(asset, animation, context.frameIndex);
    return `
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Animation Settings</div>
                <button type="button" class="paint-project-icon" data-action="playback-range-add" title="Add playback range"${animation ? '' : ' disabled'}>+</button>
            </div>
            <div class="paint-project-grid paint-project-grid--settings">
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Project FPS</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="1" max="60" step="1" data-role="playback-default-fps" value="${playbackSettings.defaultPlaybackFps}" title="Default playback speed for this project">
                    <div class="paint-project-setting-detail">Used by every playback range unless that range overrides its FPS.</div>
                </label>
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Loop</span>
                    <select class="paint-project-select" data-role="playback-loop" title="Choose whether playback loops">
                        ${renderWorkspaceSelectOptions([
                            { value: 'true', label: 'Loop On' },
                            { value: 'false', label: 'Loop Off' }
                        ], String(playbackSettings.playbackLoop !== false))}
                    </select>
                    <div class="paint-project-setting-detail">Playback starts from the selected frame and loops only inside the matched range when loop is on.</div>
                </label>
            </div>
            <div class="paint-project-subtle">${animation ? `Active playback range from this frame: ${escapeWorkspaceText(activeRange.title)}` : 'No animation is currently selected.'}</div>
        </div>
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Playback Ranges</div>
            </div>
            ${animation ? renderPlaybackRangesMarkup(asset, animation, context) : '<div class="paint-project-subtle">Open or create an animation first. Custom ranges live on the current animation.</div>'}
        </div>
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Hold Summary</div>
            </div>
            ${animation ? renderPlaybackHoldSummaryMarkup(animation) : '<div class="paint-project-subtle">No animation is currently selected.</div>'}
        </div>
    `;
}

function renderUnityPanelMarkup(asset, context = {}) {
    const animation = context.animation || null;
    const frames = animation ? frameListForPaint(animation) : [];
    const animationBinding = resolveAnimationUnityBinding(animation);
    const effective = resolveEffectiveUnitySheetBinding(asset, animation);
    const binding = effective.binding;
    const scopeValue = animation && animationBinding.useProjectBinding === false ? 'animation' : 'project';
    const targetPath = String(binding.targetPath || '');
    const hasTargetPath = !!targetPath;
    const boundAssetFrames = frames.filter((frame) => String(frame?.unityAssetPath || '').trim());
    return `
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Unity Sprite Sheet</div>
            </div>
            ${animation ? `
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Binding Scope</span>
                    <select class="paint-project-select" data-role="unity-binding-scope" title="Use project defaults or an animation override">
                        ${renderWorkspaceSelectOptions([
                            { value: 'project', label: 'Project Default' },
                            { value: 'animation', label: 'Animation Override' }
                        ], scopeValue)}
                    </select>
                    <div class="paint-project-setting-detail">${scopeValue === 'animation' ? 'This animation is using its own Unity sheet binding.' : 'This animation inherits the project default Unity sheet binding.'}</div>
                </label>
            ` : '<div class="paint-project-subtle">No animation is selected. You can still set the project default sheet binding here.</div>'}
            <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                <span>Sprite Sheet Path</span>
                <input class="paint-project-text-input" type="text" data-role="unity-target-path" value="${escapeWorkspaceText(targetPath)}" placeholder="C:\\Projects\\Game\\Assets\\Sprites\\sheet.png" title="Linked Unity sprite sheet path">
                <div class="paint-project-setting-detail">${hasTargetPath ? escapeWorkspaceText(targetPath) : 'Set the target PNG path that Update Sprite Sheet should overwrite. Unity .meta files are never touched.'}</div>
            </label>
            <div class="paint-unity-panel-actions">
                <button type="button" class="paint-animation-btn" data-action="unity-bind-existing-sheet" title="Pick an existing sprite sheet file">Bind Existing Sheet</button>
                <button type="button" class="paint-animation-btn" data-action="unity-choose-sheet-target" title="Pick a target sprite sheet path">Choose Export Path</button>
            </div>
        </div>
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Sheet Layout</div>
            </div>
            <div class="paint-project-grid paint-project-grid--unity-layout">
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Columns</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="1" max="512" step="1" data-role="unity-columns" value="${Math.max(1, Number(binding.columns) || 4)}">
                </label>
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Rows</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="1" max="512" step="1" data-role="unity-rows" value="${Math.max(1, Number(binding.rows) || 4)}">
                </label>
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Frame Width</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="0" max="${MAX_CANVAS_DIMENSION}" step="1" data-role="unity-frame-width" value="${Math.max(0, Number(binding.frameWidth) || 0)}">
                </label>
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Frame Height</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="0" max="${MAX_CANVAS_DIMENSION}" step="1" data-role="unity-frame-height" value="${Math.max(0, Number(binding.frameHeight) || 0)}">
                </label>
                <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                    <span>Downscale</span>
                    <input class="paint-project-number paint-project-number--full" type="number" min="0.1" max="8" step="0.25" data-role="unity-downscale" value="${Number(binding.downscale || 1)}">
                </label>
            </div>
            <div class="paint-project-subtle">Layout stays fixed. Update fails instead of silently resizing the sheet when the current frame count exceeds the available slots.</div>
        </div>
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Sheet Actions</div>
            </div>
            <div class="paint-unity-panel-actions">
                <button type="button" class="paint-animation-btn" data-action="unity-import-sheet" title="Import the linked sheet as a new animation"${hasTargetPath ? '' : ' disabled'}>Import Sprite Sheet</button>
                <button type="button" class="paint-animation-btn" data-action="unity-update-sheet" title="Overwrite the linked PNG with the current animation"${animation && hasTargetPath ? '' : ' disabled'}>Update Sprite Sheet</button>
            </div>
            <div class="paint-project-subtle">Import creates a Board Studio animation from the linked sheet. Update only overwrites the PNG and keeps Unity meta slicing untouched.</div>
        </div>
        <div class="paint-project-section paint-project-section--settings">
            <div class="paint-project-section-head">
                <div class="paint-project-section-title">Unity Asset Sheet</div>
                <div class="paint-unity-panel-actions">
                    <button type="button" class="paint-animation-btn" data-action="unity-update-asset-sheet"${animation && boundAssetFrames.length ? '' : ' disabled'}>Update Bound Assets</button>
                </div>
            </div>
            ${animation ? `
                <div class="paint-project-subtle">Bind individual frames to individual Unity PNG assets. This is the multi-sprite lane for breakout sheets and other non-sheet exports.</div>
                <div class="paint-unity-asset-list">
                    ${frames.map((frame) => `
                        <div class="paint-unity-asset-row">
                            <div class="paint-unity-asset-frame">Frame ${frame.index + 1}</div>
                            <input class="paint-project-text-input" type="text" data-role="unity-frame-asset-path" data-frame-id="${escapeWorkspaceText(frame.id)}" value="${escapeWorkspaceText(String(frame.unityAssetPath || ''))}" placeholder="C:\\Projects\\Game\\Assets\\Sprites\\clouds.png">
                            <button type="button" class="paint-animation-btn" data-action="unity-bind-frame-asset" data-frame-id="${escapeWorkspaceText(frame.id)}">Bind</button>
                        </div>
                    `).join('')}
                </div>
            ` : '<div class="paint-project-subtle">No animation is selected. Asset-sheet binding works on the current animation frames.</div>'}
        </div>
    `;
}

function resolveAnimationLayerSchemaRelativePath(animationId) {
    return `animations/${String(animationId || '').trim()}/layers/schema.json`;
}

function resolveAnimationFrameLayerDirRelativePath(animationId, frameId) {
    return `animations/${String(animationId || '').trim()}/layers/${String(frameId || '').trim()}`;
}

function resolveAnimationFrameLayerManifestRelativePath(animationId, frameId) {
    return `${resolveAnimationFrameLayerDirRelativePath(animationId, frameId)}/manifest.json`;
}

function resolveAnimationFrameLayerImageRelativePath(animationId, frameId, layerId) {
    return `${resolveAnimationFrameLayerDirRelativePath(animationId, frameId)}/${String(layerId || '').trim()}.png`;
}

function createBlankTimelineCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Number(session?.width) || 1);
    canvas.height = Math.max(1, Number(session?.height) || 1);
    return canvas;
}

function buildTimelineLayerSchemaFromLayers(layers = []) {
    const source = Array.isArray(layers) && layers.length
        ? layers
        : [{ id: 'layer-base', name: LAYER_BASE_NAME, isBase: true }];
    return source.map((layer, index) => ({
        id: String(layer?.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`)),
        name: String(layer?.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
        isBase: index === 0 || layer?.isBase === true,
        visible: normalizeLayerVisibility(layer?.visible, true),
        opacity: normalizeLayerOpacity(layer?.opacity),
        thumbnailTone: normalizeLayerThumbnailTone(layer?.thumbnailTone)
    }));
}

function extractNumericLayerId(value) {
    const match = /^layer-(\d+)$/.exec(String(value || '').trim());
    if (!match) {
        return 0;
    }
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeTimelineLayerSchema(entries, fallbackLayers = []) {
    const fallback = buildTimelineLayerSchemaFromLayers(fallbackLayers);
    const source = Array.isArray(entries) && entries.length ? entries : fallback;
    const merged = [];
    const seenIds = new Set();
    source.forEach((entry, index) => {
        const fallbackEntry = fallback[index] || null;
        const id = String(entry?.id || fallbackEntry?.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`));
        if (!id || seenIds.has(id)) {
            return;
        }
        seenIds.add(id);
        merged.push({
            id,
            name: String(entry?.name || fallbackEntry?.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
            isBase: index === 0 || entry?.isBase === true || fallbackEntry?.isBase === true,
            visible: normalizeLayerVisibility(entry?.visible, fallbackEntry?.visible),
            opacity: normalizeLayerOpacity(entry?.opacity, fallbackEntry?.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(entry?.thumbnailTone, fallbackEntry?.thumbnailTone)
        });
    });
    fallback.forEach((entry, index) => {
        const id = String(entry?.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`));
        if (!id || seenIds.has(id)) {
            return;
        }
        seenIds.add(id);
        merged.push({
            id,
            name: String(entry?.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
            isBase: index === 0 || entry?.isBase === true,
            visible: normalizeLayerVisibility(entry?.visible, true),
            opacity: normalizeLayerOpacity(entry?.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(entry?.thumbnailTone)
        });
    });
    return merged;
}

function buildCanonicalAnimationLayerSchema(asset, animation, fallbackLayers = []) {
    const fallback = buildTimelineLayerSchemaFromLayers(fallbackLayers);
    if (!asset?.id || !animation?.id) {
        return normalizeTimelineLayerSchema(fallback, fallbackLayers);
    }
    return readPersistedAnimationLayerSchema(asset, animation, fallbackLayers);
}

function normalizeTimelineLayerSnapshots(layerSnapshots = [], canonicalLayers = [], options = {}) {
    const canonicalSchema = normalizeTimelineLayerSchema(canonicalLayers, canonicalLayers);
    const sourceLayers = Array.isArray(layerSnapshots) ? layerSnapshots : [];
    const sourceById = new Map();
    const duplicateIds = [];
    const staleIds = [];
    let baseFallback = null;
    sourceLayers.forEach((entry) => {
        if (!baseFallback && entry?.isBase === true) {
            baseFallback = entry;
        }
        const id = String(entry?.id || '').trim();
        if (!id) {
            return;
        }
        if (sourceById.has(id)) {
            duplicateIds.push(id);
            return;
        }
        sourceById.set(id, entry);
    });
    const canonicalIds = new Set(canonicalSchema.map((entry) => String(entry?.id || '').trim()).filter(Boolean));
    sourceById.forEach((_entry, id) => {
        if (!canonicalIds.has(id)) {
            staleIds.push(id);
        }
    });
    const normalizedLayers = canonicalSchema.map((schemaEntry, index) => {
        const sourceEntry = sourceById.get(schemaEntry.id) || (schemaEntry.isBase === true ? baseFallback : null);
        let canvas = sourceEntry?.canvas || null;
        if (options.cloneCanvas === true && canvas) {
            canvas = cloneCanvasSurface(canvas);
        }
        if (!canvas) {
            canvas = createBlankTimelineCanvas();
        } else if (canvas.width !== Math.max(1, Number(session?.width) || 1) || canvas.height !== Math.max(1, Number(session?.height) || 1)) {
            const resized = createBlankTimelineCanvas();
            const resizedCtx = resized.getContext('2d', { willReadFrequently: false });
            if (resizedCtx) {
                try {
                    resizedCtx.drawImage(canvas, 0, 0, resized.width, resized.height);
                    canvas = resized;
                } catch {
                    canvas = createBlankTimelineCanvas();
                }
            } else {
                canvas = createBlankTimelineCanvas();
            }
        }
        return {
            id: String(schemaEntry.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`)),
            name: String(sourceEntry?.name || schemaEntry.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
            isBase: schemaEntry.isBase === true || index === 0,
            visible: normalizeLayerVisibility(sourceEntry?.visible, schemaEntry.visible),
            opacity: normalizeLayerOpacity(sourceEntry?.opacity, schemaEntry.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(sourceEntry?.thumbnailTone, schemaEntry.thumbnailTone),
            canvas
        };
    });
    if (duplicateIds.length || staleIds.length) {
        logPaintTrace('timeline.layers.normalized', {
            reason: String(options.reason || ''),
            assetId: String(options.assetId || ''),
            animationId: String(options.animationId || ''),
            frameId: String(options.frameId || ''),
            sourceCount: sourceLayers.length,
            layerCount: normalizedLayers.length,
            duplicateIds,
            staleIds
        });
    }
    return normalizedLayers;
}

function repairLoadedTimelineFrameStates(layerSchema = [], reason = 'timeline-frame-state-repair') {
    if (!session?.timelineStore?.frameStates) {
        return 0;
    }
    const canonicalSchema = normalizeTimelineLayerSchema(layerSchema, layerSchema);
    let repairedCount = 0;
    Object.entries(session.timelineStore.frameStates).forEach(([frameId, frameState]) => {
        const beforeIds = Array.isArray(frameState?.layers) ? frameState.layers.map((entry) => String(entry?.id || '')) : [];
        const nextLayers = normalizeTimelineLayerSnapshots(frameState?.layers || [], canonicalSchema, {
            cloneCanvas: false,
            reason,
            frameId
        });
        const afterIds = nextLayers.map((entry) => String(entry?.id || ''));
        if (beforeIds.length !== afterIds.length || beforeIds.some((id, index) => id !== afterIds[index])) {
            repairedCount += 1;
        }
        frameState.layers = nextLayers;
    });
    if (repairedCount > 0) {
        logPaintTrace('timeline.frameState.repaired', {
            reason,
            repairedCount,
            frameCount: Object.keys(session.timelineStore.frameStates || {}).length,
            canonicalLayerIds: canonicalSchema.map((entry) => String(entry?.id || ''))
        });
    }
    return repairedCount;
}

function repairSessionLayerStructureIfNeeded(reason = 'session-layer-repair', options = {}) {
    if (!session || !Array.isArray(session.layers) || !session.layers.length || session.isDrawing) {
        return false;
    }
    const asset = resolveWorkspaceAsset();
    const context = resolveSessionAnimationContext(asset);
    const canonicalSchema = buildCanonicalAnimationLayerSchema(asset, context.animation, session.layers || []);
    const currentIds = session.layers.map((entry) => String(entry?.id || ''));
    const targetIds = canonicalSchema.map((entry) => String(entry?.id || ''));
    const duplicateIds = currentIds.filter((id, index) => !!id && currentIds.indexOf(id) !== index);
    const needsRepair = currentIds.length !== targetIds.length
        || currentIds.some((id, index) => id !== targetIds[index])
        || duplicateIds.length > 0;
    if (!needsRepair) {
        return false;
    }
    const activeLayerId = getActiveLayer()?.id || '';
    const activeLayerIndex = Math.max(0, targetIds.indexOf(activeLayerId));
    const normalizedSnapshots = normalizeTimelineLayerSnapshots(session.layers, canonicalSchema, {
        cloneCanvas: true,
        reason,
        assetId: asset?.id || '',
        animationId: context.animation?.id || '',
        frameId: context.frame?.id || ''
    });
    applyTimelineLayerSnapshotsToSession(normalizedSnapshots, {
        activeLayerIndex,
        skipUi: options.skipUi === true,
        layerSchema: canonicalSchema
    });
    repairLoadedTimelineFrameStates(canonicalSchema, reason);
    if (context.frame?.id) {
        captureCurrentAnimationFrameState(`${reason}.capture`);
    }
    logPaintTrace('session.layers.repaired', {
        reason,
        assetId: asset?.id || '',
        animationId: context.animation?.id || '',
        frameId: context.frame?.id || '',
        beforeIds: currentIds,
        afterIds: targetIds,
        duplicateIds
    });
    return true;
}

function syncSessionLayerIdCounterToKnownLayers(reason = 'layer-id-sync') {
    if (!session) {
        return 1;
    }
    const asset = resolveWorkspaceAsset();
    const context = resolveSessionAnimationContext(asset);
    const canonicalSchema = buildCanonicalAnimationLayerSchema(asset, context.animation, session.layers || []);
    let maxLayerNumber = 0;
    const scanLayers = (layers = []) => {
        (Array.isArray(layers) ? layers : []).forEach((entry) => {
            maxLayerNumber = Math.max(maxLayerNumber, extractNumericLayerId(entry?.id));
        });
    };
    scanLayers(session.layers || []);
    scanLayers(canonicalSchema);
    Object.values(session?.timelineStore?.frameStates || {}).forEach((frameState) => {
        scanLayers(frameState?.layers || []);
    });
    const nextCounter = Math.max(1, maxLayerNumber + 1);
    if ((Number(session.layerIdCounter) || 0) < nextCounter) {
        const previous = Number(session.layerIdCounter) || 0;
        session.layerIdCounter = nextCounter;
        logPaintTrace('session.layerIdCounter.sync', {
            reason,
            previous,
            next: nextCounter,
            maxLayerNumber,
            animationId: context.animation?.id || ''
        });
    }
    return session.layerIdCounter;
}

function readPersistedAnimationLayerSchema(asset, animation, fallbackLayers = []) {
    if (!asset?.id || !animation?.id) {
        return buildTimelineLayerSchemaFromLayers(fallbackLayers);
    }
    const relativePath = resolveAnimationLayerSchemaRelativePath(animation.id);
    const absolutePath = projectStore.resolveAssetPath(asset, relativePath);
    if (!absolutePath || !env.fs.existsSync(absolutePath)) {
        return buildTimelineLayerSchemaFromLayers(fallbackLayers);
    }
    try {
        const parsed = JSON.parse(env.fs.readFileSync(absolutePath, 'utf8'));
        const entries = Array.isArray(parsed?.layers) ? parsed.layers : parsed;
        return normalizeTimelineLayerSchema(entries, fallbackLayers);
    } catch (error) {
        logPaintTrace('timeline.schema.readFailed', {
            assetId: asset.id,
            animationId: animation.id,
            relativePath,
            message: error?.message || String(error)
        });
        return buildTimelineLayerSchemaFromLayers(fallbackLayers);
    }
}

async function persistAnimationLayerSchema(asset, animation, layers, options = {}) {
    if (!asset?.id || !animation?.id) {
        return '';
    }
    const schema = normalizeTimelineLayerSchema(buildTimelineLayerSchemaFromLayers(layers), layers);
    const relativePath = resolveAnimationLayerSchemaRelativePath(animation.id);
    projectStore.writeJsonToAsset(asset.id, relativePath, {
        animationId: animation.id,
        savedAt: new Date().toISOString(),
        reason: String(options.reason || ''),
        layers: schema
    });
    logPaintTrace('timeline.schema.persisted', {
        assetId: asset.id,
        animationId: animation.id,
        relativePath,
        layerCount: schema.length,
        reason: options.reason || ''
    });
    return relativePath;
}

async function loadPersistedTimelineFrameState(asset, animation, frame, options = {}) {
    if (!asset?.id || !animation?.id || !frame?.id) {
        return null;
    }
    const schema = readPersistedAnimationLayerSchema(asset, animation, options.fallbackLayers || session?.layers || []);
    const manifestRelativePath = resolveAnimationFrameLayerManifestRelativePath(animation.id, frame.id);
    const manifestAbsolutePath = projectStore.resolveAssetPath(asset, manifestRelativePath);
    const frameAbsolutePath = projectStore.resolveAssetPath(asset, resolveFramePath(frame));
    let manifest = null;
    if (manifestAbsolutePath && env.fs.existsSync(manifestAbsolutePath)) {
        try {
            manifest = JSON.parse(env.fs.readFileSync(manifestAbsolutePath, 'utf8'));
        } catch (error) {
            logPaintTrace('timeline.frameState.readManifestFailed', {
                assetId: asset.id,
                animationId: animation.id,
                frameId: frame.id,
                manifestRelativePath,
                message: error?.message || String(error)
            });
        }
    }
    const manifestLayers = Array.isArray(manifest?.layers) ? manifest.layers : [];
    const onlyBaseLayerCached = manifestLayers.length === 1 && String(manifestLayers[0]?.id || '') === 'layer-base';
    if (frame?.manualEdited !== true && onlyBaseLayerCached) {
        return buildFrameStateFromImagePath(frameAbsolutePath, {
            layerSchema: schema
        });
    }
    if (!manifest) {
        return buildFrameStateFromImagePath(frameAbsolutePath, {
            layerSchema: schema
        });
    }
    const layers = [];
    for (const schemaEntry of schema) {
        const manifestEntry = Array.isArray(manifest.layers)
            ? manifest.layers.find((entry) => String(entry?.id || '') === schemaEntry.id)
            : null;
        const canvas = createBlankTimelineCanvas();
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) {
            continue;
        }
        const relativeLayerPath = String(manifestEntry?.path || '').trim();
        const absoluteLayerPath = relativeLayerPath ? projectStore.resolveAssetPath(asset, relativeLayerPath) : '';
        if (absoluteLayerPath && env.fs.existsSync(absoluteLayerPath)) {
            try {
                const image = await loadImageForPath(absoluteLayerPath);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            } catch (error) {
                logPaintTrace('timeline.frameState.readLayerFailed', {
                    assetId: asset.id,
                    animationId: animation.id,
                    frameId: frame.id,
                    layerId: schemaEntry.id,
                    relativeLayerPath,
                    message: error?.message || String(error)
                });
            }
        } else if (schemaEntry.isBase && frameAbsolutePath && env.fs.existsSync(frameAbsolutePath)) {
            try {
                const image = await loadImageForPath(frameAbsolutePath);
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            } catch {}
        }
        layers.push({
            id: schemaEntry.id,
            name: schemaEntry.name,
            isBase: schemaEntry.isBase === true,
            visible: normalizeLayerVisibility(schemaEntry.visible, true),
            opacity: normalizeLayerOpacity(schemaEntry.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(schemaEntry.thumbnailTone),
            canvas
        });
    }
    logPaintTrace('timeline.frameState.loaded', {
        assetId: asset.id,
        animationId: animation.id,
        frameId: frame.id,
        layerCount: layers.length,
        schemaCount: schema.length,
        manifestCount: Array.isArray(manifest?.layers) ? manifest.layers.length : 0,
        source: 'persisted'
    });
    return {
        frameId: frame.id,
        layers
    };
}

async function persistTimelineFrameState(asset, animation, frameId, layers = [], options = {}) {
    if (!asset?.id || !animation?.id || !frameId) {
        return false;
    }
    const schema = normalizeTimelineLayerSchema(buildTimelineLayerSchemaFromLayers(layers), layers);
    await persistAnimationLayerSchema(asset, animation, schema, options);
    const manifestLayers = [];
    for (const layer of schema) {
        const sourceLayer = (Array.isArray(layers) ? layers : []).find((entry) => String(entry?.id || '') === layer.id);
        const relativePath = resolveAnimationFrameLayerImageRelativePath(animation.id, frameId, layer.id);
        const canvas = sourceLayer?.canvas || createBlankTimelineCanvas();
        const buffer = await exportCanvasToPngBuffer(canvas);
        if (!buffer) {
            continue;
        }
        projectStore.writeBufferToAsset(asset.id, relativePath, buffer);
        manifestLayers.push({
            id: layer.id,
            name: layer.name,
            isBase: layer.isBase === true,
            path: relativePath
        });
    }
    const manifestRelativePath = resolveAnimationFrameLayerManifestRelativePath(animation.id, frameId);
    projectStore.writeJsonToAsset(asset.id, manifestRelativePath, {
        animationId: animation.id,
        frameId,
        savedAt: new Date().toISOString(),
        reason: String(options.reason || ''),
        layers: manifestLayers
    });
    logPaintTrace('timeline.frameState.persisted', {
        assetId: asset.id,
        animationId: animation.id,
        frameId,
        layerCount: manifestLayers.length,
        reason: options.reason || ''
    });
    return true;
}

async function persistLoadedTimelineStates(asset, animation, options = {}) {
    if (!asset?.id || !animation?.id || !session?.timelineStore?.frameStates) {
        return false;
    }
    const entries = Object.entries(session.timelineStore.frameStates);
    if (!entries.length) {
        await persistAnimationLayerSchema(asset, animation, session.layers || [], options);
        return false;
    }
    for (const [frameId, frameState] of entries) {
        await persistTimelineFrameState(asset, animation, frameId, frameState?.layers || [], options);
    }
    logPaintTrace('timeline.frameState.persistLoaded.complete', {
        assetId: asset.id,
        animationId: animation.id,
        frameCount: entries.length,
        reason: options.reason || ''
    });
    return true;
}

async function persistActiveTimelineFrameState(reason = 'timeline-active-persist') {
    const asset = resolveWorkspaceAsset();
    const context = resolveSessionAnimationContext(asset);
    if (!asset?.id || !context.animation?.id || !context.frame?.id || !session?.layers?.length) {
        return false;
    }
    captureCurrentAnimationFrameState(`${reason}.capture`);
    return persistTimelineFrameState(asset, context.animation, context.frame.id, session.layers, { reason });
}

function buildTimelineFrameDebugSummary(frameEntries = [], currentFrameId = '') {
    return (Array.isArray(frameEntries) ? frameEntries : []).map((entry, index) => ({
        listIndex: index,
        frameId: String(entry?.id || ''),
        frameIndex: Number(entry?.index ?? -1),
        slot: String(entry?.slot || ''),
        pseudo: entry?.pseudo === true,
        disabled: entry?.disabled === true,
        spacer: entry?.spacer === true,
        isCurrent: String(entry?.id || '') === String(currentFrameId || '')
    }));
}

function resolveFramePath(frame) {
    return frame?.workingPath || frame?.originalPath || '';
}

function framePathUsesRootImagePath(relativePath) {
    const normalized = String(relativePath || '').trim().replace(/\\/g, '/').toLowerCase();
    return normalized.startsWith('still/');
}

async function ensureAnimationFrameHasDedicatedFile(asset, animation, frame) {
    if (!asset?.id || !animation?.id || !frame?.id) {
        return { asset, animation, frame };
    }
    const currentRelativePath = resolveFramePath(frame);
    if (!framePathUsesRootImagePath(currentRelativePath)) {
        return { asset, animation, frame };
    }
    const sourceAbsolutePath = projectStore.resolveAssetPath(asset, currentRelativePath);
    if (!sourceAbsolutePath || !env.fs.existsSync(sourceAbsolutePath)) {
        logPaintTrace('timeline.framePath.normalizeSkipped', {
            assetId: asset.id,
            animationId: animation.id,
            frameId: frame.id,
            currentRelativePath,
            reason: 'missing-source'
        });
        return { asset, animation, frame };
    }
    const ext = env.path.extname(sourceAbsolutePath) || '.png';
    const targetRelativePath = `animations/${animation.id}/frames/working/${frame.id}${ext}`;
    if (targetRelativePath === currentRelativePath) {
        return { asset, animation, frame };
    }
    const buffer = env.fs.readFileSync(sourceAbsolutePath);
    projectStore.writeBufferToAsset(asset.id, targetRelativePath, buffer);
    projectStore.updateAnimation(asset.id, animation.id, (draft) => {
        draft.frames = frameListForPaint(draft).map((entry) => {
            if (entry.id !== frame.id) {
                return entry;
            }
            return {
                ...entry,
                workingPath: targetRelativePath,
                approvedPath: targetRelativePath,
                originalPath: targetRelativePath
            };
        });
        draft.frameCount = draft.frames.length;
        return draft;
    }, 'asset2d-frame-normalize-path');
    const refreshedAsset = projectStore.getAsset(asset.id) || asset;
    const refreshedAnimation = refreshedAsset.animations?.[animation.id] || animation;
    const refreshedFrame = frameListForPaint(refreshedAnimation).find((entry) => entry.id === frame.id) || frame;
    logPaintTrace('timeline.framePath.normalized', {
        assetId: asset.id,
        animationId: animation.id,
        frameId: frame.id,
        from: currentRelativePath,
        to: targetRelativePath
    });
    return {
        asset: refreshedAsset,
        animation: refreshedAnimation,
        frame: refreshedFrame
    };
}

function applyTimelineLayerSnapshotsToSession(layerSnapshots, options = {}) {
    if (!session) {
        return false;
    }
    const fallbackSnapshots = [{
        id: 'layer-base',
        name: LAYER_BASE_NAME,
        isBase: true,
        visible: true,
        opacity: 1,
        canvas: (() => {
            const blank = document.createElement('canvas');
            blank.width = session.width;
            blank.height = session.height;
            return blank;
        })()
    }];
    const canonicalSchema = normalizeTimelineLayerSchema(options.layerSchema, session.layers || []);
    const snapshots = normalizeTimelineLayerSnapshots(
        Array.isArray(layerSnapshots) && layerSnapshots.length ? layerSnapshots : fallbackSnapshots,
        canonicalSchema,
        {
            cloneCanvas: false,
            reason: String(options.reason || 'apply-session-snapshots'),
            assetId: String(options.assetId || ''),
            animationId: String(options.animationId || ''),
            frameId: String(options.frameId || '')
        }
    );
    logPaintTrace('applyTimelineLayerSnapshotsToSession', {
        reason: String(options.reason || ''),
        incomingCount: Array.isArray(layerSnapshots) ? layerSnapshots.length : 0,
        layerCount: snapshots.length,
        activeLayerIndex: Math.min(Math.max(0, Number(options.activeLayerIndex) || 0), Math.max(0, snapshots.length - 1)),
        layerIds: snapshots.map((snapshot) => String(snapshot?.id || ''))
    });
    destroyDynamicPaintLayerCanvases();
    const nextLayers = [];
    snapshots.forEach((snapshot, index) => {
        const canvas = index === 0 ? session.baseCanvas : createDynamicPaintLayerCanvas(session.width, session.height);
        const ctx = canvas?.getContext?.('2d', { willReadFrequently: true });
        if (!canvas || !ctx) {
            return;
        }
        canvas.width = session.width;
        canvas.height = session.height;
        ctx.clearRect(0, 0, session.width, session.height);
        if (snapshot.canvas) {
            ctx.drawImage(snapshot.canvas, 0, 0, session.width, session.height);
        }
        const record = createLayerRecord(canvas, {
            id: snapshot.id || (index === 0 ? 'layer-base' : nextLayerId()),
            name: snapshot.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`),
            isBase: index === 0 || snapshot.isBase === true,
            dynamic: index !== 0,
            visible: normalizeLayerVisibility(snapshot.visible, true),
            opacity: normalizeLayerOpacity(snapshot.opacity),
            thumbnailTone: snapshot.thumbnailTone
        });
        if (record) {
            nextLayers.push(record);
        }
    });
    if (!nextLayers.length) {
        return false;
    }
    session.layers = nextLayers;
    const maxLayerNumber = nextLayers.reduce((max, layer) => {
        const match = /^layer-(\d+)$/.exec(String(layer?.id || ''));
        return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, 0);
    session.layerIdCounter = Math.max(1, maxLayerNumber + 1);
    syncPaintLayerCanvasOrder();
    setActiveLayerRefs(clamp(Math.round(Number(options.activeLayerIndex) || 0), 0, nextLayers.length - 1), { skipUi: true });
    if (options.skipUi !== true) {
        renderLayerBar();
        updateHud();
        renderStageUi();
        renderCursorCanvas();
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
    }
    return true;
}

async function buildFrameStateFromImagePath(absolutePath, options = {}) {
    const hasImage = !!(absolutePath && env.fs.existsSync(absolutePath));
    const img = hasImage ? await loadImageForPath(absolutePath) : null;
    if (img && ((img.naturalWidth || 0) !== session.width || (img.naturalHeight || 0) !== session.height)) {
        throw new Error('frame-size-mismatch');
    }
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = session.width;
    baseCanvas.height = session.height;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
    if (!baseCtx) {
        throw new Error('frame-canvas-init-failed');
    }
    baseCtx.clearRect(0, 0, session.width, session.height);
    if (img) {
        baseCtx.drawImage(img, 0, 0, session.width, session.height);
    }
    const templateLayers = normalizeTimelineLayerSchema(options.layerSchema, session.layers || []);
    return {
        layers: templateLayers.map((layer, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = session.width;
            canvas.height = session.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: false });
            if (ctx && index === 0) {
                ctx.drawImage(baseCanvas, 0, 0);
            }
            return {
                id: String(layer.id || (index === 0 ? 'layer-base' : `layer-${index + 1}`)),
                name: String(layer.name || (index === 0 ? LAYER_BASE_NAME : `Layer ${index + 1}`)),
                isBase: index === 0 || layer.isBase === true,
                visible: normalizeLayerVisibility(layer.visible, true),
                opacity: normalizeLayerOpacity(layer.opacity),
                thumbnailTone: normalizeLayerThumbnailTone(layer.thumbnailTone),
                canvas
            };
        })
    };
}

function syncTimelineFrameStatesAfterLayerInsert(insertIndex, templateLayer) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const blank = document.createElement('canvas');
        blank.width = session.width;
        blank.height = session.height;
        const nextLayer = {
            id: String(templateLayer.id || ''),
            name: String(templateLayer.name || ''),
            isBase: templateLayer.isBase === true,
            visible: normalizeLayerVisibility(templateLayer.visible, true),
            opacity: normalizeLayerOpacity(templateLayer.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(templateLayer.thumbnailTone),
            canvas: blank
        };
        const layers = Array.isArray(frameState.layers) ? frameState.layers.slice() : [];
        layers.splice(insertIndex, 0, nextLayer);
        frameState.layers = layers;
    });
    logPaintTrace('timelineLayers.insert', {
        insertIndex,
        layerId: templateLayer?.id || '',
        layerName: templateLayer?.name || '',
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function syncTimelineFrameStatesAfterLayerDelete(deleteIndex) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layers = Array.isArray(frameState.layers) ? frameState.layers.slice() : [];
        if (deleteIndex >= 0 && deleteIndex < layers.length) {
            layers.splice(deleteIndex, 1);
        }
        frameState.layers = layers;
    });
    logPaintTrace('timelineLayers.delete', {
        deleteIndex,
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function syncTimelineFrameStatesAfterLayerSwap(indexA, indexB) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layers = Array.isArray(frameState.layers) ? frameState.layers.slice() : [];
        if (indexA < 0 || indexB < 0 || indexA >= layers.length || indexB >= layers.length) {
            return;
        }
        const temp = layers[indexA];
        layers[indexA] = layers[indexB];
        layers[indexB] = temp;
        frameState.layers = layers;
    });
    logPaintTrace('timelineLayers.swap', {
        indexA,
        indexB,
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function syncTimelineFrameStatesAfterLayerDuplicate(sourceIndex, duplicateIndex, templateLayer) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layers = Array.isArray(frameState.layers) ? frameState.layers.slice() : [];
        if (sourceIndex < 0 || sourceIndex >= layers.length || duplicateIndex < 0 || duplicateIndex >= layers.length) {
            return;
        }
        const sourceLayer = layers[sourceIndex];
        layers[duplicateIndex] = {
            id: String(templateLayer?.id || ''),
            name: String(templateLayer?.name || ''),
            isBase: templateLayer?.isBase === true,
            visible: normalizeLayerVisibility(templateLayer?.visible, true),
            opacity: normalizeLayerOpacity(templateLayer?.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(templateLayer?.thumbnailTone),
            canvas: cloneCanvasSurface(sourceLayer?.canvas) || document.createElement('canvas')
        };
        if (layers[duplicateIndex].canvas.width !== session.width) {
            layers[duplicateIndex].canvas.width = session.width;
        }
        if (layers[duplicateIndex].canvas.height !== session.height) {
            layers[duplicateIndex].canvas.height = session.height;
        }
        frameState.layers = layers;
    });
    logPaintTrace('timelineLayers.duplicate', {
        sourceIndex,
        duplicateIndex,
        layerId: templateLayer?.id || '',
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function syncTimelineFrameStatesAfterLayerMergeDown(upperIndex) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layers = Array.isArray(frameState.layers) ? frameState.layers.slice() : [];
        if (upperIndex <= 0 || upperIndex >= layers.length) {
            return;
        }
        const upper = layers[upperIndex];
        const lower = layers[upperIndex - 1];
        const mergedCanvas = document.createElement('canvas');
        mergedCanvas.width = session.width;
        mergedCanvas.height = session.height;
        const mergedCtx = mergedCanvas.getContext('2d', { willReadFrequently: false });
        if (!mergedCtx) {
            return;
        }
        if (lower?.canvas && normalizeLayerVisibility(lower.visible, true) !== false) {
            mergedCtx.save();
            mergedCtx.globalAlpha = normalizeLayerOpacity(lower.opacity);
            mergedCtx.drawImage(lower.canvas, 0, 0);
            mergedCtx.restore();
        }
        if (upper?.canvas && normalizeLayerVisibility(upper.visible, true) !== false) {
            mergedCtx.save();
            mergedCtx.globalAlpha = normalizeLayerOpacity(upper.opacity);
            mergedCtx.drawImage(upper.canvas, 0, 0);
            mergedCtx.restore();
        }
        layers[upperIndex - 1] = {
            id: String(lower?.id || ''),
            name: String(lower?.name || ''),
            isBase: lower?.isBase === true,
            visible: normalizeLayerVisibility(lower?.visible, true),
            opacity: normalizeLayerOpacity(lower?.opacity),
            thumbnailTone: normalizeLayerThumbnailTone(lower?.thumbnailTone),
            canvas: mergedCanvas
        };
        layers.splice(upperIndex, 1);
        frameState.layers = layers;
    });
    logPaintTrace('timelineLayers.mergeDown', {
        upperIndex,
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

    return {
        clampPlaybackFps,
        clampFrameHoldValue,
        defaultUnitySheetBindingConfig,
        defaultAnimationUnityBindingConfig,
        normalizeUnitySheetBindingConfig,
        normalizeAnimationUnityBindingConfig,
        resolveProjectPlaybackSettings,
        normalizePlaybackRangeRecord,
        getAnimationPlaybackRanges,
        resolvePlaybackFallbackRange,
        resolveActivePlaybackRange,
        resolvePlaybackFps,
        resolveProjectUnityBinding,
        resolveAnimationUnityBinding,
        resolveEffectiveUnitySheetBinding,
        describePlaybackRangeFrames,
        renderPlaybackRangesMarkup,
        renderPlaybackHoldSummaryMarkup,
        renderAnimationPanelMarkup,
        renderUnityPanelMarkup,
        resolveAnimationLayerSchemaRelativePath,
        resolveAnimationFrameLayerDirRelativePath,
        resolveAnimationFrameLayerManifestRelativePath,
        resolveAnimationFrameLayerImageRelativePath,
        createBlankTimelineCanvas,
        buildTimelineLayerSchemaFromLayers,
        extractNumericLayerId,
        normalizeTimelineLayerSchema,
        buildCanonicalAnimationLayerSchema,
        normalizeTimelineLayerSnapshots,
        repairLoadedTimelineFrameStates,
        repairSessionLayerStructureIfNeeded,
        syncSessionLayerIdCounterToKnownLayers,
        readPersistedAnimationLayerSchema,
        persistAnimationLayerSchema,
        loadPersistedTimelineFrameState,
        persistTimelineFrameState,
        persistLoadedTimelineStates,
        persistActiveTimelineFrameState,
        buildTimelineFrameDebugSummary,
        resolveFramePath,
        framePathUsesRootImagePath,
        ensureAnimationFrameHasDedicatedFile,
        applyTimelineLayerSnapshotsToSession,
        buildFrameStateFromImagePath,
        syncTimelineFrameStatesAfterLayerInsert,
        syncTimelineFrameStatesAfterLayerDelete,
        syncTimelineFrameStatesAfterLayerSwap,
        syncTimelineFrameStatesAfterLayerDuplicate,
        syncTimelineFrameStatesAfterLayerMergeDown
    };
};
