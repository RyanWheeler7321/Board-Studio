'use strict';

// MARK: PAINT MODE
const env = require('../core/state');
const projectStore = require('../tools/twoD/projectStore');
const launchTargets = require('../tools/twoD/paintLaunchTarget');
const assetActions = require('../tools/twoD/assetActions');
const createWorkboardProfiler = require('../core/perfProfiler');
const paintTheme = require('./paintTheme');
const createPaintInputModule = require('./modules/input');
const createPaintLayersModule = require('./modules/layers');
const createPaintLifecycleModule = require('./modules/lifecycle');
const createPaintPersistenceModule = require('./modules/persistence');
const createPaintColorUiModule = require('./modules/colorUi');
const createPaintAdjustmentsModule = require('./modules/adjustments');
const createPaintAssetOpsModule = require('./modules/assetOps');
const createPaintEventsModule = require('./modules/paintEvents');
const createPaintImageIoModule = require('./modules/imageIo');
const createPaintJobRunnerModule = require('./modules/jobRunner');
const createPaintShellModule = require('./modules/paintShell');
const createPaintPromptDialogModule = require('./modules/promptDialog');
const createPaintToolsModule = require('./modules/paintTools');
const createPaintStampLibraryModule = require('./modules/stampLibrary');
const createPaintSelectionTransformModule = require('./modules/selectionTransform');
const createPaintSessionCoreModule = require('./modules/sessionCore');
const createPaintStageRenderModule = require('./modules/stageRender');
const createPaintStrokeEngineModule = require('./modules/strokeEngine');
const createPaintTimelinePersistenceModule = require('./modules/timelinePersistence');
const createPaintTimelineModule = require('./modules/timeline');
const createPaintWorkspaceUiModule = require('./modules/workspaceUi');

const { dom, state, utils } = env;

const TOOL_AIR = 'air';
const TOOL_INK = 'ink';
const TOOL_PAINT = 'paint';
const TOOL_RECT = 'rect';
const TOOL_BLUR = 'blur';
const TOOL_STAMP = 'stamp';

const TOOL_LABELS = {
    [TOOL_AIR]: 'Air',
    [TOOL_INK]: 'Ink',
    [TOOL_PAINT]: 'Paint',
    [TOOL_RECT]: 'Shape',
    [TOOL_BLUR]: 'Blur',
    [TOOL_STAMP]: 'Stamp'
};

const TOOL_KEYS = {
    [TOOL_AIR]: '1',
    [TOOL_INK]: '2',
    [TOOL_PAINT]: '3',
    [TOOL_RECT]: '4',
    [TOOL_BLUR]: '5',
    [TOOL_STAMP]: '6'
};


const CREATE_PROJECT_ASPECT_PRESETS = Object.freeze([
    { key: 'square', label: '1:1', width: 1024, height: 1024, ratioWidth: 1, ratioHeight: 1 },
    { key: 'wide-16x9', label: '16:9', width: 1600, height: 900, ratioWidth: 16, ratioHeight: 9 },
    { key: 'tall-9x16', label: '9:16', width: 900, height: 1600, ratioWidth: 9, ratioHeight: 16 },
    { key: 'landscape-3x2', label: '3:2', width: 1536, height: 1024, ratioWidth: 3, ratioHeight: 2 },
    { key: 'portrait-2x3', label: '2:3', width: 1024, height: 1536, ratioWidth: 2, ratioHeight: 3 }
]);

const CREATE_PROJECT_SCALE_OPTIONS = Object.freeze([1, 1.25, 1.5, 2, 3, 4, 6, 8, 8.5, 10]);

const DEFAULT_CREATE_PROJECT_WIDTH = 1024;
const DEFAULT_CREATE_PROJECT_HEIGHT = 1024;
const DEFAULT_CREATE_PROJECT_ASPECT_PRESET = 'square';
const DEFAULT_CREATE_PROJECT_SCALE = '1';
const SUPPORTED_PROJECT_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff';

const BACKGROUND_REMOVAL_INPUT_BACKGROUND_OPTIONS = Object.freeze([
    { value: 'white', label: 'White' },
    { value: 'black', label: 'Black' },
    { value: 'other', label: 'Other' },
    { value: 'transparent', label: 'Transparent' }
]);

const BREAKOUT_TYPE_OPTIONS = Object.freeze([]);

const STROKE_MODE_FILL = 'fill';
const STROKE_MODE_BORDER = 'border';

const EDIT_MODE_PAINT = 'paint';
const EDIT_MODE_SELECT = 'select';
const EDIT_MODE_TRANSFORM = 'transform';

const DEFAULT_COLOR = '#ffffff';
const DEFAULT_BRUSH_SIZE = 16;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 1000;
const DEFAULT_BORDER_SIZE_RATIO = 0.4;
const DEFAULT_VIEW_SCALE = 0.6;
const PAINT_JOB_TIMING_STORAGE_KEY = 'workboard.paintJobTimingHistory.v1';
const PAINT_PERF_LOG_FLUSH_MS = 32;
const SELECTION_DASH_ON = 3.6;
const SELECTION_DASH_OFF = 9.4;
const ACTION_BOUNDS_PAD = 8;
const LAYER_MAX = 24;
const LAYER_BASE_NAME = 'Base';
const LAYER_PREVIEW_SIZE = 40;
const LAYER_OPACITY_DEFAULT = 1;
const LAYER_THUMBNAIL_TONE_DEFAULT = 0.58;
const LAYER_THUMBNAIL_TONE_MIN = 0.18;
const LAYER_THUMBNAIL_TONE_MAX = 0.86;

const CROP_NUDGE_STEP = 1;
const CROP_NUDGE_STEP_FAST = 10;
const MAX_CANVAS_DIMENSION = 8192;
const COLOR_PICKER_WIDTH = 284;
const COLOR_PICKER_HEIGHT = 336;
const CURSOR_RING_STROKE = 1.25;
const STROKE_SMOOTHING = 0.86;
const PRESSURE_SMOOTHING = 0.22;
const TILT_SMOOTHING = 0.65;
const ANGLE_SMOOTHING = 0.78;
const STAMP_RADIUS_QUANT = 16;
const STAMP_SUPERSAMPLE = 2;
const STAMP_LIVE_COMMIT_MS = 70;
const ERASER_LIVE_COMMIT_MS = 24;
const PAINT_LIVE_PREVIEW_DEBOUNCE_MS = 180;
const STICKER_SHADOW_PAD = 72;
const PATTERN_TILE_LIMIT = 5;
const MIN_ACTIVE_STYLUS_PRESSURE = 0.08;
const PAINT_PREFS_STORAGE_KEY = 'workboard.paint.prefs.v2';
const STAMP_LIBRARY_STORAGE_KEY = 'workboard.paint.stamps.v2';
const PAINT_CONTEXTMENU_SUPPRESS_MS = 250;
const IGNORE_MOUSE_AFTER_STYLUS_UP_MS = 180;
const IGNORE_HOVER_AFTER_UP_MS = 180;
const PAINT_EXIT_HOTKEY_BLOCK_MS = 260;
const PAINT_AUTOSAVE_INTERVAL_MS = 10000;
const PAINT_AUTOSAVE_IDLE_MS = 1500;
const PAINT_AUTOSAVE_RETRY_MS = 3000;
const PAINT_AUTOSAVE_TICK_MS = 1000;

const STROKE_DAB_SPACING = {
    [TOOL_AIR]: 4.0,
    [TOOL_INK]: 1.4,
    [TOOL_PAINT]: 2.2,
    [TOOL_BLUR]: 0.6,
    [TOOL_STAMP]: 1.4,
    default: 2.0
};

const TOOL_SPACING_MIN = 0.00001;
const TOOL_SPACING_MAX = 4.0;
const TOOL_SPACING_DRAG_RATE_NORMAL = 0.006;
const TOOL_SPACING_DRAG_RATE_FAST = 0.012;
const CURSOR_HINT_LEFT_OFFSET = 70;
const BRUSH_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'color-dodge', 'color-burn'];
const BRUSH_BLEND_COMPOSITE_MAP = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn'
};
const PRESSURE_DEFAULTS = {
    [TOOL_AIR]: { opacity: true, size: false },
    [TOOL_INK]: { opacity: false, size: true },
    [TOOL_PAINT]: { opacity: true, size: false },
    [TOOL_RECT]: { opacity: true, size: true },
    [TOOL_BLUR]: { opacity: true, size: true },
    [TOOL_STAMP]: { opacity: true, size: false }
};
const BRUSH_SHAPE_OPTIONS = ['circle', 'square', 'diamond', 'triangle'];
const BRUSH_FILL_MODE_OPTIONS = [STROKE_MODE_FILL, STROKE_MODE_BORDER];
const PAINT_TIP_OPTIONS = ['texture', ...BRUSH_SHAPE_OPTIONS];
const SHAPE_PRIMITIVE_OPTIONS = ['rect', 'ellipse'];
const STAMP_SOURCE_MODE_ALPHA = 'alpha-mask';
const STAMP_SOURCE_MODE_PRESERVE = 'preserve-color';
const STAMP_SOURCE_MODE_OPTIONS = [STAMP_SOURCE_MODE_ALPHA, STAMP_SOURCE_MODE_PRESERVE];

function clampPercent(value, fallback = 0) {
    const number = Number.isFinite(Number(value)) ? Number(value) : fallback;
    return clamp(Math.round(number), 0, 100);
}

function clampNormalized(value, fallback = 1) {
    const number = Number.isFinite(Number(value)) ? Number(value) : fallback;
    return clamp(number, 0, 1);
}

function normalizeEnum(value, options, fallback) {
    return options.includes(value) ? value : fallback;
}

function createDefaultBrushProfiles() {
    return {
        [TOOL_AIR]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: true, size: false },
            fillMode: STROKE_MODE_FILL,
            hardness: 0,
            flow: 1
        },
        [TOOL_INK]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: false, size: true },
            fillMode: STROKE_MODE_FILL,
            tipShape: 'circle'
        },
        [TOOL_PAINT]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: true, size: false },
            fillMode: STROKE_MODE_FILL,
            tipShape: 'texture',
            hardness: 0.58,
            flow: 0.88,
            tiltStretch: true
        },
        [TOOL_RECT]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: true, size: true },
            fillMode: STROKE_MODE_FILL,
            primitive: 'rect',
            borderWidth: 6,
            cornerRadius: 0
        },
        [TOOL_BLUR]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: true, size: true },
            blurRadius: 10,
            blurStrength: 0.7
        },
        [TOOL_STAMP]: {
            size: DEFAULT_BRUSH_SIZE,
            spacing: 0.25,
            blendMode: 'normal',
            opacityCap: 1,
            pressure: { opacity: true, size: false },
            sourceMode: STAMP_SOURCE_MODE_ALPHA,
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
        }
    };
}

