'use strict';

const { normalizePaintLaunchTarget, PAINT_LAUNCH_MODES } = require('./paintLaunchTarget');

const ASSET_SCHEMA_VERSION = 1;

function defaultStillState() {
    return {
        prompt: '',
        sourceImages: [],
        variants: [],
        workingImagePath: '',
        approvedImagePath: '',
        generationHistory: [],
        width: 0,
        height: 0
    };
}

function defaultReferenceRecord() {
    return {
        id: '',
        type: 'image',
        label: '',
        role: 'general',
        path: '',
        animationId: '',
        frameId: '',
        enabled: true,
        createdAt: '',
        updatedAt: ''
    };
}

function defaultUnitySheetBinding() {
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

function defaultAnimationUnityBinding() {
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

function defaultWorkspaceState() {
    return {
        lastOpenedTarget: normalizePaintLaunchTarget({
            mode: PAINT_LAUNCH_MODES.PROJECT_STILL
        }),
        lastOpenedAt: '',
        temporary: false,
        temporaryBoardId: '',
        temporaryBlockId: ''
    };
}

function defaultPlaybackState() {
    return {
        defaultPlaybackFps: 12,
        playbackLoop: true
    };
}

function defaultKritaIntegration() {
    return {
        lastOpenedPath: '',
        lastSidecarPath: '',
        openedAt: '',
        enabled: true
    };
}

function defaultUnityIntegration() {
    return {
        targetPath: '',
        exportPreset: 'sprite-sheet',
        autoPush: false,
        lastExportDir: '',
        lastPushAt: '',
        defaultSheetBinding: defaultUnitySheetBinding()
    };
}

function defaultPaintState() {
    return {
        lastEditedPath: '',
        editedAt: '',
        thumbnailPath: '',
        thumbnailUpdatedAt: '',
        layerCount: 1,
        frameCount: 1,
        noBoundaryClip: true,
        quickAnimationPeek: false,
        selectedLayerId: '',
        selectedLayerIndex: 0,
        selectedAnimationId: '',
        selectedFrameId: '',
        selectedFrameIndex: -1
    };
}

function normalizeUnitySheetBinding(binding, fallback = {}) {
    const next = {
        ...defaultUnitySheetBinding(),
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

function normalizeAnimationUnityBinding(binding) {
    const next = {
        ...defaultAnimationUnityBinding(),
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

function normalizePlaybackFps(value, fallback = 12) {
    return Math.max(1, Math.min(60, Math.round(Number(value) || Number(fallback) || 12)));
}

function normalizeHistoryEntry(entry, helpers = {}) {
    const nowIso = typeof helpers.nowIso === 'function' ? helpers.nowIso : () => new Date().toISOString();
    return {
        type: typeof entry?.type === 'string' ? entry.type : '',
        prompt: typeof entry?.prompt === 'string' ? entry.prompt : '',
        outputPaths: Array.isArray(entry?.outputPaths) ? entry.outputPaths.filter((value) => typeof value === 'string' && value) : [],
        sourcePaths: Array.isArray(entry?.sourcePaths) ? entry.sourcePaths.filter((value) => typeof value === 'string' && value) : [],
        at: typeof entry?.at === 'string' && entry.at ? entry.at : nowIso()
    };
}

function normalizeVariant(entry, helpers = {}) {
    const createId = typeof helpers.createId === 'function' ? helpers.createId : (prefix = 'id') => `${prefix}-${Date.now()}`;
    const nowIso = typeof helpers.nowIso === 'function' ? helpers.nowIso : () => new Date().toISOString();
    return {
        id: typeof entry?.id === 'string' && entry.id ? entry.id : createId('variant'),
        path: typeof entry?.path === 'string' ? entry.path : '',
        prompt: typeof entry?.prompt === 'string' ? entry.prompt : '',
        createdAt: typeof entry?.createdAt === 'string' && entry.createdAt ? entry.createdAt : nowIso(),
        approved: entry?.approved === true,
        sourcePath: typeof entry?.sourcePath === 'string' ? entry.sourcePath : '',
        status: typeof entry?.status === 'string' && entry.status ? entry.status : 'ready'
    };
}

function normalizePlaybackRange(entry, index = 0, helpers = {}) {
    const createId = typeof helpers.createId === 'function' ? helpers.createId : (prefix = 'id') => `${prefix}-${Date.now()}`;
    const title = typeof entry?.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : `Animation ${index + 1}`;
    const startFrameIndex = Math.max(0, Math.round(Number(entry?.startFrameIndex) || 0));
    const endFrameIndex = Math.max(startFrameIndex, Math.round(Number(entry?.endFrameIndex) || startFrameIndex));
    return {
        id: typeof entry?.id === 'string' && entry.id ? entry.id : createId('range'),
        title,
        startFrameIndex,
        endFrameIndex,
        fpsOverrideEnabled: entry?.fpsOverrideEnabled === true,
        fpsOverride: normalizePlaybackFps(entry?.fpsOverride, 12)
    };
}

function defaultAnimationRecord(helpers = {}) {
    const createId = typeof helpers.createId === 'function' ? helpers.createId : (prefix = 'id') => `${prefix}-${Date.now()}`;
    const nowIso = typeof helpers.nowIso === 'function' ? helpers.nowIso : () => new Date().toISOString();
    return {
        id: createId('animation'),
        name: 'Animation',
        sourceSheetPath: '',
        starterImagePath: '',
        motionPrompt: '',
        frameCount: 0,
        frameWidth: 0,
        frameHeight: 0,
        columns: 0,
        rows: 0,
        fps: 12,
        selectedFrameId: '',
        sourceFrameId: '',
        playbackRanges: [],
        frames: [],
        history: [],
        export: {
            unity: defaultAnimationUnityBinding()
        },
        createdAt: nowIso(),
        updatedAt: nowIso()
    };
}

function normalizeFrame(frame, helpers = {}) {
    const createId = typeof helpers.createId === 'function' ? helpers.createId : (prefix = 'id') => `${prefix}-${Date.now()}`;
    return {
        id: typeof frame?.id === 'string' && frame.id ? frame.id : createId('frame'),
        index: Math.max(0, Math.round(Number(frame?.index) || 0)),
        originalPath: typeof frame?.originalPath === 'string' ? frame.originalPath : '',
        workingPath: typeof frame?.workingPath === 'string' ? frame.workingPath : '',
        approvedPath: typeof frame?.approvedPath === 'string' ? frame.approvedPath : '',
        hold: Math.max(1, Math.round(Number(frame?.hold) || 1)),
        status: typeof frame?.status === 'string' ? frame.status : 'idle',
        notes: typeof frame?.notes === 'string' ? frame.notes : '',
        promptHistory: Array.isArray(frame?.promptHistory) ? frame.promptHistory.map((entry) => normalizeHistoryEntry(entry, helpers)) : [],
        manualEdited: frame?.manualEdited === true,
        approved: frame?.approved === true,
        isReference: frame?.isReference === true,
        keyframe: frame?.keyframe === true,
        selected: frame?.selected === true,
        reviewStatus: typeof frame?.reviewStatus === 'string' ? frame.reviewStatus : 'pending',
        lastRunAt: typeof frame?.lastRunAt === 'string' ? frame.lastRunAt : '',
        lastRunType: typeof frame?.lastRunType === 'string' ? frame.lastRunType : '',
        lastPresetKey: typeof frame?.lastPresetKey === 'string' ? frame.lastPresetKey : '',
        unityAssetPath: typeof frame?.unityAssetPath === 'string' ? frame.unityAssetPath : ''
    };
}

function normalizeAnimation(animation, helpers = {}) {
    const base = defaultAnimationRecord(helpers);
    const next = {
        ...base,
        ...(animation && typeof animation === 'object' ? animation : {})
    };
    next.id = typeof next.id === 'string' && next.id ? next.id : base.id;
    next.name = typeof next.name === 'string' && next.name.trim() ? next.name.trim() : base.name;
    next.sourceSheetPath = typeof next.sourceSheetPath === 'string' ? next.sourceSheetPath : '';
    next.starterImagePath = typeof next.starterImagePath === 'string' ? next.starterImagePath : '';
    next.motionPrompt = typeof next.motionPrompt === 'string' ? next.motionPrompt : '';
    next.frameCount = Math.max(0, Math.round(Number(next.frameCount) || 0));
    next.frameWidth = Math.max(0, Math.round(Number(next.frameWidth) || 0));
    next.frameHeight = Math.max(0, Math.round(Number(next.frameHeight) || 0));
    next.columns = Math.max(0, Math.round(Number(next.columns) || 0));
    next.rows = Math.max(0, Math.round(Number(next.rows) || 0));
    next.fps = normalizePlaybackFps(next.fps, 12);
    next.selectedFrameId = typeof next.selectedFrameId === 'string' ? next.selectedFrameId : '';
    next.sourceFrameId = typeof next.sourceFrameId === 'string' ? next.sourceFrameId : '';
    next.playbackRanges = Array.isArray(next.playbackRanges) ? next.playbackRanges.map((entry, index) => normalizePlaybackRange(entry, index, helpers)) : [];
    next.frames = Array.isArray(next.frames) ? next.frames.map((frame) => normalizeFrame(frame, helpers)).sort((a, b) => a.index - b.index) : [];
    next.frameCount = Math.max(next.frameCount, next.frames.length);
    next.history = Array.isArray(next.history) ? next.history.map((entry) => normalizeHistoryEntry(entry, helpers)) : [];
    next.export = next.export && typeof next.export === 'object' ? next.export : {};
    next.export.unity = normalizeAnimationUnityBinding(next.export.unity);
    next.createdAt = typeof next.createdAt === 'string' && next.createdAt ? next.createdAt : base.createdAt;
    next.updatedAt = typeof next.updatedAt === 'string' && next.updatedAt ? next.updatedAt : next.createdAt;
    return next;
}

function createAssetRecord(options = {}) {
    const createId = typeof options.createId === 'function' ? options.createId : (prefix = 'id') => `${prefix}-${Date.now()}`;
    const nowIso = typeof options.nowIso === 'function' ? options.nowIso : () => new Date().toISOString();
    return {
        version: ASSET_SCHEMA_VERSION,
        id: createId('asset2d'),
        type: typeof options.type === 'string' && options.type.trim() ? options.type.trim() : 'concept',
        name: typeof options.overrides?.name === 'string' && options.overrides.name.trim() ? options.overrides.name.trim() : 'Untitled Project',
        description: typeof options.overrides?.description === 'string' ? options.overrides.description : '',
        tags: Array.isArray(options.overrides?.tags) ? options.overrides.tags.filter((entry) => typeof entry === 'string' && entry) : [],
        still: defaultStillState(),
        paint: defaultPaintState(),
        playback: defaultPlaybackState(),
        animations: {},
        activeAnimationId: '',
        animationHistory: [],
        integrations: {
            krita: defaultKritaIntegration(),
            unity: defaultUnityIntegration()
        },
        workspace: defaultWorkspaceState(),
        createdAt: nowIso(),
        updatedAt: nowIso()
    };
}

function normalizeAsset(asset, helpers = {}) {
    const base = createAssetRecord({
        type: asset?.type,
        overrides: asset,
        createId: helpers.createId,
        nowIso: helpers.nowIso
    });
    const next = {
        ...base,
        ...(asset && typeof asset === 'object' ? asset : {})
    };
    next.version = ASSET_SCHEMA_VERSION;
    next.id = typeof next.id === 'string' && next.id ? next.id : base.id;
    next.type = typeof next.type === 'string' && next.type.trim() ? next.type.trim() : base.type;
    next.name = typeof next.name === 'string' && next.name.trim() ? next.name.trim() : base.name;
    next.description = typeof next.description === 'string' ? next.description : '';
    next.tags = Array.isArray(next.tags) ? next.tags.filter((entry) => typeof entry === 'string' && entry) : [];

    const legacyArt = next.art && typeof next.art === 'object' ? next.art : {};
    next.still = {
        ...defaultStillState(),
        ...(next.still && typeof next.still === 'object' ? next.still : {})
    };
    if (!next.still.workingImagePath && typeof legacyArt.generatedCurrent === 'string') {
        next.still.workingImagePath = legacyArt.generatedCurrent;
    }
    if (!next.still.approvedImagePath && typeof legacyArt.approvedImage === 'string') {
        next.still.approvedImagePath = legacyArt.approvedImage;
    }
    if (!next.still.prompt && typeof next.sourcePrompt === 'string') {
        next.still.prompt = next.sourcePrompt;
    }
    if (!Array.isArray(next.still.variants) && Array.isArray(legacyArt.generatedVariants)) {
        next.still.variants = legacyArt.generatedVariants;
    }
    if (!Array.isArray(next.still.generationHistory) && Array.isArray(legacyArt.editHistory)) {
        next.still.generationHistory = legacyArt.editHistory;
    }
    next.still.prompt = typeof next.still.prompt === 'string' ? next.still.prompt : '';
    next.still.sourceImages = Array.isArray(next.still.sourceImages) ? next.still.sourceImages.filter((entry) => typeof entry === 'string' && entry) : [];
    next.still.variants = Array.isArray(next.still.variants) ? next.still.variants.map((entry) => normalizeVariant(entry, helpers)) : [];
    next.still.workingImagePath = typeof next.still.workingImagePath === 'string' ? next.still.workingImagePath : '';
    next.still.approvedImagePath = typeof next.still.approvedImagePath === 'string' ? next.still.approvedImagePath : '';
    next.still.generationHistory = Array.isArray(next.still.generationHistory) ? next.still.generationHistory.map((entry) => normalizeHistoryEntry(entry, helpers)) : [];
    next.still.width = Math.max(0, Math.round(Number(next.still.width) || 0));
    next.still.height = Math.max(0, Math.round(Number(next.still.height) || 0));

    next.paint = {
        ...defaultPaintState(),
        ...(next.paint && typeof next.paint === 'object' ? next.paint : {})
    };
    next.paint.lastEditedPath = typeof next.paint.lastEditedPath === 'string' ? next.paint.lastEditedPath : '';
    next.paint.editedAt = typeof next.paint.editedAt === 'string' ? next.paint.editedAt : '';
    next.paint.thumbnailPath = typeof next.paint.thumbnailPath === 'string' ? next.paint.thumbnailPath : '';
    next.paint.thumbnailUpdatedAt = typeof next.paint.thumbnailUpdatedAt === 'string' ? next.paint.thumbnailUpdatedAt : '';
    next.paint.layerCount = Math.max(1, Math.round(Number(next.paint.layerCount) || 1));
    next.paint.frameCount = Math.max(1, Math.round(Number(next.paint.frameCount) || 1));
    next.paint.noBoundaryClip = next.paint.noBoundaryClip !== false;
    next.paint.quickAnimationPeek = next.paint.quickAnimationPeek === true;
    next.paint.selectedLayerId = typeof next.paint.selectedLayerId === 'string' ? next.paint.selectedLayerId : '';
    next.paint.selectedLayerIndex = Number.isFinite(Number(next.paint.selectedLayerIndex)) ? Math.max(0, Math.round(Number(next.paint.selectedLayerIndex))) : 0;
    next.paint.selectedAnimationId = typeof next.paint.selectedAnimationId === 'string' ? next.paint.selectedAnimationId : '';
    next.paint.selectedFrameId = typeof next.paint.selectedFrameId === 'string' ? next.paint.selectedFrameId : '';
    next.paint.selectedFrameIndex = Number.isFinite(Number(next.paint.selectedFrameIndex)) ? Math.round(Number(next.paint.selectedFrameIndex)) : -1;

    const integrations = next.integrations && typeof next.integrations === 'object' ? next.integrations : {};
    next.integrations = {
        krita: {
            ...defaultKritaIntegration(),
            ...(integrations.krita && typeof integrations.krita === 'object' ? integrations.krita : {})
        },
        unity: {
            ...defaultUnityIntegration(),
            ...(integrations.unity && typeof integrations.unity === 'object' ? integrations.unity : {})
        }
    };
    next.integrations.unity.defaultSheetBinding = normalizeUnitySheetBinding(next.integrations.unity.defaultSheetBinding);

    next.workspace = {
        ...defaultWorkspaceState(),
        ...(next.workspace && typeof next.workspace === 'object' ? next.workspace : {})
    };
    next.workspace.lastOpenedTarget = normalizePaintLaunchTarget({
        mode: PAINT_LAUNCH_MODES.PROJECT_STILL,
        ...(next.workspace.lastOpenedTarget && typeof next.workspace.lastOpenedTarget === 'object'
            ? next.workspace.lastOpenedTarget
            : {})
    });
    next.workspace.lastOpenedAt = typeof next.workspace.lastOpenedAt === 'string' ? next.workspace.lastOpenedAt : '';
    next.workspace.temporary = next.workspace.temporary === true;
    next.workspace.temporaryBoardId = typeof next.workspace.temporaryBoardId === 'string' ? next.workspace.temporaryBoardId : '';
    next.workspace.temporaryBlockId = typeof next.workspace.temporaryBlockId === 'string' ? next.workspace.temporaryBlockId : '';

    const rawPlayback = next.playback && typeof next.playback === 'object' ? next.playback : {};
    next.playback = {
        defaultPlaybackFps: normalizePlaybackFps(rawPlayback.defaultPlaybackFps, 12),
        playbackLoop: rawPlayback.playbackLoop !== false
    };

    const animations = next.animations && typeof next.animations === 'object' ? next.animations : {};
    const normalizedAnimations = {};
    Object.entries(animations).forEach(([animationId, animation]) => {
        const normalized = normalizeAnimation({
            ...(animation && typeof animation === 'object' ? animation : {}),
            id: typeof animation?.id === 'string' && animation.id ? animation.id : animationId
        }, helpers);
        normalizedAnimations[normalized.id] = normalized;
    });
    next.animations = normalizedAnimations;
    next.activeAnimationId = typeof next.activeAnimationId === 'string' && normalizedAnimations[next.activeAnimationId]
        ? next.activeAnimationId
        : (Object.keys(normalizedAnimations)[0] || '');
    next.animationHistory = Array.isArray(next.animationHistory) ? next.animationHistory.map((entry) => normalizeHistoryEntry(entry, helpers)) : [];

    next.createdAt = typeof next.createdAt === 'string' && next.createdAt ? next.createdAt : base.createdAt;
    next.updatedAt = typeof next.updatedAt === 'string' && next.updatedAt ? next.updatedAt : next.createdAt;
    return next;
}

module.exports = {
    ASSET_SCHEMA_VERSION,
    defaultStillState,
    defaultReferenceRecord,
    defaultUnitySheetBinding,
    defaultAnimationUnityBinding,
    defaultWorkspaceState,
    defaultPlaybackState,
    defaultAnimationRecord,
    createAssetRecord,
    normalizeAnimation,
    normalizeAsset,
    normalizeUnitySheetBinding,
    normalizeAnimationUnityBinding
};
