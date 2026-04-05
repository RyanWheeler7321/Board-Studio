'use strict';

// MARK: WORKSPACE UI
module.exports = function createPaintWorkspaceUiModule(deps) {
    const {
        dom,
        env,
        utils,
        assetActions,
        projectStore,
        paintWorkspaceState,
        paintWorkspaceUi,
        DEFAULT_CREATE_PROJECT_WIDTH,
        DEFAULT_CREATE_PROJECT_HEIGHT,
        DEFAULT_CREATE_PROJECT_ASPECT_PRESET,
        DEFAULT_CREATE_PROJECT_SCALE,
        CREATE_PROJECT_ASPECT_PRESETS,
        CREATE_PROJECT_SCALE_OPTIONS,
        SUPPORTED_PROJECT_IMAGE_TYPES,
        MAX_CANVAS_DIMENSION,
        getSession,
        clamp,
        logPaintTrace,
        resolveWorkspaceAsset,
        isWorkspacePlaceholderState,
        isTemporaryWorkspaceAsset,
        isStandaloneBoardImageSession,
        isFileBackedPaintSession,
        switchPaintFile,
        promptForPaintImageFiles,
        closePaintLayerViewer: closeExternalPaintLayerViewer,
        setCanvasMenuVisible,
        setBlendMenuVisible,
        setToolMenuVisible,
        renderAnimationPanelMarkup,
        renderUnityPanelMarkup,
        resolveSessionAnimationContext,
        resolveEffectiveUnitySheetBinding,
        resolveUnityBindingScopeValue,
        updateUnityBindingConfig,
        importBoundSpriteSheetInPaint,
        updateUnitySpriteSheetInPaint,
        updateUnityAssetSheetInPaint,
        pickUnitySheetPath,
        escapeWorkspaceText,
        clearUiCanvas,
        syncOverlayCanvasPresentation,
        renderStageUi,
        renderCursorCanvas,
        updateStageCursor,
        getLayerPreviewDataUrl,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        getActiveLayer
    } = deps;

    const sessionProxy = new Proxy({}, {
        get(_target, prop) {
            return getSession()?.[prop];
        }
    });

    const projectBarUiState = {
        fadeTimer: null,
        listenersAttached: false,
        mouseNearTop: false
    };

    function noop() {}

    function nowIso() {
        return new Date().toISOString();
    }

    function ensurePanelRoot(key, className) {
        if (paintWorkspaceUi[key] && paintWorkspaceUi[key].isConnected) {
            return paintWorkspaceUi[key];
        }
        const element = document.createElement('section');
        element.className = className;
        element.hidden = true;
        dom.paintOverlay.appendChild(element);
        paintWorkspaceUi[key] = element;
        return element;
    }

    function ensureLayerViewerRoot() {
        if (paintWorkspaceUi.layerViewerEl && paintWorkspaceUi.layerViewerEl.isConnected) {
            return paintWorkspaceUi.layerViewerEl;
        }
        const overlay = document.createElement('section');
        overlay.className = 'paint-layer-viewer-overlay';
        overlay.hidden = true;
        dom.paintOverlay.appendChild(overlay);
        paintWorkspaceUi.layerViewerEl = overlay;
        return overlay;
    }

    function ensurePaintWorkspaceUi() {
        paintWorkspaceUi.projectBarEl = dom.paintProjectBar || paintWorkspaceUi.projectBarEl;
        ensureProjectBarVisibilityListeners();
        ensurePanelRoot('panelEl', 'paint-project-panel');
        ensurePanelRoot('unityPanelEl', 'paint-unity-panel');
        ensurePanelRoot('drawerEl', 'paint-animation-drawer');
        ensurePanelRoot('createModalEl', 'paint-create-modal-overlay');
        ensureLayerViewerRoot();
        return paintWorkspaceUi;
    }

    function clearProjectBarFadeTimer() {
        if (!projectBarUiState.fadeTimer) {
            return;
        }
        clearTimeout(projectBarUiState.fadeTimer);
        projectBarUiState.fadeTimer = null;
    }

    function isProjectBarPinnedVisible() {
        return paintWorkspaceState.projectMenuHidden !== true || projectBarUiState.mouseNearTop;
    }

    function applyProjectBarFadeState(options = {}) {
        const projectBar = paintWorkspaceUi.projectBarEl;
        if (!projectBar || projectBar.hidden) {
            return;
        }
        const faded = options.faded === true;
        projectBar.classList.toggle('is-faded', faded);
        projectBar.setAttribute('aria-hidden', faded ? 'true' : 'false');
    }

    function scheduleProjectBarVisibilityRefresh(options = {}) {
        const projectBar = paintWorkspaceUi.projectBarEl;
        if (!projectBar || projectBar.hidden) {
            clearProjectBarFadeTimer();
            return;
        }
        clearProjectBarFadeTimer();
        applyProjectBarFadeState({ faded: false });
        if (options.reveal !== true && isProjectBarPinnedVisible()) {
            return;
        }
        if (isProjectBarPinnedVisible()) {
            return;
        }
        projectBarUiState.fadeTimer = setTimeout(() => {
            projectBarUiState.fadeTimer = null;
            applyProjectBarFadeState({ faded: !isProjectBarPinnedVisible() });
        }, 3000);
    }

    function updateProjectBarMouseProximity(clientY) {
        const nextMouseNearTop = Number.isFinite(clientY) && clientY <= 112;
        if (projectBarUiState.mouseNearTop === nextMouseNearTop) {
            return;
        }
        projectBarUiState.mouseNearTop = nextMouseNearTop;
        if (nextMouseNearTop) {
            clearProjectBarFadeTimer();
            applyProjectBarFadeState({ faded: false });
            return;
        }
        scheduleProjectBarVisibilityRefresh();
    }

    function ensureProjectBarVisibilityListeners() {
        if (projectBarUiState.listenersAttached || typeof window === 'undefined') {
            return;
        }
        projectBarUiState.listenersAttached = true;
        window.addEventListener('mousemove', (event) => {
            updateProjectBarMouseProximity(event?.clientY);
        }, { passive: true });
        window.addEventListener('mouseleave', () => {
            updateProjectBarMouseProximity(Number.POSITIVE_INFINITY);
        });
        window.addEventListener('blur', () => {
            updateProjectBarMouseProximity(Number.POSITIVE_INFINITY);
        });
    }

    function clampCreateProjectDimension(value, fallback = DEFAULT_CREATE_PROJECT_WIDTH) {
        const numeric = Math.round(Number(value) || Number(fallback) || 1);
        return clamp(numeric, 1, MAX_CANVAS_DIMENSION);
    }

    function normalizeCreateProjectScale(value) {
        const candidate = String(value || '').trim();
        return CREATE_PROJECT_SCALE_OPTIONS.some((entry) => String(entry) === candidate)
            ? candidate
            : DEFAULT_CREATE_PROJECT_SCALE;
    }

    function findCreateProjectAspectPreset(value) {
        const key = String(value || '').trim();
        return CREATE_PROJECT_ASPECT_PRESETS.find((entry) => entry.key === key) || CREATE_PROJECT_ASPECT_PRESETS[0];
    }

    function formatCreateProjectScaleLabel(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return '1x';
        }
        const normalized = String(numeric).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        return `${normalized}x`;
    }

    function ensureCreateProjectState() {
        paintWorkspaceState.createAspectPreset = findCreateProjectAspectPreset(
            paintWorkspaceState.createAspectPreset || DEFAULT_CREATE_PROJECT_ASPECT_PRESET
        ).key;
        paintWorkspaceState.createScale = normalizeCreateProjectScale(paintWorkspaceState.createScale);
        paintWorkspaceState.createWidth = clampCreateProjectDimension(paintWorkspaceState.createWidth, DEFAULT_CREATE_PROJECT_WIDTH);
        paintWorkspaceState.createHeight = clampCreateProjectDimension(paintWorkspaceState.createHeight, DEFAULT_CREATE_PROJECT_HEIGHT);
    }

    function applyCreateProjectAspectPreset(presetKey, scaleValue = paintWorkspaceState.createScale, options = {}) {
        const preset = findCreateProjectAspectPreset(presetKey);
        const scale = Number(normalizeCreateProjectScale(scaleValue)) || 1;
        paintWorkspaceState.createAspectPreset = preset.key;
        paintWorkspaceState.createScale = normalizeCreateProjectScale(scaleValue);
        paintWorkspaceState.createWidth = clampCreateProjectDimension(Math.round(preset.width * scale), preset.width);
        paintWorkspaceState.createHeight = clampCreateProjectDimension(Math.round(preset.height * scale), preset.height);
        if (options.render !== false) {
            renderPaintWorkspaceUi();
        }
    }

    function syncCreateDialogStateFromDom() {
        const root = paintWorkspaceUi.createModalEl && !paintWorkspaceUi.createModalEl.hidden
            ? paintWorkspaceUi.createModalEl
            : paintWorkspaceUi.panelEl;
        if (!root) {
            return;
        }
        const nameInput = root.querySelector('[data-role="create-name"]');
        const widthInput = root.querySelector('[data-role="create-width"]');
        const heightInput = root.querySelector('[data-role="create-height"]');
        const scaleInput = root.querySelector('[data-role="create-scale"]');
        if (nameInput) {
            paintWorkspaceState.createName = String(nameInput.value || '');
        }
        if (widthInput) {
            paintWorkspaceState.createWidth = clampCreateProjectDimension(widthInput.value, DEFAULT_CREATE_PROJECT_WIDTH);
        }
        if (heightInput) {
            paintWorkspaceState.createHeight = clampCreateProjectDimension(heightInput.value, DEFAULT_CREATE_PROJECT_HEIGHT);
        }
        if (scaleInput) {
            paintWorkspaceState.createScale = normalizeCreateProjectScale(scaleInput.value);
        }
    }

    function setCreateProjectDropActive(active) {
        paintWorkspaceState.createDropActive = active === true;
        if (paintWorkspaceUi.createModalEl && !paintWorkspaceUi.createModalEl.hidden) {
            paintWorkspaceUi.createModalEl.classList.toggle('is-drop-active', paintWorkspaceState.createDropActive === true);
        }
    }

    function isProjectCreationSurfaceActive() {
        const asset = resolveWorkspaceAsset();
        return paintWorkspaceState.createDialogOpen === true || !asset || isWorkspacePlaceholderState() || isTemporaryWorkspaceAsset(asset);
    }

    function extractDroppedProjectImageFiles(dataTransfer) {
        const items = Array.from(dataTransfer?.files || []);
        return items.filter((file) => {
            const type = String(file?.type || '').toLowerCase();
            return type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(file?.path || file?.name || ''));
        });
    }

    async function finalizeCreatedPaintProject(result) {
        if (!result?.asset?.id) {
            return null;
        }
        paintWorkspaceState.createDialogOpen = false;
        projectStore.selectAsset(result.asset.id, 'asset2d-select-created');
        if (result.launchTarget) {
            projectStore.setLastOpenedTarget(result.asset.id, result.launchTarget, 'asset2d-open-created');
        }
        if (result.absolutePath) {
            await switchPaintFile(result.absolutePath);
        } else {
            renderPaintWorkspaceUi();
        }
        return result;
    }

    async function createBlankPaintProject(options = {}) {
        ensureCreateProjectState();
        const result = await assetActions.createBlankAssetProject({
            name: String(options.name || paintWorkspaceState.createName || '').trim() || 'Untitled Project',
            width: clampCreateProjectDimension(options.width || paintWorkspaceState.createWidth, DEFAULT_CREATE_PROJECT_WIDTH),
            height: clampCreateProjectDimension(options.height || paintWorkspaceState.createHeight, DEFAULT_CREATE_PROJECT_HEIGHT),
            type: String(options.type || 'concept').trim() || 'concept'
        });
        return await finalizeCreatedPaintProject(result);
    }

    async function createPaintProjectFromImageFile(filePath, options = {}) {
        const result = await assetActions.importStillImageAsset(filePath, {
            name: String(options.name || '').trim() || ''
        });
        return await finalizeCreatedPaintProject(result);
    }

    async function createPaintProjectFromClipboard() {
        const nativeImage = env.electron?.clipboard?.readImage?.();
        if (!nativeImage || nativeImage.isEmpty()) {
            utils.showToast?.('Clipboard does not contain an image');
            return null;
        }
        const size = nativeImage.getSize?.() || {};
        const result = await assetActions.createStillImageAssetFromBuffer(nativeImage.toPNG(), {
            name: String(paintWorkspaceState.createName || '').trim() || 'Clipboard Project',
            width: clampCreateProjectDimension(size.width, DEFAULT_CREATE_PROJECT_WIDTH),
            height: clampCreateProjectDimension(size.height, DEFAULT_CREATE_PROJECT_HEIGHT),
            sourceExt: 'png',
            type: 'concept'
        });
        return await finalizeCreatedPaintProject(result);
    }

    async function chooseImageForNewPaintProject() {
        const files = await promptForPaintImageFiles({
            accept: SUPPORTED_PROJECT_IMAGE_TYPES,
            multiple: false
        });
        const first = files[0];
        if (!first?.path) {
            return null;
        }
        return await createPaintProjectFromImageFile(first.path, {
            name: String(paintWorkspaceState.createName || '').trim()
        });
    }

    function openPaintCreateDialog() {
        ensureCreateProjectState();
        paintWorkspaceState.createDialogOpen = true;
        renderPaintWorkspaceUi();
    }

    function closePaintCreateDialog() {
        paintWorkspaceState.createDialogOpen = false;
        setCreateProjectDropActive(false);
        renderPaintWorkspaceUi();
    }

    function buildProjectThumbnailSrc(asset) {
        const relative = projectStore.resolveAssetThumbnailPath(asset);
        return relative ? projectStore.toFileUrl(asset, relative) : '';
    }

    function buildProjectListMarkup(asset, assets) {
        const cards = assets.map((entry) => {
            const active = String(entry.id || '') === String(asset?.id || '');
            const thumbSrc = buildProjectThumbnailSrc(entry);
            const count = Object.keys(entry.animations || {}).length;
            return `
                <button type="button" class="paint-layer-viewer-tile${active ? ' is-focused' : ''}" data-action="project-open-asset" data-asset-id="${escapeWorkspaceText(entry.id)}">
                    <div class="paint-layer-viewer-tile-canvas">
                        ${thumbSrc ? `<img src="${thumbSrc}" alt="">` : '<div class="paint-layer-viewer-tile-empty">No image</div>'}
                    </div>
                    <div class="paint-layer-viewer-tile-meta">
                        <div class="paint-layer-viewer-tile-name">${escapeWorkspaceText(entry.name || 'Untitled Project')}</div>
                        <div class="paint-layer-viewer-badges">
                            <span class="paint-layer-viewer-badge${active ? ' is-active' : ''}">${active ? 'Open' : 'Project'}</span>
                            <span class="paint-layer-viewer-badge">${count} Anim</span>
                        </div>
                    </div>
                </button>
            `;
        }).join('');
        return `
            <div class="paint-project-section paint-project-section--settings">
                <div class="paint-project-section-head">
                    <div class="paint-project-section-title">Projects</div>
                </div>
                <div class="paint-layer-viewer-grid">${cards || '<div class="paint-project-empty">No projects yet.</div>'}</div>
            </div>
        `;
    }

    function buildCreateDialogMarkup() {
        ensureCreateProjectState();
        const preset = findCreateProjectAspectPreset(paintWorkspaceState.createAspectPreset);
        return `
            <div class="paint-create-modal-scrim" data-action="create-cancel"></div>
            <div class="paint-create-modal-card">
                <div class="paint-create-modal-header">
                    <div>
                        <div class="paint-create-modal-title">New Project</div>
                        <div class="paint-create-modal-copy">Start blank, import an image, or paste one from the clipboard.</div>
                    </div>
                    <button type="button" class="paint-create-modal-close" data-action="create-cancel">X</button>
                </div>
                <label class="paint-project-field">
                    <span class="paint-project-label">Name</span>
                    <input class="paint-project-select" type="text" data-role="create-name" value="${escapeWorkspaceText(String(paintWorkspaceState.createName || ''))}" placeholder="Untitled Project">
                </label>
                <div class="paint-project-grid paint-project-grid--settings">
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Width</span>
                        <input class="paint-project-number paint-project-number--full" type="number" min="1" max="${MAX_CANVAS_DIMENSION}" step="1" data-role="create-width" value="${paintWorkspaceState.createWidth}">
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Height</span>
                        <input class="paint-project-number paint-project-number--full" type="number" min="1" max="${MAX_CANVAS_DIMENSION}" step="1" data-role="create-height" value="${paintWorkspaceState.createHeight}">
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Scale</span>
                        <select class="paint-project-select" data-role="create-scale">
                            ${CREATE_PROJECT_SCALE_OPTIONS.map((entry) => `<option value="${entry}"${String(entry) === String(paintWorkspaceState.createScale) ? ' selected' : ''}>${formatCreateProjectScaleLabel(entry)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="paint-project-inline-field paint-project-inline-field--stacked paint-project-setting-field">
                        <span>Aspect</span>
                        <select class="paint-project-select" data-role="create-aspect-preset">
                            ${CREATE_PROJECT_ASPECT_PRESETS.map((entry) => `<option value="${entry.key}"${entry.key === preset.key ? ' selected' : ''}>${escapeWorkspaceText(entry.label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="paint-create-modal-actions">
                    <button type="button" data-action="create-blank" class="is-primary">Create Blank</button>
                    <button type="button" data-action="create-import">Import Image</button>
                    <button type="button" data-action="create-paste">Paste Image</button>
                </div>
            </div>
        `;
    }

    function buildLogsMarkup() {
        const snapshots = Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : [];
        const debugEntries = Array.isArray(paintWorkspaceState.debugConsoleEntries) ? paintWorkspaceState.debugConsoleEntries : [];
        const snapshotMarkup = snapshots.map((entry) => `
            <button type="button" class="paint-animation-btn" data-action="log-restore" data-snapshot-id="${escapeWorkspaceText(String(entry.id || ''))}">
                ${escapeWorkspaceText(String(entry.label || 'Snapshot'))}
            </button>
        `).join('');
        const debugMarkup = debugEntries.slice(-12).reverse().map((entry) => `
            <div class="paint-project-subtle">${escapeWorkspaceText(String(entry?.text || ''))}</div>
        `).join('');
        return `
            <div class="paint-project-section paint-project-section--settings">
                <div class="paint-project-section-head">
                    <div class="paint-project-section-title">Paint Logs</div>
                </div>
                <div class="paint-project-subtle">The public build keeps simple local paint logs and checkpoints only.</div>
                <div class="paint-unity-panel-actions">${snapshotMarkup || '<div class="paint-project-empty">No saved checkpoints yet.</div>'}</div>
            </div>
            <div class="paint-project-section paint-project-section--settings">
                <div class="paint-project-section-head">
                    <div class="paint-project-section-title">Recent Console</div>
                </div>
                ${debugMarkup || '<div class="paint-project-empty">No paint log entries yet.</div>'}
            </div>
        `;
    }

    function buildProjectPanelMarkup(asset, assets, context) {
        const thumbSrc = asset ? buildProjectThumbnailSrc(asset) : '';
        const activeAnimation = context.animation || null;
        const mode = String(paintWorkspaceState.panelMode || 'asset').trim() || 'asset';
        const currentPath = asset ? projectStore.resolvePreferredPaintFilePath(asset, context.target || null) : '';
        const detailsMarkup = mode === 'animation'
            ? renderAnimationPanelMarkup(asset, context)
            : (mode === 'logs'
                ? buildLogsMarkup()
                : `
                    <div class="paint-project-section paint-project-section--settings">
                        <div class="paint-project-section-head">
                            <div class="paint-project-section-title">Current Project</div>
                        </div>
                        <div class="paint-project-preview">
                            ${thumbSrc ? `<img src="${thumbSrc}" alt="">` : '<div class="paint-project-empty">No preview</div>'}
                        </div>
                        <div class="paint-project-subtle">${escapeWorkspaceText(currentPath || 'No file is open yet.')}</div>
                        <div class="paint-unity-panel-actions">
                            <button type="button" class="paint-animation-btn" data-action="create-open">New</button>
                            <button type="button" class="paint-animation-btn" data-action="create-import">Import</button>
                            <button type="button" class="paint-animation-btn" data-action="create-paste">Paste</button>
                            <button type="button" class="paint-animation-btn" data-action="project-open-folder"${currentPath ? '' : ' disabled'}>Explorer</button>
                        </div>
                    </div>
                    ${buildProjectListMarkup(asset, assets)}
                `);
        const activeName = asset?.name || (isStandaloneBoardImageSession() || isFileBackedPaintSession() ? 'Open Image' : 'No Project');
        const animationName = activeAnimation?.name || 'No animation';
        return `
            <div class="paint-project-section paint-project-section--settings">
                <div class="paint-project-section-head">
                    <div class="paint-project-section-title">${escapeWorkspaceText(activeName)}</div>
                    <button type="button" class="paint-project-icon" data-action="workspace-panel-toggle">X</button>
                </div>
                <div class="paint-project-subtle">${escapeWorkspaceText(animationName)}</div>
                <div class="paint-project-tabs">
                    <button type="button" class="paint-project-tab${mode === 'asset' ? ' is-active' : ''}" data-action="workspace-mode" data-mode="asset">Project</button>
                    <button type="button" class="paint-project-tab${mode === 'animation' ? ' is-active' : ''}" data-action="workspace-mode" data-mode="animation">Animation</button>
                    <button type="button" class="paint-project-tab${mode === 'logs' ? ' is-active' : ''}" data-action="workspace-mode" data-mode="logs">Logs</button>
                </div>
            </div>
            ${detailsMarkup}
        `;
    }

    function buildProjectBarMarkup(asset) {
        const name = asset?.name || 'No Project';
        return `
            <div class="paint-top-row">
                <div class="paint-top-title">${escapeWorkspaceText(name)}</div>
            </div>
        `;
    }

    function renderPaintProjectBar(asset, assets, options = {}) {
        ensurePaintWorkspaceUi();
        if (!paintWorkspaceUi.projectBarEl) {
            return;
        }
        paintWorkspaceUi.projectBarEl.hidden = options.hidden === true;
        paintWorkspaceUi.projectBarEl.innerHTML = buildProjectBarMarkup(asset, assets);
        if (paintWorkspaceUi.projectBarEl.hidden) {
            clearProjectBarFadeTimer();
            paintWorkspaceUi.projectBarEl.classList.remove('is-faded');
            paintWorkspaceUi.projectBarEl.removeAttribute('aria-hidden');
            return;
        }
        scheduleProjectBarVisibilityRefresh({ reveal: true });
    }

    function buildLayerViewerEntries() {
        const session = getSession();
        if (!session?.layers?.length) {
            return [];
        }
        const activeLayerId = String(getActiveLayer()?.id || '').trim();
        return session.layers.map((layer, index) => ({
            id: String(layer.id || ''),
            index,
            name: String(layer.name || `Layer ${index + 1}`),
            active: String(layer.id || '') === activeLayerId,
            preview: getLayerPreviewDataUrl(layer)
        })).filter((entry) => !!entry.id);
    }

    function renderLayerViewerOverlay() {
        ensurePaintWorkspaceUi();
        const root = ensureLayerViewerRoot();
        const entries = buildLayerViewerEntries();
        if (!paintWorkspaceState.layerViewerOpen || !entries.length) {
            root.hidden = true;
            root.innerHTML = '';
            return;
        }
        const focusedId = String(paintWorkspaceState.layerViewerFocusedLayerId || entries.find((entry) => entry.active)?.id || entries[0]?.id || '');
        const tiles = entries.map((entry) => `
            <button type="button" class="paint-layer-viewer-tile${entry.id === focusedId ? ' is-focused' : ''}" data-action="layer-viewer-focus" data-layer-id="${escapeWorkspaceText(entry.id)}">
                <div class="paint-layer-viewer-tile-canvas">
                    ${entry.preview ? `<img src="${entry.preview}" alt="">` : '<div class="paint-layer-viewer-tile-empty">Empty</div>'}
                </div>
                <div class="paint-layer-viewer-tile-meta">
                    <div class="paint-layer-viewer-tile-name">${escapeWorkspaceText(entry.name)}</div>
                    <div class="paint-layer-viewer-tile-badges">
                        <span class="paint-layer-viewer-badge${entry.active ? ' is-active' : ''}">${entry.active ? 'Active' : `L${entry.index + 1}`}</span>
                    </div>
                </div>
            </button>
        `).join('');
        root.hidden = false;
        root.innerHTML = `
            <div class="paint-layer-viewer-shell is-focused">
                <div class="paint-layer-viewer-status">Layer Viewer</div>
                <div class="paint-layer-viewer-grid">${tiles}</div>
            </div>
        `;
    }

    function openPaintLayerViewer() {
        paintWorkspaceState.layerViewerOpen = true;
        renderLayerViewerOverlay();
    }

    function closePaintLayerViewer() {
        paintWorkspaceState.layerViewerOpen = false;
        renderLayerViewerOverlay();
    }

    function togglePaintLayerViewer() {
        paintWorkspaceState.layerViewerOpen = !paintWorkspaceState.layerViewerOpen;
        renderLayerViewerOverlay();
    }

    function navigatePaintLayerViewer(step) {
        const entries = buildLayerViewerEntries();
        if (!entries.length) {
            return;
        }
        const currentId = String(paintWorkspaceState.layerViewerFocusedLayerId || entries.find((entry) => entry.active)?.id || entries[0].id);
        const currentIndex = Math.max(0, entries.findIndex((entry) => entry.id === currentId));
        const nextIndex = clamp(currentIndex + step, 0, entries.length - 1);
        paintWorkspaceState.layerViewerFocusedLayerId = entries[nextIndex].id;
        renderLayerViewerOverlay();
    }

    function clearPaintWorkspaceVariantPreview() {
        paintWorkspaceState.previewVariantId = '';
    }

    function refreshPaintStageView() {
        clearUiCanvas();
        syncOverlayCanvasPresentation?.();
        renderStageUi();
        renderCursorCanvas();
        updateStageCursor();
        queueLayerPreviewRefresh?.();
        queueStageShadowRefresh?.();
    }

    function clearPaintWorkspaceStage() {
        if (paintWorkspaceUi.panelEl) {
            paintWorkspaceUi.panelEl.hidden = true;
            paintWorkspaceUi.panelEl.innerHTML = '';
        }
        if (paintWorkspaceUi.unityPanelEl) {
            paintWorkspaceUi.unityPanelEl.hidden = true;
            paintWorkspaceUi.unityPanelEl.innerHTML = '';
        }
        if (paintWorkspaceUi.projectBarEl) {
            clearProjectBarFadeTimer();
            paintWorkspaceUi.projectBarEl.hidden = true;
            paintWorkspaceUi.projectBarEl.classList.remove('is-faded');
            paintWorkspaceUi.projectBarEl.removeAttribute('aria-hidden');
            paintWorkspaceUi.projectBarEl.innerHTML = '';
        }
        closeExternalPaintLayerViewer?.();
    }

    async function openSelectedAsset(assetId) {
        const asset = projectStore.getAsset(assetId);
        if (!asset?.id) {
            return;
        }
        projectStore.selectAsset(asset.id, 'asset2d-select');
        const target = projectStore.resolveLastOpenedTarget(asset.id);
        const filePath = projectStore.resolvePreferredPaintFilePath(asset, target);
        if (filePath) {
            await switchPaintFile(filePath);
        } else {
            renderPaintWorkspaceUi();
        }
    }

    async function chooseUnityTargetPath(asset, animation, mode) {
        const result = await pickUnitySheetPath(mode, {
            initialPath: resolveEffectiveUnitySheetBinding(asset, animation).binding?.targetPath || ''
        });
        if (!result) {
            return;
        }
        updateUnityBindingConfig(asset.id, animation?.id || '', {
            targetPath: result,
            enabled: true
        }, 'asset2d-unity-binding-path');
        renderPaintWorkspaceUi();
    }

    async function handleWorkspaceAction(target) {
        const action = String(target?.dataset?.action || '').trim();
        if (!action) {
            return false;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        if (action === 'workspace-panel-toggle') {
            paintWorkspaceState.projectMenuHidden = !paintWorkspaceState.projectMenuHidden;
            renderPaintWorkspaceUi();
            return true;
        }
        if (action === 'workspace-unity-toggle') {
            paintWorkspaceState.unityPanelHidden = !paintWorkspaceState.unityPanelHidden;
            renderPaintWorkspaceUi();
            return true;
        }
        if (action === 'workspace-mode') {
            paintWorkspaceState.panelMode = String(target.dataset.mode || 'asset');
            renderPaintWorkspaceUi();
            return true;
        }
        if (action === 'project-open-asset') {
            await openSelectedAsset(String(target.dataset.assetId || ''));
            return true;
        }
        if (action === 'project-open-folder') {
            const filePath = asset ? projectStore.resolvePreferredPaintFilePath(asset, context.target || null) : '';
            if (filePath) {
                await env.electron?.ipcRenderer?.invoke?.('workboard:2d-open-path', { targetPath: env.path.dirname(filePath) });
            }
            return true;
        }
        if (action === 'create-open') {
            openPaintCreateDialog();
            return true;
        }
        if (action === 'create-cancel') {
            closePaintCreateDialog();
            return true;
        }
        if (action === 'create-blank') {
            syncCreateDialogStateFromDom();
            await createBlankPaintProject();
            return true;
        }
        if (action === 'create-import') {
            syncCreateDialogStateFromDom();
            await chooseImageForNewPaintProject();
            return true;
        }
        if (action === 'create-paste') {
            syncCreateDialogStateFromDom();
            await createPaintProjectFromClipboard();
            return true;
        }
        if (action === 'unity-choose-sheet-target' && asset) {
            await chooseUnityTargetPath(asset, context.animation, 'save');
            return true;
        }
        if (action === 'unity-bind-existing-sheet' && asset) {
            await chooseUnityTargetPath(asset, context.animation, 'open');
            return true;
        }
        if (action === 'unity-import-sheet' && asset) {
            await importBoundSpriteSheetInPaint(asset, context.animation);
            renderPaintWorkspaceUi();
            return true;
        }
        if (action === 'unity-update-sheet' && asset && context.animation) {
            await updateUnitySpriteSheetInPaint(asset, context.animation);
            utils.showToast?.('Sprite sheet updated');
            return true;
        }
        if (action === 'unity-update-asset-sheet' && asset && context.animation) {
            await updateUnityAssetSheetInPaint(asset, context.animation);
            utils.showToast?.('Unity asset sheet updated');
            return true;
        }
        if (action === 'layer-viewer-focus') {
            paintWorkspaceState.layerViewerFocusedLayerId = String(target.dataset.layerId || '');
            renderLayerViewerOverlay();
            return true;
        }
        return false;
    }

    function handlePaintWorkspacePanelClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeExternalPaintLayerViewer?.({ render: false });
        setCanvasMenuVisible(false);
        setBlendMenuVisible(false);
        setToolMenuVisible(false);
        handleWorkspaceAction(target).catch((error) => {
            logPaintTrace('workspace.action.error', {
                action: String(target.dataset.action || ''),
                message: error?.message || String(error)
            });
            utils.showToast?.(error?.message || 'Workspace action failed');
        });
    }

    function handlePaintWorkspacePanelInput(event) {
        const target = event.target;
        const role = String(target?.dataset?.role || '').trim();
        if (!target) {
            return;
        }
        if (role === 'create-name') {
            paintWorkspaceState.createName = String(target.value || '');
            return;
        }
        if (role === 'create-width') {
            paintWorkspaceState.createWidth = clampCreateProjectDimension(target.value, DEFAULT_CREATE_PROJECT_WIDTH);
            return;
        }
        if (role === 'create-height') {
            paintWorkspaceState.createHeight = clampCreateProjectDimension(target.value, DEFAULT_CREATE_PROJECT_HEIGHT);
            return;
        }
        const asset = resolveWorkspaceAsset();
        const context = resolveSessionAnimationContext(asset);
        if (!asset?.id) {
            return;
        }
        const animationId = context.animation?.id || '';
        if (role === 'unity-target-path') {
            updateUnityBindingConfig(asset.id, animationId, {
                targetPath: String(target.value || '').trim()
            }, 'asset2d-unity-binding-input');
            return;
        }
        if (role === 'unity-columns') {
            updateUnityBindingConfig(asset.id, animationId, {
                columns: Math.max(1, Math.round(Number(target.value) || 1))
            }, 'asset2d-unity-columns');
            return;
        }
        if (role === 'unity-rows') {
            updateUnityBindingConfig(asset.id, animationId, {
                rows: Math.max(1, Math.round(Number(target.value) || 1))
            }, 'asset2d-unity-rows');
            return;
        }
        if (role === 'unity-frame-width') {
            updateUnityBindingConfig(asset.id, animationId, {
                frameWidth: Math.max(0, Math.round(Number(target.value) || 0))
            }, 'asset2d-unity-frame-width');
            return;
        }
        if (role === 'unity-frame-height') {
            updateUnityBindingConfig(asset.id, animationId, {
                frameHeight: Math.max(0, Math.round(Number(target.value) || 0))
            }, 'asset2d-unity-frame-height');
            return;
        }
        if (role === 'unity-downscale') {
            updateUnityBindingConfig(asset.id, animationId, {
                downscale: Math.max(1, Number(target.value) || 1)
            }, 'asset2d-unity-downscale');
        }
    }

    function handlePaintWorkspacePanelPointerOver() {
        noop();
    }

    function handlePaintPasteEvent(event) {
        if (!isProjectCreationSurfaceActive()) {
            return false;
        }
        const clipboardItems = Array.from(event?.clipboardData?.items || []);
        const hasImage = clipboardItems.some((item) => String(item?.type || '').toLowerCase().startsWith('image/'));
        if (!hasImage && !(env.electron?.clipboard?.readImage?.() && !env.electron.clipboard.readImage().isEmpty())) {
            return false;
        }
        event.preventDefault();
        createPaintProjectFromClipboard().catch((error) => {
            utils.showToast?.(error?.message || 'Clipboard import failed');
        });
        return true;
    }

    function isPaintEditableTextField(element) {
        if (!element) {
            return false;
        }
        const tagName = String(element.tagName || '').toLowerCase();
        return element.isContentEditable || tagName === 'textarea' || tagName === 'input' || tagName === 'select';
    }

    function renderPaintWorkspaceUi() {
        ensurePaintWorkspaceUi();
        const asset = resolveWorkspaceAsset();
        const assets = projectStore.listAssets();
        const context = resolveSessionAnimationContext(asset);
        const showWorkspace = !!asset || isWorkspacePlaceholderState() || paintWorkspaceState.createDialogOpen === true || !assets.length;
        renderPaintProjectBar(asset, assets, {
            hidden: !showWorkspace
        });
        if (paintWorkspaceUi.panelEl) {
            paintWorkspaceUi.panelEl.hidden = paintWorkspaceState.projectMenuHidden === true || !showWorkspace;
            paintWorkspaceUi.panelEl.innerHTML = paintWorkspaceState.projectMenuHidden === true || !showWorkspace
                ? ''
                : buildProjectPanelMarkup(asset, assets, context);
            paintWorkspaceUi.panelEl.onclick = handlePaintWorkspacePanelClick;
            paintWorkspaceUi.panelEl.oninput = handlePaintWorkspacePanelInput;
            paintWorkspaceUi.panelEl.onpointerover = handlePaintWorkspacePanelPointerOver;
        }
        if (paintWorkspaceUi.projectBarEl) {
            paintWorkspaceUi.projectBarEl.onclick = handlePaintWorkspacePanelClick;
        }
        if (paintWorkspaceUi.unityPanelEl) {
            const showUnity = !!asset && paintWorkspaceState.unityPanelHidden !== true;
            paintWorkspaceUi.unityPanelEl.hidden = !showUnity;
            paintWorkspaceUi.unityPanelEl.innerHTML = showUnity
                ? renderUnityPanelMarkup(asset, context)
                : '';
            paintWorkspaceUi.unityPanelEl.onclick = handlePaintWorkspacePanelClick;
            paintWorkspaceUi.unityPanelEl.oninput = handlePaintWorkspacePanelInput;
        }
        if (paintWorkspaceUi.createModalEl) {
            paintWorkspaceUi.createModalEl.hidden = paintWorkspaceState.createDialogOpen !== true;
            paintWorkspaceUi.createModalEl.innerHTML = paintWorkspaceState.createDialogOpen === true
                ? buildCreateDialogMarkup()
                : '';
            paintWorkspaceUi.createModalEl.onclick = handlePaintWorkspacePanelClick;
            paintWorkspaceUi.createModalEl.oninput = handlePaintWorkspacePanelInput;
        }
        renderLayerViewerOverlay();
    }

    function handlePaintWorkspaceDragEnter(event) {
        if (!isProjectCreationSurfaceActive()) {
            return;
        }
        if (!extractDroppedProjectImageFiles(event.dataTransfer).length) {
            return;
        }
        event.preventDefault();
        setCreateProjectDropActive(true);
    }

    function handlePaintWorkspaceDragOver(event) {
        if (!isProjectCreationSurfaceActive()) {
            return;
        }
        if (!extractDroppedProjectImageFiles(event.dataTransfer).length) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        setCreateProjectDropActive(true);
    }

    function handlePaintWorkspaceDragLeave(event) {
        if (!isProjectCreationSurfaceActive()) {
            return;
        }
        const nextTarget = event.relatedTarget;
        if (nextTarget && dom.paintOverlay?.contains?.(nextTarget)) {
            return;
        }
        setCreateProjectDropActive(false);
    }

    async function handlePaintWorkspaceDrop(event) {
        if (!isProjectCreationSurfaceActive()) {
            return;
        }
        const files = extractDroppedProjectImageFiles(event.dataTransfer);
        setCreateProjectDropActive(false);
        if (!files.length) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        await createPaintProjectFromImageFile(files[0].path);
    }

    return {
        ensurePaintWorkspaceUi,
        syncCreateDialogStateFromDom,
        clampCreateProjectDimension,
        normalizeCreateProjectScale,
        findCreateProjectAspectPreset,
        formatCreateProjectScaleLabel,
        ensureCreateProjectState,
        applyCreateProjectAspectPreset,
        setCreateProjectDropActive,
        isProjectCreationSurfaceActive,
        extractDroppedProjectImageFiles,
        finalizeCreatedPaintProject,
        createBlankPaintProject,
        createPaintProjectFromImageFile,
        chooseImageForNewPaintProject,
        openPaintCreateDialog,
        closePaintCreateDialog,
        createPaintProjectFromClipboard,
        isPaintEditableTextField,
        handlePaintPasteEvent,
        handlePaintWorkspacePanelClick,
        handlePaintWorkspacePanelInput,
        handlePaintWorkspacePanelPointerOver,
        handlePaintWorkspaceDragEnter,
        handlePaintWorkspaceDragOver,
        handlePaintWorkspaceDragLeave,
        handlePaintWorkspaceDrop,
        renderPaintProjectBar,
        renderPaintWorkspaceUi,
        renderLayerViewerOverlay,
        openPaintLayerViewer,
        closePaintLayerViewer,
        togglePaintLayerViewer,
        navigatePaintLayerViewer,
        clearPaintWorkspaceVariantPreview,
        refreshPaintStageView,
        clearPaintWorkspaceStage
    };
};