function normalizeBrushProfiles(savedProfiles = null, legacy = {}) {
    const defaults = createDefaultBrushProfiles();
    const output = createDefaultBrushProfiles();
    const profiles = savedProfiles && typeof savedProfiles === 'object' ? savedProfiles : {};
    const legacyStamp = legacy.stampSettings && typeof legacy.stampSettings === 'object' ? legacy.stampSettings : {};
    for (const tool of Object.keys(defaults)) {
        const profile = profiles[tool] && typeof profiles[tool] === 'object' ? profiles[tool] : {};
        const fallback = defaults[tool];
        output[tool].size = clamp(Math.round(Number(profile.size ?? legacy.sizes?.[tool] ?? fallback.size) || fallback.size), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
        output[tool].spacing = clamp(Number(profile.spacing ?? legacy.spacings?.[tool] ?? fallback.spacing) || fallback.spacing, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
        output[tool].blendMode = fallback.blendMode;
        output[tool].opacityCap = clampNormalized(profile.opacityCap ?? legacy.opacityCaps?.[tool] ?? fallback.opacityCap, fallback.opacityCap);
        const legacyPressure = legacy.pressureByTool?.[tool];
        output[tool].pressure = {
            opacity: (profile.pressure?.opacity ?? legacyPressure?.opacity ?? fallback.pressure.opacity) !== false,
            size: (profile.pressure?.size ?? legacyPressure?.size ?? fallback.pressure.size) !== false
        };
        if (tool === TOOL_AIR) {
            output[tool].fillMode = normalizeEnum(profile.fillMode ?? legacy.strokeModes?.[tool], BRUSH_FILL_MODE_OPTIONS, fallback.fillMode);
            output[tool].hardness = clampNormalized(profile.hardness, fallback.hardness);
            output[tool].flow = clampNormalized(profile.flow, fallback.flow);
        } else if (tool === TOOL_INK) {
            output[tool].fillMode = normalizeEnum(profile.fillMode ?? legacy.strokeModes?.[tool], BRUSH_FILL_MODE_OPTIONS, fallback.fillMode);
            output[tool].tipShape = normalizeEnum(profile.tipShape, BRUSH_SHAPE_OPTIONS, fallback.tipShape);
        } else if (tool === TOOL_PAINT) {
            output[tool].fillMode = normalizeEnum(profile.fillMode ?? legacy.strokeModes?.[tool], BRUSH_FILL_MODE_OPTIONS, fallback.fillMode);
            output[tool].tipShape = normalizeEnum(profile.tipShape, PAINT_TIP_OPTIONS, fallback.tipShape);
            output[tool].hardness = clampNormalized(profile.hardness, fallback.hardness);
            output[tool].flow = clampNormalized(profile.flow, fallback.flow);
            output[tool].tiltStretch = profile.tiltStretch !== false;
        } else if (tool === TOOL_RECT) {
            output[tool].fillMode = normalizeEnum(profile.fillMode ?? legacy.strokeModes?.[tool], BRUSH_FILL_MODE_OPTIONS, fallback.fillMode);
            output[tool].primitive = normalizeEnum(profile.primitive, SHAPE_PRIMITIVE_OPTIONS, fallback.primitive);
            output[tool].borderWidth = clamp(Math.round(Number(profile.borderWidth) || fallback.borderWidth), 1, 240);
            output[tool].cornerRadius = clamp(Math.round(Number(profile.cornerRadius) || fallback.cornerRadius), 0, 128);
        } else if (tool === TOOL_BLUR) {
            output[tool].blurRadius = clamp(Math.round(Number(profile.blurRadius) || fallback.blurRadius), 1, 120);
            output[tool].blurStrength = clampNormalized(profile.blurStrength, fallback.blurStrength);
        } else if (tool === TOOL_STAMP) {
            output[tool].sourceMode = normalizeEnum(profile.sourceMode ?? legacyStamp.sourceMode, STAMP_SOURCE_MODE_OPTIONS, fallback.sourceMode);
            output[tool].tipShape = normalizeEnum(profile.tipShape ?? legacyStamp.tipShape, ['custom', ...BRUSH_SHAPE_OPTIONS], fallback.tipShape);
            output[tool].commitOnRelease = (profile.commitOnRelease ?? legacyStamp.commitOnRelease ?? fallback.commitOnRelease) !== false;
            output[tool].varSize = clampPercent(profile.varSize ?? legacyStamp.varSize, fallback.varSize);
            output[tool].varSizeX = clampPercent(profile.varSizeX ?? legacyStamp.varSizeX, fallback.varSizeX);
            output[tool].varSizeY = clampPercent(profile.varSizeY ?? legacyStamp.varSizeY, fallback.varSizeY);
            output[tool].varRot = clamp(Math.round(Number(profile.varRot ?? legacyStamp.varRot) || fallback.varRot), 0, 180);
            output[tool].varColor = clampPercent(profile.varColor ?? legacyStamp.varColor, fallback.varColor);
            output[tool].varHue = clamp(Math.round(Number(profile.varHue ?? legacyStamp.varHue) || fallback.varHue), 0, 180);
            output[tool].varVal = clampPercent(profile.varVal ?? legacyStamp.varVal, fallback.varVal);
            output[tool].varSat = clampPercent(profile.varSat ?? legacyStamp.varSat, fallback.varSat);
            output[tool].scatter = clampPercent(profile.scatter ?? legacyStamp.scatter, fallback.scatter);
            output[tool].varAlpha = clampPercent(profile.varAlpha ?? legacyStamp.varAlpha, fallback.varAlpha);
            output[tool].flipX = (profile.flipX ?? legacyStamp.flipX ?? fallback.flipX) === true;
            output[tool].flipY = (profile.flipY ?? legacyStamp.flipY ?? fallback.flipY) === true;
            output[tool].followRotation = (profile.followRotation ?? legacyStamp.followRotation ?? fallback.followRotation) !== false;
        }
    }
    return output;
}

function buildLegacyBrushStateFromProfiles(brushProfiles) {
    const toolSizes = {};
    const toolSpacing = {};
    const pressureByTool = {};
    const opacityCapByTool = {};
    const strokeModeByTool = {};
    const blendModeByTool = {};
    const stampProfile = brushProfiles?.[TOOL_STAMP] || createDefaultBrushProfiles()[TOOL_STAMP];
    for (const tool of Object.keys(TOOL_LABELS)) {
        const profile = brushProfiles?.[tool];
        if (!profile) {
            continue;
        }
        toolSizes[tool] = clamp(Math.round(Number(profile.size) || DEFAULT_BRUSH_SIZE), MIN_BRUSH_SIZE, MAX_BRUSH_SIZE);
        toolSpacing[tool] = clamp(Number(profile.spacing) || 0.25, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
        pressureByTool[tool] = {
            opacity: profile.pressure?.opacity !== false,
            size: profile.pressure?.size !== false
        };
        opacityCapByTool[tool] = clampNormalized(profile.opacityCap, 1);
        blendModeByTool[tool] = BRUSH_BLEND_MODES.includes(profile.blendMode) ? profile.blendMode : 'normal';
        if (BRUSH_FILL_MODE_OPTIONS.includes(profile.fillMode)) {
            strokeModeByTool[tool] = profile.fillMode;
        }
    }
    return {
        toolSizes,
        toolSpacing,
        pressureByTool,
        opacityCapByTool,
        strokeModeByTool,
        blendModeByTool,
        stampSettings: {
            editorVisible: false,
            sourceMode: normalizeEnum(stampProfile.sourceMode, STAMP_SOURCE_MODE_OPTIONS, STAMP_SOURCE_MODE_ALPHA),
            tipShape: normalizeEnum(stampProfile.tipShape, ['custom', ...BRUSH_SHAPE_OPTIONS], 'custom'),
            commitOnRelease: stampProfile.commitOnRelease !== false,
            varSize: clampPercent(stampProfile.varSize, 0),
            varSizeX: clampPercent(stampProfile.varSizeX, 0),
            varSizeY: clampPercent(stampProfile.varSizeY, 0),
            varRot: clamp(Math.round(Number(stampProfile.varRot) || 0), 0, 180),
            varColor: clampPercent(stampProfile.varColor, 0),
            varHue: clamp(Math.round(Number(stampProfile.varHue) || 0), 0, 180),
            varVal: clampPercent(stampProfile.varVal, 0),
            varSat: clampPercent(stampProfile.varSat, 0),
            scatter: clampPercent(stampProfile.scatter, 0),
            varAlpha: clampPercent(stampProfile.varAlpha, 0),
            flipX: stampProfile.flipX === true,
            flipY: stampProfile.flipY === true,
            followRotation: stampProfile.followRotation !== false
        }
    };
}
const GRADIENT_MAPS = {
    none: null,
    teal_orange: [
        { t: 0, rgb: [12, 16, 32] },
        { t: 0.42, rgb: [24, 178, 201] },
        { t: 0.72, rgb: [255, 158, 82] },
        { t: 1, rgb: [255, 246, 232] }
    ],
    vaporwave: [
        { t: 0, rgb: [20, 16, 46] },
        { t: 0.35, rgb: [91, 110, 225] },
        { t: 0.7, rgb: [255, 105, 180] },
        { t: 1, rgb: [255, 230, 248] }
    ],
    autumn: [
        { t: 0, rgb: [17, 13, 10] },
        { t: 0.35, rgb: [140, 68, 26] },
        { t: 0.7, rgb: [233, 155, 59] },
        { t: 1, rgb: [255, 242, 214] }
    ],
    emerald: [
        { t: 0, rgb: [8, 12, 10] },
        { t: 0.35, rgb: [19, 94, 83] },
        { t: 0.7, rgb: [86, 204, 157] },
        { t: 1, rgb: [232, 255, 246] }
    ],
    inferno: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 0.25, rgb: [74, 12, 89] },
        { t: 0.55, rgb: [208, 47, 70] },
        { t: 0.82, rgb: [255, 186, 73] },
        { t: 1, rgb: [255, 255, 255] }
    ],
    noir: [
        { t: 0, rgb: [0, 0, 0] },
        { t: 0.55, rgb: [112, 112, 112] },
        { t: 1, rgb: [255, 255, 255] }
    ],
    icefire: [
        { t: 0, rgb: [0, 8, 18] },
        { t: 0.38, rgb: [0, 180, 210] },
        { t: 0.7, rgb: [255, 110, 45] },
        { t: 1, rgb: [255, 245, 235] }
    ],
    cyberpunk: [
        { t: 0, rgb: [10, 10, 20] },
        { t: 0.35, rgb: [0, 255, 210] },
        { t: 0.7, rgb: [255, 0, 170] },
        { t: 1, rgb: [255, 245, 250] }
    ],
    forest_moss: [
        { t: 0, rgb: [6, 10, 7] },
        { t: 0.38, rgb: [22, 74, 46] },
        { t: 0.72, rgb: [156, 220, 122] },
        { t: 1, rgb: [245, 255, 238] }
    ],
    sunset_pop: [
        { t: 0, rgb: [18, 12, 34] },
        { t: 0.35, rgb: [132, 46, 146] },
        { t: 0.68, rgb: [255, 128, 64] },
        { t: 1, rgb: [255, 240, 215] }
    ],
    rose_gold: [
        { t: 0, rgb: [12, 10, 14] },
        { t: 0.35, rgb: [120, 72, 92] },
        { t: 0.7, rgb: [235, 173, 142] },
        { t: 1, rgb: [255, 251, 246] }
    ],
    arctic: [
        { t: 0, rgb: [6, 10, 20] },
        { t: 0.4, rgb: [60, 130, 190] },
        { t: 0.78, rgb: [215, 245, 255] },
        { t: 1, rgb: [255, 255, 255] }
    ],
    sepia: [
        { t: 0, rgb: [8, 6, 4] },
        { t: 0.5, rgb: [120, 84, 52] },
        { t: 1, rgb: [255, 238, 215] }
    ],
    pastel: [
        { t: 0, rgb: [20, 18, 28] },
        { t: 0.33, rgb: [170, 220, 255] },
        { t: 0.66, rgb: [255, 190, 230] },
        { t: 1, rgb: [255, 250, 245] }
    ]
};

let session = null;
const stampCache = new Map();
let brushMaskCanvas = null;
let brushMaskReady = false;
let brushMaskFailed = false;
let brushMaskPromise = null;
let colorPickTimer = null;
let layerPreviewRefreshQueued = false;
let stageShadowRefreshQueued = false;
let stageShadowNeedsRebuild = false;
let stagePatternRefreshQueued = false;
let paintRuntimeErrorHandlersAttached = false;
let paintPerfLogPath = '';
let paintPerfLogBuffer = [];
let paintPerfLogFlushTimer = null;
let paintDebugRenderQueued = false;
let paintConsoleBridgeAttached = false;
let paintTopDockLayoutSignature = '';
let paintLayerViewerRefreshTimer = null;
let paintThemeWindowActivitySubscribed = false;
const timelinePreviewUrlCache = new WeakMap();
const recentColors = [];
const RECENT_COLORS_MAX = 6;
const PAINT_LOG_SNAPSHOT_MAX = 16;
const PAINT_DEBUG_CONSOLE_MAX = 240;
const LAYER_VIEWER_REFRESH_INTERVAL_MS = 220;
const paintWorkspaceUi = {
    panelEl: null,
    unityPanelEl: null,
    drawerEl: null,
    canvasPreviewEl: null,
    emptyStateEl: null,
    createModalEl: null,
    projectBarEl: null,
    layerViewerEl: null
};
const TIMELINE_LAYOUT = {
    expandedBarMinWidth: 340,
    collapsedBarMinWidth: 320,
    expandedFrameBucket: 116,
    collapsedFrameBucket: 132,
    expandedChromeWidth: 220,
    collapsedChromeWidth: 24
};
const paintWorkspaceState = {
    drawerOpen: false,
    timelineExpanded: false,
    collapsedTimelineVisible: false,
    expandedTimelineVisible: false,
    pinnedLayerIds: [],
    timelineMenu: {
        open: false,
        x: 0,
        y: 0,
        kind: '',
        layerIndex: -1,
        frameId: '',
        pseudoFrame: false,
        host: 'collapsed'
    },
    previewVariantId: '',
    showNewMenu: false,
    createDialogOpen: false,
    createName: '',
    createWidth: DEFAULT_CREATE_PROJECT_WIDTH,
    createHeight: DEFAULT_CREATE_PROJECT_HEIGHT,
    createAspectPreset: DEFAULT_CREATE_PROJECT_ASPECT_PRESET,
    createScale: DEFAULT_CREATE_PROJECT_SCALE,
    createDropActive: false,
    layerViewerOpen: false,
    layerViewerMode: 'survey',
    layerViewerFocusedLayerId: '',
    layerViewerRecency: [],
    layerViewerRefreshQueued: false,
    timelineRenderSignature: '',
    collapsedTimelineRenderSignature: '',
    expandedTimelineRenderSignature: '',
    debugConsoleEntries: [],
    debugConsoleCounter: 0,
    logSnapshots: [],
    activeLogSnapshotId: '',
    logSnapshotCounter: 0,
    panelMode: 'asset',
    assetPanelTab: 'project',
    panelHidden: false,
    unityPanelHidden: true,
    projectMenuHidden: true,
    noBoundaryClip: true,
    quickAnimationPeek: false,
    activeJobId: '',
    themeController: null,
    themeTokens: null,
    jobStatus: 'idle',
    jobMessage: '',
    jobDetailMessage: '',
    jobProgress: 0,
    jobCancelRequested: false,
    jobStartedAt: 0,
    jobEstimateMs: 0,
    jobEstimateExceededLogged: false,
    jobTimeoutMs: 0,
    jobTimingKey: '',
    jobAttemptIndex: 0,
    jobAttemptMax: 0,
    placeholderLaunchTarget: null,
    playTimer: null,
    playing: false,
    activePlaybackRangeId: '',
    timelineMotion: '',
    timelineQuickPreview: false,
    timelineDrag: null,
    overlayPresentationKey: ''
};
const paintProfiler = createWorkboardProfiler({
    namespace: 'paint.profiler',
    flushIntervalMs: 5000,
    slowThresholdMs: 4,
    summaryLimit: 10,
    log: (message) => appendPaintPerfLog(message)
});
let paintPersistenceModule = null;
let paintInputModule = null;
let paintLayersModule = null;
let paintLifecycleModule = null;
let paintImageIoModule = null;
let paintSelectionTransformModule = null;
let paintSessionCoreModule = null;
let paintShellModule = null;
let paintStageRenderModule = null;
let paintStrokeEngineModule = null;
let paintTimelinePersistenceModule = null;
let paintTimelineModule = null;
let paintWorkspaceUiModule = null;
let paintColorUiModule = null;
let paintAdjustmentsModule = null;
let paintAssetOpsModule = null;
let paintEventsModule = null;
let paintJobRunnerModule = null;
let paintPromptDialogModule = null;
let paintToolsModule = null;
let paintStampLibraryModule = null;

function bindLazyModuleMethod(getModule, methodName) {
    return (...args) => getModule()[methodName](...args);
}

const renderPaintWorkspaceUi = bindLazyModuleMethod(getPaintWorkspaceUiModule, 'renderPaintWorkspaceUi');
const handlePaintAnimationDrawerClick = bindLazyModuleMethod(getPaintTimelineModule, 'handlePaintAnimationDrawerClick');
const promptForPaintText = bindLazyModuleMethod(getPaintPromptDialogModule, 'promptForPaintText');
const promptForPaintChoice = bindLazyModuleMethod(getPaintPromptDialogModule, 'promptForPaintChoice');
const resolvePressure = bindLazyModuleMethod(getPaintStrokeEngineModule, 'resolvePressure');
const beginAdjustRender = bindLazyModuleMethod(getPaintAdjustmentsModule, 'beginAdjustRender');
const handlePaintContextMenu = bindLazyModuleMethod(getPaintInputModule, 'handlePaintContextMenu');
const handlePaintWheel = bindLazyModuleMethod(getPaintInputModule, 'handlePaintWheel');
const handlePaintPointerDown = bindLazyModuleMethod(getPaintInputModule, 'handlePaintPointerDown');
const handlePaintPointerMove = bindLazyModuleMethod(getPaintInputModule, 'handlePaintPointerMove');
const handlePaintPointerUp = bindLazyModuleMethod(getPaintInputModule, 'handlePaintPointerUp');
const handleStagePointerDown = bindLazyModuleMethod(getPaintInputModule, 'handleStagePointerDown');
const handleStagePointerMove = bindLazyModuleMethod(getPaintInputModule, 'handleStagePointerMove');
const handleStagePointerUp = bindLazyModuleMethod(getPaintInputModule, 'handleStagePointerUp');
const handlePaintKeyDown = bindLazyModuleMethod(getPaintInputModule, 'handlePaintKeyDown');
const handlePaintKeyUp = bindLazyModuleMethod(getPaintInputModule, 'handlePaintKeyUp');
const resetPaintModifierState = bindLazyModuleMethod(getPaintInputModule, 'resetPaintModifierState');
const ensureHandlers = bindLazyModuleMethod(getPaintEventsModule, 'ensureHandlers');

function getPaintPersistenceModule() {
    if (paintPersistenceModule) {
        return paintPersistenceModule;
    }
    paintPersistenceModule = createPaintPersistenceModule({
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
        getSession: () => session,
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
    });
    return paintPersistenceModule;
}

function getPaintInputModule() {
    if (paintInputModule) {
        return paintInputModule;
    }
    logPaintTrace('paint.module.init', {
        module: 'input'
    });
    paintInputModule = createPaintInputModule({
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
        getSession: () => session,
        normalizeKey,
        clamp,
        clamp01,
        logPaintTrace,
        collectAdjustSettingsFromDom,
        paintQueries: {
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
        },
        paintUi: {
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
            renderLassoPreview,
            renderBrushCursor,
            updateRectPreview,
            isStampPanelOpen,
            setStampPanelVisible
        },
        paintActions: {
            createPaintProjectFromClipboard,
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
            toggleExpandedTimelineDrawer,
            triggerTimelineMotion,
            navigatePaintAnimation,
            insertTimelineFrameFromHotkey,
            togglePaintAnimationPlayback,
            undo,
            redo,
            capturePaintHistorySnapshot,
            saveCurrentPaintSession,
            copySelectionOrCanvasToClipboard,
            pasteClipboardImageAsTransformSelection,
            rebuildSelectionFromComponents,
            invertSelection,
            fitToScreen,
            clearOverlayCanvas,
            beginTransformMode,
            createPaintLayer,
            insertBlankLayerRelative,
            setActiveTool,
            updateStageCursor,
            setBrushBlendMode,
            captureInputSample,
            updateHoverFromPointerEvent,
            beginZoomDrag,
            endZoomDrag,
            beginPan,
            endPan,
            continuePan,
            continueZoomDrag,
            applySpacingDrag,
            updateToolSizeFromSession,
            syncBorderSizeToBrush,
            renderCropOverlay,
            finalizeSelection,
            beginTransformDrag,
            updateCropRectFromDrag,
            updateTransformDrag,
            continueStroke,
            beginStroke,
            endStroke,
            renderStageUi,
            requestCancelPaint,
            saveAndExit,
            keepChangesAction,
            applySelectionEditsAndClearSelection,
            beginRect,
            syncHoverToLastStage,
            cachePressureForTool,
            cancelTransformMode,
            applyTransformMode,
            beginCropMode,
            setWrapTransform,
            zoomAtScreenPoint,
            duplicateActiveLayerRelative
        }
    });
    return paintInputModule;
}

function getPaintLayersModule() {
    if (paintLayersModule) {
        return paintLayersModule;
    }
    paintLayersModule = createPaintLayersModule({
        dom,
        utils,
        paintWorkspaceState,
        LAYER_MAX,
        LAYER_BASE_NAME,
        getSession: () => session,
        clamp,
        logPaintTrace,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        normalizeLayerThumbnailTone,
        resolveSessionAnimationContext,
        resolveWorkspaceAsset,
        getCurrentTimelineFrameId,
        persistAnimationLayerSchema,
        patchExpandedTimelineSelection: (...args) => getPaintTimelineModule().patchExpandedTimelineSelection(...args),
        patchCollapsedTimelineSelection: (...args) => getPaintTimelineModule().patchCollapsedTimelineSelection(...args),
        renderLayerBar,
        updateHud,
        renderStageUi,
        renderCursorCanvas,
        updateStageCursor,
        syncTimelineFrameStatesAfterLayerThumbnailToneChange,
        applyTimelineCheckerStyleToLayerRow,
        syncTimelineFrameStatesAfterLayerDisplayChange,
        syncPaintLayerCanvasOrder,
        syncOverlayCanvasPresentation,
        markPaintSessionDirty,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        queueStagePatternRefresh,
        scheduleLivePreviewSync,
        invalidateTimelinePreviewCacheForLayers,
        refreshTimelinePreviewForCurrentFrame,
        persistLoadedTimelineStates,
        captureCurrentAnimationFrameState,
        repairSessionLayerStructureIfNeeded,
        createDynamicPaintLayerCanvas,
        createLayerRecord,
        nextLayerId,
        buildLayerName,
        setActiveLayerRefs,
        syncTimelineFrameStatesAfterLayerInsert,
        syncTimelineFrameStatesAfterLayerSwap,
        syncTimelineFrameStatesAfterLayerDuplicate,
        getActiveLayer,
        clearSelection,
        resetUndoRedoStacks,
        syncTimelineFrameStatesAfterLayerDelete,
        syncTimelineFrameStatesAfterLayerMergeDown,
        createFlattenedLayersCanvas,
        ensureLayerStackEditable,
        promptForPaintText,
        queuePaintLayerViewerRefresh
    });
    return paintLayersModule;
}

function getPaintLifecycleModule() {
    if (paintLifecycleModule) {
        return paintLifecycleModule;
    }
    paintLifecycleModule = createPaintLifecycleModule({
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
        getSession: () => session,
        setSession: (value) => {
            session = value;
        },
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
        clearPaintJobHudTimer: () => getPaintJobRunnerModule().clearPaintJobHudTimer(),
        scheduleLivePreviewSync,
        startPaintAutosaveLoop,
        saveCurrentPaintSession,
        loadAnimationFrameIntoSession,
        resetWorkspaceUiState,
        exportCanvasToPngBuffer,
        paintWorkspaceUi,
        recentColors,
        fitToScreen
    });
    return paintLifecycleModule;
}

function getPaintImageIoModule() {
    if (paintImageIoModule) {
        return paintImageIoModule;
    }
    paintImageIoModule = createPaintImageIoModule({
        env,
        launchTargets,
        MAX_CANVAS_DIMENSION
    });
    return paintImageIoModule;
}

function getPaintShellModule() {
    if (paintShellModule) {
        return paintShellModule;
    }
    paintShellModule = createPaintShellModule({
        dom,
        EDIT_MODE_TRANSFORM,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        getSession: () => session,
        isColorPopoverOpen,
        hideColorPopover,
        applyTransformMode,
        applySelectionEditsAndClearSelection,
        saveAndExit,
        revertPaintSessionChangesAndExit,
        cancelTransformMode,
        cancelCropMode,
        undo,
        closePaintMode,
        requestCancelPaint,
        copySelectionOrCanvasToClipboard,
        pasteClipboardImageAsTransformSelection
    });
    return paintShellModule;
}

function getPaintWorkspaceUiModule() {
    if (paintWorkspaceUiModule) {
        return paintWorkspaceUiModule;
    }
    paintWorkspaceUiModule = createPaintWorkspaceUiModule({
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
        getSession: () => session,
        clamp,
        logPaintTrace,
        resolveWorkspaceAsset,
        isWorkspacePlaceholderState,
        isTemporaryWorkspaceAsset,
        isFileBackedPaintSession,
        isStandaloneBoardImageSession,
        switchPaintFile,
        promptForPaintImageFiles,
        closePaintLayerViewer,
        openPaintLayerViewer,
        togglePaintLayerViewer,
        navigatePaintLayerViewer,
        isPaintLayerViewerOpen,
        setCanvasMenuVisible,
        setBlendMenuVisible,
        setToolMenuVisible,
        renderPaintWorkspaceUi,
        escapeWorkspaceText,
        resolveSessionAnimationContext,
        createPaintProjectFromImageFile,
        createPaintProjectFromClipboard,
        handlePaintWorkspaceDragEnter,
        handlePaintWorkspaceDragOver,
        handlePaintWorkspaceDragLeave,
        handlePaintWorkspaceDrop,
        handlePaintWorkspacePanelInput,
        handlePaintWorkspacePanelPointerOver,
        handlePaintAnimationDrawerClick,
        ensureCreateProjectState,
        findCreateProjectAspectPreset,
        formatCreateProjectScaleLabel,
        clampCreateProjectDimension,
        renderAnimationPanelMarkup,
        renderUnityPanelMarkup,
        renderWorkspaceSelectOptions,
        clearUiCanvas,
        syncOverlayCanvasPresentation,
        renderStageUi,
        renderCursorCanvas,
        updateStageCursor,
        getLayerPreviewDataUrl,
        queueLayerPreviewRefresh,
        queueStageShadowRefresh,
        getActiveLayer,
        updatePaintTopDockLayout,
        openPaintCreateDialog,
        closePaintCreateDialog,
        applyCreateProjectAspectPreset,
        chooseImageForNewPaintProject,
        createBlankPaintProject,
        resolvePlaybackFallbackRange,
        normalizePlaybackRangeRecord,
        resolveProjectPlaybackSettings,
        updateAnimationPlaybackRanges,
        moveAnimationPlaybackRange,
        pickUnitySheetPath,
        resolveEffectiveUnitySheetBinding,
        resolveUnityBindingScopeValue,
        updateUnityBindingConfig,
        importBoundSpriteSheetInPaint,
        updateUnitySpriteSheetInPaint,
        updateUnityAssetSheetInPaint,
        clampPlaybackFps,
        frameListForPaint,
        syncAnimationFlags,
        queuePaintUiFocusRelease,
        renderPaintJobHud,
        queuePaintLayerViewerRefresh
    });
    return paintWorkspaceUiModule;
}

function getPaintColorUiModule() {
    if (paintColorUiModule) {
        return paintColorUiModule;
    }
    paintColorUiModule = createPaintColorUiModule({
        dom,
        recentColors,
        TOOL_AIR,
        DEFAULT_COLOR,
        DEFAULT_BRUSH_SIZE,
        COLOR_PICKER_WIDTH,
        COLOR_PICKER_HEIGHT,
        RECENT_COLORS_MAX,
        clamp,
        clamp01,
        getSession: () => session,
        updateHud,
        persistPaintPreferences,
        updateTransformPreviewGeometry,
        renderStageUi
    });
    return paintColorUiModule;
}

function getPaintAdjustmentsModule() {
    if (paintAdjustmentsModule) {
        return paintAdjustmentsModule;
    }
    paintAdjustmentsModule = createPaintAdjustmentsModule({
        dom,
        GRADIENT_MAPS,
        clamp,
        clamp01,
        getSession: () => session,
        normalizeHexColor,
        parseHexColor,
        renderStageUi,
        pushUndoAction
    });
    return paintAdjustmentsModule;
}

function getPaintAssetOpsModule() {
    if (paintAssetOpsModule) {
        return paintAssetOpsModule;
    }
    paintAssetOpsModule = createPaintAssetOpsModule({
        env,
        utils,
        assetActions,
        launchTargets,
        projectStore,
        paintWorkspaceState,
        getSession: () => session,
        clamp,
        logPaintTrace,
        resolveWorkspaceAsset,
        switchPaintFile,
        renderPaintWorkspaceUi,
        frameListForPaint,
        resolveFramePath,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        getActiveLayer,
        refreshPaintStageView,
        captureCurrentAnimationFrameState,
        captureFullSnapshot,
        persistLoadedTimelineStates,
        resolveSessionLaunchTarget,
        resolveAnimationUnityBinding,
        resolveEffectiveUnitySheetBinding,
        normalizeUnitySheetBindingConfig,
        normalizeAnimationUnityBindingConfig,
        exportCanvasToPngBuffer,
        loadImageForPath,
        promptForSheetGrid
    });
    return paintAssetOpsModule;
}

function getPaintJobRunnerModule() {
    if (paintJobRunnerModule) {
        return paintJobRunnerModule;
    }
    paintJobRunnerModule = createPaintJobRunnerModule({
        env,
        utils,
        paintProfiler,
        paintWorkspaceState,
        PAINT_JOB_TIMING_STORAGE_KEY,
        getSession: () => session,
        resolveWorkspaceAsset,
        logPaintTrace,
        renderPaintWorkspaceUi,
        updatePaintTopDockLayout
    });
    return paintJobRunnerModule;
}

function getPaintEventsModule() {
    if (paintEventsModule) {
        return paintEventsModule;
    }
    paintEventsModule = createPaintEventsModule({
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
        getSession: () => session,
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
        setActiveLayerByIndex,
        renameLayerAtIndex,
        updateLayerThumbnailTone,
        togglePinnedLayer,
        createPaintLayer,
        duplicateActiveLayerRelative,
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
    });
    return paintEventsModule;
}

function getPaintPromptDialogModule() {
    if (paintPromptDialogModule) {
        return paintPromptDialogModule;
    }
    paintPromptDialogModule = createPaintPromptDialogModule();
    return paintPromptDialogModule;
}

function getPaintToolsModule() {
    if (paintToolsModule) {
        return paintToolsModule;
    }
    paintToolsModule = createPaintToolsModule({
        dom,
        env,
        state,
        utils,
        recentColors,
        BRUSH_BLEND_MODES,
        BRUSH_BLEND_COMPOSITE_MAP,
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
        DEFAULT_VIEW_SCALE,
        RECENT_COLORS_MAX,
        PAINT_PREFS_STORAGE_KEY,
        EDIT_MODE_TRANSFORM,
        getSession: () => session,
        isPaintEditorWindow,
        clamp,
        normalizeHexColor,
        updateRecentColors,
        renderRecentColorSwatches,
        renderRelatedColorSwatches,
        resolveBorderSize,
        cachePressureForTool,
        cacheToolSettingsForTool,
        applyPressureForTool,
        applyToolSettingsForTool,
        setStampPanelVisible,
        updateHud,
        renderCursorCanvas,
        renderBlendMenu,
        rebuildSelectionFromComponents,
        captureSelectionSnapshot,
        pushUndoAction,
        clearOverlayCanvas,
        renderStageUi,
        floodFillAtImagePoint,
        positionStampEditorInline,
        queueStageShadowRefresh,
        queueStagePatternRefresh
    });
    return paintToolsModule;
}

function getPaintStampLibraryModule() {
    if (paintStampLibraryModule) {
        return paintStampLibraryModule;
    }
    paintStampLibraryModule = createPaintStampLibraryModule({
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
        getSession: () => session,
        persistPaintPreferences,
        updateHud,
        renderCursorCanvas,
        renderStageUi
    });
    return paintStampLibraryModule;
}

function getPaintSelectionTransformModule() {
    if (paintSelectionTransformModule) {
        return paintSelectionTransformModule;
    }
    paintSelectionTransformModule = createPaintSelectionTransformModule({
        env,
        utils,
        MAX_CANVAS_DIMENSION,
        CROP_NUDGE_STEP,
        CROP_NUDGE_STEP_FAST,
        LAYER_BASE_NAME,
        EDIT_MODE_PAINT,
        EDIT_MODE_TRANSFORM,
        paintWorkspaceState,
        getSession: () => session,
        clamp,
        clamp01,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        renderStageUi,
        renderCursorCanvas,
        clearSelectionCanvas,
        clearOverlayCanvas,
        clearUiCanvas,
        pushUndoAction,
        updateHud,
        updateStageCursor,
        resizeCanvases,
        createDynamicPaintLayerCanvas,
        createLayerRecord,
        buildLayerName,
        syncPaintLayerCanvasOrder,
        setActiveLayerRefs,
        getActiveLayer,
        setActiveLayerById,
        fitToScreen,
        createPaintLayer,
        refreshTimelinePreviewForCurrentFrame,
        isTimelineBarVisible,
        renderLayerBar,
        exportCanvasToPngBuffer,
        setWrapTransform,
        applyCanvasResizeSnapshot,
        imageToStage,
        normalizeKey,
        logPaintTrace
    });
    return paintSelectionTransformModule;
}

function getPaintSessionCoreModule() {
    if (paintSessionCoreModule) {
        return paintSessionCoreModule;
    }
    paintSessionCoreModule = createPaintSessionCoreModule({
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
        getSession: () => session,
        setSession: (value) => {
            session = value;
        },
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
    });
    return paintSessionCoreModule;
}

function getPaintStageRenderModule() {
    if (paintStageRenderModule) {
        return paintStageRenderModule;
    }
    paintStageRenderModule = createPaintStageRenderModule({
        dom,
        paintWorkspaceState,
        LAYER_PREVIEW_SIZE,
        STICKER_SHADOW_PAD,
        PATTERN_TILE_LIMIT,
        CURSOR_HINT_LEFT_OFFSET,
        SELECTION_DASH_ON,
        SELECTION_DASH_OFF,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_RECT,
        TOOL_BLUR,
        TOOL_STAMP,
        TOOL_LABELS,
        TOOL_KEYS,
        BRUSH_BLEND_MODES,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        EDIT_MODE_SELECT,
        EDIT_MODE_TRANSFORM,
        DEFAULT_COLOR,
        MAX_BRUSH_SIZE,
        getSession: () => session,
        clamp,
        clamp01,
        logPaintTrace,
        appendPaintPerfLog,
        getActiveLayer,
        normalizeLayerVisibility,
        normalizeLayerOpacity,
        resolveEffectiveLayerVisibility,
        resolvePaintThemeToken,
        resolveToolSpacingFactor,
        formatSpacingPercent,
        resolveOpacityCapForTool,
        resolveBorderSize,
        imageToStage,
        buildPath2D,
        isColorPopoverOpen,
        resolveTransformHandleAtStage,
        ensureLayerControlsEnabled,
        createFlattenedLayersCanvas,
        createVisibleLayersCanvas,
        updateTransformPreviewGeometry
    });
    return paintStageRenderModule;
}

function getPaintStrokeEngineModule() {
    if (paintStrokeEngineModule) {
        return paintStrokeEngineModule;
    }
    paintStrokeEngineModule = createPaintStrokeEngineModule({
        paintWorkspaceState,
        DEFAULT_COLOR,
        DEFAULT_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        MIN_ACTIVE_STYLUS_PRESSURE,
        ACTION_BOUNDS_PAD,
        TOOL_AIR,
        TOOL_INK,
        TOOL_PAINT,
        TOOL_BLUR,
        TOOL_STAMP,
        TOOL_RECT,
        STROKE_MODE_BORDER,
        EDIT_MODE_PAINT,
        PAINT_CONTEXTMENU_SUPPRESS_MS,
        IGNORE_MOUSE_AFTER_STYLUS_UP_MS,
        ERASER_LIVE_COMMIT_MS,
        STAMP_LIVE_COMMIT_MS,
        STROKE_SMOOTHING,
        PRESSURE_SMOOTHING,
        TILT_SMOOTHING,
        ANGLE_SMOOTHING,
        getSession: () => session,
        clamp,
        clamp01,
        normalizeAngleRad,
        lerpAngleRad,
        logPaintTrace,
        appendPaintPerfLog,
        getActiveLayer,
        repairSessionLayerStructureIfNeeded,
        renderLayerBar,
        clearOverlayCanvas,
        clearSelectionCanvas,
        updateStageCursor,
        applyToolSize,
        setBrushBlendMode,
        setCursorBlendMode,
        syncOverlayCanvasPresentation,
        resolveOpacityCapForTool,
        computeCommitBounds,
        expandLiveStrokeBeforeSnapshot,
        normalizeBounds,
        syncCurrentFrameStateForTimeline,
        invalidateTimelinePreviewCacheForLayers,
        refreshTimelinePreviewForCurrentFrame,
        scheduleDeferredTimelineStoreSync,
        queueLayerPreviewRefresh,
        pushUndoAction,
        parseHexColor,
        getStampCanvas,
        quantizeStampRadius,
        resolveDabSpacing,
        getPatternWrappedPoints,
        getMirroredPoints,
        getPatternWrappedPairs,
        getMirroredPairs,
        updateActionBounds,
        resolveBrushCompositeOperation,
        createAlphaMaskCanvas,
        extractBorderImageData,
        resolveBorderSize,
        unwrapPatternStrokePoint,
        clientToStage,
        stageToImageRaw,
        queueStagePatternRefresh,
        queueStageShadowRefresh,
        renderStageUi,
        renderCursorCanvas,
        captureStampEntryFromEditor,
        touchStampEntry,
        updateRecentColors,
        renderRecentColorSwatches
    });
    return paintStrokeEngineModule;
}

function getPaintTimelinePersistenceModule() {
    if (paintTimelinePersistenceModule) {
        return paintTimelinePersistenceModule;
    }
    paintTimelinePersistenceModule = createPaintTimelinePersistenceModule({
        env,
        projectStore,
        paintWorkspaceState,
        LAYER_BASE_NAME,
        MAX_CANVAS_DIMENSION,
        getSession: () => session,
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
    });
    return paintTimelinePersistenceModule;
}

function getPaintTimelineModule() {
    if (paintTimelineModule) {
        return paintTimelineModule;
    }
    paintTimelineModule = createPaintTimelineModule({
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
        getSession: () => session,
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
        isTimelineBarVisible,
        isLayerPinned,
        renderTimelineLayerControl,
        escapeWorkspaceText,
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
        ensureAnimationFramesForPaint
    });
    return paintTimelineModule;
}

function isPaintEditorWindow() {
    return env.windowMode === 'paint-editor';
}

function flushPaintPerfLogBuffer() {
    paintPerfLogFlushTimer = null;
    if (!paintPerfLogBuffer.length) {
        return;
    }
    try {
        if (!paintPerfLogPath) {
            const logDir = env.path.join(env.paths.baseDir, '..', 'logs');
            env.fs.mkdirSync(logDir, { recursive: true });
            paintPerfLogPath = env.path.join(logDir, 'workboard_paint.log');
        }
        env.fs.appendFileSync(paintPerfLogPath, paintPerfLogBuffer.join(''), 'utf8');
        paintPerfLogBuffer = [];
    } catch {
        paintPerfLogBuffer = [];
    }
}

function appendPaintPerfLog(message) {
    try {
        const timestamp = new Date().toISOString();
        paintPerfLogBuffer.push(`[${timestamp}] ${message}\n`);
        if (paintPerfLogFlushTimer == null) {
            if (typeof setTimeout === 'function') {
                paintPerfLogFlushTimer = setTimeout(flushPaintPerfLogBuffer, PAINT_PERF_LOG_FLUSH_MS);
            } else {
                flushPaintPerfLogBuffer();
            }
        }
    } catch {}
}

function escapePaintDebugHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatPaintDebugConsoleTime(timestamp) {
    try {
        return new Date(timestamp).toLocaleTimeString('en-US', {
            hour12: true,
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return '';
    }
}

function queuePaintDebugOverlayRender() {
    if (paintDebugRenderQueued || !session?.debug?.visible || !dom.paintDebugBody) {
        return;
    }
    paintDebugRenderQueued = true;
    window.requestAnimationFrame(() => {
        paintDebugRenderQueued = false;
        renderDebugOverlay();
    });
}

function formatPaintDebugConsoleArgs(args = []) {
    const values = Array.isArray(args) ? args : [args];
    return values.map((value) => {
        if (typeof value === 'string') {
            return value;
        }
        return JSON.stringify(safePaintLogValue(value));
    }).join(' ');
}

function pushPaintDebugConsoleEntry(level, scope, payload = {}) {
    const entries = Array.isArray(paintWorkspaceState.debugConsoleEntries)
        ? paintWorkspaceState.debugConsoleEntries
        : [];
    const entry = {
        id: `paint-debug-${Date.now()}-${paintWorkspaceState.debugConsoleCounter += 1}`,
        ts: Date.now(),
        level: String(level || 'debug'),
        scope: String(scope || ''),
        text: JSON.stringify(safePaintLogValue(payload))
    };
    entries.unshift(entry);
    if (entries.length > PAINT_DEBUG_CONSOLE_MAX) {
        entries.length = PAINT_DEBUG_CONSOLE_MAX;
    }
    paintWorkspaceState.debugConsoleEntries = entries;
    queuePaintDebugOverlayRender();
}

function attachPaintConsoleBridge() {
    if (paintConsoleBridgeAttached || typeof console === 'undefined') {
        return;
    }
    paintConsoleBridgeAttached = true;
    const bridgeLevels = ['debug', 'info', 'warn', 'error', 'log'];
    bridgeLevels.forEach((level) => {
        const original = typeof console[level] === 'function' ? console[level].bind(console) : null;
        if (!original) {
            return;
        }
        console[level] = (...args) => {
            try {
                pushPaintDebugConsoleEntry(level === 'log' ? 'debug' : level, `console.${level}`, {
                    message: formatPaintDebugConsoleArgs(args)
                });
            } catch {}
            return original(...args);
        };
    });
}

function safePaintLogValue(value, seen = new WeakSet()) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'function') {
        return '[Function]';
    }
    if (typeof value !== 'object') {
        return String(value);
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.slice(0, 12).map((entry) => safePaintLogValue(entry, seen));
    }
    const output = {};
    Object.keys(value).slice(0, 32).forEach((key) => {
        output[key] = safePaintLogValue(value[key], seen);
    });
    return output;
}

function logPaintTrace(scope, payload = {}) {
    try {
        appendPaintPerfLog(`${scope} ${JSON.stringify(safePaintLogValue(payload))}`);
        pushPaintDebugConsoleEntry('debug', scope, payload);
    } catch (error) {
        appendPaintPerfLog(`${scope} [log-failed:${error?.message || 'unknown'}]`);
    }
}

function reportPaintUiError(scope, error, options = {}) {
    const message = error?.message || String(error) || 'Unknown paint error';
    const payload = {
        scope,
        message,
        stack: typeof error?.stack === 'string' ? error.stack.slice(0, 1200) : ''
    };
    appendPaintPerfLog(`paintUiError ${JSON.stringify(safePaintLogValue(payload))}`);
    console.error(`${scope} failed`, error);
    if (options.toast !== false) {
        utils.showToast?.(options.userMessage || message);
    }
}

function wrapPaintUiAction(scope, handler, options = {}) {
    return function wrappedPaintUiAction(...args) {
        try {
            const result = handler.apply(this, args);
            if (result && typeof result.then === 'function') {
                return result.catch((error) => {
                    reportPaintUiError(scope, error, options);
                });
            }
            return result;
        } catch (error) {
            reportPaintUiError(scope, error, options);
            return undefined;
        }
    };
}

function resolvePaintUiFocusControl(target, options = {}) {
    if (!target || typeof target.closest !== 'function') {
        return null;
    }
    const selector = options.selector || 'button, select';
    const control = target.closest(selector);
    if (!control) {
        return null;
    }
    const withinPaintUi = control.closest('.paint-top-actions, .paint-top-menu, .paint-project-bar, .paint-project-panel, .paint-unity-panel, .paint-animation-drawer');
    return withinPaintUi ? control : null;
}

function queuePaintUiFocusRelease(target, options = {}) {
    const control = resolvePaintUiFocusControl(target, options);
    if (!control) {
        return false;
    }
    const release = () => {
        if (document.activeElement === control) {
            control.blur?.();
        }
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(release);
    } else {
        setTimeout(release, 0);
    }
    return true;
}

function attachPaintRuntimeErrorHandlers() {
    if (paintRuntimeErrorHandlersAttached || typeof window === 'undefined') {
        return;
    }
    paintRuntimeErrorHandlersAttached = true;
    window.addEventListener('error', (event) => {
        const target = event?.target;
        const scope = target && target !== window ? 'paint-runtime-resource-error' : 'paint-runtime-error';
        reportPaintUiError(scope, event?.error || new Error(event?.message || scope), { toast: false });
    });
    window.addEventListener('unhandledrejection', (event) => {
        reportPaintUiError('paint-unhandled-rejection', event?.reason || new Error('unhandled-rejection'), { toast: false });
    });
    window.addEventListener('beforeunload', () => {
        paintProfiler.flush('beforeunload');
        flushPaintPerfLogBuffer();
    });
}

appendPaintPerfLog('paint-renderer-loaded');
attachPaintConsoleBridge();
attachPaintRuntimeErrorHandlers();
if (typeof window !== 'undefined') {
    window.__paintProfiler = paintProfiler;
    window.__workboardProfiler = paintProfiler;
}

function resolveLivePreviewKey(boardId, blockId) {
    return `${String(boardId || '')}:${String(blockId || '')}`;
}

function clearPaintWorkspacePlaybackTimer() {
    if (paintWorkspaceState.playTimer) {
        clearTimeout(paintWorkspaceState.playTimer);
        paintWorkspaceState.playTimer = null;
    }
}

function ensurePaintThemeController() {
    if (paintWorkspaceState.themeController) {
        return paintWorkspaceState.themeController;
    }
    paintWorkspaceState.themeController = paintTheme.createPaintThemeController({
        getMotionMode: () => env.windowActivity?.getMode?.() || 'active',
        getTargets: () => ({
            overlayEl: dom.paintOverlay || null,
            bodyEl: isPaintEditorWindow() ? document.body : null
        }),
        log: (scope, payload) => {
            logPaintTrace(scope, payload);
        },
        onApply: (tokens) => {
            paintWorkspaceState.themeTokens = tokens && typeof tokens === 'object' ? { ...tokens } : null;
        }
    });
    paintWorkspaceState.themeController.setMotionMode?.(env.windowActivity?.getMode?.() || 'active', { force: true });
    if (!paintThemeWindowActivitySubscribed && env.windowActivity?.subscribe) {
        paintThemeWindowActivitySubscribed = true;
        env.windowActivity.subscribe((snapshot) => {
            paintWorkspaceState.themeController?.setMotionMode?.(snapshot?.mode || 'active');
        });
    }
    return paintWorkspaceState.themeController;
}

function startPaintTheme(sourceCanvas, reason) {
    const controller = ensurePaintThemeController();
    const result = controller.start({
        sourceCanvas: sourceCanvas || null,
        reason: reason || 'start'
    });
    paintWorkspaceState.themeTokens = controller.getTokens();
    return result;
}

function stopPaintTheme() {
    if (!paintWorkspaceState.themeController) {
        paintWorkspaceState.themeTokens = null;
        return;
    }
    paintWorkspaceState.themeController.stop();
    paintWorkspaceState.themeTokens = null;
}

function resolvePaintThemeToken(name, fallback = '') {
    const value = paintWorkspaceState.themeTokens?.[name];
    return typeof value === 'string' && value ? value : fallback;
}

function isFileBackedPaintSession(...args) {
    return getPaintSessionCoreModule().isFileBackedPaintSession(...args);
}
function resolveSessionAsset(...args) {
    return getPaintSessionCoreModule().resolveSessionAsset(...args);
}
function resolveSessionLaunchTarget(...args) {
    return getPaintSessionCoreModule().resolveSessionLaunchTarget(...args);
}
function resolveWorkspaceAsset(...args) {
    return getPaintSessionCoreModule().resolveWorkspaceAsset(...args);
}
function createInitialPaintAutosaveState() {
    return getPaintPersistenceModule().createInitialPaintAutosaveState();
}

function ensurePaintAutosaveState() {
    return getPaintPersistenceModule().ensurePaintAutosaveState();
}

function touchPaintSessionActivity(reason = '') {
    return getPaintPersistenceModule().touchPaintSessionActivity(reason);
}

function markPaintSessionDirty(reason = 'change', payload = {}) {
    return getPaintPersistenceModule().markPaintSessionDirty(reason, payload);
}

function resolvePaintAutosaveBlockReason(now = Date.now()) {
    return getPaintPersistenceModule().resolvePaintAutosaveBlockReason(now);
}

function stopPaintAutosaveLoop(reason = 'stop') {
    return getPaintPersistenceModule().stopPaintAutosaveLoop(reason);
}

function isWorkspacePlaceholderState(...args) {
    return getPaintSessionCoreModule().isWorkspacePlaceholderState(...args);
}
function isStandaloneBoardImageSession(...args) {
    return getPaintSessionCoreModule().isStandaloneBoardImageSession(...args);
}
function showEmptyPaintWorkspace(...args) {
    return getPaintSessionCoreModule().showEmptyPaintWorkspace(...args);
}
function shouldDefaultPaintWorkspacePanelHidden(...args) {
    return getPaintSessionCoreModule().shouldDefaultPaintWorkspacePanelHidden(...args);
}
function resolveSessionAnimationContext(asset = resolveWorkspaceAsset()) {
    return getPaintAssetOpsModule().resolveSessionAnimationContext(asset);
}

function resolveBoardImageAbsolutePath(...args) {
    return getPaintSessionCoreModule().resolveBoardImageAbsolutePath(...args);
}
function isTemporaryWorkspaceAsset(...args) {
    return getPaintSessionCoreModule().isTemporaryWorkspaceAsset(...args);
}
async function ensureTemporaryBoardImageAsset(...args) {
    return await getPaintSessionCoreModule().ensureTemporaryBoardImageAsset(...args);
}
function cloneCanvasSurface(...args) {
    return getPaintSessionCoreModule().cloneCanvasSurface(...args);
}
function normalizeLayerThumbnailTone(...args) {
    return getPaintSessionCoreModule().normalizeLayerThumbnailTone(...args);
}
function normalizeLayerOpacity(...args) {
    return getPaintSessionCoreModule().normalizeLayerOpacity(...args);
}
function normalizeLayerVisibility(...args) {
    return getPaintSessionCoreModule().normalizeLayerVisibility(...args);
}
function cloneLayerSnapshots(...args) {
    return getPaintSessionCoreModule().cloneLayerSnapshots(...args);
}
function invalidateTimelinePreviewCacheForLayers(...args) {
    return getPaintSessionCoreModule().invalidateTimelinePreviewCacheForLayers(...args);
}
function resolveAssetPrimaryImageRelativePath(...args) {
    return getPaintSessionCoreModule().resolveAssetPrimaryImageRelativePath(...args);
}
function resolveFrameCanvasExtension(...args) {
    return getPaintSessionCoreModule().resolveFrameCanvasExtension(...args);
}
function ensureSessionTimelineStore(...args) {
    return getPaintTimelineModule().ensureSessionTimelineStore(...args);
}

function cacheSessionLayersInTimelineStore(...args) {
    return getPaintTimelineModule().cacheSessionLayersInTimelineStore(...args);
}

function captureCurrentAnimationFrameState(...args) {
    return getPaintTimelineModule().captureCurrentAnimationFrameState(...args);
}

function syncCurrentFrameStateForTimeline(...args) {
    return getPaintTimelineModule().syncCurrentFrameStateForTimeline(...args);
}

function clearDeferredTimelineSync(...args) {
    return getPaintTimelineModule().clearDeferredTimelineSync(...args);
}

function scheduleDeferredTimelineStoreSync(...args) {
    return getPaintTimelineModule().scheduleDeferredTimelineStoreSync(...args);
}

function refreshTimelinePreviewForCurrentFrame(...args) {
    return getPaintTimelineModule().refreshTimelinePreviewForCurrentFrame(...args);
}

function applyTimelineLayerSnapshotsToSession(...args) {
    return getPaintTimelinePersistenceModule().applyTimelineLayerSnapshotsToSession(...args);
}
function refreshLayerSelectionUi(reason = 'layer-selection-refresh', options = {}) {
    return getPaintLayersModule().refreshLayerSelectionUi(reason, options);
}

async function buildFrameStateFromImagePath(...args) {
    return await getPaintTimelinePersistenceModule().buildFrameStateFromImagePath(...args);
}
async function loadAnimationFrameIntoSession(...args) {
    return await getPaintTimelineModule().loadAnimationFrameIntoSession(...args);
}

function syncTimelineFrameStatesAfterLayerInsert(...args) {
    return getPaintTimelinePersistenceModule().syncTimelineFrameStatesAfterLayerInsert(...args);
}
function syncTimelineFrameStatesAfterLayerDelete(...args) {
    return getPaintTimelinePersistenceModule().syncTimelineFrameStatesAfterLayerDelete(...args);
}
function syncTimelineFrameStatesAfterLayerSwap(...args) {
    return getPaintTimelinePersistenceModule().syncTimelineFrameStatesAfterLayerSwap(...args);
}
function syncTimelineFrameStatesAfterLayerDuplicate(...args) {
    return getPaintTimelinePersistenceModule().syncTimelineFrameStatesAfterLayerDuplicate(...args);
}
function syncTimelineFrameStatesAfterLayerMergeDown(...args) {
    return getPaintTimelinePersistenceModule().syncTimelineFrameStatesAfterLayerMergeDown(...args);
}
function switchPaintFile(filePath) {
    const resolved = String(filePath || '').trim();
    logPaintTrace('switchPaintFile.begin', {
        requestedFilePath: filePath,
        resolvedFilePath: resolved,
        sessionBoardId: session?.boardId || '',
        currentBoardId: state.currentBoardId || ''
    });
    if (!resolved) {
        logPaintTrace('switchPaintFile.missingTarget', {});
        return Promise.resolve({ success: false, error: 'missing-target' });
    }
    clearPaintWorkspacePlaybackTimer();
    const context = projectStore.findAssetContextByFilePath(resolved);
    logPaintTrace('switchPaintFile.context', {
        resolvedFilePath: resolved,
        assetId: context?.asset?.id || '',
        animationId: context?.animation?.id || '',
        frameId: context?.frame?.id || '',
        launchMode: context?.target?.mode || ''
    });
    return openPaintModeForBlock('', {
        inline: true,
        boardId: session?.boardId || state.currentBoardId,
        filePath: resolved,
        paintLaunchTarget: context?.target || {
            mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
            boardId: session?.boardId || state.currentBoardId || '',
            filePath: resolved
        }
    });
}

function ensurePaintWorkspaceUi() {
    return getPaintWorkspaceUiModule().ensurePaintWorkspaceUi();
}

function escapeWorkspaceText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function frameListForPaint(animation) {
    return Array.isArray(animation?.frames) ? animation.frames.slice().sort((a, b) => a.index - b.index) : [];
}

function clampPlaybackFps(...args) {
    return getPaintTimelinePersistenceModule().clampPlaybackFps(...args);
}
function clampFrameHoldValue(...args) {
    return getPaintTimelinePersistenceModule().clampFrameHoldValue(...args);
}
function defaultUnitySheetBindingConfig(...args) {
    return getPaintTimelinePersistenceModule().defaultUnitySheetBindingConfig(...args);
}
function defaultAnimationUnityBindingConfig(...args) {
    return getPaintTimelinePersistenceModule().defaultAnimationUnityBindingConfig(...args);
}
function normalizeUnitySheetBindingConfig(...args) {
    return getPaintTimelinePersistenceModule().normalizeUnitySheetBindingConfig(...args);
}
function normalizeAnimationUnityBindingConfig(...args) {
    return getPaintTimelinePersistenceModule().normalizeAnimationUnityBindingConfig(...args);
}
function resolveProjectPlaybackSettings(...args) {
    return getPaintTimelinePersistenceModule().resolveProjectPlaybackSettings(...args);
}
function normalizePlaybackRangeRecord(...args) {
    return getPaintTimelinePersistenceModule().normalizePlaybackRangeRecord(...args);
}
function getAnimationPlaybackRanges(...args) {
    return getPaintTimelinePersistenceModule().getAnimationPlaybackRanges(...args);
}
function resolvePlaybackFallbackRange(...args) {
    return getPaintTimelinePersistenceModule().resolvePlaybackFallbackRange(...args);
}
function resolveActivePlaybackRange(...args) {
    return getPaintTimelinePersistenceModule().resolveActivePlaybackRange(...args);
}
function resolvePlaybackFps(...args) {
    return getPaintTimelinePersistenceModule().resolvePlaybackFps(...args);
}
function resolveProjectUnityBinding(...args) {
    return getPaintTimelinePersistenceModule().resolveProjectUnityBinding(...args);
}
function resolveAnimationUnityBinding(...args) {
    return getPaintTimelinePersistenceModule().resolveAnimationUnityBinding(...args);
}
function resolveEffectiveUnitySheetBinding(...args) {
    return getPaintTimelinePersistenceModule().resolveEffectiveUnitySheetBinding(...args);
}
function describePlaybackRangeFrames(...args) {
    return getPaintTimelinePersistenceModule().describePlaybackRangeFrames(...args);
}
function renderPlaybackRangesMarkup(...args) {
    return getPaintTimelinePersistenceModule().renderPlaybackRangesMarkup(...args);
}
function renderPlaybackHoldSummaryMarkup(...args) {
    return getPaintTimelinePersistenceModule().renderPlaybackHoldSummaryMarkup(...args);
}
function renderAnimationPanelMarkup(...args) {
    return getPaintTimelinePersistenceModule().renderAnimationPanelMarkup(...args);
}
function renderUnityPanelMarkup(...args) {
    return getPaintTimelinePersistenceModule().renderUnityPanelMarkup(...args);
}
function resolveAnimationLayerSchemaRelativePath(...args) {
    return getPaintTimelinePersistenceModule().resolveAnimationLayerSchemaRelativePath(...args);
}
function resolveAnimationFrameLayerDirRelativePath(...args) {
    return getPaintTimelinePersistenceModule().resolveAnimationFrameLayerDirRelativePath(...args);
}
function resolveAnimationFrameLayerManifestRelativePath(...args) {
    return getPaintTimelinePersistenceModule().resolveAnimationFrameLayerManifestRelativePath(...args);
}
function resolveAnimationFrameLayerImageRelativePath(...args) {
    return getPaintTimelinePersistenceModule().resolveAnimationFrameLayerImageRelativePath(...args);
}
function createBlankTimelineCanvas(...args) {
    return getPaintTimelinePersistenceModule().createBlankTimelineCanvas(...args);
}
function buildTimelineLayerSchemaFromLayers(...args) {
    return getPaintTimelinePersistenceModule().buildTimelineLayerSchemaFromLayers(...args);
}
function extractNumericLayerId(...args) {
    return getPaintTimelinePersistenceModule().extractNumericLayerId(...args);
}
function normalizeTimelineLayerSchema(...args) {
    return getPaintTimelinePersistenceModule().normalizeTimelineLayerSchema(...args);
}
function buildCanonicalAnimationLayerSchema(...args) {
    return getPaintTimelinePersistenceModule().buildCanonicalAnimationLayerSchema(...args);
}
function normalizeTimelineLayerSnapshots(...args) {
    return getPaintTimelinePersistenceModule().normalizeTimelineLayerSnapshots(...args);
}
function repairLoadedTimelineFrameStates(...args) {
    return getPaintTimelinePersistenceModule().repairLoadedTimelineFrameStates(...args);
}
function repairSessionLayerStructureIfNeeded(...args) {
    return getPaintTimelinePersistenceModule().repairSessionLayerStructureIfNeeded(...args);
}
function syncSessionLayerIdCounterToKnownLayers(...args) {
    return getPaintTimelinePersistenceModule().syncSessionLayerIdCounterToKnownLayers(...args);
}
function readPersistedAnimationLayerSchema(...args) {
    return getPaintTimelinePersistenceModule().readPersistedAnimationLayerSchema(...args);
}
async function persistAnimationLayerSchema(...args) {
    return await getPaintTimelinePersistenceModule().persistAnimationLayerSchema(...args);
}
async function loadPersistedTimelineFrameState(...args) {
    return await getPaintTimelinePersistenceModule().loadPersistedTimelineFrameState(...args);
}
async function persistTimelineFrameState(...args) {
    return await getPaintTimelinePersistenceModule().persistTimelineFrameState(...args);
}
async function persistLoadedTimelineStates(...args) {
    return await getPaintTimelinePersistenceModule().persistLoadedTimelineStates(...args);
}
async function persistActiveTimelineFrameState(...args) {
    return await getPaintTimelinePersistenceModule().persistActiveTimelineFrameState(...args);
}
async function primeTimelineFrameStates(...args) {
    return await getPaintTimelineModule().primeTimelineFrameStates(...args);
}

function clearTimelineMotion(...args) {
    return getPaintTimelineModule().clearTimelineMotion(...args);
}

function triggerTimelineMotion(...args) {
    return getPaintTimelineModule().triggerTimelineMotion(...args);
}

function buildTimelineFrameDebugSummary(...args) {
    return getPaintTimelinePersistenceModule().buildTimelineFrameDebugSummary(...args);
}
function logTimelineDomMetrics(...args) {
    return getPaintTimelineModule().logTimelineDomMetrics(...args);
}

function buildTimelineCellCheckerStyle(...args) {
    return getPaintTimelineModule().buildTimelineCellCheckerStyle(...args);
}

function applyTimelineCheckerStyleToLayerRow(layerIndex, thumbnailTone) {
    const layer = session?.layers?.[layerIndex];
    if (!layer) {
        return;
    }
    const checkerStyle = buildTimelineCellCheckerStyle({
        thumbnailTone
    });
    const selector = `.paint-timeline-cell[data-layer-index="${layerIndex}"]`;
    [dom.paintLayerList, dom.paintTimelinePanelList].filter(Boolean).forEach((listEl) => {
        listEl.querySelectorAll(selector).forEach((cell) => {
            cell.setAttribute('style', checkerStyle);
        });
    });
}

function resolveFramePath(...args) {
    return getPaintTimelinePersistenceModule().resolveFramePath(...args);
}
function framePathUsesRootImagePath(...args) {
    return getPaintTimelinePersistenceModule().framePathUsesRootImagePath(...args);
}
async function ensureAnimationFrameHasDedicatedFile(...args) {
    return await getPaintTimelinePersistenceModule().ensureAnimationFrameHasDedicatedFile(...args);
}
function pushUniqueAbsolutePath(list, absolutePath) {
    const resolved = String(absolutePath || '').trim();
    if (!resolved || !env.fs.existsSync(resolved)) {
        return;
    }
    if (!list.includes(resolved)) {
        list.push(resolved);
    }
}

function syncCreateDialogStateFromDom() {
    return getPaintWorkspaceUiModule().syncCreateDialogStateFromDom();
}

function clampCreateProjectDimension(value, fallback = DEFAULT_CREATE_PROJECT_WIDTH) {
    return getPaintWorkspaceUiModule().clampCreateProjectDimension(value, fallback);
}

function normalizeCreateProjectScale(value) {
    return getPaintWorkspaceUiModule().normalizeCreateProjectScale(value);
}

function findCreateProjectAspectPreset(value) {
    return getPaintWorkspaceUiModule().findCreateProjectAspectPreset(value);
}

function formatCreateProjectScaleLabel(value) {
    return getPaintWorkspaceUiModule().formatCreateProjectScaleLabel(value);
}

function ensureCreateProjectState() {
    return getPaintWorkspaceUiModule().ensureCreateProjectState();
}

function applyCreateProjectAspectPreset(presetKey, scaleValue = paintWorkspaceState.createScale, options = {}) {
    return getPaintWorkspaceUiModule().applyCreateProjectAspectPreset(presetKey, scaleValue, options);
}

function setCreateProjectDropActive(active, reason = '', payload = {}) {
    return getPaintWorkspaceUiModule().setCreateProjectDropActive(active, reason, payload);
}

function isProjectCreationSurfaceActive() {
    return getPaintWorkspaceUiModule().isProjectCreationSurfaceActive();
}

function extractDroppedProjectImageFiles(dataTransfer) {
    return getPaintWorkspaceUiModule().extractDroppedProjectImageFiles(dataTransfer);
}

async function finalizeCreatedPaintProject(result, scope, payload = {}) {
    return getPaintWorkspaceUiModule().finalizeCreatedPaintProject(result, scope, payload);
}

async function createBlankPaintProject(options = {}) {
    return getPaintWorkspaceUiModule().createBlankPaintProject(options);
}

async function createPaintProjectFromImageFile(filePath, options = {}) {
    return getPaintWorkspaceUiModule().createPaintProjectFromImageFile(filePath, options);
}

async function chooseImageForNewPaintProject(options = {}) {
    return getPaintWorkspaceUiModule().chooseImageForNewPaintProject(options);
}

function openPaintCreateDialog() {
    return getPaintWorkspaceUiModule().openPaintCreateDialog();
}

function closePaintCreateDialog() {
    return getPaintWorkspaceUiModule().closePaintCreateDialog();
}

function resetWorkspaceUiState() {
    closePaintCreateDialog();
}

async function createPaintProjectFromClipboard(options = {}) {
    return getPaintWorkspaceUiModule().createPaintProjectFromClipboard(options);
}

function isPaintEditableTextField(element) {
    return getPaintWorkspaceUiModule().isPaintEditableTextField(element);
}

async function handlePaintPasteEvent(event) {
    return getPaintWorkspaceUiModule().handlePaintPasteEvent(event);
}

function handlePaintWorkspacePanelInput(event) {
    return getPaintWorkspaceUiModule().handlePaintWorkspacePanelInput(event);
}

function handlePaintWorkspacePanelPointerOver(event) {
    return getPaintWorkspaceUiModule().handlePaintWorkspacePanelPointerOver(event);
}

function renderPaintJobHud() {
    return getPaintJobRunnerModule().renderPaintJobHud();
}

function updatePaintTopDockLayout() {
    const finishProfile = paintProfiler.begin('paint.topDock.layout');
    const topBase = 12;
    const gap = 10;
    const edgePad = 16;
    const collapsedTimelineMinWidth = TIMELINE_LAYOUT.collapsedBarMinWidth;
    let nextTop = topBase;
    let leftInset = edgePad;
    let rightInset = edgePad;
    let availableWidth = 0;
    let layerBarMode = 'hidden';
    let expandedPanelWidth = 0;
    let expandedPanelHeight = 0;
    const projectBar = dom.paintProjectBar || paintWorkspaceUi.projectBarEl;
    const topActionsRight = dom.paintTopActions?.querySelector?.('.paint-top-actions-right') || null;
    const overlayRect = dom.paintOverlay?.getBoundingClientRect?.() || {
        left: 0,
        top: 0,
        right: Math.max(window.innerWidth || 0, 0),
        bottom: Math.max(window.innerHeight || 0, 0)
    };
    const overlayWidth = Math.max(0, Math.round((overlayRect.right || 0) - (overlayRect.left || 0)));
    const overlayHeight = Math.max(0, Math.round((overlayRect.bottom || 0) - (overlayRect.top || 0)));
    if (projectBar) {
        projectBar.style.top = `${topBase}px`;
        if (!projectBar.hidden) {
            nextTop += projectBar.offsetHeight + gap;
        }
    }
    if (dom.paintLayerBar) {
        if (!dom.paintLayerBar.hidden) {
            const projectRect = projectBar && !projectBar.hidden
                ? projectBar.getBoundingClientRect()
                : null;
            const topRightRect = topActionsRight
                ? topActionsRight.getBoundingClientRect()
                : null;
            leftInset = projectRect
                ? Math.max(edgePad, Math.round(projectRect.right - overlayRect.left + gap))
                : edgePad;
            rightInset = topRightRect
                ? Math.max(edgePad, Math.round(overlayRect.right - topRightRect.left + gap))
                : edgePad;
            availableWidth = Math.max(0, overlayWidth - leftInset - rightInset);
            if (availableWidth >= collapsedTimelineMinWidth) {
                layerBarMode = 'inline';
                const preferredInlineWidth = Math.max(
                    collapsedTimelineMinWidth,
                    Math.round(parseFloat(String(dom.paintLayerBar.style.width || '0')) || dom.paintLayerBar.offsetWidth || 0)
                );
                const inlineWidth = Math.min(availableWidth, preferredInlineWidth);
                dom.paintLayerBar.style.top = `${topBase}px`;
                dom.paintLayerBar.style.left = `${leftInset}px`;
                dom.paintLayerBar.style.right = '';
                dom.paintLayerBar.style.transform = 'none';
                dom.paintLayerBar.style.width = `${inlineWidth}px`;
            } else {
                layerBarMode = 'stacked';
                dom.paintLayerBar.style.top = `${nextTop}px`;
                dom.paintLayerBar.style.left = '50%';
                dom.paintLayerBar.style.right = '';
                dom.paintLayerBar.style.transform = 'translateX(-50%)';
                dom.paintLayerBar.style.width = '';
            }
        }
    }
    if (dom.paintTimelinePanel) {
        const projectRect = projectBar && !projectBar.hidden
            ? projectBar.getBoundingClientRect()
            : null;
        const expandedTop = projectRect
            ? Math.max(104, Math.round(projectRect.bottom - overlayRect.top + 68))
            : 104;
        const expandedMaxWidth = clamp(Math.round(overlayWidth * 0.66), 320, Math.max(320, overlayWidth - 48));
        const expandedLeft = clamp(Math.round(overlayWidth * 0.14), 24, Math.max(24, overlayWidth - expandedMaxWidth - 24));
        const expandedMaxHeight = Math.max(240, overlayHeight - expandedTop - 72);
        dom.paintTimelinePanel.style.top = `${expandedTop}px`;
        dom.paintTimelinePanel.style.left = `${expandedLeft}px`;
        dom.paintTimelinePanel.style.maxWidth = `${expandedMaxWidth}px`;
        dom.paintTimelinePanel.style.maxHeight = `${expandedMaxHeight}px`;
        expandedPanelWidth = expandedMaxWidth;
        expandedPanelHeight = expandedMaxHeight;
    }
    if (dom.paintJobHud) {
        dom.paintJobHud.style.top = `${nextTop}px`;
    }
    const projectVisible = !!projectBar && !projectBar.hidden;
    const layerVisible = !!dom.paintLayerBar && !dom.paintLayerBar.hidden;
    const expandedVisible = !!dom.paintTimelinePanel && !dom.paintTimelinePanel.hidden;
    const jobVisible = !!dom.paintJobHud && !dom.paintJobHud.hidden;
    const layoutSignature = [
        projectVisible ? '1' : '0',
        layerVisible ? '1' : '0',
        expandedVisible ? '1' : '0',
        jobVisible ? '1' : '0',
        paintWorkspaceState.timelineExpanded === true ? '1' : '0',
        nextTop,
        leftInset,
        rightInset,
        availableWidth,
        layerBarMode,
        expandedPanelWidth,
        expandedPanelHeight
    ].join('|');
    const changed = layoutSignature !== paintTopDockLayoutSignature;
    if (changed) {
        paintTopDockLayoutSignature = layoutSignature;
        paintProfiler.count('paint.topDock.layout.changed');
    } else {
        paintProfiler.count('paint.topDock.layout.unchanged');
    }
    if (jobVisible) {
        paintProfiler.count('paint.topDock.layout.jobVisible');
    }
    if (changed) {
        logPaintTrace('updatePaintTopDockLayout', {
            projectVisible,
            layerVisible,
            expandedVisible,
            jobVisible,
            timelineExpanded: paintWorkspaceState.timelineExpanded === true,
            nextTop
        });
    }
    finishProfile({
        changed,
        jobVisible,
        layerBarMode,
        nextTop
    });
}

function renderPaintProjectBar(asset, assets, options = {}) {
    return getPaintWorkspaceUiModule().renderPaintProjectBar(asset, assets, options);
}

function renderLayerViewerOverlay() {
    return getPaintWorkspaceUiModule().renderLayerViewerOverlay();
}

function isPaintLayerViewerOpen() {
    return paintWorkspaceState.layerViewerOpen === true;
}

function openPaintLayerViewer(options = {}) {
    return getPaintWorkspaceUiModule().openPaintLayerViewer(options);
}

function closePaintLayerViewer(options = {}) {
    return getPaintWorkspaceUiModule().closePaintLayerViewer(options);
}

function togglePaintLayerViewer(options = {}) {
    return getPaintWorkspaceUiModule().togglePaintLayerViewer(options);
}

function navigatePaintLayerViewer(step, options = {}) {
    return getPaintWorkspaceUiModule().navigatePaintLayerViewer(step, options);
}

function queuePaintLayerViewerRefresh(reason = 'layer-viewer-refresh') {
    if (!isPaintLayerViewerOpen()) {
        return false;
    }
    if (paintWorkspaceState.layerViewerRefreshQueued) {
        return true;
    }
    paintWorkspaceState.layerViewerRefreshQueued = true;
    if (paintLayerViewerRefreshTimer) {
        clearTimeout(paintLayerViewerRefreshTimer);
    }
    paintLayerViewerRefreshTimer = setTimeout(() => {
        paintLayerViewerRefreshTimer = null;
        paintWorkspaceState.layerViewerRefreshQueued = false;
        if (!isPaintLayerViewerOpen()) {
            return;
        }
        logPaintTrace('paint.layerViewer.refresh', {
            reason,
            mode: paintWorkspaceState.layerViewerMode,
            focusedLayerId: paintWorkspaceState.layerViewerFocusedLayerId || ''
        });
        renderLayerViewerOverlay();
    }, LAYER_VIEWER_REFRESH_INTERVAL_MS);
    return true;
}

function clearPaintWorkspaceVariantPreview() {
    return getPaintWorkspaceUiModule().clearPaintWorkspaceVariantPreview();
}

function refreshPaintStageView(reason = 'refresh-stage-view') {
    return getPaintWorkspaceUiModule().refreshPaintStageView(reason);
}

function syncOverlayCanvasPresentation(reason = 'overlay-presentation-sync') {
    return getPaintStageRenderModule().syncOverlayCanvasPresentation(reason);
}

function clearPaintWorkspaceStage() {
    return getPaintWorkspaceUiModule().clearPaintWorkspaceStage();
}

function refreshTimelineContextMenuOverlay() {
    const collapsedList = dom.paintLayerList || null;
    const expandedList = dom.paintTimelinePanelList || null;
    if (!collapsedList && !expandedList) {
        return false;
    }
    collapsedList?.querySelector?.('.paint-timeline-menu')?.remove();
    expandedList?.querySelector?.('.paint-timeline-menu')?.remove();
    if (!paintWorkspaceState.timelineMenu.open) {
        return true;
    }
    const host = String(paintWorkspaceState.timelineMenu?.host || 'collapsed');
    const hostList = host === 'expanded'
        ? (expandedList || collapsedList)
        : (collapsedList || expandedList);
    if (!hostList) {
        return false;
    }
    const markup = renderTimelineContextMenu().trim();
    if (!markup) {
        return false;
    }
    const template = document.createElement('template');
    template.innerHTML = markup;
    const nextMenu = template.content.firstElementChild;
    if (!nextMenu) {
        return false;
    }
    hostList.appendChild(nextMenu);
    return true;
}

function closeTimelineContextMenu() {
    if (!paintWorkspaceState.timelineMenu.open) {
        return;
    }
    paintWorkspaceState.timelineMenu.open = false;
    paintWorkspaceState.timelineMenu.kind = '';
    paintWorkspaceState.timelineMenu.layerIndex = -1;
    paintWorkspaceState.timelineMenu.frameId = '';
    paintWorkspaceState.timelineMenu.pseudoFrame = false;
    refreshTimelineContextMenuOverlay();
    logPaintTrace('closeTimelineContextMenu', {
        drawerOpen: paintWorkspaceState.drawerOpen === true,
        timelineExpanded: paintWorkspaceState.timelineExpanded === true
    });
}

function openTimelineContextMenu(options = {}) {
    const rawKind = String(options.kind || '');
    paintWorkspaceState.timelineMenu = {
        open: true,
        x: Math.max(8, Math.round(Number(options.x) || 0)),
        y: Math.max(8, Math.round(Number(options.y) || 0)),
        kind: rawKind,
        layerIndex: Number.isFinite(Number(options.layerIndex)) ? Number(options.layerIndex) : -1,
        frameId: String(options.frameId || ''),
        pseudoFrame: options.pseudoFrame === true,
        host: String(options.host || 'collapsed') === 'expanded' ? 'expanded' : 'collapsed'
    };
    logPaintTrace('openTimelineContextMenu', paintWorkspaceState.timelineMenu);
    refreshTimelineContextMenuOverlay();
}

function togglePinnedLayer(layerId) {
    const id = String(layerId || '').trim();
    if (!id) {
        return;
    }
    const current = Array.isArray(paintWorkspaceState.pinnedLayerIds) ? paintWorkspaceState.pinnedLayerIds.slice() : [];
    const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
    paintWorkspaceState.pinnedLayerIds = next;
    logPaintTrace('togglePinnedLayer', {
        layerId: id,
        pinnedLayerIds: next
    });
    renderLayerBar();
}

function syncTimelineFrameStatesAfterLayerThumbnailToneChange(layerIndex, thumbnailTone) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layer = Array.isArray(frameState.layers) ? frameState.layers[layerIndex] : null;
        if (layer) {
            layer.thumbnailTone = thumbnailTone;
        }
    });
    logPaintTrace('timelineLayers.thumbnailTone', {
        layerIndex,
        thumbnailTone,
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function syncTimelineFrameStatesAfterLayerDisplayChange(layerIndex, display = {}) {
    if (!session?.timelineStore?.frameStates) {
        return;
    }
    const visible = normalizeLayerVisibility(display.visible, true);
    const opacity = normalizeLayerOpacity(display.opacity);
    Object.values(session.timelineStore.frameStates).forEach((frameState) => {
        const layer = Array.isArray(frameState.layers) ? frameState.layers[layerIndex] : null;
        if (layer) {
            layer.visible = visible;
            layer.opacity = opacity;
        }
    });
    logPaintTrace('timelineLayers.display', {
        layerIndex,
        visible,
        opacity,
        frameCount: Object.keys(session.timelineStore.frameStates || {}).length
    });
}

function updateLayerThumbnailTone(layerIndex, value, options = {}) {
    return getPaintLayersModule().updateLayerThumbnailTone(layerIndex, value, options);
}

function updateLayerVisibility(layerIndex, visible, options = {}) {
    return getPaintLayersModule().updateLayerVisibility(layerIndex, visible, options);
}

function updateLayerOpacity(layerIndex, opacity, options = {}) {
    return getPaintLayersModule().updateLayerOpacity(layerIndex, opacity, options);
}

function toggleActiveLayerVisibility() {
    return getPaintLayersModule().toggleActiveLayerVisibility();
}

function setIsolateActiveLayerEnabled(enabled, options = {}) {
    return getPaintLayersModule().setIsolateActiveLayerEnabled(enabled, options);
}

function toggleIsolateActiveLayer() {
    return getPaintLayersModule().toggleIsolateActiveLayer();
}

function beginTimelineLayerDrag(layerIndex, pointerId, startY, buttonEl = null) {
    return getPaintLayersModule().beginTimelineLayerDrag(layerIndex, pointerId, startY, buttonEl);
}

function updateTimelineLayerDrag(pointerId, clientY) {
    return getPaintLayersModule().updateTimelineLayerDrag(pointerId, clientY);
}

function endTimelineLayerDrag(pointerId) {
    return getPaintLayersModule().endTimelineLayerDrag(pointerId);
}

function renderTimelineEyeIcon(visible) {
    return getPaintLayersModule().renderTimelineEyeIcon(visible);
}

function refreshTimelineLayerControlUi(layerIndex) {
    return getPaintLayersModule().refreshTimelineLayerControlUi(layerIndex);
}

function isLayerPinned(layerId) {
    const id = String(layerId || '').trim();
    return !!id && Array.isArray(paintWorkspaceState.pinnedLayerIds) && paintWorkspaceState.pinnedLayerIds.includes(id);
}

function buildTimelineDisplayRows(layers) {
    return Array.isArray(layers)
        ? layers.map((layer, index) => ({ layer, index })).filter((entry) => !!entry.layer).sort((a, b) => b.index - a.index)
        : [];
}

function buildTimelineFrameEntries(asset, animation, context, options = {}) {
    const frames = frameListForPaint(animation);
    const expanded = options.expanded === true
        || (options.expanded !== false && paintWorkspaceState.timelineExpanded === true);
    if (frames.length) {
        const currentFrameId = context?.frame?.id || frames[0]?.id || '';
        const currentIndex = Math.max(0, frames.findIndex((frame) => frame.id === currentFrameId));
        if (!expanded) {
            const collapsedFrames = [
                frames[currentIndex - 1] || {
                    id: `timeline-space-left-${currentFrameId}`,
                    index: Math.max(0, currentIndex - 1),
                    path: '',
                    keyframe: false,
                    hold: 1,
                    pseudo: true,
                    disabled: true,
                    spacer: true,
                    slot: 'left'
                },
                frames[currentIndex],
                frames[currentIndex + 1] || {
                    id: `timeline-space-right-${currentFrameId}`,
                    index: currentIndex + 1,
                    path: '',
                    keyframe: false,
                    hold: 1,
                    pseudo: true,
                    disabled: true,
                    spacer: true,
                    slot: 'right'
                }
            ];
            return collapsedFrames.map((frame, visibleIndex) => ({
                id: frame.id,
                index: frame.index,
                path: resolveFramePath(frame),
                keyframe: frame.keyframe === true,
                hold: Math.max(1, Number(frame.hold) || 1),
                pseudo: frame.pseudo === true,
                disabled: frame.disabled === true,
                spacer: frame.spacer === true,
                slot: frame.slot || (visibleIndex === 0 ? 'left' : (visibleIndex === 1 ? 'center' : 'right'))
            }));
        }
        return frames.map((frame) => ({
            id: frame.id,
            index: frame.index,
            path: resolveFramePath(frame),
            keyframe: frame.keyframe === true,
            hold: Math.max(1, Number(frame.hold) || 1),
            pseudo: frame.pseudo === true,
            disabled: frame.disabled === true,
            slot: frame.id === currentFrameId ? 'center' : 'grid'
        }));
    }
    const fallbackPath = resolveAssetPrimaryImageRelativePath(asset);
    return [{
        id: String(session?.timelineStore?.currentFrameId || 'timeline-session-frame'),
        index: 0,
        path: fallbackPath,
        keyframe: true,
        hold: 1,
        pseudo: false,
        slot: 'center'
    }];
}

function resolveTimelineFrameLayers(...args) {
    return getPaintTimelineModule().resolveTimelineFrameLayers(...args);
}

function resolveTimelineCanvasPreviewUrl(...args) {
    return getPaintTimelineModule().resolveTimelineCanvasPreviewUrl(...args);
}

function resolveTimelineCellPreviewUrl(...args) {
    return getPaintTimelineModule().resolveTimelineCellPreviewUrl(...args);
}

function buildTimelineFrameEntryFromCellNode(...args) {
    return getPaintTimelineModule().buildTimelineFrameEntryFromCellNode(...args);
}

function updateTimelineCellSelectionState(...args) {
    return getPaintTimelineModule().updateTimelineCellSelectionState(...args);
}

function updateTimelineCellPreviewNode(...args) {
    return getPaintTimelineModule().updateTimelineCellPreviewNode(...args);
}

function patchTimelineVisibleFramePreviews(...args) {
    return getPaintTimelineModule().patchTimelineVisibleFramePreviews(...args);
}

function patchTimelineVisibleFrames(...args) {
    return getPaintTimelineModule().patchTimelineVisibleFrames(...args);
}

function patchExpandedTimelineSelection(...args) {
    return getPaintTimelineModule().patchExpandedTimelineSelection(...args);
}

function patchCollapsedTimelineSelection(...args) {
    return getPaintTimelineModule().patchCollapsedTimelineSelection(...args);
}

function centerTimelineOnActiveFrame(...args) {
    return getPaintTimelineModule().centerTimelineOnActiveFrame(...args);
}

function getCurrentTimelineFrameId(...args) {
    return getPaintTimelineModule().getCurrentTimelineFrameId(...args);
}

function renderTimelineLayerControl(layer, layerIndex, isActiveRow) {
    const visible = normalizeLayerVisibility(layer?.visible, true);
    const opacity = normalizeLayerOpacity(layer?.opacity);
    return `
        <div class="paint-timeline-layer-control${isActiveRow ? ' is-active' : ''}${visible ? '' : ' is-hidden'}" data-layer-index="${layerIndex}">
            <button class="paint-timeline-layer-eye${visible ? '' : ' is-hidden'}" type="button" data-action="timeline-layer-visibility" data-layer-index="${layerIndex}" aria-pressed="${visible ? 'true' : 'false'}" title="${visible ? 'Hide layer' : 'Show layer'}">${renderTimelineEyeIcon(visible)}</button>
            <span class="paint-timeline-layer-opacity">${Math.round(opacity * 100)}%</span>
        </div>
    `;
}

function renderTimelineContextMenu() {
    const menu = paintWorkspaceState.timelineMenu || {};
    const items = [];
    let controlsMarkup = '';
    let controlRowCount = 0;
    if (menu.kind === 'layer' || menu.kind === 'cell') {
        const layer = session?.layers?.[Number(menu.layerIndex)] || null;
        const thumbnailTone = normalizeLayerThumbnailTone(layer?.thumbnailTone);
        controlsMarkup = `
            <label class="paint-timeline-menu-slider">
                <span>Thumbnail Background</span>
                <input type="range" min="${LAYER_THUMBNAIL_TONE_MIN}" max="${LAYER_THUMBNAIL_TONE_MAX}" step="0.01" value="${thumbnailTone}" data-role="timeline-layer-thumbnail-tone" data-layer-index="${Number(menu.layerIndex)}">
            </label>
        `;
        controlRowCount += 1;
        items.push(
            '<button type="button" data-action="timeline-menu-layer-above">New Layer Above</button>',
            '<button type="button" data-action="timeline-menu-layer-below">New Layer Below</button>',
            '<button type="button" data-action="timeline-menu-layer-duplicate-above">Duplicate Layer Above</button>',
            '<button type="button" data-action="timeline-menu-layer-duplicate-below">Duplicate Layer Below</button>',
            '<button type="button" data-action="timeline-menu-layer-move-down">Move Layer Down</button>',
            '<button type="button" data-action="timeline-menu-layer-merge-down">Merge Layer Down</button>',
            '<button type="button" data-action="timeline-menu-layer-toggle-pin">Pin / Unpin Layer</button>',
            '<button type="button" data-action="timeline-menu-layer-delete">Delete Layer</button>'
        );
    }
    if (menu.kind === 'frame' || menu.kind === 'cell') {
        const context = resolveSessionAnimationContext(resolveWorkspaceAsset());
        const targetFrame = menu.frameId && context.animation
            ? frameListForPaint(context.animation).find((entry) => entry.id === String(menu.frameId || ''))
            : context.frame || null;
        const holdValue = clampFrameHoldValue(targetFrame?.hold, 1);
        controlsMarkup += `
            <label class="paint-timeline-menu-slider">
                <span>Hold</span>
                <input type="number" min="1" max="24" step="1" value="${holdValue}" data-role="timeline-frame-hold" data-frame-id="${escapeWorkspaceText(String(targetFrame?.id || menu.frameId || ''))}">
            </label>
        `;
        controlRowCount += 1;
        items.push(
            '<button type="button" data-action="timeline-menu-frame-blank-left">Blank Frame Left</button>',
            '<button type="button" data-action="timeline-menu-frame-blank-right">Blank Frame Right</button>',
            '<button type="button" data-action="timeline-menu-frame-duplicate-left">Duplicate Frame Left</button>',
            '<button type="button" data-action="timeline-menu-frame-duplicate-right">Duplicate Frame Right</button>',
            '<button type="button" data-action="timeline-menu-frame-delete">Delete Frame</button>'
        );
    }
    if (!items.length) {
        return '';
    }
    const estimatedWidth = controlsMarkup ? 252 : 224;
    const estimatedHeight = (items.length * 32) + 18 + Math.max(0, items.length - 1) * 6 + (controlRowCount * 62);
    const hostKind = String(menu.host || 'collapsed');
    const hostEl = hostKind === 'expanded'
        ? (dom.paintTimelinePanel || dom.paintLayerBar)
        : (dom.paintLayerBar || dom.paintTimelinePanel);
    const hostRect = hostEl?.getBoundingClientRect?.();
    const viewportMaxX = hostRect ? Math.max(8, Math.round(window.innerWidth - hostRect.left - estimatedWidth - 8)) : 720;
    const viewportMaxY = hostRect ? Math.max(8, Math.round(window.innerHeight - hostRect.top - estimatedHeight - 8)) : 420;
    const maxX = hostRect ? Math.max(8, Math.min(Math.round(hostRect.width - estimatedWidth - 8), viewportMaxX)) : 720;
    const maxY = hostRect ? Math.max(8, Math.min(Math.round(hostRect.height - estimatedHeight - 8), viewportMaxY)) : 420;
    const safeX = clamp(Math.round(Number(menu.x) || 8), 8, maxX);
    const safeY = clamp(Math.round(Number(menu.y) || 8), 8, maxY);
    logPaintTrace('renderTimelineContextMenu', {
        kind: menu.kind || '',
        safeX,
        safeY,
        maxX,
        maxY,
        itemCount: items.length
    });
    return `
        <div class="paint-timeline-menu" style="left:${safeX}px; top:${safeY}px;">
            ${controlsMarkup}
            ${items.join('')}
        </div>
    `;
}

function collectPaintReferencePaths(asset, options = {}) {
    const list = [];
    if (options.includeSessionFile !== false && session?.filePath) {
        pushUniqueAbsolutePath(list, session.filePath);
    }
    const animation = options.animation || null;
    const frame = options.frame || null;
    (asset?.references || []).forEach((reference) => {
        if (!reference?.enabled || !reference?.path) {
            return;
        }
        if (reference.animationId && animation && reference.animationId !== animation.id) {
            return;
        }
        if (reference.frameId && frame && reference.frameId !== frame.id) {
            return;
        }
        pushUniqueAbsolutePath(list, projectStore.resolveAssetPath(asset, reference.path));
    });
    if (animation?.starterImagePath) {
        pushUniqueAbsolutePath(list, projectStore.resolveAssetPath(asset, animation.starterImagePath));
    }
    if (frame?.originalPath) {
        pushUniqueAbsolutePath(list, projectStore.resolveAssetPath(asset, frame.originalPath));
    }
    frameListForPaint(animation)
        .filter((entry) => entry.isReference)
        .forEach((entry) => {
            pushUniqueAbsolutePath(list, projectStore.resolveAssetPath(asset, resolveFramePath(entry)));
        });
    return list;
}

function summarizePaintHistory(entry) {
    const type = String(entry?.type || '').trim() || 'run';
    if (type === 'still-variants') {
        return `${Math.max(1, Number(entry?.variantCount) || 0)} variant${Number(entry?.variantCount) === 1 ? '' : 's'}`;
    }
    if (type === 'paint-over') {
        return entry?.presetKey ? `Preset ${entry.presetKey}` : 'Paint-over';
    }
    if (type === 'frame-repair') {
        return `Frame ${Math.max(1, Number(entry?.targetIndex) + 1)} repair`;
    }
    if (type === 'animation-frames') {
        return `${Math.max(1, Number(entry?.frameCount) || 0)} frame run`;
    }
    if (type === 'paint-save') {
        return 'Paint save';
    }
    if (type === 'approve-variant') {
        return 'Variant approved';
    }
    return type;
}

function buildPaintJobTimingKey(meta = {}) {
    return getPaintJobRunnerModule().buildPaintJobTimingKey(meta);
}

function formatPaintEtaMs(value) {
    return getPaintJobRunnerModule().formatPaintEtaMs(value);
}

function isTimeoutLikePaintJobError(error) {
    return getPaintJobRunnerModule().isTimeoutLikePaintJobError(error);
}

function classifyPaintJobRetryReason(error) {
    return getPaintJobRunnerModule().classifyPaintJobRetryReason(error);
}

function extractUsefulFailureLine(raw) {
    return getPaintJobRunnerModule().extractUsefulFailureLine(raw);
}

function extractStructuredFailureMessage(raw) {
    return getPaintJobRunnerModule().extractStructuredFailureMessage(raw);
}

function normalizePaintTimingRecord(value) {
    return getPaintJobRunnerModule().normalizePaintTimingRecord(value);
}

function getPaintTimingEstimateMs(record) {
    return getPaintJobRunnerModule().getPaintTimingEstimateMs(record);
}

function derivePaintJobTimeoutMs(estimateMs, meta = {}) {
    return getPaintJobRunnerModule().derivePaintJobTimeoutMs(estimateMs, meta);
}

function getPaintTimingRecord(key) {
    return getPaintJobRunnerModule().getPaintTimingRecord(key);
}

function estimatePaintJobDurationMs(meta = {}) {
    return getPaintJobRunnerModule().estimatePaintJobDurationMs(meta);
}

function clearPaintJobEstimateTimer() {
    return getPaintJobRunnerModule().clearPaintJobEstimateTimer();
}

function syncWorkspacePromptFromDom(assetId) {
    return assetId ? projectStore.getAsset(assetId) : null;
}

function renderWorkspaceSelectOptions(options = [], selectedValue = '') {
    return options.map((entry) => {
        const value = String(entry?.value || '');
        const label = String(entry?.label || value);
        return `<option value="${value}"${value === String(selectedValue || '') ? ' selected' : ''}>${label}</option>`;
    }).join('');
}

function updateProjectPlaybackSettings(assetId, updates, reason = 'asset2d-playback-update') {
    return projectStore.updateAsset(assetId, (draft) => {
        draft.playback = {
            ...resolveProjectPlaybackSettings(draft),
            ...(updates && typeof updates === 'object' ? updates : {})
        };
        draft.playback.defaultPlaybackFps = clampPlaybackFps(draft.playback.defaultPlaybackFps, 12);
        draft.playback.playbackLoop = draft.playback.playbackLoop !== false;
        return draft;
    }, reason);
}

function updateAnimationPlaybackRanges(assetId, animationId, updater, reason = 'asset2d-playback-range-update') {
    return projectStore.updateAnimation(assetId, animationId, (draft) => {
        const ranges = getAnimationPlaybackRanges(draft);
        const nextRanges = typeof updater === 'function' ? (updater(ranges) || ranges) : ranges;
        draft.playbackRanges = Array.isArray(nextRanges)
            ? nextRanges.map((entry, index) => normalizePlaybackRangeRecord(entry, index))
            : [];
        return draft;
    }, reason);
}

function moveAnimationPlaybackRange(assetId, animationId, rangeId, direction = 0) {
    return updateAnimationPlaybackRanges(assetId, animationId, (ranges) => {
        const currentIndex = ranges.findIndex((entry) => entry.id === rangeId);
        if (currentIndex < 0) {
            return ranges;
        }
        const targetIndex = clamp(currentIndex + direction, 0, Math.max(0, ranges.length - 1));
        if (targetIndex === currentIndex) {
            return ranges;
        }
        const next = ranges.slice();
        const [moved] = next.splice(currentIndex, 1);
        next.splice(targetIndex, 0, moved);
        return next;
    }, 'asset2d-playback-range-reorder');
}

function resolveUnityBindingScopeValue(animation) {
    return resolveAnimationUnityBinding(animation).useProjectBinding === false ? 'animation' : 'project';
}

function updateUnityBindingConfig(assetId, animationId, updates, reason = 'asset2d-unity-binding-update', options = {}) {
    const asset = projectStore.getAsset(assetId);
    if (!asset) {
        return null;
    }
    const animation = animationId ? asset.animations?.[animationId] || null : null;
    const scope = String(options.scope || resolveUnityBindingScopeValue(animation)).trim() || 'project';
    if (scope === 'animation' && animationId) {
        return projectStore.updateAnimation(assetId, animationId, (draft) => {
            draft.export = draft.export && typeof draft.export === 'object' ? draft.export : {};
            const current = normalizeAnimationUnityBindingConfig(draft.export.unity);
            const next = {
                ...current,
                ...(updates && typeof updates === 'object' ? updates : {}),
                useProjectBinding: false
            };
            const targetPath = typeof next.targetPath === 'string' ? next.targetPath.trim() : '';
            next.targetPath = targetPath;
            if (Object.prototype.hasOwnProperty.call(next, 'enabled')) {
                next.enabled = next.enabled === true;
            } else if (Object.prototype.hasOwnProperty.call(updates || {}, 'targetPath')) {
                next.enabled = !!targetPath;
            }
            next.columns = Math.max(1, Math.round(Number(next.columns) || 1));
            next.rows = Math.max(1, Math.round(Number(next.rows) || 1));
            next.frameWidth = Math.max(0, Math.round(Number(next.frameWidth) || 0));
            next.frameHeight = Math.max(0, Math.round(Number(next.frameHeight) || 0));
            next.downscale = Math.max(1, Number(next.downscale) || 1);
            draft.export.unity = next;
            return draft;
        }, reason);
    }
    return projectStore.updateAsset(assetId, (draft) => {
        draft.integrations = draft.integrations && typeof draft.integrations === 'object' ? draft.integrations : {};
        draft.integrations.unity = draft.integrations.unity && typeof draft.integrations.unity === 'object'
            ? draft.integrations.unity
            : {};
        const current = normalizeUnitySheetBindingConfig(draft.integrations.unity.defaultSheetBinding);
        const next = {
            ...current,
            ...(updates && typeof updates === 'object' ? updates : {})
        };
        const targetPath = typeof next.targetPath === 'string' ? next.targetPath.trim() : '';
        next.targetPath = targetPath;
        if (Object.prototype.hasOwnProperty.call(next, 'enabled')) {
            next.enabled = next.enabled === true;
        } else if (Object.prototype.hasOwnProperty.call(updates || {}, 'targetPath')) {
            next.enabled = !!targetPath;
        }
        next.columns = Math.max(1, Math.round(Number(next.columns) || 1));
        next.rows = Math.max(1, Math.round(Number(next.rows) || 1));
        next.frameWidth = Math.max(0, Math.round(Number(next.frameWidth) || 0));
        next.frameHeight = Math.max(0, Math.round(Number(next.frameHeight) || 0));
        next.downscale = Math.max(1, Number(next.downscale) || 1);
        draft.integrations.unity.defaultSheetBinding = next;
        return draft;
    }, reason);
}

function ensureAnimationUnityBindingOverride(assetId, animationId) {
    const asset = projectStore.getAsset(assetId);
    const animation = animationId ? asset?.animations?.[animationId] || null : null;
    if (!asset || !animation) {
        return null;
    }
    const projectBinding = resolveProjectUnityBinding(asset);
    const current = resolveAnimationUnityBinding(animation);
    if (current.useProjectBinding === false) {
        return animation;
    }
    return projectStore.updateAnimation(assetId, animationId, (draft) => {
        draft.export = draft.export && typeof draft.export === 'object' ? draft.export : {};
        draft.export.unity = {
            ...normalizeAnimationUnityBindingConfig(draft.export.unity),
            useProjectBinding: false,
            enabled: projectBinding.enabled === true || !!projectBinding.targetPath,
            targetPath: current.targetPath || projectBinding.targetPath,
            columns: current.columns > 0 ? current.columns : projectBinding.columns,
            rows: current.rows > 0 ? current.rows : projectBinding.rows,
            frameWidth: current.frameWidth > 0 ? current.frameWidth : projectBinding.frameWidth,
            frameHeight: current.frameHeight > 0 ? current.frameHeight : projectBinding.frameHeight,
            downscale: Math.max(1, Number(current.downscale) || Number(projectBinding.downscale) || 1)
        };
        return draft;
    }, 'asset2d-unity-binding-override');
}

async function pickUnitySheetPath(mode = 'open', options = {}) {
    if (!env.electron?.ipcRenderer) {
        const fallback = await promptForPaintText({
            title: mode === 'save' ? 'Sprite sheet path' : 'Existing sprite sheet path',
            placeholder: 'Enter the absolute PNG path',
            initialValue: String(options.initialPath || ''),
            confirmLabel: 'Use Path'
        });
        return fallback ? String(fallback).trim() : '';
    }
    const result = await env.electron.ipcRenderer.invoke('workboard:2d-pick-sheet-path', {
        mode,
        initialPath: typeof options.initialPath === 'string' ? options.initialPath : '',
        title: typeof options.title === 'string' ? options.title : ''
    });
    if (!result || result.canceled || !result.path) {
        return '';
    }
    return String(result.path || '').trim();
}

async function importBoundSpriteSheetInPaint(asset, animation = null) {
    return await getPaintAssetOpsModule().importBoundSpriteSheetInPaint(asset, animation);
}

async function updateUnitySpriteSheetInPaint(asset, animation) {
    return await getPaintAssetOpsModule().updateUnitySpriteSheetInPaint(asset, animation);
}

async function updateUnityAssetSheetInPaint(asset, animation) {
    return await getPaintAssetOpsModule().updateUnityAssetSheetInPaint(asset, animation);
}

function summarizePaintHistoryMeta(entry) {
    const details = [];
    if (entry?.size) {
        details.push(String(entry.size));
    }
    if (entry?.imageSize) {
        details.push(String(entry.imageSize));
    }
    if (entry?.aspectRatio) {
        details.push(String(entry.aspectRatio));
    }
    if (entry?.model) {
        details.push(String(entry.model));
    }
    return details.join(' · ');
}

function syncAnimationFlags(draftAnimation) {
    const frames = frameListForPaint(draftAnimation);
    draftAnimation.frames = frames;
    draftAnimation.frameCount = Math.max(Number(draftAnimation.frameCount) || 0, frames.length);
    draftAnimation.keyframeIndices = frames.filter((frame) => frame.keyframe).map((frame) => frame.index);
    draftAnimation.referenceFrameIds = frames.filter((frame) => frame.isReference).map((frame) => frame.id);
    return draftAnimation;
}

function recordStillHistory(draft, entry) {
    draft.still.generationHistory = Array.isArray(draft.still.generationHistory) ? draft.still.generationHistory : [];
    draft.still.generationHistory.unshift(entry);
    return draft;
}

async function exportCurrentCanvasReferenceForGeneration(asset, options = {}) {
    if (!asset || !session) {
        throw new Error('Paint session missing for canvas reference export');
    }
    const renderMode = session.isolateActiveLayer === true ? 'visible-isolated' : 'visible-composite';
    logPaintTrace('exportCurrentCanvasReferenceForGeneration.begin', {
        assetId: asset.id,
        assetName: asset.name || '',
        jobId: options.jobId || '',
        width: session.width,
        height: session.height,
        layerCount: Array.isArray(session.layers) ? session.layers.length : 0,
        isolateActiveLayer: session.isolateActiveLayer === true,
        activeLayerIndex: Math.max(0, Math.round(Number(session.activeLayerIndex) || 0)),
        renderMode
    });
    const visibleCanvas = createVisibleLayersCanvas();
    if (!visibleCanvas) {
        throw new Error('Unable to export visible canvas reference');
    }
    const hasTransparency = hasMeaningfulCanvasTransparency(visibleCanvas);
    const buffer = await exportCanvasToPngBuffer(visibleCanvas);
    if (!buffer?.length) {
        throw new Error('Unable to export current canvas reference');
    }
    const fileName = `${String(options.jobId || utils.createId('job2d')).trim() || utils.createId('job2d')}-canvas-ref.png`;
    const relativePath = projectStore.writeBufferToAsset(asset.id, `paint/runtime/${fileName}`, buffer);
    const absolutePath = projectStore.resolveAssetPath(asset, relativePath);
    logPaintTrace('exportCurrentCanvasReferenceForGeneration.complete', {
        assetId: asset.id,
        relativePath,
        absolutePath,
        bytes: buffer.length,
        hasTransparency,
        width: visibleCanvas.width,
        height: visibleCanvas.height,
        isolateActiveLayer: session.isolateActiveLayer === true,
        activeLayerIndex: Math.max(0, Math.round(Number(session.activeLayerIndex) || 0)),
        renderMode
    });
    return {
        relativePath,
        absolutePath,
        bytes: buffer.length,
        hasTransparency,
        width: visibleCanvas.width,
        height: visibleCanvas.height
    };
}

function hasMeaningfulCanvasPixels(canvas, options = {}) {
    if (!canvas) {
        return false;
    }
    const width = Math.max(1, Number(canvas.width) || 1);
    const height = Math.max(1, Number(canvas.height) || 1);
    const ctx = canvas.getContext?.('2d', { willReadFrequently: true });
    if (!ctx) {
        return false;
    }
    try {
        const data = ctx.getImageData(0, 0, width, height).data;
        const stride = Math.max(1, Math.floor((width * height) / 18000));
        const alphaThreshold = Math.max(1, Math.round(Number(options.alphaThreshold) || 8));
        let visibleCount = 0;
        for (let index = 3; index < data.length; index += (4 * stride)) {
            if (data[index] > alphaThreshold) {
                visibleCount += 1;
                if (visibleCount >= 8) {
                    return true;
                }
            }
        }
    } catch {}
    return false;
}

function hasMeaningfulCanvasTransparency(canvas) {
    if (!canvas) {
        return false;
    }
    const width = Math.max(1, Number(canvas.width) || 1);
    const height = Math.max(1, Number(canvas.height) || 1);
    const ctx = canvas.getContext?.('2d', { willReadFrequently: true });
    if (!ctx) {
        return false;
    }
    try {
        const data = ctx.getImageData(0, 0, width, height).data;
        let nonOpaque = 0;
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] < 250) {
                nonOpaque += 1;
                if (nonOpaque >= Math.max(48, Math.floor((width * height) * 0.01))) {
                    return true;
                }
            }
        }
    } catch {}
    return false;
}

