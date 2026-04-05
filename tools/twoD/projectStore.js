'use strict';

const env = require('../../core/state');
const schema = require('./assetSchema');
const launchTargets = require('./paintLaunchTarget');

const { data, fs, path, state, utils } = env;

const PROJECT_FILE_NAME = 'asset-project.json';
const PROJECT_LIBRARY_RESCAN_INTERVAL_MS = 30000;
let cachedBoardDataRef = null;
let libraryScanReady = false;
let libraryLastScannedAt = 0;

function nowIso() {
    return new Date().toISOString();
}

function defaultStillState() {
    return schema.defaultStillState();
}

function defaultAnimationRecord() {
    return schema.defaultAnimationRecord({
        createId: utils.createId,
        nowIso
    });
}

function createAssetRecord(type = 'concept', overrides = {}) {
    return schema.createAssetRecord({
        type,
        overrides,
        createId: utils.createId,
        nowIso
    });
}

function normalizeAnimation(animation) {
    return schema.normalizeAnimation(animation, {
        createId: utils.createId,
        nowIso
    });
}

function normalizeAsset(asset) {
    return schema.normalizeAsset(asset, {
        createId: utils.createId,
        nowIso
    });
}

function resolveProjectsRoot() {
    return env.paths.twoDProjectsDir || path.join(env.paths.dataDir, '2d-projects');
}

function ensureProjectsRoot() {
    data.ensureDataDirectories?.();
    fs.mkdirSync(resolveProjectsRoot(), { recursive: true });
    return resolveProjectsRoot();
}

function resolveAssetDir(assetId) {
    return path.join(ensureProjectsRoot(), String(assetId || '').trim());
}

function resolveProjectFile(assetId) {
    return path.join(resolveAssetDir(assetId), PROJECT_FILE_NAME);
}

