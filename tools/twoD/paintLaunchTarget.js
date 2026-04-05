'use strict';

const PAINT_LAUNCH_MODES = Object.freeze({
    WORKSPACE: 'workspace',
    PROJECT_STILL: 'project-still',
    ANIMATION_FRAME: 'animation-frame',
    ANIMATION_SHEET: 'animation-sheet',
    BOARD_IMAGE: 'board-image'
});

const VALID_MODES = new Set(Object.values(PAINT_LAUNCH_MODES));

function normalizeToken(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMode(value) {
    const mode = normalizeToken(value).toLowerCase();
    return VALID_MODES.has(mode) ? mode : '';
}

function inferMode(raw = {}) {
    if (raw.workspace === true || normalizeToken(raw.workspace) === '1') {
        return PAINT_LAUNCH_MODES.WORKSPACE;
    }
    if (normalizeToken(raw.mode)) {
        return normalizeMode(raw.mode);
    }
    if (normalizeToken(raw.assetId) && normalizeToken(raw.animationId) && normalizeToken(raw.frameId)) {
        return PAINT_LAUNCH_MODES.ANIMATION_FRAME;
    }
    if (normalizeToken(raw.assetId) && normalizeToken(raw.animationId)) {
        return PAINT_LAUNCH_MODES.ANIMATION_SHEET;
    }
    if (normalizeToken(raw.assetId)) {
        return PAINT_LAUNCH_MODES.PROJECT_STILL;
    }
    if (normalizeToken(raw.boardId) || normalizeToken(raw.blockId) || normalizeToken(raw.filePath)) {
        return PAINT_LAUNCH_MODES.BOARD_IMAGE;
    }
    return PAINT_LAUNCH_MODES.WORKSPACE;
}

function normalizePaintLaunchTarget(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const mode = inferMode(source);
    return {
        mode,
        boardId: normalizeToken(source.boardId),
        blockId: normalizeToken(source.blockId),
        assetId: normalizeToken(source.assetId),
        animationId: normalizeToken(source.animationId),
        frameId: normalizeToken(source.frameId),
        filePath: normalizeToken(source.filePath),
        source: normalizeToken(source.source),
        workspace: mode === PAINT_LAUNCH_MODES.WORKSPACE
    };
}

function serializePaintLaunchTarget(target = {}) {
    return JSON.stringify(normalizePaintLaunchTarget(target));
}

function parsePaintLaunchTarget(value) {
    if (!value) {
        return normalizePaintLaunchTarget();
    }
    if (value && typeof value === 'object') {
        return normalizePaintLaunchTarget(value);
    }
    try {
        return normalizePaintLaunchTarget(JSON.parse(String(value)));
    } catch {
        return normalizePaintLaunchTarget();
    }
}

function buildPaintWindowQuery(target = {}) {
    const normalized = normalizePaintLaunchTarget(target);
    const query = {
        windowMode: 'paint-editor',
        paintTarget: serializePaintLaunchTarget(normalized)
    };
    if (normalized.mode === PAINT_LAUNCH_MODES.WORKSPACE) {
        query.workspace = '1';
    }
    if (normalized.boardId) {
        query.boardId = normalized.boardId;
    }
    if (normalized.blockId) {
        query.blockId = normalized.blockId;
    }
    if (normalized.filePath) {
        query.filePath = normalized.filePath;
    }
    if (normalized.assetId) {
        query.assetId = normalized.assetId;
    }
    if (normalized.animationId) {
        query.animationId = normalized.animationId;
    }
    if (normalized.frameId) {
        query.frameId = normalized.frameId;
    }
    return query;
}

function normalizePaintWindowPayload(payload = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {};
    return normalizePaintLaunchTarget(raw.paintLaunchTarget || raw);
}

module.exports = {
    PAINT_LAUNCH_MODES,
    normalizePaintLaunchTarget,
    serializePaintLaunchTarget,
    parsePaintLaunchTarget,
    buildPaintWindowQuery,
    normalizePaintWindowPayload
};