function layerHasVisibleContentOutsideCurrentFrame(layerId, currentFrameId) {
    if (!session?.timelineStore?.frameStates || !layerId) {
        return false;
    }
    return Object.values(session.timelineStore.frameStates).some((frameState) => {
        if (!frameState || String(frameState.frameId || '') === String(currentFrameId || '')) {
            return false;
        }
        const layer = Array.isArray(frameState.layers)
            ? frameState.layers.find((entry) => String(entry?.id || '') === String(layerId))
            : null;
        return !!layer?.canvas && hasMeaningfulCanvasPixels(layer.canvas);
    });
}

function resolveImageResultOutputBuffer(responseImage, options = {}) {
    return getPaintAssetOpsModule().resolveImageResultOutputBuffer(responseImage, options);
}

async function insertImageResultIntoCurrentLayer(asset, responseImage, options = {}) {
    return await getPaintAssetOpsModule().insertImageResultIntoCurrentLayer(asset, responseImage, options);
}

async function insertImageResultAsLayer(asset, responseImage, options = {}) {
    return await getPaintAssetOpsModule().insertImageResultAsLayer(asset, responseImage, options);
}

async function insertGeneratedImagesIntoLayerStack(asset, responseImages, options = {}) {
    return await getPaintAssetOpsModule().insertGeneratedImagesIntoLayerStack(asset, responseImages, options);
}