function resolveAssetPath(asset, relativePath) {
    const rel = typeof relativePath === 'string' ? relativePath.trim() : '';
    if (!asset || !rel) {
        return '';
    }
    if (path.isAbsolute(rel)) {
        return rel;
    }
    return path.join(resolveAssetDir(asset.id), rel.replace(/\//g, path.sep));
}

function toRelativeAssetPath(assetId, absolutePath) {
    if (!absolutePath) {
        return '';
    }
    return path.relative(resolveAssetDir(assetId), absolutePath).replace(/\\/g, '/');
}

function ensureAssetDir(assetId) {
    const target = resolveAssetDir(assetId);
    fs.mkdirSync(target, { recursive: true });
    return target;
}

function copyFileToAsset(assetId, sourcePath, relativeDir, preferredName = '') {
    ensureAssetDir(assetId);
    const source = path.resolve(String(sourcePath || '').trim());
    const fileName = preferredName || path.basename(source);
    const targetDir = path.join(resolveAssetDir(assetId), relativeDir.replace(/\//g, path.sep));
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, fileName);
    fs.copyFileSync(source, targetPath);
    return toRelativeAssetPath(assetId, targetPath);
}

function writeBufferToAsset(assetId, relativePath, buffer) {
    ensureAssetDir(assetId);
    const absolute = resolveAssetPath({ id: assetId }, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    return toRelativeAssetPath(assetId, absolute);
}

function writeJsonToAsset(assetId, relativePath, value) {
    return writeBufferToAsset(assetId, relativePath, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
}

function saveAssetSnapshot(asset) {
    const normalized = normalizeAsset(asset);
    const targetPath = resolveProjectFile(normalized.id);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function readAssetSnapshot(assetId) {
    const targetPath = resolveProjectFile(assetId);
    if (!fs.existsSync(targetPath)) {
        return null;
    }
    try {
        return normalizeAsset(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
    } catch (error) {
        console.error('Failed to read asset snapshot', { assetId, error });
        return null;
    }
}

function touchLibraryScan() {
    libraryScanReady = true;
    libraryLastScannedAt = Date.now();
}

function syncLibraryFromDisk(library) {
    const assetMap = library.assets && typeof library.assets === 'object' ? library.assets : {};
    const discovered = {};
    let removedAny = false;

    ensureProjectsRoot();
    try {
        const assetDirs = fs.readdirSync(resolveProjectsRoot(), { withFileTypes: true });
        assetDirs.forEach((entry) => {
            if (!entry.isDirectory()) {
                return;
            }
            const assetId = String(entry.name || '').trim();
            if (!assetId) {
                return;
            }
            const snapshot = readAssetSnapshot(assetId);
            if (snapshot) {
                discovered[assetId] = snapshot;
            }
        });
    } catch {}

    Object.keys(assetMap).forEach((assetId) => {
        const projectFile = resolveProjectFile(assetId);
        if (!fs.existsSync(projectFile)) {
            delete assetMap[assetId];
            removedAny = true;
        }
    });

    Object.keys(discovered).forEach((assetId) => {
        assetMap[assetId] = discovered[assetId];
    });

    library.assets = assetMap;
    if (!library.activeAssetId || !library.assets[library.activeAssetId]) {
        library.activeAssetId = Object.keys(library.assets)[0] || '';
        removedAny = true;
    }
    if (removedAny) {
        data.queueSave?.('asset2d-prune-missing');
    }
    return library;
}

function ensureLibrary(options = {}) {
    const boardData = state.boardData || {};
    if (state.boardData !== boardData) {
        state.boardData = boardData;
    }
    if (cachedBoardDataRef !== boardData) {
        cachedBoardDataRef = boardData;
        libraryScanReady = false;
    }
    const library = data.ensureAssetProjects2DRecord
        ? data.ensureAssetProjects2DRecord(boardData)
        : (boardData.assetProjects2D || { version: 1, activeAssetId: '', assets: {} });
    const forceRefresh = options && options.forceRefresh === true;
    const now = Date.now();
    const shouldScan = forceRefresh
        || !libraryScanReady
        || ((now - libraryLastScannedAt) >= PROJECT_LIBRARY_RESCAN_INTERVAL_MS);
    if (shouldScan) {
        syncLibraryFromDisk(library);
        touchLibraryScan();
    }
    return library;
}

function isTemporaryAsset(asset) {
    return !!(asset && asset.workspace && asset.workspace.temporary === true);
}

function listAssets(options = {}) {
    const library = ensureLibrary(options);
    const includeTemporary = options && options.includeTemporary === true;
    return Object.values(library.assets || {})
        .map(normalizeAsset)
        .filter((asset) => includeTemporary || !isTemporaryAsset(asset))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function getAsset(assetId) {
    const library = ensureLibrary();
    const id = typeof assetId === 'string' ? assetId.trim() : '';
    if (!id) {
        return null;
    }
    const asset = library.assets?.[id];
    if (asset) {
        const normalized = normalizeAsset(asset);
        library.assets[id] = normalized;
        return normalized;
    }
    const fromDisk = readAssetSnapshot(id);
    if (!fromDisk) {
        return null;
    }
    library.assets[id] = fromDisk;
    touchLibraryScan();
    return fromDisk;
}

function saveAsset(asset, reason = 'asset2d-save') {
    const library = ensureLibrary();
    const normalized = normalizeAsset(asset);
    normalized.updatedAt = nowIso();
    library.assets[normalized.id] = normalized;
    library.activeAssetId = normalized.id;
    saveAssetSnapshot(normalized);
    touchLibraryScan();
    data.queueSave?.(reason);
    return normalized;
}

function createAsset(type = 'concept', overrides = {}, reason = 'asset2d-create') {
    const asset = createAssetRecord(type, overrides);
    ensureAssetDir(asset.id);
    return saveAsset(asset, reason);
}

function updateAsset(assetId, updater, reason = 'asset2d-update') {
    const existing = getAsset(assetId);
    if (!existing) {
        return null;
    }
    const draft = normalizeAsset(existing);
    const updated = typeof updater === 'function' ? (updater(draft) || draft) : draft;
    return saveAsset(updated, reason);
}

function selectAsset(assetId, reason = 'asset2d-select') {
    const library = ensureLibrary();
    library.activeAssetId = typeof assetId === 'string' ? assetId : '';
    touchLibraryScan();
    data.queueSave?.(reason);
}

function getSelectedAsset(options = {}) {
    const library = ensureLibrary();
    const includeTemporary = options && options.includeTemporary === true;
    const current = library.activeAssetId ? getAsset(library.activeAssetId) : null;
    if (current && (includeTemporary || !isTemporaryAsset(current))) {
        return current;
    }
    return listAssets({ includeTemporary })[0] || null;
}

function createAnimation(assetId, overrides = {}, reason = 'asset2d-animation-create') {
    const animation = normalizeAnimation(overrides);
    updateAsset(assetId, (asset) => {
        asset.animations[animation.id] = animation;
        asset.activeAnimationId = animation.id;
        asset.animationHistory.push({
            type: 'animation-created',
            animationId: animation.id,
            at: nowIso()
        });
        return asset;
    }, reason);
    return animation;
}

function resolveDuplicateAssetName(sourceName = '') {
    const baseName = String(sourceName || '').trim() || 'Untitled Asset';
    const existingNames = new Set(
        listAssets({ includeTemporary: true })
            .map((asset) => String(asset?.name || '').trim().toLowerCase())
            .filter((value) => !!value)
    );
    let candidate = `${baseName} Copy`;
    let index = 2;
    while (existingNames.has(candidate.toLowerCase())) {
        candidate = `${baseName} Copy ${index}`;
        index += 1;
    }
    return candidate;
}

function duplicateAsset(assetId, options = {}, reason = 'asset2d-duplicate') {
    const sourceAsset = getAsset(assetId);
    if (!sourceAsset) {
        return null;
    }
    let duplicateId = utils.createId('asset2d');
    while (!duplicateId || fs.existsSync(resolveAssetDir(duplicateId))) {
        duplicateId = utils.createId('asset2d');
    }
    const sourceDir = resolveAssetDir(sourceAsset.id);
    const targetDir = resolveAssetDir(duplicateId);
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    const nextKrita = {
        ...(sourceAsset.integrations?.krita && typeof sourceAsset.integrations.krita === 'object'
            ? sourceAsset.integrations.krita
            : (sourceAsset.krita && typeof sourceAsset.krita === 'object' ? sourceAsset.krita : {})),
        lastOpenedPath: '',
        lastSidecarPath: '',
        openedAt: ''
    };
    const duplicateAssetRecord = normalizeAsset({
        ...sourceAsset,
        id: duplicateId,
        name: String(options.name || '').trim() || resolveDuplicateAssetName(sourceAsset.name),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        paint: {
            ...(sourceAsset.paint && typeof sourceAsset.paint === 'object' ? sourceAsset.paint : {}),
            lastEditedPath: '',
            editedAt: ''
        },
        krita: nextKrita,
        integrations: {
            ...(sourceAsset.integrations && typeof sourceAsset.integrations === 'object' ? sourceAsset.integrations : {}),
            krita: nextKrita
        },
        workspace: {
            ...(sourceAsset.workspace && typeof sourceAsset.workspace === 'object' ? sourceAsset.workspace : {}),
            lastOpenedTarget: launchTargets.normalizePaintLaunchTarget({
                ...(sourceAsset.workspace?.lastOpenedTarget && typeof sourceAsset.workspace.lastOpenedTarget === 'object'
                    ? sourceAsset.workspace.lastOpenedTarget
                    : {}),
                assetId: duplicateId,
                filePath: ''
            }),
            lastOpenedAt: ''
        }
    });
    const library = ensureLibrary();
    library.assets[duplicateId] = duplicateAssetRecord;
    library.activeAssetId = duplicateId;
    saveAssetSnapshot(duplicateAssetRecord);
    touchLibraryScan();
    data.queueSave?.(reason);
    return duplicateAssetRecord;
}

function deleteAsset(assetId, reason = 'asset2d-delete') {
    const library = ensureLibrary();
    const id = typeof assetId === 'string' ? assetId.trim() : '';
    if (!id || !library.assets?.[id]) {
        return false;
    }
    const targetDir = resolveAssetDir(id);
    try {
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
    } catch {}
    delete library.assets[id];
    if (library.activeAssetId === id) {
        library.activeAssetId = Object.keys(library.assets)[0] || '';
    }
    touchLibraryScan();
    data.queueSave?.(reason);
    return true;
}

function deleteAnimation(assetId, animationId, reason = 'asset2d-animation-delete') {
    return updateAsset(assetId, (asset) => {
        if (asset.animations?.[animationId]) {
            delete asset.animations[animationId];
        }
        if (asset.activeAnimationId === animationId) {
            asset.activeAnimationId = Object.keys(asset.animations || {})[0] || '';
        }
        asset.animationHistory = Array.isArray(asset.animationHistory) ? asset.animationHistory : [];
        asset.animationHistory.unshift({
            type: 'animation-deleted',
            animationId,
            at: nowIso(),
            frameCount: 0
        });
        return asset;
    }, reason);
}

function updateAnimation(assetId, animationId, updater, reason = 'asset2d-animation-update') {
    return updateAsset(assetId, (asset) => {
        const current = normalizeAnimation(asset.animations?.[animationId] || { id: animationId });
        const updated = typeof updater === 'function' ? (updater(current, asset) || current) : current;
        updated.updatedAt = nowIso();
        asset.animations[animationId] = normalizeAnimation(updated);
        asset.activeAnimationId = animationId;
        return asset;
    }, reason);
}

function fileExists(asset, relativePath) {
    const absolute = resolveAssetPath(asset, relativePath);
    return !!absolute && fs.existsSync(absolute);
}

function getFileStamp(asset, relativePath) {
    try {
        const absolute = resolveAssetPath(asset, relativePath);
        if (!absolute || !fs.existsSync(absolute)) {
            return 0;
        }
        return Math.round(fs.statSync(absolute).mtimeMs || 0);
    } catch {
        return 0;
    }
}

function toFileUrl(asset, relativePath) {
    const absolute = resolveAssetPath(asset, relativePath);
    if (!absolute || !fs.existsSync(absolute)) {
        return '';
    }
    const stamp = getFileStamp(asset, relativePath);
    const href = env.utils.toFileUrl(absolute);
    return stamp ? `${href}?v=${stamp}` : href;
}

function resolveFramePath(frame) {
    return frame?.approvedPath || frame?.workingPath || frame?.originalPath || '';
}

function resolveAssetThumbnailPath(asset) {
    if (!asset) {
        return '';
    }
    if (asset.paint?.thumbnailPath) {
        return asset.paint.thumbnailPath;
    }
    if (asset.still?.approvedImagePath) {
        return asset.still.approvedImagePath;
    }
    if (asset.still?.workingImagePath) {
        return asset.still.workingImagePath;
    }
    if (Array.isArray(asset.still?.variants) && asset.still.variants[0]?.path) {
        return asset.still.variants[0].path;
    }
    const animations = Object.values(asset.animations || {});
    for (const animation of animations) {
        const firstFrame = Array.isArray(animation.frames) ? animation.frames.find((frame) => !!resolveFramePath(frame)) : null;
        if (firstFrame) {
            return resolveFramePath(firstFrame);
        }
        if (animation.sourceSheetPath) {
            return animation.sourceSheetPath;
        }
        if (animation.starterImagePath) {
            return animation.starterImagePath;
        }
    }
    return asset.still?.sourceImages?.[0] || '';
}

function resolveStillPaintFilePath(asset) {
    const stillRelative = asset?.still?.approvedImagePath || asset?.still?.workingImagePath || asset?.still?.sourceImages?.[0] || resolveAssetThumbnailPath(asset);
    return stillRelative ? resolveAssetPath(asset, stillRelative) : '';
}

function resolveTargetPaintFilePath(asset, target = null) {
    if (!asset) {
        return '';
    }
    const resolvedTarget = launchTargets.normalizePaintLaunchTarget(target);
    if (resolvedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME) {
        const animation = asset.animations?.[resolvedTarget.animationId];
        const frame = Array.isArray(animation?.frames) ? animation.frames.find((entry) => entry.id === resolvedTarget.frameId) : null;
        const relative = resolveFramePath(frame);
        return relative ? resolveAssetPath(asset, relative) : resolveStillPaintFilePath(asset);
    }
    if (resolvedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET) {
        const animation = asset.animations?.[resolvedTarget.animationId];
        const relative = animation?.sourceSheetPath || animation?.exportSheetPath || animation?.starterImagePath || '';
        return relative ? resolveAssetPath(asset, relative) : resolveStillPaintFilePath(asset);
    }
    if (resolvedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL || resolvedTarget.mode === launchTargets.PAINT_LAUNCH_MODES.WORKSPACE) {
        return resolveStillPaintFilePath(asset);
    }
    const filePath = String(resolvedTarget.filePath || '').trim();
    if (filePath) {
        return path.isAbsolute(filePath) ? filePath : resolveAssetPath(asset, filePath);
    }
    return resolveStillPaintFilePath(asset);
}

function resolvePreferredPaintFilePath(asset, target = null) {
    if (!asset) {
        return '';
    }
    const resolvedTarget = target
        ? launchTargets.normalizePaintLaunchTarget(target)
        : resolveLastOpenedTarget(asset.id);
    return resolveTargetPaintFilePath(asset, resolvedTarget);
}

function buildAssetBadges(asset) {
    const badges = [];
    if (Object.keys(asset?.animations || {}).length > 0) {
        badges.push('anim');
    }
    if (String(asset?.integrations?.unity?.targetPath || '').trim()) {
        badges.push('unity');
    }
    const needsReview = Object.values(asset?.animations || {}).some((animation) =>
        Array.isArray(animation?.frames) && animation.frames.some((frame) => frame.reviewStatus === 'pending')
    );
    if (needsReview) {
        badges.push('needs review');
    }
    return badges;
}

function setLastOpenedTarget(assetId, target, reason = 'asset2d-last-opened-target') {
    return updateAsset(assetId, (asset) => {
        const normalizedTarget = launchTargets.normalizePaintLaunchTarget({
            assetId,
            ...target
        });
        normalizedTarget.filePath = resolveTargetPaintFilePath(asset, normalizedTarget);
        asset.workspace = asset.workspace && typeof asset.workspace === 'object' ? asset.workspace : schema.defaultWorkspaceState();
        asset.workspace.lastOpenedTarget = normalizedTarget;
        asset.workspace.lastOpenedAt = nowIso();
        return asset;
    }, reason);
}

function resolveLastOpenedTarget(assetId) {
    const asset = getAsset(assetId);
    if (!asset) {
        return launchTargets.normalizePaintLaunchTarget();
    }
    const stored = asset.workspace?.lastOpenedTarget && typeof asset.workspace.lastOpenedTarget === 'object'
        ? asset.workspace.lastOpenedTarget
        : {};
    const normalized = launchTargets.normalizePaintLaunchTarget({
        mode: stored.mode || launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL,
        assetId: asset.id,
        animationId: stored.animationId || asset.activeAnimationId || '',
        frameId: stored.frameId || '',
        filePath: stored.filePath || ''
    });
    normalized.filePath = resolveTargetPaintFilePath(asset, normalized);
    return normalized;
}

function findAssetContextByFilePath(filePath) {
    const resolved = path.resolve(String(filePath || '').trim());
    if (!resolved) {
        return null;
    }
    const assets = listAssets({ includeTemporary: true });
    for (const asset of assets) {
        const animations = Object.values(asset.animations || {});
        for (const animation of animations) {
            const frames = Array.isArray(animation.frames) ? animation.frames.slice().sort((a, b) => a.index - b.index) : [];
            for (let index = 0; index < frames.length; index += 1) {
                const frame = frames[index];
                const frameCandidates = [frame.originalPath, frame.workingPath, frame.approvedPath];
                (frame.variants || []).forEach((variant) => variant?.path && frameCandidates.push(variant.path));
                for (const relative of frameCandidates.filter(Boolean)) {
                    const absolute = resolveAssetPath(asset, relative);
                    if (absolute && path.resolve(absolute) === resolved) {
                        return {
                            asset,
                            animation,
                            frame,
                            frameIndex: index,
                            target: launchTargets.normalizePaintLaunchTarget({
                                mode: launchTargets.PAINT_LAUNCH_MODES.ANIMATION_FRAME,
                                assetId: asset.id,
                                animationId: animation.id,
                                frameId: frame.id,
                                filePath: absolute
                            })
                        };
                    }
                }
            }
        }
        const stillCandidates = [];
        if (asset.still?.workingImagePath) stillCandidates.push(asset.still.workingImagePath);
        if (asset.still?.approvedImagePath) stillCandidates.push(asset.still.approvedImagePath);
        (asset.still?.sourceImages || []).forEach((value) => stillCandidates.push(value));
        (asset.still?.variants || []).forEach((variant) => variant?.path && stillCandidates.push(variant.path));
        for (const relative of stillCandidates) {
            const absolute = resolveAssetPath(asset, relative);
            if (absolute && path.resolve(absolute) === resolved) {
                return {
                    asset,
                    animation: null,
                    frame: null,
                    frameIndex: -1,
                    target: launchTargets.normalizePaintLaunchTarget({
                        mode: launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL,
                        assetId: asset.id,
                        filePath: absolute
                    })
                };
            }
        }
        for (const reference of asset.references || []) {
            const absolute = resolveAssetPath(asset, reference.path);
            if (absolute && path.resolve(absolute) === resolved) {
                return {
                    asset,
                    animation: null,
                    frame: null,
                    frameIndex: -1,
                    target: launchTargets.normalizePaintLaunchTarget({
                        mode: launchTargets.PAINT_LAUNCH_MODES.PROJECT_STILL,
                        assetId: asset.id,
                        filePath: absolute
                    })
                };
            }
        }
        for (const animation of animations) {
            const animationPaths = [animation.sourceSheetPath, animation.starterImagePath, animation.exportSheetPath, animation.exportManifestPath];
            for (const relative of animationPaths.filter(Boolean)) {
                const absolute = resolveAssetPath(asset, relative);
                if (absolute && path.resolve(absolute) === resolved) {
                    return {
                        asset,
                        animation,
                        frame: null,
                        frameIndex: -1,
                        target: launchTargets.normalizePaintLaunchTarget({
                            mode: launchTargets.PAINT_LAUNCH_MODES.ANIMATION_SHEET,
                            assetId: asset.id,
                            animationId: animation.id,
                            filePath: absolute
                        })
                    };
                }
            }
        }
    }
    return null;
}

function findAssetByFilePath(filePath) {
    return findAssetContextByFilePath(filePath)?.asset || null;
}

env.projectStore = {
    defaultAnimationRecord,
    createAssetRecord,
    normalizeAsset,
    normalizeAnimation,
    ensureLibrary,
    listAssets,
    getAsset,
    saveAsset,
    createAsset,
    updateAsset,
    selectAsset,
    getSelectedAsset,
    createAnimation,
    duplicateAsset,
    deleteAsset,
    deleteAnimation,
    updateAnimation,
    resolveProjectsRoot,
    resolveAssetDir,
    resolveProjectFile,
    resolveAssetPath,
    toRelativeAssetPath,
    copyFileToAsset,
    writeBufferToAsset,
    writeJsonToAsset,
    saveAssetSnapshot,
    readAssetSnapshot,
    fileExists,
    getFileStamp,
    toFileUrl,
    resolveAssetThumbnailPath,
    resolvePreferredPaintFilePath,
    buildAssetBadges,
    isTemporaryAsset,
    setLastOpenedTarget,
    resolveLastOpenedTarget,
    findAssetContextByFilePath,
    findAssetByFilePath
};

module.exports = env.projectStore;