async function insertGeneratedResultAsTopLayer(asset, responseImage, options = {}) {
    return insertImageResultAsLayer(asset, responseImage, {
        ...options,
        insertIndex: Math.max(0, session?.layers?.length || 0),
        targetSubdir: options.targetSubdir || 'still/generated',
        logScope: 'insertGeneratedResultAsTopLayer',
        captureReason: 'generated-ref-layer',
        refreshReason: 'insert-generated-result',
        previewReason: 'generated-layer',
        reason: options.reason || 'asset2d-generate-layer'
    });
}

async function persistGeneratedVariants(asset, responseImages, options = {}) {
    return await getPaintAssetOpsModule().persistGeneratedVariants(asset, responseImages, options);
}

async function addReferenceFromFile(asset, sourcePath, options = {}) {
    if (!asset || !sourcePath) {
        return;
    }
    const preferredName = options.preferredName || env.path.basename(sourcePath);
    const relative = projectStore.copyFileToAsset(asset.id, sourcePath, 'references', preferredName);
    projectStore.updateAsset(asset.id, (draft) => {
        const exists = (draft.references || []).some((reference) => reference.path === relative);
        if (!exists) {
            draft.references = Array.isArray(draft.references) ? draft.references : [];
            draft.references.unshift({
                id: utils.createId('ref'),
                type: 'image',
                label: env.path.basename(relative),
                role: options.role || 'general',
                path: relative,
                animationId: options.animationId || '',
                frameId: options.frameId || '',
                enabled: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        }
        return draft;
    }, 'asset2d-reference-add');
}

async function promptForPaintImageFiles(options = {}) {
    return await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.accept || SUPPORTED_PROJECT_IMAGE_TYPES;
        input.multiple = options.multiple === true;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.addEventListener('change', () => {
            const files = Array.from(input.files || []).filter((file) => !!file?.path);
            input.remove();
            resolve(files);
        }, { once: true });
        document.body.appendChild(input);
        input.click();
    });
}

function handlePaintWorkspaceDragEnter(event) {
    if (!isProjectCreationSurfaceActive()) {
        return;
    }
    const files = extractDroppedProjectImageFiles(event.dataTransfer);
    if (!files.length) {
        return;
    }
    event.preventDefault();
    setCreateProjectDropActive(true, 'drag-enter', {
        fileCount: files.length
    });
}

function handlePaintWorkspaceDragOver(event) {
    if (!isProjectCreationSurfaceActive()) {
        return;
    }
    const files = extractDroppedProjectImageFiles(event.dataTransfer);
    if (!files.length) {
        return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
    setCreateProjectDropActive(true, 'drag-over', {
        fileCount: files.length
    });
}

function handlePaintWorkspaceDragLeave(event) {
    if (!isProjectCreationSurfaceActive()) {
        return;
    }
    const nextTarget = event.relatedTarget;
    if (nextTarget && dom.paintOverlay?.contains?.(nextTarget)) {
        return;
    }
    setCreateProjectDropActive(false, 'drag-leave');
}

async function handlePaintWorkspaceDrop(event) {
    if (!isProjectCreationSurfaceActive()) {
        return;
    }
    const files = extractDroppedProjectImageFiles(event.dataTransfer);
    if (!files.length) {
        setCreateProjectDropActive(false, 'drop-empty');
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const file = files[0];
    setCreateProjectDropActive(false, 'drop-begin', {
        fileCount: files.length,
        filePath: file.path || ''
    });
    logPaintTrace('createProject.drop.begin', {
        fileCount: files.length,
        filePath: file.path || '',
        createDialogOpen: paintWorkspaceState.createDialogOpen === true,
        workspacePlaceholder: isWorkspacePlaceholderState()
    });
    try {
        await createPaintProjectFromImageFile(file.path, {
            source: 'drop'
        });
    } catch (error) {
        logPaintTrace('createProject.drop.failed', {
            message: error?.message || String(error),
            filePath: file.path || ''
        });
        utils.showToast?.(error?.message || 'Image drop failed');
    }
}

function ensureAnimationFramesForPaint(asset, animation) {
    const existing = frameListForPaint(animation);
    const targetCount = Math.max(1, Math.round(Number(animation?.frameCount) || existing.length || 8));
    if (existing.length >= targetCount) {
        return projectStore.getAsset(asset.id)?.animations?.[animation.id] || animation;
    }
    const starterPath = animation.starterImagePath || asset.still.approvedImagePath || asset.still.workingImagePath || asset.still.sourceImages?.[0] || '';
    projectStore.updateAnimation(asset.id, animation.id, (draft) => {
        const frames = frameListForPaint(draft);
        for (let index = frames.length; index < targetCount; index += 1) {
            frames.push({
                id: utils.createId('frame'),
                index,
                originalPath: starterPath,
                workingPath: '',
                hold: 1,
                status: 'idle',
                notes: '',
                promptHistory: [],
                manualEdited: false,
                approved: false,
                isReference: false,
                keyframe: false,
                selected: false,
                reviewStatus: 'pending',
                lastRunAt: '',
                lastRunType: '',
                lastPresetKey: ''
            });
        }
        draft.frames = frames;
        draft.frameCount = Math.max(Number(draft.frameCount) || 0, frames.length);
        return syncAnimationFlags(draft);
    }, 'asset2d-animation-ensure-frames');
    return projectStore.getAsset(asset.id)?.animations?.[animation.id] || animation;
}

function buildAnimationFramePrompt(asset, animation, frame, options = {}) {
    return getPaintAssetOpsModule().buildAnimationFramePrompt(asset, animation, frame, options);
}

async function runBreakoutGeneration(asset, animation, options = {}) {
    return await getPaintAssetOpsModule().runBreakoutGeneration(asset, animation, options);
}

async function importAnimationSheetInPaint(asset) {
    if (!asset) {
        return;
    }
    const files = await promptForPaintImageFiles();
    const first = files[0];
    if (!first?.path) {
        return;
    }
    const result = await assetActions.importAnimationSheetAsset(asset.id, first.path, {
        name: `${env.path.basename(first.path, env.path.extname(first.path))} Animation`
    });
    if (result?.absolutePath) {
        await switchPaintFile(result.absolutePath);
    } else {
        renderPaintWorkspaceUi();
    }
}

async function promptForSheetGrid(animation) {
    const defaultValue = Number(animation?.columns) > 0 && Number(animation?.rows) > 0
        ? `${Math.max(1, Number(animation.columns))}x${Math.max(1, Number(animation.rows))}`
        : '4x4';
    const value = await promptForPaintText({
        title: 'Sprite sheet grid',
        placeholder: 'Columns x Rows',
        initialValue: defaultValue,
        confirmLabel: 'Slice'
    });
    if (value === null) {
        return null;
    }
    const match = String(value || '').trim().match(/^(\d+)\s*[x, ]\s*(\d+)$/i);
    if (!match) {
        throw new Error('Enter the grid as columns x rows, for example 4x4');
    }
    return {
        columns: Math.max(1, Math.round(Number(match[1]) || 1)),
        rows: Math.max(1, Math.round(Number(match[2]) || 1))
    };
}

async function sliceAnimationSheetInPaint(asset, animation) {
    return await getPaintAssetOpsModule().sliceAnimationSheetInPaint(asset, animation);
}

async function rebuildAnimationSheetInPaint(asset, animation, options = {}) {
    return await getPaintAssetOpsModule().rebuildAnimationSheetInPaint(asset, animation, options);
}

async function exportAnimationBundle(asset, animation) {
    return await getPaintAssetOpsModule().exportAnimationBundle(asset, animation);
}

async function runAnimationFrameBatch(asset, animation, options = {}) {
    return await getPaintAssetOpsModule().runAnimationFrameBatch(asset, animation, options);
}

async function runCurrentFrameRepair(asset, animation, frame, options = {}) {
    return await getPaintAssetOpsModule().runCurrentFrameRepair(asset, animation, frame, options);
}

async function navigatePaintAnimation(...args) {
    return await getPaintTimelineModule().navigatePaintAnimation(...args);
}

function ensureTimelineAnimation(...args) {
    return getPaintTimelineModule().ensureTimelineAnimation(...args);
}

async function buildCompositeBufferFromSessionLayers(...args) {
    return await getPaintTimelineModule().buildCompositeBufferFromSessionLayers(...args);
}

function bindSessionToSequenceFrame(...args) {
    return getPaintTimelineModule().bindSessionToSequenceFrame(...args);
}

async function persistSessionIntoSequenceFrame(...args) {
    return await getPaintTimelineModule().persistSessionIntoSequenceFrame(...args);
}

async function ensureTimelineSequenceContext(...args) {
    return await getPaintTimelineModule().ensureTimelineSequenceContext(...args);
}

async function setTimelineDrawerOpen(...args) {
    return await getPaintTimelineModule().setTimelineDrawerOpen(...args);
}

async function buildFrameBufferFromCurrentState(...args) {
    return await getPaintTimelineModule().buildFrameBufferFromCurrentState(...args);
}

async function insertAnimationFrameRelative(...args) {
    return await getPaintTimelineModule().insertAnimationFrameRelative(...args);
}

async function insertTimelineFrameFromHotkey(...args) {
    return await getPaintTimelineModule().insertTimelineFrameFromHotkey(...args);
}

async function deleteTimelineFrame(...args) {
    return await getPaintTimelineModule().deleteTimelineFrame(...args);
}

function createPaintLayerAt(insertIndex, options = {}) {
    return getPaintLayersModule().createPaintLayerAt(insertIndex, options);
}

function moveActiveLayerDown() {
    return getPaintLayersModule().moveActiveLayerDown();
}

function schedulePaintAnimationPlayback(...args) {
    return getPaintTimelineModule().schedulePaintAnimationPlayback(...args);
}

function togglePaintAnimationPlayback(...args) {
    return getPaintTimelineModule().togglePaintAnimationPlayback(...args);
}

function isPaintModeActive() {
    return !!state.paintModeActive;
}

function isActivePointerInteraction() {
    return !!(session?.pointerDown
        || session?.isDrawing
        || session?.colorPickDrag
        || session?.sizeDrag?.active
        || session?.zoomDrag?.active
        || session?.pan?.active
        || (session?.crop?.active && session?.crop?.drag)
        || (session?.editMode === EDIT_MODE_SELECT && session?.select?.lassoing)
        || (session?.editMode === EDIT_MODE_TRANSFORM && session?.transform?.dragging));
}

function shouldIgnoreNonActivePointerEvent(event) {
    if (!session || !event) {
        return true;
    }
    if (!isActivePointerInteraction()) {
        return false;
    }
    const activePointerId = typeof session.pointerId === 'number' ? session.pointerId : NaN;
    const eventPointerId = typeof event.pointerId === 'number' ? event.pointerId : NaN;
    const eventPointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
    const activePointerType = typeof session.activePointerType === 'string' ? session.activePointerType : '';
    if (Number.isFinite(activePointerId) && Number.isFinite(eventPointerId) && eventPointerId !== activePointerId) {
        if (!(activePointerType === 'mouse' && eventPointerType === 'mouse')) {
            return true;
        }
    }
    if ((session.activeWasStylusLike || activePointerType === 'pen') && eventPointerType === 'mouse' && !isStylusLikeEvent(event)) {
        return true;
    }
    return false;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function resolveToolSpacingFactor(tool) {
    const raw = session?.toolSpacing && tool ? Number(session.toolSpacing[tool]) : NaN;
    const normalized = Number.isFinite(raw) ? raw : 1;
    return clamp(normalized, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
}

function quantizeSpacingFactor(value) {
    const clamped = clamp(Number(value) || 0, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
    if (clamped >= 0.1) {
        return Math.round(clamped * 1000) / 1000;
    }
    if (clamped >= 0.01) {
        return Math.round(clamped * 10000) / 10000;
    }
    return Math.round(clamped * 100000) / 100000;
}

function resolveSpacingDragRate(startSpacingFactor) {
    const start = clamp(Number(startSpacingFactor) || 1, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
    const log = Math.log10 ? Math.log10(start) : (Math.log(start) / Math.LN10);
    const t = clamp01((-log) / 5);
    return TOOL_SPACING_DRAG_RATE_NORMAL + ((TOOL_SPACING_DRAG_RATE_FAST - TOOL_SPACING_DRAG_RATE_NORMAL) * t);
}

function applySpacingDrag(startSpacingFactor, dy) {
    const start = clamp(Number(startSpacingFactor) || 1, TOOL_SPACING_MIN, TOOL_SPACING_MAX);
    const rate = resolveSpacingDragRate(start);
    const log0 = Math.log10 ? Math.log10(start) : (Math.log(start) / Math.LN10);
    const log1 = log0 + ((Number(dy) || 0) * rate);
    const next = Math.pow(10, log1);
    return quantizeSpacingFactor(next);
}

function formatSpacingPercent(factor) {
    const percent = clamp(Number(factor) || 0, TOOL_SPACING_MIN, TOOL_SPACING_MAX) * 100;
    if (percent >= 10) {
        return `${Math.round(percent)}%`;
    }
    if (percent >= 1) {
        return `${Math.round(percent * 10) / 10}%`;
    }
    if (percent >= 0.01) {
        return `${Math.round(percent * 100) / 100}%`;
    }
    return `${Math.max(0.001, Math.round(percent * 1000) / 1000)}%`;
}

function resolveDabSpacing(tool, radius, options = {}) {
    const spacingFactor = STROKE_DAB_SPACING[tool] ?? STROKE_DAB_SPACING.default;
    const normalized = Number.isFinite(spacingFactor) && spacingFactor > 0 ? spacingFactor : STROKE_DAB_SPACING.default;
    const min = Number.isFinite(options.min) ? options.min : 0.35;
    const spacing = radius * normalized * resolveToolSpacingFactor(tool);
    return Math.max(min, spacing);
}

function resolveBorderSize() {
    const fallback = Math.round((session?.size || DEFAULT_BRUSH_SIZE) * DEFAULT_BORDER_SIZE_RATIO);
    const value = Number(session?.borderSize);
    const resolved = Number.isFinite(value) ? value : fallback;
    return clamp(Math.round(resolved), 1, 240);
}

function resolvePressureDefaults(tool) {
    return PRESSURE_DEFAULTS[tool] || { opacity: true, size: true };
}

function cachePressureForTool(tool) {
    if (!session?.pressureByTool || !tool) {
        return;
    }
    session.pressureByTool[tool] = {
        opacity: session.pressureAffectsOpacity !== false,
        size: session.pressureAffectsSize !== false
    };
}

function cacheToolSettingsForTool(tool) {
    if (!session || !tool) {
        return;
    }
    if (session.strokeModeByTool) {
        session.strokeModeByTool[tool] = session.strokeMode;
    }
    if (session.blendModeByTool) {
        session.blendModeByTool[tool] = session.brushBlendMode;
    }
}

function applyPressureForTool(tool) {
    if (!session) {
        return;
    }
    const cached = session.pressureByTool?.[tool];
    if (cached) {
        session.pressureAffectsOpacity = cached.opacity !== false;
        session.pressureAffectsSize = cached.size !== false;
        return;
    }
    const defaults = resolvePressureDefaults(tool);
    session.pressureAffectsOpacity = defaults.opacity !== false;
    session.pressureAffectsSize = defaults.size !== false;
}

function applyToolSettingsForTool(tool) {
    if (!session || !tool) {
        return;
    }
    if (tool === TOOL_AIR || tool === TOOL_INK || tool === TOOL_PAINT || tool === TOOL_RECT) {
        const mode = session.strokeModeByTool?.[tool];
        session.strokeMode = mode === STROKE_MODE_BORDER ? STROKE_MODE_BORDER : STROKE_MODE_FILL;
    } else {
        session.strokeMode = STROKE_MODE_FILL;
    }
    if (session.blendModeByTool && typeof session.blendModeByTool[tool] === 'string') {
        const mode = session.blendModeByTool[tool];
        session.brushBlendMode = BRUSH_BLEND_MODES.includes(mode) ? mode : 'normal';
        session.brushBlendIndex = Math.max(0, BRUSH_BLEND_MODES.indexOf(session.brushBlendMode));
        applyOverlayBlendMode();
    } else {
        session.brushBlendMode = BRUSH_BLEND_MODES.includes(session.brushBlendMode) ? session.brushBlendMode : 'normal';
        session.brushBlendIndex = Math.max(0, BRUSH_BLEND_MODES.indexOf(session.brushBlendMode));
        applyOverlayBlendMode();
    }
}

function ensureOpacityCapsInitialized() {
    if (!session) {
        return;
    }
    if (!session.opacityCapByTool || typeof session.opacityCapByTool !== 'object') {
        session.opacityCapByTool = {};
    }
    for (const tool of Object.keys(TOOL_LABELS)) {
        if (typeof session.opacityCapByTool[tool] !== 'number') {
            session.opacityCapByTool[tool] = 1;
        }
    }
}

function resolveOpacityCapForTool(tool) {
    if (!session) {
        return 1;
    }
    const caps = session.opacityCapByTool && typeof session.opacityCapByTool === 'object' ? session.opacityCapByTool : null;
    const raw = caps && tool ? Number(caps[tool]) : 1;
    return Number.isFinite(raw) ? clamp(raw, 0, 1) : 1;
}

function quantizeStampRadius(radius) {
    const value = Number(radius);
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    const quantized = Math.round(value * STAMP_RADIUS_QUANT) / STAMP_RADIUS_QUANT;
    return Math.max(0.05, quantized);
}

function normalizeKey(event) {
    return typeof event?.key === 'string' ? event.key.toLowerCase() : '';
}

function ensureDom() {
    return !!(dom.paintOverlay && dom.paintStage && dom.paintStageUiCanvas && dom.paintCursorCanvas && dom.paintCanvasWrap && dom.paintCanvas && dom.paintSelectionCanvas && dom.paintOverlayCanvas && dom.paintUiCanvas);
}

function resolveBoardImageBlock(blockId) {
    const board = state.boardData?.boards?.[state.currentBoardId];
    if (!board || !Array.isArray(board.blocks)) {
        return null;
    }
    return board.blocks.find((candidate) => candidate && candidate.id === blockId) || null;
}

function resolveImageBlockByBoard(boardId, blockId) {
    const board = state.boardData?.boards?.[boardId];
    if (!board || !Array.isArray(board.blocks)) {
        return null;
    }
    return board.blocks.find((candidate) => candidate && candidate.id === blockId && candidate.type === 'image') || null;
}

function findRenderedImageElement(blockId) {
    if (!dom.boardGrid || !blockId) {
        return null;
    }
    return dom.boardGrid.querySelector(`.board-block[data-id="${String(blockId).replace(/"/g, '\\"')}"] img`);
}

function cloneViewportSnapshot(viewport) {
    if (!viewport || typeof viewport !== 'object') {
        return null;
    }
    const scale = Number(viewport.scale);
    const scrollX = Number(viewport.scrollX);
    const scrollY = Number(viewport.scrollY);
    if (!Number.isFinite(scale) || !Number.isFinite(scrollX) || !Number.isFinite(scrollY)) {
        return null;
    }
    return { scale, scrollX, scrollY };
}

function restoreBoardViewportAfterPaint(viewport) {
    const safeViewport = cloneViewportSnapshot(viewport);
    if (!safeViewport) {
        return;
    }
    try {
        env.management?.renderBoard?.({
            targetViewport: safeViewport,
            preserveViewport: false,
            skipViewportCommit: true
        });
    } catch (error) {
        console.warn('Failed to restore paint entry viewport', error);
    }
}

function updateRenderedBoardImageSource(blockId, src) {
    const img = findRenderedImageElement(blockId);
    if (!img || !src) {
        return;
    }
    const nextToken = String((Number(img.dataset.paintSwapToken) || 0) + 1);
    img.dataset.paintSwapToken = nextToken;
    const apply = () => {
        if (img.dataset.paintSwapToken !== nextToken) {
            return;
        }
        img.src = src;
    };
    const preload = new Image();
    preload.decoding = 'async';
    preload.src = src;
    preload.onload = apply;
    preload.onerror = apply;
    if (typeof preload.decode === 'function') {
        preload.decode().then(apply).catch(() => {});
    }
}

function dropLivePreviewState(boardId, blockId) {
    if (!(state.paintLivePreviews instanceof Map)) {
        return;
    }
    state.paintLivePreviews.delete(resolveLivePreviewKey(boardId, blockId));
    state.paintLivePreviews.delete(blockId);
}

function applyLivePreview(payload = {}) {
    const boardId = String(payload.boardId || state.currentBoardId || '').trim();
    const blockId = String(payload.blockId || '').trim();
    const dataUrl = String(payload.dataUrl || '').trim();
    if (!boardId || !blockId || !dataUrl || !(state.paintLivePreviews instanceof Map)) {
        return;
    }
    state.paintLivePreviews.set(resolveLivePreviewKey(boardId, blockId), dataUrl);
    state.paintLivePreviews.set(blockId, dataUrl);
    if (state.currentBoardId === boardId) {
        updateRenderedBoardImageSource(blockId, dataUrl);
    }
}

function clearLivePreview(payload = {}) {
    const boardId = String(payload.boardId || state.currentBoardId || '').trim();
    const blockId = String(payload.blockId || '').trim();
    if (!boardId || !blockId || !(state.paintLivePreviews instanceof Map)) {
        return;
    }
    dropLivePreviewState(boardId, blockId);
    if (state.currentBoardId === boardId) {
        const block = resolveImageBlockByBoard(boardId, blockId);
        if (block?.assetName) {
            updateRenderedBoardImageSource(blockId, env.blocks.image.resolveImageAssetUrl(block.assetName));
        }
    }
}

function applyCommittedImage(payload = {}) {
    const boardId = String(payload.boardId || '').trim();
    const blockId = String(payload.blockId || '').trim();
    const assetName = String(payload.assetName || '').trim();
    if (!boardId || !blockId || !assetName) {
        return;
    }
    dropLivePreviewState(boardId, blockId);
    const block = resolveImageBlockByBoard(boardId, blockId);
    if (!block) {
        return;
    }
    block.assetName = assetName;
    block.updatedAt = new Date().toISOString();
    console.info('Paint commit applied to board data', { boardId, blockId, assetName });
    if (state.currentBoardId === boardId) {
        updateRenderedBoardImageSource(blockId, env.blocks.image.resolveImageAssetUrl(assetName));
    }
    if (typeof env.data?.persistBoardData === 'function') {
        env.data.persistBoardData(true, 'paint-save');
    } else {
        env.data?.queueSave?.('paint-save');
    }
}

function drawLayerPreview(previewCanvas, sourceCanvas, layerId = '') {
    return getPaintStageRenderModule().drawLayerPreview(previewCanvas, sourceCanvas, layerId);
}

function getLayerPreviewDataUrl(layerOrId, options = {}) {
    return getPaintStageRenderModule().getLayerPreviewDataUrl(layerOrId, options);
}

function refreshLayerPreviewCanvases(options = {}) {
    return getPaintStageRenderModule().refreshLayerPreviewCanvases(options);
}

function queueLayerPreviewRefresh(options = {}) {
    return getPaintStageRenderModule().queueLayerPreviewRefresh(options);
}

function nextLayerId() {
    if (!session) {
        return '';
    }
    syncSessionLayerIdCounterToKnownLayers('next-layer-id');
    const raw = Number(session.layerIdCounter);
    session.layerIdCounter = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
    const id = `layer-${session.layerIdCounter}`;
    session.layerIdCounter += 1;
    return id;
}

function getActiveLayer() {
    if (!session?.layers?.length) {
        return null;
    }
    const index = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
    return session.layers[index] || null;
}

function createDynamicPaintLayerCanvas(width, height) {
    if (!dom.paintCanvasWrap || !dom.paintSelectionCanvas) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'paint-canvas paint-canvas-layer';
    canvas.dataset.paintLayerDynamic = '1';
    canvas.width = width;
    canvas.height = height;
    dom.paintCanvasWrap.insertBefore(canvas, dom.paintSelectionCanvas);
    return canvas;
}

function destroyDynamicPaintLayerCanvases() {
    if (!dom.paintCanvasWrap) {
        return;
    }
    const nodes = dom.paintCanvasWrap.querySelectorAll('canvas[data-paint-layer-dynamic="1"]');
    nodes.forEach((node) => node.remove());
}

function syncPaintLayerCanvasOrder() {
    if (!session?.layers?.length || !dom.paintCanvasWrap || !dom.paintSelectionCanvas) {
        return;
    }
    for (let index = 0; index < session.layers.length; index += 1) {
        const layer = session.layers[index];
        if (!layer?.canvas) {
            continue;
        }
        dom.paintCanvasWrap.insertBefore(layer.canvas, dom.paintSelectionCanvas);
        layer.canvas.style.opacity = String(normalizeLayerOpacity(layer.opacity));
        layer.canvas.style.display = resolveEffectiveLayerVisibility(layer, index) ? '' : 'none';
    }
    syncOverlayCanvasPresentation('sync-layer-order');
}

function setActiveLayerRefs(index, options = {}) {
    if (!session?.layers?.length) {
        return false;
    }
    const safeIndex = clamp(Math.round(Number(index) || 0), 0, session.layers.length - 1);
    const nextLayer = session.layers[safeIndex];
    if (!nextLayer?.canvas || !nextLayer?.ctx) {
        return false;
    }
    const previousIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
    const sameLayer = previousIndex === safeIndex && session.baseCanvas === nextLayer.canvas && session.baseCtx === nextLayer.ctx;
    if (sameLayer && options.force !== true) {
        logPaintTrace('setActiveLayerRefs.noop', {
            safeIndex,
            layerId: nextLayer.id || '',
            layerName: nextLayer.name || '',
            skipUi: !!options.skipUi,
            reason: String(options.reason || '')
        });
        return false;
    }
    session.activeLayerIndex = safeIndex;
    session.baseCanvas = nextLayer.canvas;
    session.baseCtx = nextLayer.ctx;
    if (session.isolateActiveLayer) {
        syncPaintLayerCanvasOrder();
        queueStageShadowRefresh();
        queueStagePatternRefresh();
    }
    syncOverlayCanvasPresentation(options.reason || 'setActiveLayerRefs');
    logPaintTrace('setActiveLayerRefs', {
        safeIndex,
        layerId: nextLayer.id || '',
        layerName: nextLayer.name || '',
        skipUi: !!options.skipUi,
        reason: String(options.reason || '')
    });
    if (!options.skipUi) {
        const reason = options.reason || 'setActiveLayerRefs';
        refreshLayerSelectionUi(reason);
        if (paintWorkspaceState.quickAnimationPeek === true && options.quickPeek !== false) {
            showTimelineQuickPreview(`${reason}-layer-change`, {
                durationMs: 820,
                renderImmediately: true
            });
        }
    }
    return true;
}

function setActiveLayerById(layerId, options = {}) {
    if (!session?.layers?.length) {
        return false;
    }
    const id = String(layerId || '');
    const index = session.layers.findIndex((entry) => entry && entry.id === id);
    if (index < 0) {
        return false;
    }
    return setActiveLayerByIndex(index, options);
}

function setActiveLayerByIndex(index, options = {}) {
    if (!session?.layers?.length) {
        return false;
    }
    const safeIndex = clamp(Math.round(Number(index) || 0), 0, session.layers.length - 1);
    const nextLayer = session.layers[safeIndex];
    const currentIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
    if (currentIndex === safeIndex && session.baseCanvas === nextLayer?.canvas && session.baseCtx === nextLayer?.ctx && options.force !== true) {
        logPaintTrace('setActiveLayerByIndex.noop', {
            safeIndex,
            layerId: nextLayer?.id || '',
            layerName: nextLayer?.name || '',
            skipUi: !!options.skipUi,
            reason: String(options.reason || '')
        });
        return false;
    }
    if (!options.force) {
        if (session.isDrawing || session.pointerDown || session.crop?.active || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active)) {
            utils.showToast?.('Paint: finish current action first');
            return false;
        }
        if (session.selectionEdit?.dirty) {
            utils.showToast?.('Paint: apply selection edits first');
            return false;
        }
    }
    if (!options.keepSelection && (session.selection || session.selectionEdit)) {
        clearSelection();
    }
    return setActiveLayerRefs(index, {
        skipUi: !!options.skipUi,
        force: options.force === true,
        reason: String(options.reason || '')
    });
}

function isTimelineBarVisible(...args) {
    return getPaintTimelineModule().isTimelineBarVisible(...args);
}

function clearTimelineQuickPreview(...args) {
    return getPaintTimelineModule().clearTimelineQuickPreview(...args);
}

function showTimelineQuickPreview(...args) {
    return getPaintTimelineModule().showTimelineQuickPreview(...args);
}

async function toggleCollapsedTimelineDrawer(reason = 'timeline-collapsed-toggle') {
    clearTimelineQuickPreview(`${reason}-clear`, { render: false });
    paintWorkspaceState.collapsedTimelineVisible = paintWorkspaceState.collapsedTimelineVisible !== true;
    renderLayerBar({
        syncCurrentFrame: false,
        deferPreviewImages: true,
        deferLayerPreviews: true,
        logDomMetrics: false
    });
    logPaintTrace('timeline.collapsed.toggle', {
        reason,
        visible: paintWorkspaceState.collapsedTimelineVisible === true,
        expandedVisible: paintWorkspaceState.expandedTimelineVisible === true
    });
    return true;
}

async function toggleExpandedTimelineDrawer(reason = 'timeline-expanded-toggle') {
    clearTimelineQuickPreview(`${reason}-clear`, { render: false });
    return setTimelineDrawerOpen(!(paintWorkspaceState.expandedTimelineVisible === true), reason);
}

function ensureLayerControlsEnabled() {
    if (!dom.paintLayerDelete || !dom.paintLayerMergeDown || !dom.paintLayerMergeAll || !dom.paintLayerAdd || !dom.paintLayerDuplicate) {
        return;
    }
    const layers = session?.layers || [];
    const active = getActiveLayer();
    const count = layers.length;
    const activeIndex = clamp(Math.round(Number(session?.activeLayerIndex) || 0), 0, Math.max(0, count - 1));
    dom.paintLayerAdd.disabled = count >= LAYER_MAX;
    dom.paintLayerDuplicate.disabled = !active || count >= LAYER_MAX;
    dom.paintLayerDelete.disabled = !active || !!active.isBase || count <= 1;
    dom.paintLayerMergeDown.disabled = count <= 1 || activeIndex <= 0;
    dom.paintLayerMergeAll.disabled = count <= 1;
}

function renderLayerBar(...args) {
    return getPaintTimelineModule().renderLayerBar(...args);
}

function createLayerRecord(canvas, options = {}) {
    const ctx = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!ctx) {
        return null;
    }
    return {
        id: String(options.id || ''),
        name: String(options.name || ''),
        isBase: options.isBase === true,
        dynamic: options.dynamic === true,
        visible: normalizeLayerVisibility(options.visible, true),
        opacity: normalizeLayerOpacity(options.opacity),
        thumbnailTone: normalizeLayerThumbnailTone(options.thumbnailTone),
        canvas,
        ctx
    };
}

function createFlattenedLayersCanvas() {
    if (!session) {
        return null;
    }
    const out = document.createElement('canvas');
    out.width = session.width;
    out.height = session.height;
    const outCtx = out.getContext('2d', { willReadFrequently: false });
    if (!outCtx) {
        return null;
    }
    outCtx.clearRect(0, 0, out.width, out.height);
    const layers = Array.isArray(session.layers) ? session.layers : [];
    for (const layer of layers) {
        if (!layer?.canvas || normalizeLayerVisibility(layer.visible, true) === false) {
            continue;
        }
        outCtx.save();
        outCtx.globalAlpha = normalizeLayerOpacity(layer.opacity);
        outCtx.drawImage(layer.canvas, 0, 0);
        outCtx.restore();
    }
    return out;
}

function resolveEffectiveLayerVisibility(layer, layerIndex) {
    if (!layer) {
        return false;
    }
    if (session?.isolateActiveLayer === true) {
        const activeIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, Math.max(0, (session.layers?.length || 1) - 1));
        const safeLayerIndex = clamp(Math.round(Number(layerIndex) || 0), 0, Math.max(0, (session.layers?.length || 1) - 1));
        return safeLayerIndex === activeIndex;
    }
    return normalizeLayerVisibility(layer.visible, true);
}

function createVisibleLayersCanvas() {
    if (!session) {
        return null;
    }
    const out = document.createElement('canvas');
    out.width = session.width;
    out.height = session.height;
    const outCtx = out.getContext('2d', { willReadFrequently: false });
    if (!outCtx) {
        return null;
    }
    outCtx.clearRect(0, 0, out.width, out.height);
    const layers = Array.isArray(session.layers) ? session.layers : [];
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        if (!layer?.canvas || !resolveEffectiveLayerVisibility(layer, index)) {
            continue;
        }
        outCtx.save();
        outCtx.globalAlpha = normalizeLayerOpacity(layer.opacity);
        outCtx.drawImage(layer.canvas, 0, 0);
        outCtx.restore();
    }
    return out;
}

function resolvePaintHistoryTargetKey(targetSession = session) {
    const filePath = String(targetSession?.filePath || '').trim();
    if (filePath) {
        return filePath.toLowerCase();
    }
    const asset = resolveWorkspaceAsset();
    const context = resolveSessionAnimationContext(asset);
    return [
        String(asset?.id || ''),
        String(context.animation?.id || ''),
        String(context.frame?.id || '')
    ].join('::');
}

function createPaintHistoryThumbnailDataUrl(sourceCanvas, maxWidth = 220, maxHeight = 132) {
    if (!sourceCanvas?.width || !sourceCanvas?.height) {
        return '';
    }
    const scale = Math.min(maxWidth / sourceCanvas.width, maxHeight / sourceCanvas.height, 1);
    const width = Math.max(1, Math.round(sourceCanvas.width * scale));
    const height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return '';
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    try {
        return canvas.toDataURL('image/png');
    } catch {
        return '';
    }
}

function buildPaintHistorySnapshotLabel(reason = 'manual', timestamp = Date.now()) {
    const timeLabel = new Date(timestamp).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
    if (reason === 'session-open') {
        return `Opened ${timeLabel}`;
    }
    if (reason === 'logs-open') {
        return `Logs ${timeLabel}`;
    }
    if (reason === 'pre-restore') {
        return `Before Load ${timeLabel}`;
    }
    if (reason === 'manual') {
        return `Manual ${timeLabel}`;
    }
    if (reason === 'manual-save') {
        return `Saved ${timeLabel}`;
    }
    return `${String(reason || 'Snapshot')} ${timeLabel}`;
}

function listPaintHistorySnapshots() {
    const targetKey = resolvePaintHistoryTargetKey();
    if (!targetKey) {
        return [];
    }
    return (Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : [])
        .filter((entry) => String(entry?.targetKey || '') === targetKey);
}

function findPaintHistorySnapshot(snapshotId = '') {
    const targetId = String(snapshotId || '').trim();
    if (!targetId) {
        return null;
    }
    return (Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : [])
        .find((entry) => String(entry?.id || '') === targetId) || null;
}

function capturePaintHistorySnapshot(reason = 'manual', options = {}) {
    if (!session) {
        return null;
    }
    const snapshot = captureFullSnapshot();
    if (!snapshot) {
        return null;
    }
    const asset = resolveWorkspaceAsset();
    const context = resolveSessionAnimationContext(asset);
    const flattened = createFlattenedLayersCanvas() || session.baseCanvas || null;
    const createdAt = Date.now();
    const id = `paintlog-${createdAt}-${paintWorkspaceState.logSnapshotCounter += 1}`;
    const entry = {
        id,
        reason: String(reason || ''),
        label: String(options.label || buildPaintHistorySnapshotLabel(reason, createdAt)),
        createdAt,
        targetKey: resolvePaintHistoryTargetKey(),
        filePath: String(session.filePath || ''),
        assetId: String(asset?.id || ''),
        assetName: String(asset?.name || ''),
        animationId: String(context.animation?.id || ''),
        frameId: String(context.frame?.id || ''),
        frameIndex: Number.isFinite(Number(context.frame?.index)) ? Number(context.frame.index) : -1,
        layerCount: Array.isArray(snapshot.layers) ? snapshot.layers.length : 0,
        undoDepth: Array.isArray(session.undo) ? session.undo.length : 0,
        redoDepth: Array.isArray(session.redo) ? session.redo.length : 0,
        thumbnailDataUrl: createPaintHistoryThumbnailDataUrl(flattened),
        snapshot
    };
    const nextEntries = [entry];
    let targetCount = 1;
    for (const existing of Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : []) {
        if (!existing || existing.id === id) {
            continue;
        }
        if (String(existing.targetKey || '') === entry.targetKey) {
            if (targetCount >= PAINT_LOG_SNAPSHOT_MAX) {
                continue;
            }
            targetCount += 1;
        }
        nextEntries.push(existing);
    }
    paintWorkspaceState.logSnapshots = nextEntries;
    if (options.select !== false) {
        paintWorkspaceState.activeLogSnapshotId = id;
    }
    if (options.markEntry) {
        session.entrySnapshot = snapshot;
        session.entrySnapshotId = id;
    }
    logPaintTrace('paint.logs.capture', {
        reason: entry.reason,
        snapshotId: id,
        label: entry.label,
        assetId: entry.assetId,
        animationId: entry.animationId,
        frameId: entry.frameId,
        layerCount: entry.layerCount,
        undoDepth: entry.undoDepth,
        redoDepth: entry.redoDepth
    });
    if (options.render === true) {
        renderPaintWorkspaceUi();
    }
    return entry;
}

function removePaintHistorySnapshot(snapshotId = '') {
    const targetId = String(snapshotId || '').trim();
    if (!targetId) {
        return false;
    }
    const beforeLength = Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots.length : 0;
    paintWorkspaceState.logSnapshots = (Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : [])
        .filter((entry) => String(entry?.id || '') !== targetId);
    if (paintWorkspaceState.activeLogSnapshotId === targetId) {
        paintWorkspaceState.activeLogSnapshotId = '';
    }
    return paintWorkspaceState.logSnapshots.length !== beforeLength;
}

function clearPaintHistorySnapshotsForCurrentTarget() {
    const targetKey = resolvePaintHistoryTargetKey();
    if (!targetKey) {
        return false;
    }
    const beforeLength = Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots.length : 0;
    paintWorkspaceState.logSnapshots = (Array.isArray(paintWorkspaceState.logSnapshots) ? paintWorkspaceState.logSnapshots : [])
        .filter((entry) => String(entry?.targetKey || '') !== targetKey);
    const activeEntry = findPaintHistorySnapshot(paintWorkspaceState.activeLogSnapshotId);
    if (!activeEntry) {
        paintWorkspaceState.activeLogSnapshotId = '';
    }
    return paintWorkspaceState.logSnapshots.length !== beforeLength;
}

function resolvePaintHistorySnapshotLaunchTarget(entry = null) {
    const baseTarget = launchTargets.normalizePaintLaunchTarget({
        ...(session?.launchTarget && typeof session.launchTarget === 'object' ? session.launchTarget : {}),
        boardId: String(session?.boardId || ''),
        blockId: String(session?.blockId || '')
    });
    const assetId = String(entry?.assetId || baseTarget.assetId || '').trim();
    const animationId = String(entry?.animationId || '').trim();
    const frameId = String(entry?.frameId || '').trim();
    const asset = assetId ? projectStore.getAsset(assetId) : null;
    const nextTarget = launchTargets.normalizePaintLaunchTarget({
        ...baseTarget,
        mode: frameId
            ? launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME
            : (animationId ? launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET : launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL),
        assetId,
        animationId,
        frameId,
        filePath: String(entry?.filePath || ''),
        source: 'logs-restore'
    });
    const resolvedFilePath = asset?.id
        ? projectStore.resolvePreferredPaintFilePath(asset, nextTarget)
        : String(entry?.filePath || '').trim();
    if (resolvedFilePath) {
        nextTarget.filePath = resolvedFilePath;
    }
    return {
        asset,
        target: nextTarget,
        filePath: resolvedFilePath || String(nextTarget.filePath || '').trim()
    };
}

function restorePaintHistorySnapshot(snapshotId = '', options = {}) {
    if (!session) {
        return false;
    }
    const entry = findPaintHistorySnapshot(snapshotId);
    if (!entry?.snapshot) {
        return false;
    }
    if (options.captureCurrent !== false) {
        capturePaintHistorySnapshot('pre-restore', {
            label: options.preRestoreLabel || undefined,
            render: false,
            select: false
        });
    }
    session.transform = null;
    session.editMode = EDIT_MODE_PAINT;
    if (session.crop) {
        session.crop.active = false;
        session.crop.drag = null;
        session.crop.rect = null;
    }
    if (session.select) {
        session.select.lassoing = false;
        session.select.points = [];
    }
    session.selectionEdit = null;
    session.undo = [];
    session.redo = [];
    const restoredLaunch = resolvePaintHistorySnapshotLaunchTarget(entry);
    if (restoredLaunch.filePath) {
        session.filePath = restoredLaunch.filePath;
    }
    if (restoredLaunch.target) {
        session.launchTarget = restoredLaunch.target;
    }
    if (restoredLaunch.asset?.id && restoredLaunch.target) {
        projectStore.setLastOpenedTarget(restoredLaunch.asset.id, restoredLaunch.target, 'asset2d-logs-restore');
    }
    applyCanvasResizeSnapshot(entry.snapshot, { skipFit: true });
    applySelectionSnapshot(null);
    clearOverlayCanvas();
    clearUiCanvas();
    setWrapTransform();
    updateStageCursor();
    renderLayerBar();
    updateHud();
    renderStageUi();
    renderCursorCanvas();
    queueLayerPreviewRefresh();
    queueStageShadowRefresh();
    queueStagePatternRefresh();
    try {
        refreshTimelinePreviewForCurrentFrame('logs-restore', {
            renderBar: true
        });
    } catch {}
    markPaintSessionDirty('logs-restore', {
        snapshotId: entry.id,
        layerCount: entry.layerCount
    });
    scheduleLivePreviewSync('logs-restore');
    paintWorkspaceState.activeLogSnapshotId = entry.id;
    logPaintTrace('paint.logs.restore', {
        snapshotId: entry.id,
        label: entry.label,
        assetId: entry.assetId,
        animationId: entry.animationId,
        frameId: entry.frameId,
        layerCount: entry.layerCount
    });
    if (options.render !== false) {
        renderPaintWorkspaceUi();
    }
    return true;
}

async function revertPaintSessionChangesAndExit() {
    if (!session) {
        return;
    }
    const entrySnapshotId = String(session.entrySnapshotId || '').trim();
    if (!entrySnapshotId && !session.entrySnapshot) {
        closePaintMode({ reason: 'negate' });
        return;
    }
    let restored = false;
    if (entrySnapshotId) {
        restored = restorePaintHistorySnapshot(entrySnapshotId, {
            captureCurrent: false,
            render: false
        });
    }
    if (!restored && session.entrySnapshot) {
        applyCanvasResizeSnapshot(session.entrySnapshot, { skipFit: true });
        applySelectionSnapshot(null);
        clearOverlayCanvas();
        clearUiCanvas();
        renderLayerBar();
        updateHud();
        renderStageUi();
        renderCursorCanvas();
    }
    const result = await saveCurrentPaintSession('negate-exit', {
        recordHistory: false,
        notifyCommit: true,
        assetReason: 'asset2d-paint-negate',
        boardReason: 'paint-negate'
    });
    if (!result?.saved) {
        throw new Error('Paint negate failed');
    }
    session.externalCommitSent = isPaintEditorWindow();
    closePaintMode({
        reason: 'negate',
        skipViewportRestore: true
    });
}

function clearScheduledLivePreview() {
    return getPaintPersistenceModule().clearScheduledLivePreview();
}

function notifyPreviewCleared() {
    return getPaintPersistenceModule().notifyPreviewCleared();
}

function scheduleLivePreviewSync(reason = 'update', options = {}) {
    return getPaintPersistenceModule().scheduleLivePreviewSync(reason, options);
}

function buildLayerName() {
    if (!session) {
        return 'Layer';
    }
    const index = (Array.isArray(session.layers) ? session.layers.length : 0) + 1;
    return `Layer ${index}`;
}

function createPaintLayer(options = {}) {
    return createPaintLayerAt(session?.layers?.length || 0, options);
}

function insertBlankLayerRelative(direction = 'up', options = {}) {
    return getPaintLayersModule().insertBlankLayerRelative(direction, options);
}

function duplicateActiveLayer() {
    return getPaintLayersModule().duplicateActiveLayer();
}

function duplicateActiveLayerRelative(direction = 'up') {
    return getPaintLayersModule().duplicateActiveLayerRelative(direction);
}

async function renameLayerAtIndex(index) {
    return await getPaintLayersModule().renameLayerAtIndex(index);
}

async function renameCurrentPaintProject() {
    const asset = resolveWorkspaceAsset();
    if (!asset?.id) {
        utils.showToast?.('No project to rename');
        return false;
    }
    const value = await promptForPaintText({
        title: 'Rename project',
        placeholder: 'Project name',
        initialValue: String(asset.name || '').trim() || 'Untitled Project',
        confirmLabel: 'Rename'
    });
    if (value === null) {
        logPaintTrace('project.rename.cancelled', {
            assetId: asset.id,
            assetName: asset.name || ''
        });
        return false;
    }
    const nextName = String(value).trim() || 'Untitled Project';
    projectStore.updateAsset(asset.id, (draft) => {
        draft.name = nextName;
        return draft;
    }, 'asset2d-rename-project');
    logPaintTrace('project.rename.applied', {
        assetId: asset.id,
        previousName: asset.name || '',
        nextName
    });
    renderPaintWorkspaceUi();
    return true;
}

function resetUndoRedoStacks() {
    if (!session) {
        return;
    }
    session.undo = [];
    session.redo = [];
}

function ensureLayerStackEditable() {
    if (!session) {
        return false;
    }
    if (session.isDrawing || session.pointerDown || session.crop?.active || (session.editMode === EDIT_MODE_TRANSFORM && session.transform?.active) || session.select?.lassoing) {
        utils.showToast?.('Paint: finish current action first');
        return false;
    }
    if (session.selectionEdit?.dirty) {
        utils.showToast?.('Paint: apply selection edits first');
        return false;
    }
    return true;
}

function deleteActiveLayer() {
    return getPaintLayersModule().deleteActiveLayer();
}

function mergeActiveLayerDown() {
    return getPaintLayersModule().mergeActiveLayerDown();
}

function mergeAllLayers() {
    return getPaintLayersModule().mergeAllLayers();
}

function setHelpVisible(visible) {
    if (!dom.paintHelpOverlay) {
        return;
    }
    dom.paintHelpOverlay.hidden = !visible;
}

function isCanvasMenuOpen() {
    return !!dom.paintCanvasMenu && dom.paintCanvasMenu.hidden === false;
}

function setCanvasMenuVisible(visible) {
    if (!dom.paintCanvasMenu) {
        return;
    }
    if (visible) {
        closePaintLayerViewer({ render: false, reason: 'canvas-menu-open' });
    }
    logPaintTrace('setCanvasMenuVisible', {
        visible: !!visible
    });
    dom.paintCanvasMenu.hidden = !visible;
}

function isBlendMenuOpen() {
    return !!dom.paintBlendMenu && dom.paintBlendMenu.hidden === false;
}

function setBlendMenuVisible(visible) {
    if (!dom.paintBlendMenu) {
        return;
    }
    if (visible) {
        closePaintLayerViewer({ render: false, reason: 'blend-menu-open' });
    }
    dom.paintBlendMenu.hidden = !visible;
}

function isToolMenuOpen() {
    return !!dom.paintToolMenu && dom.paintToolMenu.hidden === false;
}

function setToolMenuVisible(visible) {
    if (!dom.paintToolMenu) {
        return;
    }
    if (visible) {
        closePaintLayerViewer({ render: false, reason: 'tool-menu-open' });
    }
    dom.paintToolMenu.hidden = !visible;
}

function renderBlendMenu() {
    return getPaintStageRenderModule().renderBlendMenu();
}

function renderToolMenu() {
    return getPaintStageRenderModule().renderToolMenu();
}

function setConfirmVisible(visible) {
    if (!dom.paintConfirmOverlay) {
        return;
    }
    dom.paintConfirmOverlay.hidden = !visible;
}

function isConfirmOpen() {
    return !!dom.paintConfirmOverlay && !dom.paintConfirmOverlay.hidden;
}

function showColorPickIndicator(color, clientX, clientY) {
    return getPaintColorUiModule().showColorPickIndicator(color, clientX, clientY);
}

function hideColorPickIndicator() {
    return getPaintColorUiModule().hideColorPickIndicator();
}

function updateStageCursor() {
    return getPaintStageRenderModule().updateStageCursor();
}

function updateHud() {
    return getPaintStageRenderModule().updateHud();
}

function updateToolSizeFromSession() {
    return getPaintToolsModule().updateToolSizeFromSession();
}

function applyToolSize(tool) {
    return getPaintToolsModule().applyToolSize(tool);
}

function syncBorderSizeToBrush() {
    return getPaintToolsModule().syncBorderSizeToBrush();
}

function setActiveTool(tool) {
    return getPaintToolsModule().setActiveTool(tool);
}

function setBrushBlendMode(mode) {
    return getPaintToolsModule().setBrushBlendMode(mode);
}

function resolveBrushCompositeOperation() {
    return getPaintToolsModule().resolveBrushCompositeOperation();
}

function applyOverlayBlendMode() {
    return getPaintToolsModule().applyOverlayBlendMode();
}

function readLocalPaintPrefs() {
    return getPaintToolsModule().readLocalPaintPrefs();
}

function writeLocalPaintPrefs(prefs) {
    return getPaintToolsModule().writeLocalPaintPrefs(prefs);
}

function snapshotPaintPrefs() {
    return getPaintToolsModule().snapshotPaintPrefs();
}

function persistPaintPreferences() {
    return getPaintToolsModule().persistPaintPreferences();
}

function fillSelectionOrCanvas() {
    return getPaintToolsModule().fillSelectionOrCanvas();
}

function fillCanvasWithColor() {
    return getPaintToolsModule().fillCanvasWithColor();
}

function fillAtHoverPoint() {
    return getPaintToolsModule().fillAtHoverPoint();
}

function mirrorCanvasHorizontal() {
    return getPaintToolsModule().mirrorCanvasHorizontal();
}

function invertSelection() {
    return getPaintToolsModule().invertSelection();
}

function setWrapTransform() {
    return getPaintToolsModule().setWrapTransform();
}

function fitToScreen() {
    return getPaintToolsModule().fitToScreen();
}

function setDefaultZoom() {
    return getPaintToolsModule().setDefaultZoom();
}

function zoomAtScreenPoint(deltaScale, screenX, screenY) {
    return getPaintToolsModule().zoomAtScreenPoint(deltaScale, screenX, screenY);
}

function clientToStage(event) {
    return getPaintToolsModule().clientToStage(event);
}

function stageToImageRaw(stageX, stageY) {
    return getPaintToolsModule().stageToImageRaw(stageX, stageY);
}

function stageToImage(stageX, stageY) {
    return getPaintToolsModule().stageToImage(stageX, stageY);
}

function imageToStage(imgX, imgY) {
    return getPaintToolsModule().imageToStage(imgX, imgY);
}

function getMirroredPoints(x, y) {
    return getPaintToolsModule().getMirroredPoints(x, y);
}

function getPatternWrappedPoints(points, radius = 0) {
    return getPaintToolsModule().getPatternWrappedPoints(points, radius);
}

function getMirroredPairs(x0, y0, x1, y1) {
    return getPaintToolsModule().getMirroredPairs(x0, y0, x1, y1);
}

function getPatternWrappedPairs(pairs, radius = 0) {
    return getPaintToolsModule().getPatternWrappedPairs(pairs, radius);
}

function unwrapPatternStrokePoint(lastX, lastY, x, y) {
    return getPaintToolsModule().unwrapPatternStrokePoint(lastX, lastY, x, y);
}

function ensureStageUiSized() {
    return getPaintStageRenderModule().ensureStageUiSized();
}

function clearStageShadowCanvas() {
    return getPaintStageRenderModule().clearStageShadowCanvas();
}

function clearStagePatternCanvas() {
    return getPaintStageRenderModule().clearStagePatternCanvas();
}

function rebuildStageShadowSource() {
    return getPaintStageRenderModule().rebuildStageShadowSource();
}

function renderStageShadowCanvas() {
    return getPaintStageRenderModule().renderStageShadowCanvas();
}

function queueStageShadowRefresh(options = {}) {
    return getPaintStageRenderModule().queueStageShadowRefresh(options);
}

function drawPatternTileContent(ctx, dx, dy, drawWidth, drawHeight) {
    return getPaintStageRenderModule().drawPatternTileContent(ctx, dx, dy, drawWidth, drawHeight);
}

function renderStagePatternCanvas() {
    return getPaintStageRenderModule().renderStagePatternCanvas();
}

function queueStagePatternRefresh() {
    return getPaintStageRenderModule().queueStagePatternRefresh();
}

function clearStageUiCanvas() {
    return getPaintStageRenderModule().clearStageUiCanvas();
}

function clearCursorCanvas() {
    return getPaintStageRenderModule().clearCursorCanvas();
}

function drawCursorHint(ctx, originX, originY, lines) {
    return getPaintStageRenderModule().drawCursorHint(ctx, originX, originY, lines);
}

function drawCursorHintAtStage(stageX, stageY, radius, lines) {
    return getPaintStageRenderModule().drawCursorHintAtStage(stageX, stageY, radius, lines);
}

function setCursorBlendMode(mode) {
    return getPaintStageRenderModule().setCursorBlendMode(mode);
}

function renderCursorCanvas(options = {}) {
    return getPaintStageRenderModule().renderCursorCanvas(options);
}

function applyStageUiImageTransform(ctx) {
    return getPaintStageRenderModule().applyStageUiImageTransform(ctx);
}

function renderStageUi() {
    return getPaintStageRenderModule().renderStageUi();
}

function clearOverlayCanvas() {
    if (!session) {
        return;
    }
    session.overlayCtx.save();
    session.overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    session.overlayCtx.clearRect(0, 0, session.width, session.height);
    session.overlayCtx.restore();
    if (session.patternMode) {
        queueStagePatternRefresh();
    }
}

function clearSelectionCanvas() {
    if (!session?.selectionCtx) {
        return;
    }
    session.selectionCtx.save();
    session.selectionCtx.setTransform(1, 0, 0, 1, 0, 0);
    session.selectionCtx.clearRect(0, 0, session.width, session.height);
    session.selectionCtx.restore();
}

function clearUiCanvas() {
    if (!session) {
        return;
    }
    if (session.uiCtx) {
        session.uiCtx.save();
        session.uiCtx.setTransform(1, 0, 0, 1, 0, 0);
        session.uiCtx.clearRect(0, 0, session.width, session.height);
        session.uiCtx.restore();
    }
    clearStageUiCanvas();
    clearCursorCanvas();
}

function clamp01(value) {
    return clamp(value, 0, 1);
}

function normalizeAngleRad(angle) {
    const value = Number(angle);
    if (!Number.isFinite(value)) {
        return 0;
    }
    let out = value % (Math.PI * 2);
    if (out > Math.PI) {
        out -= Math.PI * 2;
    } else if (out < -Math.PI) {
        out += Math.PI * 2;
    }
    return out;
}

function lerpAngleRad(from, to, t) {
    const a = normalizeAngleRad(from);
    const b = normalizeAngleRad(to);
    let delta = b - a;
    if (delta > Math.PI) {
        delta -= Math.PI * 2;
    } else if (delta < -Math.PI) {
        delta += Math.PI * 2;
    }
    return normalizeAngleRad(a + (delta * clamp01(t)));
}

function transformPoint(point, transform) {
    const cx = transform.centerX;
    const cy = transform.centerY;
    const sx = transform.scaleX;
    const sy = transform.scaleY;
    const rot = transform.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const px = (point.x - cx) * sx;
    const py = (point.y - cy) * sy;
    const rx = (px * cos) - (py * sin);
    const ry = (px * sin) + (py * cos);
    return {
        x: rx + cx + transform.dx,
        y: ry + cy + transform.dy
    };
}

function transformBoundsCorners(bounds, transform) {
    const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height }
    ];
    return corners.map((corner) => transformPoint(corner, transform));
}

function computeAabb(points) {
    return getPaintSelectionTransformModule().computeAabb(points);
}

function updateTransformPreviewGeometry() {
    return getPaintSelectionTransformModule().updateTransformPreviewGeometry();
}

function resolveTransformHandleAtStage(stageX, stageY) {
    return getPaintSelectionTransformModule().resolveTransformHandleAtStage(stageX, stageY);
}

function beginTransformDrag(ix, iy, stageX, stageY) {
    return getPaintSelectionTransformModule().beginTransformDrag(ix, iy, stageX, stageY);
}

function updateTransformDrag(ix, iy) {
    return getPaintSelectionTransformModule().updateTransformDrag(ix, iy);
}

function normalizeHexColor(value) {
    return getPaintColorUiModule().normalizeHexColor(value);
}

function parseHexColor(hex) {
    return getPaintColorUiModule().parseHexColor(hex);
}

function rgbToHex(rgb) {
    return getPaintColorUiModule().rgbToHex(rgb);
}

function rgbToRgbaString(rgb, alpha) {
    return getPaintColorUiModule().rgbToRgbaString(rgb, alpha);
}

function rgbToHsl(rgb) {
    return getPaintColorUiModule().rgbToHsl(rgb);
}

function hslToRgb(hsl) {
    return getPaintColorUiModule().hslToRgb(hsl);
}

function hslToHex(hsl) {
    return getPaintColorUiModule().hslToHex(hsl);
}

function buildRelatedColors(hex) {
    return getPaintColorUiModule().buildRelatedColors(hex);
}

function hsvToRgb(hsv) {
    return getPaintColorUiModule().hsvToRgb(hsv);
}

function rgbToHsv(rgb) {
    return getPaintColorUiModule().rgbToHsv(rgb);
}

function hexToRgba(hex) {
    return getPaintColorUiModule().hexToRgba(hex);
}

function updateRecentColors(hex) {
    return getPaintColorUiModule().updateRecentColors(hex);
}

function setDebugVisible(visible) {
    if (!dom.paintDebugPanel) {
        return;
    }
    dom.paintDebugPanel.hidden = !visible;
}

function toFixedOr(value, fallback = '') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return fallback;
    }
    return num.toFixed(3);
}

function renderDebugOverlay() {
    if (!session?.debug?.visible || !dom.paintDebugBody) {
        return;
    }
    const input = session.lastInput || {};
    const pen = session.lastPen || {};
    const tipLines = [];
    const lines = [];
    lines.push(`tool=${session.tool}  mode=${session.strokeMode}  size=${Math.round(session.size)}  color=${session.color}`);
    lines.push(`scale=${toFixedOr(session.view.scale)}  tx=${Math.round(session.view.tx)}  ty=${Math.round(session.view.ty)}`);
    lines.push(`space=${session.spaceDown ? 1 : 0} ctrl=${session.ctrlDown ? 1 : 0} ctrl+space=${session.ctrlSpaceHeld ? 1 : 0} pan=${session.pan.active ? 1 : 0} zoomDrag=${session.zoomDrag.active ? 1 : 0}`);
    lines.push('');
    lines.push(`lastEvent(${input.source || 'n/a'}) pointerType=${input.pointerType || ''} buttons=${input.buttons ?? ''} pressure=${toFixedOr(input.pressure)} width=${toFixedOr(input.width)} height=${toFixedOr(input.height)}`);
    lines.push(`tiltX=${toFixedOr(input.tiltX)} tiltY=${toFixedOr(input.tiltY)} twist=${toFixedOr(input.twist)} azimuth=${toFixedOr(input.azimuthAngle)} altitude=${toFixedOr(input.altitudeAngle)}`);
    lines.push(`coalesced=${input.coalescedCount ?? ''} rawUpdate=${input.raw ? 1 : 0} ts=${input.ts ?? ''}`);
    lines.push('');
    lines.push(`lastPen pointerType=${pen.pointerType || ''} pressure=${toFixedOr(pen.pressure)} width=${toFixedOr(pen.width)} height=${toFixedOr(pen.height)}`);
    lines.push(`tiltX=${toFixedOr(pen.tiltX)} tiltY=${toFixedOr(pen.tiltY)} twist=${toFixedOr(pen.twist)} azimuth=${toFixedOr(pen.azimuthAngle)} altitude=${toFixedOr(pen.altitudeAngle)}`);
    lines.push(`tiltMag=${toFixedOr(pen.tiltMag)} angle(rad)=${toFixedOr(pen.angle)}`);
    lines.push('');
    lines.push(`resolved pressure=${toFixedOr(resolvePressure(input))} angle(rad)=${toFixedOr(resolvePenAngleWithFallback(input))} tiltMag=${toFixedOr(resolveTiltMagnitude(input))}`);
    lines.push(`cursorAngle(rad)=${toFixedOr(session.cursorAngle)} cursorTilt=${toFixedOr(session.cursorTilt)}`);

    const pointerType = String(input.pointerType || '');
    const pressure = Number(input.pressure);
    const buttons = Number(input.buttons) || 0;
    const tiltX = Number(input.tiltX);
    const tiltY = Number(input.tiltY);
    const width = Number(input.width);
    const height = Number(input.height);
    const hasTilt = Number.isFinite(tiltX) && Number.isFinite(tiltY) && (tiltX || tiltY);
    const hasContact = Number.isFinite(width) && Number.isFinite(height) && (width > 1.05 || height > 1.05);
    if (buttons && pointerType === 'mouse' && Number.isFinite(pressure) && Math.abs(pressure - 0.5) < 0.000001 && !hasTilt && !hasContact) {
        tipLines.push('TIP: OS is reporting a mouse-like pointer (pressure=0.5).');
        tipLines.push('XP-Pen: enable Windows Ink (or disable mouse-mode) for the Electron app so Chromium gets real pen pressure.');
    }
    if (tipLines.length) {
        lines.push('');
        lines.push(tipLines.join('\n'));
    }
    const consoleEntries = (Array.isArray(paintWorkspaceState.debugConsoleEntries) ? paintWorkspaceState.debugConsoleEntries : [])
        .map((entry) => {
            const level = String(entry?.level || 'debug');
            return `
                <div class="paint-debug-entry paint-debug-entry--${escapePaintDebugHtml(level)}">
                    <div class="paint-debug-entry-meta">
                        <span class="paint-debug-entry-time">${escapePaintDebugHtml(formatPaintDebugConsoleTime(entry?.ts))}</span>
                        <span class="paint-debug-entry-level">${escapePaintDebugHtml(level.toUpperCase())}</span>
                        <span class="paint-debug-entry-scope">${escapePaintDebugHtml(entry?.scope || '')}</span>
                    </div>
                    <div class="paint-debug-entry-text">${escapePaintDebugHtml(entry?.text || '')}</div>
                </div>
            `;
        })
        .join('');
    dom.paintDebugBody.innerHTML = `
        <div class="paint-debug-section">
            <div class="paint-debug-section-title">State</div>
            <pre class="paint-debug-state">${escapePaintDebugHtml(lines.join('\n'))}</pre>
        </div>
        <div class="paint-debug-section">
            <div class="paint-debug-section-title">Console</div>
            <div class="paint-debug-console">${consoleEntries || '<div class="paint-debug-empty">No paint log entries yet.</div>'}</div>
        </div>
    `;
}

function defaultAdjustSettings() {
    return getPaintAdjustmentsModule().defaultAdjustSettings();
}

function isAdjustPanelOpen() {
    return getPaintAdjustmentsModule().isAdjustPanelOpen();
}

function syncAdjustGradientPicker(settings) {
    return getPaintAdjustmentsModule().syncAdjustGradientPicker(settings);
}

function syncAdjustPanelValueLabels(settings) {
    return getPaintAdjustmentsModule().syncAdjustPanelValueLabels(settings);
}

function syncAdjustPanelControls(settings) {
    return getPaintAdjustmentsModule().syncAdjustPanelControls(settings);
}

function collectAdjustSettingsFromDom(current) {
    return getPaintAdjustmentsModule().collectAdjustSettingsFromDom(current);
}

function getAdjustSettingsSignature(current) {
    return getPaintAdjustmentsModule().getAdjustSettingsSignature(current);
}

function setAdjustPanelVisible(visible) {
    return getPaintAdjustmentsModule().setAdjustPanelVisible(visible);
}

function isAdjustGradientMenuOpen() {
    return getPaintAdjustmentsModule().isAdjustGradientMenuOpen();
}

function renderAdjustGradientMenu(activeKey = '') {
    return getPaintAdjustmentsModule().renderAdjustGradientMenu(activeKey);
}

function setAdjustGradientMenuVisible(visible) {
    return getPaintAdjustmentsModule().setAdjustGradientMenuVisible(visible);
}

function cancelAdjustJob() {
    return getPaintAdjustmentsModule().cancelAdjustJob();
}

function openAdjustPanel() {
    return getPaintAdjustmentsModule().openAdjustPanel();
}

function closeAdjustPanel(options = {}) {
    return getPaintAdjustmentsModule().closeAdjustPanel(options);
}

function scheduleAdjustHighQuality() {
    return getPaintAdjustmentsModule().scheduleAdjustHighQuality();
}

function defaultStampSettings() {
    return getPaintStampLibraryModule().defaultStampSettings();
}

function syncStampPanelValueLabels(settings) {
    return getPaintStampLibraryModule().syncStampPanelValueLabels(settings);
}

function syncStampPanelControls(settings) {
    return getPaintStampLibraryModule().syncStampPanelControls(settings);
}

function collectBrushPanelStateFromDom() {
    return getPaintStampLibraryModule().collectBrushPanelStateFromDom();
}

function collectStampSettingsFromDom(current) {
    return getPaintStampLibraryModule().collectStampSettingsFromDom(current);
}

function isStampPanelOpen() {
    return getPaintStampLibraryModule().isStampPanelOpen();
}

function setStampPanelVisible(visible) {
    return getPaintStampLibraryModule().setStampPanelVisible(visible);
}

function refreshBrushPanel(options = {}) {
    return getPaintStampLibraryModule().refreshBrushPanel(options);
}

function isStampEditorVisible() {
    return getPaintStampLibraryModule().isStampEditorVisible();
}

function positionStampPanel() {
    return getPaintStampLibraryModule().positionStampPanel();
}

function positionStampEditorInline() {
    return getPaintStampLibraryModule().positionStampEditorInline();
}

function setStampEditorVisible(visible, options = {}) {
    return getPaintStampLibraryModule().setStampEditorVisible(visible, options);
}

function writeStampLibrary(library) {
    return getPaintStampLibraryModule().writeStampLibrary(library);
}

function captureStampEntryFromEditor() {
    return getPaintStampLibraryModule().captureStampEntryFromEditor();
}

async function loadStampEntryIntoEditor(entry) {
    return await getPaintStampLibraryModule().loadStampEntryIntoEditor(entry);
}

function renderStampLibrary() {
    return getPaintStampLibraryModule().renderStampLibrary();
}

function touchStampEntry(entry) {
    return getPaintStampLibraryModule().touchStampEntry(entry);
}

function toggleStampFavorite(stampId) {
    return getPaintStampLibraryModule().toggleStampFavorite(stampId);
}

function initializeStampSupport(paintPrefs) {
    return getPaintStampLibraryModule().initializeStampSupport(paintPrefs);
}

function snapshotStampEditorStrokeSource() {
    return getPaintStampLibraryModule().snapshotStampEditorStrokeSource();
}

function stampEditorDrawDot(x, y) {
    return getPaintStampLibraryModule().stampEditorDrawDot(x, y);
}

function stampEditorDrawLine(x0, y0, x1, y1) {
    return getPaintStampLibraryModule().stampEditorDrawLine(x0, y0, x1, y1);
}

function captureInputSample(event, source, options = {}) {
    if (!session || !event) {
        return;
    }
    const pointerType = typeof event.pointerType === 'string' ? event.pointerType : '';
    const pressure = Number(event.pressure);
    const legacyPressure = Number(event.mozPressure ?? event.force ?? event.webkitForce);
    const width = Number(event.width);
    const height = Number(event.height);
    const tiltX = Number(event.tiltX);
    const tiltY = Number(event.tiltY);
    const twist = Number(event.twist);
    const azimuthAngle = Number(event.azimuthAngle);
    const altitudeAngle = Number(event.altitudeAngle);
    const buttons = Number(event.buttons) || 0;

    session.lastInput = {
        source,
        ts: Date.now(),
        pointerType,
        pressure,
        legacyPressure,
        width,
        height,
        tiltX,
        tiltY,
        twist,
        azimuthAngle,
        altitudeAngle,
        buttons,
        coalescedCount: options.coalescedCount ?? null,
        raw: !!options.raw
    };

    const stylusLike = isStylusLikeEvent(event);
    if (stylusLike || (options.forcePen && buttons)) {
        const angle = resolvePenAngleWithFallback(event);
        const tiltMag = resolveTiltMagnitude(event);
        const looksLikeMouseDefault = pointerType === 'mouse' && Number.isFinite(pressure) && Math.abs(pressure - 0.5) < 0.000001;
        const meaningfulPressure = ((Number.isFinite(pressure) && pressure > 0) && !(looksLikeMouseDefault && stylusLike)) || (Number.isFinite(legacyPressure) && legacyPressure > 0);
        const meaningfulTilt = tiltMag > 0.01;
        const meaningfulTwist = Number.isFinite(twist) && !!twist;
        const meaningfulSize = Number.isFinite(width) && Number.isFinite(height) && (width > 1 || height > 1);
        const accept = meaningfulPressure || meaningfulTilt || meaningfulTwist || meaningfulSize || (options.acceptZero && buttons);
        if (accept) {
            session.lastPen = {
                pointerType: 'pen',
                pressure: meaningfulPressure ? (Number.isFinite(pressure) ? pressure : legacyPressure) : null,
                width,
                height,
                tiltX,
                tiltY,
                twist,
                azimuthAngle,
                altitudeAngle,
                tiltMag,
                angle
            };
        }
    }

    renderDebugOverlay();
}

function renderRecentColorSwatches() {
    return getPaintColorUiModule().renderRecentColorSwatches();
}

function renderRelatedColorSwatches() {
    return getPaintColorUiModule().renderRelatedColorSwatches();
}

function setSessionColor(hex, options = {}) {
    return getPaintColorUiModule().setSessionColor(hex, options);
}

function isColorPopoverOpen() {
    return getPaintColorUiModule().isColorPopoverOpen();
}

function hideColorPopover() {
    return getPaintColorUiModule().hideColorPopover();
}

function renderHueCanvas() {
    return getPaintColorUiModule().renderHueCanvas();
}

function renderSvCanvas() {
    return getPaintColorUiModule().renderSvCanvas();
}

function requestCancelPaint() {
    if (!session) {
        return;
    }
    const activeJobId = String(paintWorkspaceState.activeJobId || '').trim();
    if (paintWorkspaceState.jobStatus === 'running' && activeJobId) {
        if (paintWorkspaceState.jobCancelRequested === true) {
            logPaintTrace('paint.job.cancel.skip', {
                jobId: activeJobId,
                reason: 'already-requested'
            });
            return;
        }
        paintWorkspaceState.jobCancelRequested = true;
        paintWorkspaceState.jobDetailMessage = 'Canceling generation...';
        logPaintTrace('paint.job.cancel.request', {
            jobId: activeJobId,
            status: paintWorkspaceState.jobStatus,
            progress: Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgress) || 0))
        });
        renderPaintWorkspaceUi();
        env.electron?.ipcRenderer?.invoke?.('workboard:2d-cancel-job', {
            jobId: activeJobId
        }).then((result) => {
            if (result?.success) {
                logPaintTrace('paint.job.cancel.accepted', {
                    jobId: activeJobId
                });
                return;
            }
            paintWorkspaceState.jobCancelRequested = false;
            paintWorkspaceState.jobDetailMessage = '';
            const message = String(result?.error || '').trim();
            const staleActiveJob = /job is not active/i.test(message);
            logPaintTrace(staleActiveJob ? 'paint.job.cancel.staleActiveJob' : 'paint.job.cancel.rejected', {
                jobId: activeJobId,
                error: message
            });
            renderPaintWorkspaceUi();
            if (message) {
                utils.showToast?.(staleActiveJob ? 'That motion job already finished.' : message);
            }
        }).catch((error) => {
            paintWorkspaceState.jobCancelRequested = false;
            paintWorkspaceState.jobDetailMessage = '';
            logPaintTrace('paint.job.cancel.failed', {
                jobId: activeJobId,
                message: error?.message || String(error)
            });
            renderPaintWorkspaceUi();
            utils.showToast?.(error?.message || 'Could not cancel the current job');
        });
        return;
    }
    logPaintTrace('paint.job.cancel.fallbackExitMenu', {
        jobId: activeJobId,
        status: paintWorkspaceState.jobStatus
    });
    setExitMenuVisible(true);
}

function fitTransformToCanvas() {
    return getPaintColorUiModule().fitTransformToCanvas();
}

function syncColorPickerFromSession() {
    return getPaintColorUiModule().syncColorPickerFromSession();
}

function showColorPopoverAt(clientX, clientY) {
    closePaintLayerViewer({ render: false, reason: 'color-popover-open' });
    return getPaintColorUiModule().showColorPopoverAt(clientX, clientY);
}

function handleColorSvPointerDown(event) {
    return getPaintColorUiModule().handleColorSvPointerDown(event);
}

function handleColorSvPointerMove(event) {
    return getPaintColorUiModule().handleColorSvPointerMove(event);
}

function handleColorHuePointerDown(event) {
    return getPaintColorUiModule().handleColorHuePointerDown(event);
}

function handleColorHuePointerMove(event) {
    return getPaintColorUiModule().handleColorHuePointerMove(event);
}

function handleColorPickerPointerUp(event) {
    return getPaintColorUiModule().handleColorPickerPointerUp(event);
}

function handleColorHexInput(event) {
    return getPaintColorUiModule().handleColorHexInput(event);
}

function handleColorSwatchClick(event) {
    return getPaintColorUiModule().handleColorSwatchClick(event);
}

function resolveBrushMaskUrl() {
    const candidates = [
        env.path.join(env.paths.baseDir, '..', 'Textures', 'brush.jpg'),
        env.path.join(env.paths.baseDir, '..', 'Textures', 'brush.png')
    ];
    for (const candidate of candidates) {
        try {
            if (env.fs.existsSync(candidate)) {
                return env.utils.toFileUrl(candidate);
            }
        } catch {}
    }
    return '';
}

async function ensureBrushMaskLoaded() {
    if (brushMaskReady || brushMaskFailed) {
        return brushMaskReady;
    }
    if (brushMaskPromise) {
        return brushMaskPromise;
    }
    brushMaskPromise = (async () => {
        const url = resolveBrushMaskUrl();
        if (!url) {
            brushMaskFailed = true;
            return false;
        }
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = url;
        try {
            await img.decode();
        } catch {}
        if (!img.naturalWidth || !img.naturalHeight) {
            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (error) => reject(error);
            });
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1;
        canvas.height = img.naturalHeight || 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            brushMaskFailed = true;
            return false;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let index = 0; index < data.length; index += 4) {
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const lum = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
            const alpha = clamp(Math.round(255 - lum), 0, 255);
            data[index] = 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            data[index + 3] = alpha;
        }
        ctx.putImageData(imageData, 0, 0);
        brushMaskCanvas = canvas;
        brushMaskReady = true;
        return true;
    })().catch((error) => {
        console.warn('Paint brush texture load failed', error);
        brushMaskFailed = true;
        return false;
    });
    return brushMaskPromise;
}

function stampKey({ tool, radius, color }) {
    const radiusKey = Math.max(1, Math.round(radius * STAMP_RADIUS_QUANT));
    const brushProfiles = session?.brushProfiles || {};
    const profile = brushProfiles[tool] || {};
    const stampProfile = brushProfiles[TOOL_STAMP] || {};
    const paintMaskMode = tool === TOOL_PAINT ? (brushMaskReady ? 'mask' : 'nomask') : 'plain';
    const shapeKey = tool === TOOL_INK
        ? String(profile.tipShape || 'circle')
        : (tool === TOOL_PAINT
            ? String(profile.tipShape || 'texture')
            : (tool === TOOL_STAMP ? String((session?.stampSettings?.tipShape || stampProfile.tipShape || 'custom')) : 'circle'));
    const hardnessKey = tool === TOOL_AIR
        ? Math.round((Number(profile.hardness) || 0) * 100)
        : (tool === TOOL_PAINT ? Math.round((Number(profile.hardness) || 0.58) * 100) : 100);
    return `${tool}:${color}:${radiusKey}:${paintMaskMode}:${shapeKey}:${hardnessKey}`;
}

function traceProceduralBrushPath(ctx, shape, center, radius) {
    const safeRadius = Math.max(0.5, Number(radius) || 1);
    const safeCenter = Number(center) || 0;
    ctx.beginPath();
    if (shape === 'square') {
        ctx.rect(safeCenter - safeRadius, safeCenter - safeRadius, safeRadius * 2, safeRadius * 2);
        return;
    }
    if (shape === 'diamond') {
        ctx.moveTo(safeCenter, safeCenter - safeRadius);
        ctx.lineTo(safeCenter + safeRadius, safeCenter);
        ctx.lineTo(safeCenter, safeCenter + safeRadius);
        ctx.lineTo(safeCenter - safeRadius, safeCenter);
        ctx.closePath();
        return;
    }
    if (shape === 'triangle') {
        const h = safeRadius * 1.75;
        ctx.moveTo(safeCenter, safeCenter - safeRadius);
        ctx.lineTo(safeCenter + (h * 0.5), safeCenter + (safeRadius * 0.8));
        ctx.lineTo(safeCenter - (h * 0.5), safeCenter + (safeRadius * 0.8));
        ctx.closePath();
        return;
    }
    ctx.arc(safeCenter, safeCenter, safeRadius, 0, Math.PI * 2);
}

function buildProceduralBrushCanvas({ size, radius, color, shape = 'circle', hardness = 1, airSoft = false }) {
    const supersample = STAMP_SUPERSAMPLE;
    const hiSize = Math.max(2, size * supersample);
    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = hiSize;
    hiCanvas.height = hiSize;
    const hiCtx = hiCanvas.getContext('2d', { willReadFrequently: false });
    if (!hiCtx) {
        return null;
    }
    const hiCenter = hiSize / 2;
    const hiRadius = radius * supersample;
    hiCtx.clearRect(0, 0, hiSize, hiSize);
    if (airSoft && shape === 'circle') {
        const rgb = parseHexColor(color) || { r: 255, g: 255, b: 255 };
        const inner = hiRadius * clamp(0.02 + (hardness * 0.9), 0.02, 0.96);
        const gradient = hiCtx.createRadialGradient(hiCenter, hiCenter, inner, hiCenter, hiCenter, hiRadius);
        gradient.addColorStop(0, rgbToRgbaString(rgb, 0.96));
        gradient.addColorStop(0.62, rgbToRgbaString(rgb, clamp(0.24 + (hardness * 0.32), 0.12, 0.9)));
        gradient.addColorStop(1, rgbToRgbaString(rgb, 0));
        hiCtx.fillStyle = gradient;
        hiCtx.beginPath();
        hiCtx.arc(hiCenter, hiCenter, hiRadius, 0, Math.PI * 2);
        hiCtx.fill();
    } else if (shape === 'circle' && hardness < 0.999) {
        const rgb = parseHexColor(color) || { r: 255, g: 255, b: 255 };
        const inner = hiRadius * clamp(hardness, 0.02, 0.98);
        const gradient = hiCtx.createRadialGradient(hiCenter, hiCenter, inner, hiCenter, hiCenter, hiRadius);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, rgbToRgbaString(rgb, 0));
        hiCtx.fillStyle = gradient;
        hiCtx.beginPath();
        hiCtx.arc(hiCenter, hiCenter, hiRadius, 0, Math.PI * 2);
        hiCtx.fill();
    } else if (hardness < 0.999) {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = hiSize;
        maskCanvas.height = hiSize;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: false });
        if (!maskCtx) {
            return null;
        }
        maskCtx.fillStyle = '#000';
        traceProceduralBrushPath(maskCtx, shape, hiCenter, hiRadius);
        maskCtx.fill();
        hiCtx.filter = `blur(${(1 - clamp(hardness, 0, 1)) * hiRadius * 0.3}px)`;
        hiCtx.drawImage(maskCanvas, 0, 0);
        hiCtx.filter = 'none';
        hiCtx.globalCompositeOperation = 'source-in';
        hiCtx.fillStyle = color;
        hiCtx.fillRect(0, 0, hiSize, hiSize);
        hiCtx.globalCompositeOperation = 'source-over';
    } else {
        hiCtx.fillStyle = color;
        traceProceduralBrushPath(hiCtx, shape, hiCenter, hiRadius);
        hiCtx.fill();
    }
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hiCanvas, 0, 0, hiSize, hiSize, 0, 0, size, size);
    return canvas;
}

function getPaintStampCanvas(radius, color) {
    if (!brushMaskCanvas || !brushMaskReady) {
        return null;
    }
    const size = Math.max(2, Math.ceil(radius * 2) + 2);
    const key = `paintmask:${color}:${size}`;
    const cached = stampCache.get(key);
    if (cached) {
        return cached;
    }
    const supersample = STAMP_SUPERSAMPLE;
    const hiSize = Math.max(2, size * supersample);
    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = hiSize;
    hiCanvas.height = hiSize;
    const hiCtx = hiCanvas.getContext('2d', { willReadFrequently: false });
    if (!hiCtx) {
        return null;
    }
    hiCtx.clearRect(0, 0, hiSize, hiSize);
    hiCtx.fillStyle = color;
    hiCtx.fillRect(0, 0, hiSize, hiSize);
    hiCtx.globalCompositeOperation = 'destination-in';
    hiCtx.drawImage(brushMaskCanvas, 0, 0, hiSize, hiSize);
    hiCtx.globalCompositeOperation = 'source-over';
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hiCanvas, 0, 0, hiSize, hiSize, 0, 0, size, size);
    stampCache.set(key, canvas);
    return canvas;
}

function getStampCanvas(tool, radius, color) {
    const key = stampKey({ tool, radius, color });
    const cached = stampCache.get(key);
    if (cached) {
        return cached;
    }
    const size = Math.max(2, Math.ceil(radius * 2) + 2);
    const center = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    ctx.clearRect(0, 0, size, size);
    const brushProfiles = session?.brushProfiles || {};
    const profile = brushProfiles[tool] || {};
    if (tool === TOOL_PAINT) {
        const tipShape = String(profile.tipShape || 'texture');
        const stamp = tipShape === 'texture' ? getPaintStampCanvas(radius, color) : null;
        if (stamp) {
            stampCache.set(key, stamp);
            return stamp;
        }
    }
    if (tool === TOOL_AIR) {
        const airStamp = buildProceduralBrushCanvas({
            size,
            radius,
            color,
            shape: 'circle',
            hardness: clamp(Number(profile.hardness) || 0, 0, 1),
            airSoft: true
        });
        if (airStamp) {
            stampCache.set(key, airStamp);
            return airStamp;
        }
    } else if (tool === TOOL_INK) {
        const inkStamp = buildProceduralBrushCanvas({
            size,
            radius,
            color,
            shape: String(profile.tipShape || 'circle'),
            hardness: 1
        });
        if (inkStamp) {
            stampCache.set(key, inkStamp);
            return inkStamp;
        }
    } else if (tool === TOOL_STAMP) {
        const stampShape = String(session?.stampSettings?.tipShape || profile.tipShape || 'custom');
        if (stampShape !== 'custom') {
            const shapeStamp = buildProceduralBrushCanvas({
                size,
                radius,
                color,
                shape: stampShape,
                hardness: 1
            });
            if (shapeStamp) {
                stampCache.set(key, shapeStamp);
                return shapeStamp;
            }
        }
    } else {
        const paintStamp = buildProceduralBrushCanvas({
            size,
            radius,
            color,
            shape: String(profile.tipShape || 'circle'),
            hardness: clamp(Number(profile.hardness) || 0.58, 0, 1)
        });
        if (paintStamp) {
            stampCache.set(key, paintStamp);
            return paintStamp;
        }
    }
    if (stampCache.size > 512) {
        stampCache.clear();
    }
    stampCache.set(key, canvas);
    return canvas;
}

function updateActionBounds(bounds, x, y, radius) {
    const minX = Math.floor(x - radius - ACTION_BOUNDS_PAD);
    const minY = Math.floor(y - radius - ACTION_BOUNDS_PAD);
    const maxX = Math.ceil(x + radius + ACTION_BOUNDS_PAD);
    const maxY = Math.ceil(y + radius + ACTION_BOUNDS_PAD);
    bounds.minX = Math.min(bounds.minX, minX);
    bounds.minY = Math.min(bounds.minY, minY);
    bounds.maxX = Math.max(bounds.maxX, maxX);
    bounds.maxY = Math.max(bounds.maxY, maxY);
}

function normalizeBounds(bounds) {
    if (!session) {
        return null;
    }
    const minX = clamp(Math.floor(bounds.minX), 0, session.width);
    const minY = clamp(Math.floor(bounds.minY), 0, session.height);
    const maxX = clamp(Math.ceil(bounds.maxX), 0, session.width);
    const maxY = clamp(Math.ceil(bounds.maxY), 0, session.height);
    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    if (width === 0 || height === 0) {
        return null;
    }
    return { x: minX, y: minY, width, height };
}

function computeCommitBounds(bounds) {
    const normalized = normalizeBounds(bounds);
    if (!session || !normalized) {
        return null;
    }
    const pad = ACTION_BOUNDS_PAD;
    const x0 = clamp(normalized.x - pad, 0, Math.max(0, session.width - 1));
    const y0 = clamp(normalized.y - pad, 0, Math.max(0, session.height - 1));
    const x1 = clamp(normalized.x + normalized.width + pad, 0, session.width);
    const y1 = clamp(normalized.y + normalized.height + pad, 0, session.height);
    return {
        x: x0,
        y: y0,
        width: Math.max(1, x1 - x0),
        height: Math.max(1, y1 - y0)
    };
}

function createAlphaMaskCanvas(imageData) {
    if (!imageData) {
        return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
        return null;
    }
    const mask = new ImageData(imageData.width, imageData.height);
    const src = imageData.data;
    const dst = mask.data;
    for (let index = 0; index < src.length; index += 4) {
        dst[index + 3] = src[index + 3];
    }
    ctx.putImageData(mask, 0, 0);
    return canvas;
}

function unionRect(a, b) {
    if (!a) {
        return b ? { ...b } : null;
    }
    if (!b) {
        return a ? { ...a } : null;
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const maxX = Math.max(a.x + a.width, b.x + b.width);
    const maxY = Math.max(a.y + a.height, b.y + b.height);
    return {
        x,
        y,
        width: Math.max(1, maxX - x),
        height: Math.max(1, maxY - y)
    };
}

function expandLiveStrokeBeforeSnapshot(nextBounds) {
    if (!session?.liveStrokeCommit || session.liveStrokeCommit.mode !== 'base' || !nextBounds) {
        return;
    }
    const currentBounds = session.liveStrokeCommit.bounds || null;
    if (!currentBounds) {
        session.liveStrokeCommit.bounds = { ...nextBounds };
        session.liveStrokeCommit.before = session.baseCtx.getImageData(nextBounds.x, nextBounds.y, nextBounds.width, nextBounds.height);
        return;
    }
    const merged = unionRect(currentBounds, nextBounds);
    if (!merged || (merged.x === currentBounds.x && merged.y === currentBounds.y && merged.width === currentBounds.width && merged.height === currentBounds.height)) {
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = merged.width;
    canvas.height = merged.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return;
    }

    if (session.liveStrokeCommit.before) {
        ctx.putImageData(session.liveStrokeCommit.before, currentBounds.x - merged.x, currentBounds.y - merged.y);
    }

    const regions = [
        { x: merged.x, y: merged.y, width: merged.width, height: Math.max(0, currentBounds.y - merged.y) },
        { x: merged.x, y: currentBounds.y + currentBounds.height, width: merged.width, height: Math.max(0, (merged.y + merged.height) - (currentBounds.y + currentBounds.height)) },
        { x: merged.x, y: currentBounds.y, width: Math.max(0, currentBounds.x - merged.x), height: currentBounds.height },
        { x: currentBounds.x + currentBounds.width, y: currentBounds.y, width: Math.max(0, (merged.x + merged.width) - (currentBounds.x + currentBounds.width)), height: currentBounds.height }
    ];
    for (const region of regions) {
        if (!region.width || !region.height) {
            continue;
        }
        const data = session.baseCtx.getImageData(region.x, region.y, region.width, region.height);
        ctx.putImageData(data, region.x - merged.x, region.y - merged.y);
    }
    session.liveStrokeCommit.bounds = merged;
    session.liveStrokeCommit.before = ctx.getImageData(0, 0, merged.width, merged.height);
}

function pickColorAtImagePoint(x, y) {
    if (!session?.baseCtx) {
        return null;
    }
    const ix = clamp(Math.floor(x), 0, Math.max(0, session.width - 1));
    const iy = clamp(Math.floor(y), 0, Math.max(0, session.height - 1));
    try {
        const pixel = session.baseCtx.getImageData(ix, iy, 1, 1).data;
        if (!pixel || pixel.length < 4) {
            return null;
        }
        return rgbToHex({ r: pixel[0], g: pixel[1], b: pixel[2] });
    } catch {
        return null;
    }
}

function getLayerPixelAlphaAt(layer, x, y) {
    if (!layer?.ctx || !Number.isFinite(x) || !Number.isFinite(y)) {
        return 0;
    }
    const ix = clamp(Math.floor(x), 0, Math.max(0, session.width - 1));
    const iy = clamp(Math.floor(y), 0, Math.max(0, session.height - 1));
    try {
        const pixel = layer.ctx.getImageData(ix, iy, 1, 1).data;
        return pixel && pixel.length >= 4 ? pixel[3] : 0;
    } catch {
        return 0;
    }
}

function createCompositeSampleCanvas() {
    const canvas = createVisibleLayersCanvas();
    if (!canvas) {
        return null;
    }
    if (!session?.selectionEdit?.dirty || !session.selectionEdit.canvas || !session.selection?.maskCanvas || !session.selection?.bounds || session.selection?.inverted) {
        return canvas;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return canvas;
    }
    const bounds = session.selection.bounds;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(session.selection.maskCanvas, bounds.x, bounds.y);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(session.selectionEdit.canvas, bounds.x, bounds.y);
    ctx.restore();
    return canvas;
}

function pickVisibleColorAtImagePoint(x, y) {
    if (!session) {
        return null;
    }
    const ix = clamp(Math.floor(x), 0, Math.max(0, session.width - 1));
    const iy = clamp(Math.floor(y), 0, Math.max(0, session.height - 1));
    const canvas = createCompositeSampleCanvas();
    if (!canvas) {
        return pickColorAtImagePoint(ix, iy);
    }
    try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const pixel = ctx?.getImageData(ix, iy, 1, 1)?.data;
        if (!pixel || pixel.length < 4) {
            return null;
        }
        return rgbToHex({ r: pixel[0], g: pixel[1], b: pixel[2] });
    } catch {
        return pickColorAtImagePoint(ix, iy);
    }
}

function pickLayerAtImagePoint(x, y) {
    if (!session?.layers?.length) {
        return null;
    }
    for (let index = session.layers.length - 1; index >= 0; index -= 1) {
        const layer = session.layers[index];
        if (!layer) {
            continue;
        }
        if (getLayerPixelAlphaAt(layer, x, y) > 8) {
            return { layer, index };
        }
    }
    return null;
}

function floodFillAtImagePoint(x, y) {
    if (!session?.baseCtx) {
        return;
    }
    if (session.isDrawing || session.crop.active) {
        return;
    }

    const ix = clamp(Math.floor(x), 0, Math.max(0, session.width - 1));
    const iy = clamp(Math.floor(y), 0, Math.max(0, session.height - 1));

    const fill = hexToRgba(session.color);
    if (!fill) {
        return;
    }

    const selection = session.selection;
    let maskBounds = null;
    let maskData = null;
    if (selection?.maskCanvas && selection?.bounds && !selection.inverted) {
        maskBounds = selection.bounds;
        try {
            const mctx = selection.maskCanvas.getContext('2d', { willReadFrequently: true });
            if (mctx) {
                maskData = mctx.getImageData(0, 0, selection.maskCanvas.width, selection.maskCanvas.height).data;
            }
        } catch {
            maskData = null;
        }
        if (maskBounds && maskData) {
            const mx = ix - maskBounds.x;
            const my = iy - maskBounds.y;
            const mw = selection.maskCanvas.width;
            const mh = selection.maskCanvas.height;
            if (mx < 0 || my < 0 || mx >= mw || my >= mh) {
                return;
            }
            const midx = ((my * mw) + mx) * 4;
            if ((maskData[midx + 3] || 0) < 10) {
                return;
            }
        }
    }

    const width = session.width;
    const height = session.height;
    let imageData;
    try {
        imageData = session.baseCtx.getImageData(0, 0, width, height);
    } catch {
        return;
    }
    const data = imageData.data;

    const startIdx = ((iy * width) + ix) * 4;
    const targetR = data[startIdx];
    const targetG = data[startIdx + 1];
    const targetB = data[startIdx + 2];
    const targetA = data[startIdx + 3];

    if (Math.abs(targetR - fill.r) <= 0 && Math.abs(targetG - fill.g) <= 0 && Math.abs(targetB - fill.b) <= 0 && Math.abs(targetA - fill.a) <= 0) {
        return;
    }

    const tolerance = 18;
    const matchesTarget = (idx) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        return (Math.abs(r - targetR) <= tolerance)
            && (Math.abs(g - targetG) <= tolerance)
            && (Math.abs(b - targetB) <= tolerance)
            && (Math.abs(a - targetA) <= tolerance);
    };

    const isAllowedByMask = (px, py) => {
        if (!maskBounds || !maskData) {
            return true;
        }
        const mx = px - maskBounds.x;
        const my = py - maskBounds.y;
        const mw = selection.maskCanvas.width;
        const mh = selection.maskCanvas.height;
        if (mx < 0 || my < 0 || mx >= mw || my >= mh) {
            return false;
        }
        const midx = ((my * mw) + mx) * 4;
        return (maskData[midx + 3] || 0) >= 10;
    };

    const visited = new Uint8Array(width * height);
    const stack = [];
    stack.push(ix, iy);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    while (stack.length) {
        const cy = stack.pop();
        const cx = stack.pop();
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
            continue;
        }
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) {
            continue;
        }
        const vIndex = (cy * width) + cx;
        if (visited[vIndex]) {
            continue;
        }
        visited[vIndex] = 1;
        if (!isAllowedByMask(cx, cy)) {
            continue;
        }
        const idx = vIndex * 4;
        if (!matchesTarget(idx)) {
            continue;
        }

        data[idx] = fill.r;
        data[idx + 1] = fill.g;
        data[idx + 2] = fill.b;
        data[idx + 3] = fill.a;

        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx + 1 > maxX) maxX = cx + 1;
        if (cy + 1 > maxY) maxY = cy + 1;

        stack.push(cx + 1, cy);
        stack.push(cx - 1, cy);
        stack.push(cx, cy + 1);
        stack.push(cx, cy - 1);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return;
    }

    const bounds = normalizeBounds({ minX, minY, maxX, maxY });
    if (!bounds) {
        return;
    }
    const before = session.baseCtx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    session.baseCtx.putImageData(imageData, 0, 0);
    const after = session.baseCtx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    pushUndoAction({ type: 'pixels', bounds, before, after });
}

function extractBorderImageData(sourceImageData, thickness) {
    const width = sourceImageData.width;
    const height = sourceImageData.height;
    const src = sourceImageData.data;
    const out = new ImageData(width, height);
    const dst = out.data;
    const t = clamp(Math.round(thickness), 1, 18);
    const alphaThreshold = 6;

    const isSolid = (index) => src[index + 3] > alphaThreshold;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const idx = (y * width + x) * 4;
            if (!isSolid(idx)) {
                continue;
            }
            let edgeDistSq = Infinity;
            for (let oy = -t; oy <= t; oy += 1) {
                const ny = y + oy;
                if (ny < 0 || ny >= height) {
                    edgeDistSq = Math.min(edgeDistSq, oy * oy);
                    continue;
                }
                for (let ox = -t; ox <= t; ox += 1) {
                    const nx = x + ox;
                    if (nx < 0 || nx >= width) {
                        edgeDistSq = Math.min(edgeDistSq, ox * ox);
                        continue;
                    }
                    if (!ox && !oy) {
                        continue;
                    }
                    const nidx = (ny * width + nx) * 4;
                    if (!isSolid(nidx)) {
                        edgeDistSq = Math.min(edgeDistSq, (ox * ox) + (oy * oy));
                    }
                }
            }
            if (!Number.isFinite(edgeDistSq)) {
                continue;
            }
            const srcAlpha = src[idx + 3];
            let alpha = srcAlpha;
            if (t > 1 && Number.isFinite(edgeDistSq) && edgeDistSq !== Infinity) {
                const dist = Math.sqrt(edgeDistSq);
                const fade = clamp01(1 - ((dist - 0.5) / (t + 0.5)));
                alpha = Math.round(srcAlpha * fade);
                if (alpha <= 0) {
                    continue;
                }
            }
            dst[idx] = src[idx];
            dst[idx + 1] = src[idx + 1];
            dst[idx + 2] = src[idx + 2];
            dst[idx + 3] = alpha;
        }
    }

    return out;
}

function pushUndoAction(action) {
    if (!session) {
        return;
    }
    const activeLayer = getActiveLayer();
    if (activeLayer?.id && !action.layerId) {
        action.layerId = activeLayer.id;
    }
    session.undo.push(action);
    session.redo = [];
    if (session.undo.length > 400) {
        session.undo.shift();
    }
    const type = String(action?.type || '');
    if (type === 'pixels' || type === 'pixels-selection' || type === 'resize') {
        markPaintSessionDirty(`undo-push-${type}`, {
            layerId: action.layerId || '',
            activeLayerIndex: session.activeLayerIndex ?? -1
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        queueStagePatternRefresh();
        scheduleLivePreviewSync(type);
    }
}

function applyCanvasResizeSnapshot(snapshot, options = {}) {
    if (!session || !snapshot) {
        return;
    }
    const width = clamp(Math.round(Number(snapshot.width) || session.width), 1, MAX_CANVAS_DIMENSION);
    const height = clamp(Math.round(Number(snapshot.height) || session.height), 1, MAX_CANVAS_DIMENSION);
    resizeCanvases(width, height);
    const layers = Array.isArray(snapshot.layers) ? snapshot.layers : [];
    const baseLayer = session.layers[0];
    if (!baseLayer) {
        return;
    }

    for (let i = session.layers.length - 1; i >= 1; i -= 1) {
        const layer = session.layers[i];
        if (layer?.dynamic && layer.canvas?.parentElement) {
            layer.canvas.remove();
        }
    }

    session.layers = [baseLayer];
    for (const entry of layers) {
        if (!entry || entry.id === 'layer-base') {
            continue;
        }
        const canvas = createDynamicPaintLayerCanvas(width, height);
        if (!canvas) {
            continue;
        }
        const record = createLayerRecord(canvas, {
            id: entry.id,
            name: entry.name || buildLayerName(),
            dynamic: true,
            isBase: false,
            visible: normalizeLayerVisibility(entry.visible, true),
            opacity: normalizeLayerOpacity(entry.opacity)
        });
        if (record) {
            session.layers.push(record);
        } else {
            canvas.remove();
        }
    }
    syncPaintLayerCanvasOrder();
    resizeCanvases(width, height);

    const sourceLayers = Array.isArray(snapshot.layers) && snapshot.layers.length
        ? snapshot.layers
        : [{ id: 'layer-base', imageData: snapshot.imageData, name: LAYER_BASE_NAME, isBase: true, visible: true, opacity: 1 }];

    const byId = new Map();
    for (const layer of session.layers) {
        if (layer?.id) {
            byId.set(layer.id, layer);
        }
    }
    for (const source of sourceLayers) {
        if (!source?.id || !source.imageData) {
            continue;
        }
        const target = byId.get(source.id);
        if (!target?.ctx) {
            continue;
        }
        target.ctx.putImageData(source.imageData, 0, 0);
        if (source.name) {
            target.name = source.name;
        }
        target.visible = normalizeLayerVisibility(source.visible, true);
        target.opacity = normalizeLayerOpacity(source.opacity);
    }
    let maxSnapshotLayerId = 0;
    for (const entry of sourceLayers) {
        const match = /^layer-(\d+)$/.exec(String(entry?.id || ''));
        if (!match) {
            continue;
        }
        const numeric = Number(match[1]);
        if (Number.isFinite(numeric) && numeric > maxSnapshotLayerId) {
            maxSnapshotLayerId = numeric;
        }
    }
    session.layerIdCounter = Math.max(
        Number(session.layerIdCounter) || 1,
        maxSnapshotLayerId + 1,
        sourceLayers.length + 1
    );
    const activeLayerId = String(snapshot.activeLayerId || '');
    if (activeLayerId && !setActiveLayerById(activeLayerId, { force: true, keepSelection: true, skipUi: true })) {
        setActiveLayerRefs(0, { skipUi: true });
    }
    clearOverlayCanvas();
    clearUiCanvas();
    renderLayerBar();
    updateHud();
    if (!options.skipFit) {
        fitToScreen();
    }
}

function resolveActionLayer(action) {
    if (!session || !action) {
        return true;
    }
    const layerId = String(action.layerId || '');
    if (!layerId) {
        return true;
    }
    if (setActiveLayerById(layerId, { force: true, keepSelection: true })) {
        return true;
    }
    utils.showToast?.('Paint: missing layer for undo');
    return false;
}

function undo() {
    if (!session || session.isDrawing || session.crop?.active) {
        return;
    }
    const action = session.undo.pop();
    if (!action) {
        return;
    }
    if (!resolveActionLayer(action)) {
        return;
    }
    session.redo.push(action);
    if (action.type === 'selection') {
        applySelectionSnapshot(action.before || null);
        renderStageUi();
        renderCursorCanvas();
        return;
    }
    if (action.type === 'pixels-selection') {
        session.baseCtx.putImageData(action.before, action.bounds.x, action.bounds.y);
        applySelectionSnapshot(action.selectionBefore || null);
        renderStageUi();
        renderCursorCanvas();
        markPaintSessionDirty('undo-pixels-selection', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('undo');
        return;
    }
    if (action.type === 'pixels') {
        session.baseCtx.putImageData(action.before, action.bounds.x, action.bounds.y);
        renderStageUi();
        renderCursorCanvas();
        markPaintSessionDirty('undo-pixels', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('undo');
        return;
    }
    if (action.type === 'resize') {
        applyCanvasResizeSnapshot(action.before);
        applySelectionSnapshot(action.selectionBefore || null);
        markPaintSessionDirty('undo-resize', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('undo');
    }
}

function redo() {
    if (!session || session.isDrawing || session.crop?.active) {
        return;
    }
    const action = session.redo.pop();
    if (!action) {
        return;
    }
    if (!resolveActionLayer(action)) {
        return;
    }
    session.undo.push(action);
    if (action.type === 'selection') {
        applySelectionSnapshot(action.after || null);
        renderStageUi();
        renderCursorCanvas();
        return;
    }
    if (action.type === 'pixels-selection') {
        session.baseCtx.putImageData(action.after, action.bounds.x, action.bounds.y);
        applySelectionSnapshot(action.selectionAfter || null);
        renderStageUi();
        renderCursorCanvas();
        markPaintSessionDirty('redo-pixels-selection', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('redo');
        return;
    }
    if (action.type === 'pixels') {
        session.baseCtx.putImageData(action.after, action.bounds.x, action.bounds.y);
        renderStageUi();
        renderCursorCanvas();
        markPaintSessionDirty('redo-pixels', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('redo');
        return;
    }
    if (action.type === 'resize') {
        applyCanvasResizeSnapshot(action.after);
        applySelectionSnapshot(action.selectionAfter || null);
        markPaintSessionDirty('redo-resize', {
            layerId: action.layerId || ''
        });
        queueLayerPreviewRefresh();
        queueStageShadowRefresh();
        scheduleLivePreviewSync('redo');
    }
}

function beginStroke(event) {
    return getPaintStrokeEngineModule().beginStroke(event);
}

function commitLiveStrokeIfNeeded() {
    return getPaintStrokeEngineModule().commitLiveStrokeIfNeeded();
}

function ensureSelectionEditInitialized() {
    return getPaintStrokeEngineModule().ensureSelectionEditInitialized();
}

function isStylusLikeEvent(event) {
    return getPaintStrokeEngineModule().isStylusLikeEvent(event);
}

function resolveTiltMagnitude(event) {
    return getPaintStrokeEngineModule().resolveTiltMagnitude(event);
}

function resolvePenAngleWithFallback(event) {
    return getPaintStrokeEngineModule().resolvePenAngleWithFallback(event);
}

function drawBlurDab(x, y, radius, alpha) {
    return getPaintStrokeEngineModule().drawBlurDab(x, y, radius, alpha);
}

function drawUserStampDab(x, y, angle, tiltMagnitude, radius, alpha) {
    return getPaintStrokeEngineModule().drawUserStampDab(x, y, angle, tiltMagnitude, radius, alpha);
}

function drawDabWithParams(tool, x, y, angle, tiltMagnitude, radius, alpha) {
    return getPaintStrokeEngineModule().drawDabWithParams(tool, x, y, angle, tiltMagnitude, radius, alpha);
}

function drawInkDot(x, y, pressure) {
    return getPaintStrokeEngineModule().drawInkDot(x, y, pressure);
}

function drawInkStrokeSegment(fromX, fromY, toX, toY, pressureFrom, pressureTo) {
    return getPaintStrokeEngineModule().drawInkStrokeSegment(fromX, fromY, toX, toY, pressureFrom, pressureTo);
}

function drawStrokeSegment(tool, fromX, fromY, toX, toY, pressureFrom, pressureTo, angle, tiltMagnitude) {
    return getPaintStrokeEngineModule().drawStrokeSegment(tool, fromX, fromY, toX, toY, pressureFrom, pressureTo, angle, tiltMagnitude);
}

function updateRectPreview(x, y) {
    return getPaintStrokeEngineModule().updateRectPreview(x, y);
}

function continueStroke(event) {
    return getPaintStrokeEngineModule().continueStroke(event);
}

function commitOverlayToBase(bounds, options = {}) {
    return getPaintStrokeEngineModule().commitOverlayToBase(bounds, options);
}

function commitOverlayToSelectionEdit(bounds, options = {}) {
    return getPaintStrokeEngineModule().commitOverlayToSelectionEdit(bounds, options);
}


function endStroke() {
    return getPaintStrokeEngineModule().endStroke();
}

function beginRect(x, y) {
    if (!session) {
        return;
    }
    session.rect = { x0: x, y0: y, x1: x, y1: y };
    clearOverlayCanvas();
    session.currentBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    updateRectPreview(x, y);
}

function beginPan(stageX, stageY) {
    if (!session) {
        return;
    }
    session.pan.active = true;
    session.pan.startX = stageX;
    session.pan.startY = stageY;
    session.pan.baseTx = session.view.tx;
    session.pan.baseTy = session.view.ty;
    updateStageCursor();
}

function continuePan(stageX, stageY) {
    if (!session || !session.pan.active) {
        return;
    }
    session.view.tx = Math.round(session.pan.baseTx + (stageX - session.pan.startX));
    session.view.ty = Math.round(session.pan.baseTy + (stageY - session.pan.startY));
    setWrapTransform();
}

function endPan() {
    if (!session) {
        return;
    }
    session.pan.active = false;
    updateStageCursor();
}

function computePolygonBounds(points) {
    return getPaintSelectionTransformModule().computePolygonBounds(points);
}

function buildPath2D(points, offsetX = 0, offsetY = 0) {
    return getPaintSelectionTransformModule().buildPath2D(points, offsetX, offsetY);
}

function buildSelectionPathFromComponents(components, inverted, offsetX = 0, offsetY = 0) {
    return getPaintSelectionTransformModule().buildSelectionPathFromComponents(components, inverted, offsetX, offsetY);
}

function rebuildSelectionFromComponents(components, inverted = false) {
    return getPaintSelectionTransformModule().rebuildSelectionFromComponents(components, inverted);
}

function renderLassoPreview(points) {
    return getPaintSelectionTransformModule().renderLassoPreview(points);
}

function extractImageDataRegion(fullImageData, x, y, width, height) {
    return getPaintSelectionTransformModule().extractImageDataRegion(fullImageData, x, y, width, height);
}

function renderSelectionOverlay() {
    return getPaintSelectionTransformModule().renderSelectionOverlay();
}

function captureSelectionSnapshot() {
    return getPaintSelectionTransformModule().captureSelectionSnapshot();
}

function applySelectionSnapshot(snapshot) {
    return getPaintSelectionTransformModule().applySelectionSnapshot(snapshot);
}

function clearSelectionAndQueueUndo() {
    return getPaintSelectionTransformModule().clearSelectionAndQueueUndo();
}

function applySelectionEditsAndClearSelection() {
    return getPaintSelectionTransformModule().applySelectionEditsAndClearSelection();
}

function clearSelection() {
    return getPaintSelectionTransformModule().clearSelection();
}

function finalizeSelection(points, op = 'replace') {
    return getPaintSelectionTransformModule().finalizeSelection(points, op);
}

function beginTransformMode() {
    return getPaintSelectionTransformModule().beginTransformMode();
}

function renderTransformPreview() {
    return getPaintSelectionTransformModule().renderTransformPreview();
}

function cancelTransformMode() {
    return getPaintSelectionTransformModule().cancelTransformMode();
}

function applyTransformMode() {
    return getPaintSelectionTransformModule().applyTransformMode();
}

async function copyCanvasToClipboard(canvas) {
    const { electron } = env;
    if (!electron?.nativeImage || !electron?.clipboard) {
        utils.showToast?.('Clipboard unavailable');
        return false;
    }
    const buffer = await exportCanvasToPngBuffer(canvas);
    if (!buffer) {
        utils.showToast?.('Copy failed');
        return false;
    }
    const nativeImg = electron.nativeImage.createFromBuffer(buffer);
    if (!nativeImg || nativeImg.isEmpty()) {
        utils.showToast?.('Copy failed');
        return false;
    }
    electron.clipboard.writeImage(nativeImg);
    return true;
}

function hasActiveClipboardSelection() {
    return !!(session?.selection?.bounds && session.selection.maskCanvas && session.selection.path && !session.selection.inverted);
}

async function copyActiveLayerToClipboard() {
    const activeLayer = getActiveLayer();
    if (!activeLayer?.canvas) {
        return false;
    }
    const ok = await copyCanvasToClipboard(activeLayer.canvas);
    if (ok) {
        logPaintTrace('paint.layerClipboard.copy', {
            layerId: activeLayer.id || '',
            layerName: activeLayer.name || '',
            layerIndex: session?.activeLayerIndex ?? -1,
            width: Math.round(activeLayer.canvas.width || 0),
            height: Math.round(activeLayer.canvas.height || 0)
        });
    }
    return ok;
}

async function copySelectionOrCanvasToClipboard() {
    return await getPaintSelectionTransformModule().copySelectionOrCanvasToClipboard();
}

async function loadImageFromDataUrl(dataUrl) {
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = dataUrl;
    try {
        await img.decode();
    } catch {}
    if (!img.naturalWidth || !img.naturalHeight) {
        await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (error) => reject(error);
        });
    }
    return img;
}

async function replaceActiveLayerWithClipboardImage(nativeImg, options = {}) {
    return await getPaintSelectionTransformModule().replaceActiveLayerWithClipboardImage(nativeImg, options);
}

function beginPasteTransformMode(contentCanvas, options = {}) {
    return getPaintSelectionTransformModule().beginPasteTransformMode(contentCanvas, options);
}

async function pasteClipboardImageAsTransformSelection(options = {}) {
    return await getPaintSelectionTransformModule().pasteClipboardImageAsTransformSelection(options);
}

function renderBrushCursor(x, y) {
    if (!session || session.crop.active) {
        return;
    }
    renderStageUi();
}

function updateHoverFromPointerEvent(event) {
    if (!session) {
        return;
    }
    const pointerType = typeof event?.pointerType === 'string' ? event.pointerType : '';
    const buttons = Number(event?.buttons) || 0;
    let now = 0;
    if (buttons === 0) {
        now = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? performance.now() : Date.now();
        const ignoreHoverUntil = Number(session.ignoreHoverUntil) || 0;
        if (now < ignoreHoverUntil) {
            const expectedPointerType = typeof session.ignoreHoverPointerType === 'string' ? session.ignoreHoverPointerType : '';
            if (expectedPointerType && pointerType && pointerType !== expectedPointerType) {
                return;
            }
            if (session.ignoreHoverWasStylusLike && pointerType === 'mouse' && !isStylusLikeEvent(event)) {
                return;
            }
        }
        if (pointerType === 'mouse') {
            const ignoreMouseUntil = Number(session.ignoreMouseUntil) || 0;
            if (now < ignoreMouseUntil) {
                return;
            }
        }
    }
    const stagePoint = clientToStage(event);
    if (!Number.isFinite(stagePoint.x) || !Number.isFinite(stagePoint.y)) {
        return;
    }
    session.lastClientX = Number.isFinite(event?.clientX) ? Math.round(event.clientX) : session.lastClientX;
    session.lastClientY = Number.isFinite(event?.clientY) ? Math.round(event.clientY) : session.lastClientY;

    const imgPoint = stageToImage(stagePoint.x, stagePoint.y);
    const x = imgPoint.x;
    const y = imgPoint.y;
    const inBounds = session.patternMode || (x >= 0 && x <= session.width && y >= 0 && y <= session.height);
    session.lastStageX = stagePoint.x;
    session.lastStageY = stagePoint.y;
    session.hover.stageX = stagePoint.x;
    session.hover.stageY = stagePoint.y;
    session.hover.x = x;
    session.hover.y = y;
    session.hover.inBounds = inBounds;
    session.hover.buttons = buttons;
    session.cursorAngle = resolvePenAngleWithFallback(event);
    session.cursorTilt = resolveTiltMagnitude(event);
    renderCursorCanvas({ stageX: stagePoint.x, stageY: stagePoint.y });
    updateStageCursor();
    updateHud();

    if (!session.crop.active && !session.zoomDrag.active && !session.pan.active && !session.isDrawing) {
        renderStageUi();
    }
}

function syncHoverToLastStage(buttons = 0) {
    if (!session?.hover) {
        return;
    }
    const stageX = Number(session.lastStageX);
    const stageY = Number(session.lastStageY);
    if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) {
        return;
    }
    const imgPoint = stageToImage(stageX, stageY);
    const x = imgPoint.x;
    const y = imgPoint.y;
    session.hover.stageX = stageX;
    session.hover.stageY = stageY;
    session.hover.x = x;
    session.hover.y = y;
    session.hover.inBounds = session.patternMode || (x >= 0 && x <= session.width && y >= 0 && y <= session.height);
    session.hover.buttons = Number(buttons) || 0;
}

function beginZoomDrag(stageX, stageY) {
    if (!session) {
        return;
    }
    session.zoomDrag.active = true;
    session.zoomDrag.startY = stageY;
    session.zoomDrag.startScale = session.view.scale;
    session.zoomDrag.startTx = session.view.tx;
    session.zoomDrag.startTy = session.view.ty;
    session.zoomDrag.anchorX = stageX;
    session.zoomDrag.anchorY = stageY;
    updateStageCursor();
}

function continueZoomDrag(stageX, stageY) {
    if (!session || !session.zoomDrag.active) {
        return;
    }
    const dy = stageY - session.zoomDrag.startY;
    const targetScale = clamp(session.zoomDrag.startScale * Math.exp(-dy * 0.01), 0.05, 32);
    const startScale = session.zoomDrag.startScale;
    const anchorX = session.zoomDrag.anchorX;
    const anchorY = session.zoomDrag.anchorY;
    const imgX = (anchorX - session.zoomDrag.startTx) / startScale;
    const imgY = (anchorY - session.zoomDrag.startTy) / startScale;
    session.view.scale = targetScale;
    session.view.tx = Math.round(anchorX - (imgX * targetScale));
    session.view.ty = Math.round(anchorY - (imgY * targetScale));
    setWrapTransform();
}

function endZoomDrag() {
    if (!session) {
        return;
    }
    session.zoomDrag.active = false;
    updateStageCursor();
}

function resizeCanvases(newWidth, newHeight) {
    if (!session) {
        return;
    }
    const width = clamp(Math.round(newWidth), 1, MAX_CANVAS_DIMENSION);
    const height = clamp(Math.round(newHeight), 1, MAX_CANVAS_DIMENSION);

    session.width = width;
    session.height = height;
    dom.paintCanvasWrap.style.width = `${width}px`;
    dom.paintCanvasWrap.style.height = `${height}px`;

    const layers = Array.isArray(session.layers) && session.layers.length
        ? session.layers
        : [{ canvas: session.baseCanvas, ctx: session.baseCtx, id: 'layer-base', name: LAYER_BASE_NAME, isBase: true, dynamic: false }];
    for (const layer of layers) {
        if (!layer?.canvas) {
            continue;
        }
        layer.canvas.width = width;
        layer.canvas.height = height;
        layer.ctx = layer.canvas.getContext('2d', { willReadFrequently: true });
    }
    session.layers = layers;
    if (session.selectionCanvas) {
        session.selectionCanvas.width = width;
        session.selectionCanvas.height = height;
    }
    session.overlayCanvas.width = width;
    session.overlayCanvas.height = height;
    session.uiCanvas.width = width;
    session.uiCanvas.height = height;

    const safeIndex = clamp(Math.round(Number(session.activeLayerIndex) || 0), 0, session.layers.length - 1);
    setActiveLayerRefs(safeIndex, { skipUi: true });
    session.selectionCtx = session.selectionCanvas ? session.selectionCanvas.getContext('2d', { willReadFrequently: false }) : null;
    session.overlayCtx = session.overlayCanvas.getContext('2d', { willReadFrequently: false });
    session.uiCtx = session.uiCanvas.getContext('2d', { willReadFrequently: false });
    syncPaintLayerCanvasOrder();
}

function captureFullSnapshot() {
    return getPaintSelectionTransformModule().captureFullSnapshot();
}

function beginCropMode() {
    if (!session || session.isDrawing) {
        return;
    }
    session.crop.active = true;
    session.crop.rect = {
        x: 0,
        y: 0,
        width: session.width,
        height: session.height
    };
    session.crop.drag = null;
    renderCropOverlay();
}

function cancelCropMode() {
    if (!session) {
        return;
    }
    session.crop.active = false;
    session.crop.drag = null;
    clearUiCanvas();
}

function clampCropRect(rect) {
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    return { x, y, width, height };
}

function applyCropRect(rect) {
    return getPaintSelectionTransformModule().applyCropRect(rect);
}

function resolveCropHit(x, y) {
    return getPaintSelectionTransformModule().resolveCropHit(x, y);
}

function updateCropRectFromDrag(handle, startRect, startX, startY, currentX, currentY) {
    return getPaintSelectionTransformModule().updateCropRectFromDrag(handle, startRect, startX, startY, currentX, currentY);
}

function renderCropOverlay() {
    return getPaintSelectionTransformModule().renderCropOverlay();
}

function adjustCropByKeyboard(event) {
    return getPaintSelectionTransformModule().adjustCropByKeyboard(event);
}

async function exportCanvasToPngBuffer(canvas) {
    return getPaintPersistenceModule().exportCanvasToPngBuffer(canvas);
}

async function saveCurrentPaintSession(reason = 'paint-save', options = {}) {
    return getPaintPersistenceModule().saveCurrentPaintSession(reason, options);
}

async function runPaintAutosaveTick(reason = 'interval') {
    return getPaintPersistenceModule().runPaintAutosaveTick(reason);
}

function startPaintAutosaveLoop(reason = 'start') {
    return getPaintPersistenceModule().startPaintAutosaveLoop(reason);
}

async function saveAndExit() {
    return await getPaintLifecycleModule().saveAndExit();
}

function closePaintMode(options = {}) {
    stageShadowNeedsRebuild = false;
    return getPaintLifecycleModule().closePaintMode(options);
}

function hidePaintContextMenu() {
    return getPaintShellModule().hidePaintContextMenu();
}

function isExitMenuOpen() {
    return getPaintShellModule().isExitMenuOpen();
}

function setExitMenuVisible(visible) {
    if (visible) {
        closePaintLayerViewer({ render: false, reason: 'exit-menu-open' });
    }
    return getPaintShellModule().setExitMenuVisible(visible);
}

function keepChangesAction() {
    return getPaintShellModule().keepChangesAction();
}

function negateChangesAndExit() {
    return getPaintShellModule().negateChangesAndExit();
}

function ensurePaintContextMenuClickHandler() {
    return getPaintShellModule().ensurePaintContextMenuClickHandler();
}

function showPaintContextMenuAt(clientX, clientY) {
    return getPaintShellModule().showPaintContextMenuAt(clientX, clientY);
}

async function loadImageForAsset(assetName) {
    return await getPaintImageIoModule().loadImageForAsset(assetName);
}

async function loadImageForPath(filePath) {
    return await getPaintImageIoModule().loadImageForPath(filePath);
}

function resolvePaintCanvasSize(img, block) {
    return getPaintImageIoModule().resolvePaintCanvasSize(img, block);
}

function resolvePaintTargetForBlock(block, boardId) {
    return getPaintImageIoModule().resolvePaintTargetForBlock(block, boardId);
}

function handlePaintWindowOpenResponse(response, fallbackMessage = 'Paint window failed to open') {
    return getPaintLifecycleModule().handlePaintWindowOpenResponse(response, fallbackMessage);
}

async function openPaintWindowForTarget(target) {
    return await getPaintLifecycleModule().openPaintWindowForTarget(target);
}

async function openPaintWindowForBlock(blockId) {
    return await getPaintLifecycleModule().openPaintWindowForBlock(blockId);
}

async function openPaintWindowForFile(filePath, options = {}) {
    return await getPaintLifecycleModule().openPaintWindowForFile(filePath, options);
}

async function openPaintWindowForWorkspace(options = {}) {
    return await getPaintLifecycleModule().openPaintWindowForWorkspace(options);
}

function resolveRequestedPaintFilePath(launchTarget, fallbackFilePath = '') {
    return getPaintLifecycleModule().resolveRequestedPaintFilePath(launchTarget, fallbackFilePath);
}

function buildDirectPaintLaunchTarget(blockId, options = {}) {
    return getPaintLifecycleModule().buildDirectPaintLaunchTarget(blockId, options);
}

function schedulePaintViewPostOpen() {
    return getPaintLifecycleModule().schedulePaintViewPostOpen();
}

async function openPaintModeForBlock(blockId, options = {}) {
    return await getPaintLifecycleModule().openPaintModeForBlock(blockId, options);
}

async function createBlank1920x1080AndPaint() {
    return await getPaintLifecycleModule().createBlank1920x1080AndPaint();
}

async function openPaintWorkspace() {
    return await getPaintLifecycleModule().openPaintWorkspace();
}

async function openPaintModeFromWindowContext() {
    return await getPaintLifecycleModule().openPaintModeFromWindowContext();
}

env.paintMode = {
    isActive: isPaintModeActive,
    openForBlock: (blockId, options = {}) => openPaintModeForBlock(blockId, options),
    openTarget: async (target, options = {}) => {
        const normalizedTarget = launchTargets.normalizePaintLaunchTarget(target);
        if (!isPaintEditorWindow()) {
            const response = await openPaintWindowForTarget(normalizedTarget);
            handlePaintWindowOpenResponse(response);
            return response;
        }
        return openPaintModeForBlock(normalizedTarget.blockId, {
            ...options,
            inline: true,
            boardId: normalizedTarget.boardId || options.boardId,
            filePath: normalizedTarget.filePath,
            paintLaunchTarget: normalizedTarget
        });
    },
    openForFile: async (filePath, options = {}) => {
        const resolved = String(filePath || '').trim();
        if (!resolved) {
            return Promise.resolve({ success: false, error: 'missing-target' });
        }
        if (!isPaintEditorWindow()) {
            const response = await openPaintWindowForFile(resolved, options);
            handlePaintWindowOpenResponse(response);
            return response;
        }
        return openPaintModeForBlock('', {
            ...options,
            inline: true,
            filePath: resolved,
            paintLaunchTarget: options.paintLaunchTarget || launchTargets.normalizePaintLaunchTarget({
                mode: launchTargets.PAINT_LAUNCH_MODES.BOARD_IMAGE,
                boardId: options.boardId || state.currentBoardId || '',
                filePath: resolved
            })
        });
    },
    openFromWindowContext: () => openPaintModeFromWindowContext(),
    applyLivePreview,
    clearLivePreview,
    applyCommittedImage,
    close: closePaintMode,
    createBlank1920x1080AndPaint: () => createBlank1920x1080AndPaint(),
    handlePasteEvent: (event) => handlePaintPasteEvent(event),
    openWorkspace: () => openPaintWorkspace()
};
