'use strict';

// MARK: DATA ACCESSORS
const env = require('../core/state');
const { fs, path, paths, constants, state, utils } = env;
const boardDisplay = require('../automation/boardDisplay');
const {
    getAnimated3dPackageReferences,
    resolveAnimated3dPackage,
    sanitizeAnimated3dBlockData
} = require('../blocks/animated3dPackage');

const ALLOWED_TEXT_FONTS = [
    "Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    "'Roboto', 'Helvetica Neue', Arial, sans-serif",
    "'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif",
    "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
    "'Open Sans', 'Helvetica Neue', Arial, sans-serif",
    "'Lato', 'Helvetica Neue', Arial, sans-serif",
    "'Work Sans', 'Helvetica Neue', Arial, sans-serif",
    "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
    "'Nunito', 'Helvetica Neue', Arial, sans-serif"
];

const ALLOWED_TITLE_FONTS = [
    "'Georgia', 'Palatino Linotype', 'Times New Roman', serif",
    "'Playfair Display', 'Times New Roman', serif",
    "'Libre Baskerville', 'Times New Roman', serif",
    "'Cormorant Garamond', 'Times New Roman', serif",
    "'Merriweather', 'Times New Roman', serif",
    "'EB Garamond', 'Times New Roman', serif",
    "'Abril Fatface', 'Times New Roman', serif",
    "'Bodoni Moda', 'Times New Roman', serif",
    "'Spectral', 'Times New Roman', serif",
    "'Lora', 'Times New Roman', serif",
    "'Marcellus', 'Times New Roman', serif"
];

const CREATION_FIELD_KEYS = ['conception', 'combination', 'contradiction', 'circumstance', 'counterplay', 'condition', 'clue'];
const CREATION_FIELD_MAX_LINES = 2;
const CREATION_FIELD_MAX_CHARS = 280;

let directoriesReady = false;
let lastDirectoryRoot = '';

// MARK: Media Helpers
function extractYoutubeVideoId(url) {
    if (typeof url !== 'string' || !url.trim()) {
        return '';
    }
    try {
        const parsed = new URL(url.trim());
        const host = parsed.hostname.toLowerCase();
        if (host.includes('youtube.com')) {
            if (parsed.searchParams.has('v')) {
                return parsed.searchParams.get('v');
            }
            const segments = parsed.pathname.split('/').filter(Boolean);
            if (segments.length >= 2 && segments[0] === 'embed') {
                return segments[1];
            }
            if (segments.length >= 2 && segments[0] === 'shorts') {
                return segments[1];
            }
            if (segments.length >= 1 && segments[0] === 'watch') {
                return parsed.searchParams.get('v') || '';
            }
        }
        if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
            const segments = parsed.pathname.split('/').filter(Boolean);
            if (segments[0]) {
                return segments[0];
            }
        }
    } catch {}
    return '';
}

// MARK: Viewport Utilities
function sanitizeViewport(raw = {}) {
    const scaleCandidate = Number(raw.scale);
    const scrollXCandidate = Number(raw.scrollX);
    const scrollYCandidate = Number(raw.scrollY);
    const viewportWidthCandidate = Number(raw.viewportWidth);
    const viewportHeightCandidate = Number(raw.viewportHeight);
    const scale = utils.clamp(Number.isFinite(scaleCandidate) ? scaleCandidate : 1, constants.MIN_SCALE, constants.MAX_SCALE);
    const scrollX = Number.isFinite(scrollXCandidate) ? scrollXCandidate : 0;
    const scrollY = Number.isFinite(scrollYCandidate) ? scrollYCandidate : 0;
    const viewportWidth = Number.isFinite(viewportWidthCandidate) && viewportWidthCandidate > 0 ? Math.round(viewportWidthCandidate) : 0;
    const viewportHeight = Number.isFinite(viewportHeightCandidate) && viewportHeightCandidate > 0 ? Math.round(viewportHeightCandidate) : 0;
    return { scale, scrollX, scrollY, viewportWidth, viewportHeight };
}

// MARK: Data Directory Setup
function ensureDataDirectories() {
    const targetRoot = path.resolve(paths.dataDir);
    if (directoriesReady && targetRoot === lastDirectoryRoot) {
        return;
    }
    lastDirectoryRoot = targetRoot;
    const created = [];
    if (!fs.existsSync(paths.dataDir)) {
        fs.mkdirSync(paths.dataDir, { recursive: true });
        created.push(paths.dataDir);
    }
    if (!fs.existsSync(paths.assetsDir)) {
        fs.mkdirSync(paths.assetsDir, { recursive: true });
        created.push(paths.assetsDir);
    }
    const previousImagesDir = path.join(paths.dataDir, 'images');
    if (fs.existsSync(previousImagesDir) && !fs.existsSync(paths.imagesDir)) {
        try {
            fs.mkdirSync(path.dirname(paths.imagesDir), { recursive: true });
            fs.renameSync(previousImagesDir, paths.imagesDir);
            created.push(paths.imagesDir);
        } catch (error) {
            console.error('Failed to migrate previous images directory', error);
        }
    }
    if (!fs.existsSync(paths.imagesDir)) {
        fs.mkdirSync(paths.imagesDir, { recursive: true });
        created.push(paths.imagesDir);
    }
    if (!fs.existsSync(paths.audioDir)) {
        fs.mkdirSync(paths.audioDir, { recursive: true });
        created.push(paths.audioDir);
    }
    if (!fs.existsSync(paths.videoDir)) {
        fs.mkdirSync(paths.videoDir, { recursive: true });
        created.push(paths.videoDir);
    }
    if (paths.modelsDir && !fs.existsSync(paths.modelsDir)) {
        fs.mkdirSync(paths.modelsDir, { recursive: true });
        created.push(paths.modelsDir);
    }
    if (created.length > 0) {
        console.info('Data directories created', { paths: created });
    }
    directoriesReady = true;
}

// MARK: Asset Normalization
function normalizeAssetReference(name) {
    const raw = typeof name === 'string' ? name.trim() : '';
    if (!raw) {
        return '';
    }
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.startsWith('assets/')) {
        return normalized.slice('assets/'.length);
    }
    return normalized;
}

// MARK: Default State Builders
function normalizeCreationFieldValue(value) {
    const raw = typeof value === 'string' ? value : String(value ?? '');
    const normalized = raw.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n').slice(0, CREATION_FIELD_MAX_LINES);
    return lines.join('\n').slice(0, CREATION_FIELD_MAX_CHARS);
}

function createDefaultCreationFields(sourceFields, fallbackSource) {
    const fields = {};
    const source = (sourceFields && typeof sourceFields === 'object') ? sourceFields : {};
    const fallback = (fallbackSource && typeof fallbackSource === 'object') ? fallbackSource : {};
    CREATION_FIELD_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            fields[key] = normalizeCreationFieldValue(source[key]);
            return;
        }
        if (Object.prototype.hasOwnProperty.call(fallback, key)) {
            fields[key] = normalizeCreationFieldValue(fallback[key]);
            return;
        }
        fields[key] = '';
    });
    return fields;
}

function defaultBoardData() {
    const now = new Date().toISOString();
    const defaults = {
        version: 6,
        activeBoardId: 'root',
        settings: defaultSettings(),
        viewport: sanitizeViewport(),
        boards: {
            root: {
                id: 'root',
                title: 'Root',
                parentId: null,
                childIds: [],
                blocks: [],
                iconPreview: '',
                viewport: sanitizeViewport(),
                createdAt: now,
                updatedAt: now
            }
        }
    };
    boardDisplay.ensureSystemBoards(defaults, { createdAt: now });
    return defaults;
}

function resolveCorruptSuffix(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason || 'corrupt').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
    return `${safeReason}-${stamp}`;
}

function tryParseJson(raw) {
    if (typeof raw !== 'string') {
        return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function atomicWriteFileSync(targetPath, contents) {
    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const bakPath = `${targetPath}.bak`;
    fs.writeFileSync(tmpPath, contents);
    try {
        if (fs.existsSync(bakPath)) {
            try {
                fs.unlinkSync(bakPath);
            } catch {}
        }
        if (fs.existsSync(targetPath)) {
            try {
                fs.renameSync(targetPath, bakPath);
            } catch {}
        }
        try {
            fs.renameSync(tmpPath, targetPath);
        } catch (error) {
            if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                fs.copyFileSync(tmpPath, targetPath);
                fs.unlinkSync(tmpPath);
            } else {
                throw error;
            }
        }
    } catch (error) {
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch {}
        throw error;
    }
}

function getBoardsFileMtimeMs() {
    try {
        const stat = fs.statSync(paths.boardsFilePath);
        return Number(stat.mtimeMs) || 0;
    } catch {
        return 0;
    }
}

function markBoardsFileMtime() {
    state.boardDataDiskMtimeMs = getBoardsFileMtimeMs();
    return state.boardDataDiskMtimeMs;
}

function finishLoadedBoardData(data, reason = '') {
    markBoardsFileMtime();
    if (reason) {
        console.debug('Board data disk baseline updated', {
            reason,
            mtimeMs: Number(state.boardDataDiskMtimeMs || 0).toFixed(1)
        });
    }
    return data;
}

function isStaleDiskOverwriteSensitiveReason(reason) {
    const key = String(reason || '').trim().toLowerCase();
    return key === 'reload' || key === 'beforeunload';
}

function shouldSkipStaleSyncPersist(reason) {
    if (!isStaleDiskOverwriteSensitiveReason(reason)) {
        return false;
    }
    const loadedMtime = Number(state.boardDataDiskMtimeMs) || 0;
    const diskMtime = getBoardsFileMtimeMs();
    if (!(loadedMtime > 0 && diskMtime > 0)) {
        return false;
    }
    return diskMtime > loadedMtime + 25;
}

async function atomicWriteFile(targetPath, contents, options = {}) {
    const normalized = options && typeof options === 'object' ? options : {};
    const shouldContinue = typeof normalized.shouldContinue === 'function' ? normalized.shouldContinue : null;
    const dir = path.dirname(targetPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const bakPath = `${targetPath}.bak`;
    if (shouldContinue && !shouldContinue()) {
        return { skipped: true, stage: 'before-write' };
    }
    await fs.promises.writeFile(tmpPath, contents);
    try {
        if (shouldContinue && !shouldContinue()) {
            await fs.promises.unlink(tmpPath).catch(() => {});
            return { skipped: true, stage: 'after-write' };
        }
        if (fs.existsSync(bakPath)) {
            await fs.promises.unlink(bakPath).catch(() => {});
        }
        if (fs.existsSync(targetPath)) {
            await fs.promises.rename(targetPath, bakPath).catch(() => {});
        }
        if (shouldContinue && !shouldContinue()) {
            await fs.promises.unlink(tmpPath).catch(() => {});
            return { skipped: true, stage: 'before-replace' };
        }
        try {
            await fs.promises.rename(tmpPath, targetPath);
        } catch (error) {
            if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
                await fs.promises.copyFile(tmpPath, targetPath);
                await fs.promises.unlink(tmpPath).catch(() => {});
            } else {
                throw error;
            }
        }
        return { skipped: false };
    } catch (error) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        throw error;
    }
}

function renameCorruptFileSync(targetPath, reason) {
    if (!fs.existsSync(targetPath)) {
        return '';
    }
    const suffix = resolveCorruptSuffix(reason);
    const nextPath = `${targetPath}.${suffix}`;
    try {
        fs.renameSync(targetPath, nextPath);
        return nextPath;
    } catch {
        return '';
    }
}

function loadHistoryRecoverySnapshot() {
    try {
        if (!fs.existsSync(paths.historyFilePath)) {
            return null;
        }
        const raw = fs.readFileSync(paths.historyFilePath, 'utf8');
        const parsed = tryParseJson(raw);
        const undo = Array.isArray(parsed?.undo) ? parsed.undo : [];
        let best = null;
        undo.forEach((entry) => {
            const snapshot = entry?.snapshot;
            if (!snapshot?.boards || typeof snapshot.boards !== 'object') {
                return;
            }
            const boards = snapshot.boards;
            const ids = Object.keys(boards);
            let blockCount = 0;
            ids.forEach((id) => {
                const board = boards[id];
                if (Array.isArray(board?.blocks)) {
                    blockCount += board.blocks.length;
                }
            });
            if (blockCount <= 0) {
                return;
            }
            const ts = Number(entry?.timestamp) || 0;
            if (!best || ts > best.ts) {
                best = { snapshot, ts, reason: String(entry?.reason || '') };
            }
        });
        return best?.snapshot || null;
    } catch {
        return null;
    }
}

function tryRecoverBoardsPayload(reason) {
    const bakPath = `${paths.boardsFilePath}.bak`;
    if (fs.existsSync(bakPath)) {
        try {
            const raw = fs.readFileSync(bakPath, 'utf8');
            const parsed = tryParseJson(raw);
            if (parsed && parsed.boards && typeof parsed.boards === 'object' && parsed.boards.root) {
                console.warn('Recovered board data from backup file', { source: 'bak', reason });
                return parsed;
            }
        } catch {}
    }
    const historySnapshot = loadHistoryRecoverySnapshot();
    if (historySnapshot) {
        console.warn('Recovered board data from history snapshot', { source: 'history', reason });
        return historySnapshot;
    }
    return null;
}

function persistRecoveredBoardData(recovered, options = {}) {
    if (!recovered || typeof recovered !== 'object') {
        return null;
    }
    const normalized = { ...recovered };
    const settings = sanitizeSettings(normalized.settings || {});
    normalized.settings = settings;
    hydrateLoadedData(normalized);
    try {
        atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...normalized, settings: undefined }, null, 2));
        atomicWriteFileSync(paths.settingsFilePath, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Failed to persist recovered board data', error);
    }
    if (env.backups && typeof env.backups.reconcileSettings === 'function') {
        env.backups.reconcileSettings(settings);
    }
    if (options && options.toast && env.utils?.showToast) {
        env.utils.showToast(String(options.toast));
    }
    return normalized;
}

// MARK: Settings Persistence
function loadSettingsData(fallbackSettings) {
    try {
        if (fs.existsSync(paths.settingsFilePath)) {
            const raw = fs.readFileSync(paths.settingsFilePath, 'utf8');
            if (raw.trim()) {
                const parsed = JSON.parse(raw);
                return sanitizeSettings(parsed);
            }
        }
    } catch (error) {
        console.error('Failed to read settings file', error);
    }
    const defaults = sanitizeSettings(fallbackSettings || defaultSettings());
    try {
        if (fs.existsSync(paths.settingsFilePath)) {
            renameCorruptFileSync(paths.settingsFilePath, 'settings-reset');
        }
        atomicWriteFileSync(paths.settingsFilePath, JSON.stringify(defaults, null, 2));
        console.warn('Settings file missing, created defaults');
    } catch (error) {
        console.error('Failed to write default settings file', error);
    }
    return defaults;
}

// MARK: Board Persistence
function loadBoardData() {
    try {
        ensureDataDirectories();
        console.info('Loading board data', { path: paths.boardsFilePath });
        if (!fs.existsSync(paths.boardsFilePath)) {
            const defaults = defaultBoardData();
            atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...defaults, settings: undefined }, null, 2));
            const settings = loadSettingsData(defaults.settings);
            defaults.settings = settings;
            if (env.backups && typeof env.backups.reconcileSettings === 'function') {
                env.backups.reconcileSettings(settings);
            }
            console.warn('Board data file missing, created defaults', { boardCount: Object.keys(defaults.boards).length });
            return finishLoadedBoardData(defaults, 'missing-defaults');
        }
        const raw = fs.readFileSync(paths.boardsFilePath, 'utf8');
        if (!raw.trim()) {
            const recovered = tryRecoverBoardsPayload('empty-file');
            if (recovered) {
                const persisted = persistRecoveredBoardData(recovered, { toast: 'Board Studio recovered from backup after empty save.' });
                if (persisted) {
                    return finishLoadedBoardData(persisted, 'empty-recovered');
                }
            }
            renameCorruptFileSync(paths.boardsFilePath, 'empty');
            const defaults = defaultBoardData();
            atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...defaults, settings: undefined }, null, 2));
            const settings = loadSettingsData(defaults.settings);
            defaults.settings = settings;
            if (env.backups && typeof env.backups.reconcileSettings === 'function') {
                env.backups.reconcileSettings(settings);
            }
            console.warn('Board data file empty, restored defaults', { boardCount: Object.keys(defaults.boards).length });
            return finishLoadedBoardData(defaults, 'empty-defaults');
        }
        const parsed = tryParseJson(raw);
        if (!parsed) {
            const recovered = tryRecoverBoardsPayload('parse-failed');
            if (recovered) {
                const persisted = persistRecoveredBoardData(recovered, { toast: 'Board Studio recovered from backup after load failure.' });
                if (persisted) {
                    return finishLoadedBoardData(persisted, 'parse-recovered');
                }
            }
            renameCorruptFileSync(paths.boardsFilePath, 'parse-failed');
            const defaults = defaultBoardData();
            atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...defaults, settings: undefined }, null, 2));
            const settings = loadSettingsData(defaults.settings);
            defaults.settings = settings;
            console.warn('Board data corrupted, created defaults', { boardCount: Object.keys(defaults.boards).length });
            return finishLoadedBoardData(defaults, 'parse-defaults');
        }
        const settingsFromFile = loadSettingsData(parsed.settings);
        parsed.settings = settingsFromFile;
        const systemBoards = hydrateLoadedData(parsed);
        const orphanSummary = purgeOrphanBoards(parsed);
        const storageCleanup = boardDisplay.cleanupExpiredStorageBatches(parsed);
        const storageReflow = boardDisplay.reflowStorageBatches(parsed);
        let orphanAssetSummary = { removed: 0, checked: 0, referenced: 0 };
        const dataChanged = systemBoards.changed || orphanSummary.changed || storageCleanup.changed || storageReflow.changed;
        if (dataChanged) {
            try {
                atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...parsed, settings: undefined }, null, 2));
                if (storageCleanup.changed) {
                    orphanAssetSummary = deleteOrphanAssets(parsed);
                    console.info('Expired storage cleanup applied', storageCleanup);
                }
                console.warn('Board data maintenance applied', { systemBoards, orphanSummary, storageCleanup, storageReflow, orphanAssetSummary });
            } catch (error) {
                console.error('Failed to persist board cleanup', error);
            }
        }
        if (env.backups && typeof env.backups.reconcileSettings === 'function') {
            env.backups.reconcileSettings(parsed.settings);
        }
        const boardCount = Object.keys(parsed.boards || {}).length;
        const blockCount = Object.values(parsed.boards || {}).reduce((total, board) => total + (Array.isArray(board.blocks) ? board.blocks.length : 0), 0);
        console.info('Board data loaded', { boards: boardCount, blocks: blockCount });
        return finishLoadedBoardData(parsed, 'loaded');
    } catch (error) {
        console.error('Failed to load board data', error);
        try {
            const recovered = tryRecoverBoardsPayload('exception');
            if (recovered) {
                const persisted = persistRecoveredBoardData(recovered, { toast: 'Board Studio recovered from backup after load error.' });
                if (persisted) {
                    return finishLoadedBoardData(persisted, 'exception-recovered');
                }
            }
        } catch {}
        renameCorruptFileSync(paths.boardsFilePath, 'load-exception');
        const defaults = defaultBoardData();
        try {
            atomicWriteFileSync(paths.boardsFilePath, JSON.stringify({ ...defaults, settings: undefined }, null, 2));
            atomicWriteFileSync(paths.settingsFilePath, JSON.stringify(defaults.settings, null, 2));
        } catch (writeErr) {
            console.error('Failed to write default board data', writeErr);
        }
        console.warn('Board data reset to defaults', { boardCount: Object.keys(defaults.boards).length });
        if (env.backups && typeof env.backups.reconcileSettings === 'function') {
            env.backups.reconcileSettings(defaults.settings);
        }
        return finishLoadedBoardData(defaults, 'exception-defaults');
    }
}

// MARK: Data Hydration
function hydrateLoadedData(data) {
    const systemBoards = boardDisplay.ensureSystemBoards(data);
    console.debug('Hydrating board data', { boardCount: Object.keys(data.boards || {}).length });
    data.version = Math.max(6, Number(data.version) || 1);
    data.viewport = sanitizeViewport(data.viewport);
    data.settings = sanitizeSettings(data.settings);
    // Drop 2D project data from older versions.
    delete data.artProjects2D;
    delete data.assetProjects2D;
    const boards = data.boards || {};
    const fallbackViewport = sanitizeViewport(data.viewport);
    Object.values(boards).forEach((board) => {
        board.childIds = Array.isArray(board.childIds) ? board.childIds : [];
        board.blocks = Array.isArray(board.blocks) ? board.blocks : [];
        // Older versions kept side lists on every board, those are gone now.
        delete board.sublists;
        delete board.useLocalSublists;
        board.viewport = sanitizeViewport(board.viewport || fallbackViewport);
        normalizeBoardIconState(board);
        board.blocks.forEach((block) => applyBlockDefaults(block));
    });
    return systemBoards;
}

function normalizeBoardIconState(board) {
    if (!board || typeof board !== 'object') {
        return;
    }
    if (board.iconMode !== undefined) {
        delete board.iconMode;
    }
    if (board.iconValue !== undefined) {
        delete board.iconValue;
    }
    if (typeof board.iconPreview !== 'string') {
        board.iconPreview = '';
        return;
    }
    const trimmed = board.iconPreview.trim();
    if (trimmed && !trimmed.startsWith('data:image/svg+xml')) {
        board.iconPreview = '';
    }
}

// MARK: Orphan Board Cleanup
function collectReachableBoardIds(boardData) {
    const boards = boardData?.boards && typeof boardData.boards === 'object' ? boardData.boards : {};
    const seedBoardIds = boardDisplay.getReachabilitySeedBoardIds(boardData);
    if (seedBoardIds.length === 0) {
        console.warn('Board data missing system boards; orphan cleanup skipped');
        return new Set(Object.keys(boards));
    }
    const childBoardsByParent = new Map();
    Object.entries(boards).forEach(([boardId, board]) => {
        if (!board || typeof board !== 'object' || boardId === 'root') {
            return;
        }
        const parentId = typeof board.parentId === 'string' ? board.parentId.trim() : '';
        if (!parentId || !boards[parentId]) {
            return;
        }
        if (!childBoardsByParent.has(parentId)) {
            childBoardsByParent.set(parentId, []);
        }
        childBoardsByParent.get(parentId).push(boardId);
    });
    const reachable = new Set();
    const queue = [...seedBoardIds];
    while (queue.length > 0) {
        const boardId = queue.pop();
        if (!boardId || reachable.has(boardId)) {
            continue;
        }
        const board = boards[boardId];
        if (!board) {
            continue;
        }
        reachable.add(boardId);
        const directChildIds = Array.isArray(board.childIds) ? board.childIds : [];
        directChildIds.forEach((childId) => {
            if (typeof childId !== 'string' || !boards[childId] || reachable.has(childId)) {
                return;
            }
            queue.push(childId);
        });
        const relatedChildIds = childBoardsByParent.get(boardId) || [];
        relatedChildIds.forEach((childId) => {
            if (!boards[childId] || reachable.has(childId)) {
                return;
            }
            queue.push(childId);
        });
        const blocks = Array.isArray(board.blocks) ? board.blocks : [];
        blocks.forEach((block) => {
            if (!block || block.type !== 'board-link') {
                return;
            }
            const targetId = String(block.targetBoardId || '').trim();
            if (!targetId) {
                return;
            }
            if (!boards[targetId]) {
                return;
            }
            if (!reachable.has(targetId)) {
                queue.push(targetId);
            }
        });
    }
    return reachable;
}

function purgeOrphanBoards(boardData) {
    const boards = boardData?.boards && typeof boardData.boards === 'object' ? boardData.boards : {};
    const reachable = collectReachableBoardIds(boardData);
    const ids = Object.keys(boards);
    const removedBoardIds = [];
    ids.forEach((id) => {
        if (!reachable.has(id)) {
            removedBoardIds.push(id);
            delete boards[id];
        }
    });

    let removedBoardLinks = 0;
    let repairedParents = 0;
    let prunedChildIds = 0;
    let restoredChildIds = 0;

    Object.values(boards).forEach((board) => {
        if (!board || typeof board !== 'object') {
            return;
        }
        if (boardDisplay.isSystemBoardId(board.id)) {
            if (board.parentId !== null) {
                board.parentId = null;
                repairedParents += 1;
            }
        } else if (board.parentId && !boards[board.parentId]) {
            board.parentId = 'root';
            repairedParents += 1;
        }

        if (Array.isArray(board.childIds) && board.childIds.length > 0) {
            const nextChildIds = board.childIds.filter((childId) => typeof childId === 'string' && boards[childId]);
            if (nextChildIds.length !== board.childIds.length) {
                prunedChildIds += (board.childIds.length - nextChildIds.length);
                board.childIds = nextChildIds;
            }
        }

        const orderedChildIds = [];
        const seenChildIds = new Set();
        const appendChildId = (childId) => {
            if (typeof childId !== 'string' || seenChildIds.has(childId) || !boards[childId]) {
                return;
            }
            const childBoard = boards[childId];
            if (!childBoard || childBoard.parentId !== board.id) {
                return;
            }
            orderedChildIds.push(childId);
            seenChildIds.add(childId);
        };
        (board.childIds || []).forEach(appendChildId);
        Object.keys(boards).forEach((childId) => {
            const childBoard = boards[childId];
            if (!childBoard || childBoard.parentId !== board.id) {
                return;
            }
            appendChildId(childId);
        });
        if (orderedChildIds.length !== (board.childIds || []).length || orderedChildIds.some((childId, index) => childId !== board.childIds[index])) {
            restoredChildIds += Math.max(0, orderedChildIds.length - ((board.childIds || []).length));
            board.childIds = orderedChildIds;
        }

        if (Array.isArray(board.blocks) && board.blocks.length > 0) {
            const before = board.blocks.length;
            board.blocks = board.blocks.filter((block) => {
                if (!block || typeof block !== 'object') {
                    return false;
                }
                if (block.type !== 'board-link') {
                    return true;
                }
                const targetId = String(block.targetBoardId || '').trim();
                return !!(targetId && boards[targetId]);
            });
            removedBoardLinks += (before - board.blocks.length);
        }
    });

    if (boardData && typeof boardData === 'object') {
        if (typeof boardData.activeBoardId === 'string' && boardData.activeBoardId && !boards[boardData.activeBoardId]) {
            boardData.activeBoardId = 'root';
        }
    }

    const changed = removedBoardIds.length > 0 || removedBoardLinks > 0 || repairedParents > 0 || prunedChildIds > 0 || restoredChildIds > 0;
    return {
        changed,
        removedBoards: removedBoardIds.length,
        removedBoardIds,
        removedBoardLinks,
        repairedParents,
        prunedChildIds,
        restoredChildIds,
        reachableBoards: reachable.size
    };
}

function resolveInitialBoardId(data) {
    if (data.activeBoardId && data.boards[data.activeBoardId]) {
        return data.activeBoardId;
    }
    return 'root';
}

// MARK: Block Defaults
function applyBlockDefaults(block) {
    block.id = block.id || utils.createId(block.type || 'block');
    block.type = block.type || 'text';
    if (block.type === 'animated3d') {
        sanitizeAnimated3dBlockData(block);
    }
    block.x = typeof block.x === 'number' ? block.x : constants.GRID_SIZE * 6;
    block.y = typeof block.y === 'number' ? block.y : constants.GRID_SIZE * 6;
    const allowFreeformGeometry = block.type === 'image';
    let minWidth = constants.GRID_SIZE * 4;
    let minHeight = constants.GRID_SIZE * 4;
    let defaultWidth = constants.GRID_SIZE * 8;
    let defaultHeight = constants.GRID_SIZE * 6;
    let preserveRatio = false;
    if (block.type === 'text') {
        minWidth = constants.GRID_SIZE * 6;
        minHeight = constants.GRID_SIZE * 3;
        defaultWidth = constants.GRID_SIZE * 18;
        defaultHeight = constants.GRID_SIZE * 4;
    } else if (block.type === 'title') {
        minWidth = constants.GRID_SIZE * 6;
        minHeight = constants.GRID_SIZE * 4;
        defaultWidth = constants.GRID_SIZE * 14;
        defaultHeight = constants.GRID_SIZE * 4;
    } else if (block.type === 'image') {
        minWidth = constants.GRID_SIZE * 4;
        minHeight = constants.GRID_SIZE * 4;
        defaultWidth = constants.GRID_SIZE * 12;
        defaultHeight = constants.GRID_SIZE * 8;
        preserveRatio = true;
    } else if (block.type === 'audio') {
        minWidth = constants.GRID_SIZE * 14;
        minHeight = constants.GRID_SIZE * 5;
        defaultWidth = constants.GRID_SIZE * 22;
        defaultHeight = constants.GRID_SIZE * 8;
    } else if (block.type === 'video') {
        minWidth = constants.GRID_SIZE * 6;
        minHeight = constants.GRID_SIZE * 4;
        defaultWidth = constants.GRID_SIZE * 26;
        defaultHeight = constants.GRID_SIZE * 18;
        preserveRatio = true;
    } else if (block.type === 'animated3d') {
        minWidth = constants.GRID_SIZE * 16;
        minHeight = constants.GRID_SIZE * 10;
        defaultWidth = constants.GRID_SIZE * 26;
        defaultHeight = constants.GRID_SIZE * 18;
    } else if (block.type === 'link') {
        minWidth = constants.GRID_SIZE * 10;
        minHeight = constants.GRID_SIZE * 5;
        defaultWidth = constants.GRID_SIZE * 14;
        defaultHeight = constants.GRID_SIZE * 6;
    } else if (block.type === 'youtube') {
        minWidth = constants.GRID_SIZE * 20;
        minHeight = constants.GRID_SIZE * 12;
        defaultWidth = constants.GRID_SIZE * 26;
        defaultHeight = constants.GRID_SIZE * 16;
        preserveRatio = true;
        if (typeof block.url === 'string') {
            block.url = block.url.trim();
        }
        const existingVideoId = typeof block.videoId === 'string' ? block.videoId.trim() : '';
        const parsedVideoId = existingVideoId || extractYoutubeVideoId(block.url);
        block.videoId = parsedVideoId;
    } else if (block.type === 'board-link') {
        minWidth = constants.GRID_SIZE * 3;
        minHeight = constants.GRID_SIZE * 3;
        const existingWidth = Number(block.width);
        const existingHeight = Number(block.height);
        defaultWidth = Number.isFinite(existingWidth) && existingWidth > 0 ? existingWidth : minWidth;
        defaultHeight = Number.isFinite(existingHeight) && existingHeight > 0 ? existingHeight : minHeight;
    } else if (block.type === 'arrow') {
        minWidth = constants.GRID_SIZE * 2;
        minHeight = constants.GRID_SIZE * 2;
        defaultWidth = constants.GRID_SIZE * 8;
        defaultHeight = constants.GRID_SIZE * 4;
    } else if (block.type === 'creation') {
        minWidth = constants.GRID_SIZE * 11;
        minHeight = constants.GRID_SIZE * 22;
        defaultWidth = constants.GRID_SIZE * 13;
        defaultHeight = constants.GRID_SIZE * 22;
    }
    if (block.type === 'arrow' && env.blocks.arrow?.syncBlockGeometry) {
        env.blocks.arrow.syncBlockGeometry(block);
        delete block.color;
    } else if (block.type === 'board-link') {
        const width = Math.max(block.width || defaultWidth, minWidth);
        const height = Math.max(block.height || defaultHeight, minHeight);
        block.width = utils.snapToGrid(width);
        block.height = utils.snapToGrid(height);
    } else {
        block.width = Math.max(block.width || defaultWidth, minWidth);
        block.height = Math.max(block.height || defaultHeight, minHeight);
    }
    if (allowFreeformGeometry) {
        block.x = Math.round(Number(block.x) || 0);
        block.y = Math.round(Number(block.y) || 0);
        block.width = Math.max(minWidth, Math.round(Number(block.width) || defaultWidth));
        block.height = Math.max(minHeight, Math.round(Number(block.height) || defaultHeight));
    } else {
        const snappedPosition = utils.snapPointToGrid({ x: block.x, y: block.y });
        const snappedSize = utils.snapDimensionsToGrid(block.width, block.height, {
            preserveRatio,
            minWidthCells: Math.max(Math.round(minWidth / constants.GRID_SIZE), 1),
            minHeightCells: Math.max(Math.round(minHeight / constants.GRID_SIZE), 1)
        });
        block.x = snappedPosition.x;
        block.y = snappedPosition.y;
        block.width = snappedSize.width;
        block.height = snappedSize.height;
    }
    if (block.type === 'image') {
        block.showBorder = block.showBorder !== false;
        block.opaqueBackground = block.opaqueBackground === true;
        if (env.blocks.image?.resolveCaptionState) {
            const caption = env.blocks.image.resolveCaptionState(block);
            if (caption.enabled || caption.text || caption.placement !== 'below' || caption.visibility !== 'always' || caption.extendBorder) {
                block.caption = caption;
            } else {
                delete block.caption;
            }
        } else {
            delete block.caption;
        }
    }
    if (block.type === 'title') {
        block.showBorder = !!block.showBorder;
        block.showShadow = !!block.showShadow;
        block.showUnderline = !!block.showUnderline;
        if (block.showUnderline) {
            block.showBorder = false;
        }
        const layoutMode = block.layoutMode === 'manual' ? 'manual' : 'auto';
        block.layoutMode = layoutMode;
        const manualWidth = Number(block.manualWidth);
        const manualHeight = Number(block.manualHeight);
        const resolvedManualWidth = Number.isFinite(manualWidth) && manualWidth > 0 ? utils.snapToGrid(manualWidth) : null;
        const resolvedManualHeight = Number.isFinite(manualHeight) && manualHeight > 0 ? utils.snapToGrid(manualHeight) : null;
        if (layoutMode === 'manual') {
            block.manualWidth = resolvedManualWidth;
            block.manualHeight = resolvedManualHeight;
        } else {
            block.manualWidth = null;
            block.manualHeight = null;
        }
    } else if (block.type === 'text') {
        const layoutMode = block.layoutMode === 'manual' ? 'manual' : 'auto';
        block.layoutMode = layoutMode;
        const manualWidth = Number(block.manualWidth);
        const manualHeight = Number(block.manualHeight);
        if (layoutMode === 'manual') {
            block.manualWidth = Number.isFinite(manualWidth) && manualWidth > 0 ? utils.snapToGrid(manualWidth) : null;
            block.manualHeight = Number.isFinite(manualHeight) && manualHeight > 0 ? utils.snapToGrid(manualHeight) : null;
        } else {
            block.manualWidth = null;
            block.manualHeight = null;
        }
    }
    if (block.type === 'text' || block.type === 'title') {
        const scaleCandidate = Number(block.fontScale);
        block.fontScale = Number.isFinite(scaleCandidate) && scaleCandidate > 0.2 ? scaleCandidate : 1;
        if (typeof block.smallCaps !== 'boolean') {
            delete block.smallCaps;
        }
    }
    if (block.type === 'youtube' && !block.videoId) {
        block.videoId = extractYoutubeVideoId(block.url);
    }
    if (block.type === 'creation') {
        block.fields = createDefaultCreationFields(block.fields, block);
        // Old random-tint keys, the card background is fixed now.
        delete block.creationHue;
        delete block.creationSaturation;
        CREATION_FIELD_KEYS.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(block, key)) {
                delete block[key];
            }
        });
    }
    block.createdAt = block.createdAt || new Date().toISOString();
    block.updatedAt = block.updatedAt || block.createdAt;
}

const BACKUP_SKIP_REASONS = new Set([
    'block-move',
    'blocks-duplicate-drag',
    'blocks-duplicate-move',
    'block-resize',
    'block-scale',
    'viewport',
    'scale-changed',
    'zoom-to-fit',
    'board-navigate',
    'board-preview',
    'text-edit',
    'creation-edit',
    'text-trim-height',
    'link-title',
    'video-title',
    'audio-title',
    'youtube-videoid-refresh',
    'image-border-toggle',
    'image-caption-edit',
    'image-caption-toggle',
    'image-caption-placement',
    'image-caption-visibility',
    'image-caption-border-extend',
    'title-border-toggle',
    'title-shadow-toggle',
    'title-underline-toggle',
    'block-small-caps-toggle',
    'board-icon-size',
    'board-icon-mode',
    'board-icon-custom'
]);

const PREVIEW_DIRTY_REASONS = new Set([
    'block-move',
    'blocks-duplicate-drag',
    'blocks-duplicate-move',
    'block-resize',
    'block-scale',
    'block-delete',
    'blocks-delete',
    'blocks-paste',
    'blocks-cut',
    'blocks-move-to-board',
    'text-edit',
    'creation-edit',
    'text-trim-height',
    'image-added',
    'audio-added',
    'video-added',
    'creation-added',
    'link-title',
    'video-title',
    'audio-title',
    'youtube-videoid-refresh',
    'board-created',
    'board-rename-inline'
]);

const HISTORY_SKIP_REASONS = new Set([
    'viewport',
    'scale-changed',
    'zoom-to-fit',
    'board-navigate',
    'board-preview',
    'text-edit',
    'creation-edit'
]);

const COMPACT_SAVE_REASONS = new Set([
    'block-move',
    'blocks-duplicate-drag',
    'blocks-duplicate-move',
    'block-resize',
    'block-scale',
    'viewport',
    'scale-changed',
    'zoom-to-fit',
    'board-navigate',
    'board-preview',
    'text-edit',
    'creation-edit'
]);

const SAVE_DELAY_OVERRIDES = new Map([
    ['block-move', 900],
    ['blocks-duplicate-drag', 900],
    ['blocks-duplicate-move', 900],
    ['block-resize', 900],
    ['block-scale', 900],
    ['viewport', 900],
    ['scale-changed', 900],
    ['zoom-to-fit', 900],
    ['board-navigate', 700],
    ['text-edit', 700],
    ['creation-edit', 700]
]);

function shouldQueueBackup(reason) {
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (!key) {
        return true;
    }
    return !BACKUP_SKIP_REASONS.has(key);
}

function shouldRecordHistory(reason) {
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (!key) {
        return true;
    }
    return !HISTORY_SKIP_REASONS.has(key);
}

function shouldUseCompactSave(reason) {
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (!key) {
        return false;
    }
    return COMPACT_SAVE_REASONS.has(key);
}

function shouldWriteSettings(reason) {
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (!key) {
        return true;
    }
    if (key === 'settings-update') {
        return true;
    }
    if (key.startsWith('settings-')) {
        return true;
    }
    if (key.startsWith('backup-folder')) {
        return true;
    }
    if (key.startsWith('data-folder')) {
        return true;
    }
    return false;
}

function resolveSaveDelay(reason) {
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (!key) {
        return constants.AUTO_SAVE_DELAY;
    }
    return SAVE_DELAY_OVERRIDES.get(key) || constants.AUTO_SAVE_DELAY;
}

function viewportSnapshotKey(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return '';
    }
    const scale = Number(snapshot.scale);
    const scrollX = Number(snapshot.scrollX);
    const scrollY = Number(snapshot.scrollY);
    const viewportWidth = Number(snapshot.viewportWidth);
    const viewportHeight = Number(snapshot.viewportHeight);
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const safeX = Number.isFinite(scrollX) ? scrollX : 0;
    const safeY = Number.isFinite(scrollY) ? scrollY : 0;
    const safeWidth = Number.isFinite(viewportWidth) && viewportWidth > 0 ? Math.round(viewportWidth) : 0;
    const safeHeight = Number.isFinite(viewportHeight) && viewportHeight > 0 ? Math.round(viewportHeight) : 0;
    return `${safeScale.toFixed(5)}:${Math.round(safeX)}:${Math.round(safeY)}:${safeWidth}:${safeHeight}`;
}

function summarizeViewportForLog(snapshot) {
    const safe = sanitizeViewport(snapshot || {});
    return {
        scale: Number((Number(safe.scale) || 1).toFixed(5)),
        scrollX: Math.round(Number(safe.scrollX) || 0),
        scrollY: Math.round(Number(safe.scrollY) || 0),
        viewportWidth: Math.round(Number(safe.viewportWidth) || 0),
        viewportHeight: Math.round(Number(safe.viewportHeight) || 0)
    };
}

// MARK: Persistence Queue
function queueSave(reason) {
    clearTimeout(state.saveTimer);
    const currentBoardId = state.currentBoardId;
    const key = typeof reason === 'string' ? reason.trim() : '';
    if (currentBoardId && PREVIEW_DIRTY_REASONS.has(key)) {
        state.previewDirtyBoards?.add(currentBoardId);
    }
    try {
        if (shouldRecordHistory(reason) && env.history && typeof env.history.record === 'function') {
            env.history.record(reason);
        }
    } catch {}
    const delay = resolveSaveDelay(reason);
    const attemptPersist = () => {
        if (state.dragState || state.resizeState || state.scaleState) {
            state.saveTimer = setTimeout(attemptPersist, 200);
            return;
        }
        persistBoardData(false, reason);
    };
    state.saveTimer = setTimeout(attemptPersist, delay);
}

function clearViewportSaveTimers() {
    if (state.viewportSaveTimer) {
        clearTimeout(state.viewportSaveTimer);
        state.viewportSaveTimer = null;
    }
    if (state.viewportSaveMaxTimer) {
        clearTimeout(state.viewportSaveMaxTimer);
        state.viewportSaveMaxTimer = null;
    }
    state.viewportSaveFirstQueuedAt = 0;
}

function clearPendingPersistTimers() {
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
    }
    if (state.saveMaxTimer) {
        clearTimeout(state.saveMaxTimer);
        state.saveMaxTimer = null;
    }
    state.saveFirstQueuedAt = 0;
    clearViewportSaveTimers();
}

function queueViewportSave(options = {}) {
    const normalized = options && typeof options === 'object' ? options : {};
    const reason = 'viewport';
    const delay = resolveSaveDelay(reason);
    const maxWaitMs = Number.isFinite(normalized.maxWaitMs) ? Math.max(0, Math.round(normalized.maxWaitMs)) : 1000;

    const attemptPersist = () => {
        if (state.dragState || state.resizeState || state.scaleState) {
            state.viewportSaveTimer = setTimeout(attemptPersist, 200);
            return;
        }
        try {
            updateViewportState();
            const board = state.boardData?.boards?.[state.currentBoardId];
            const snapshot = board?.viewport || state.boardData?.viewport || sanitizeViewport();
            const key = viewportSnapshotKey(snapshot);
            if (key && key === state.lastViewportPersistKey) {
                clearViewportSaveTimers();
                return;
            }
            state.lastViewportPersistKey = key;
        } catch {}
        clearViewportSaveTimers();
        persistBoardData(false, reason);
    };

    clearTimeout(state.viewportSaveTimer);
    state.viewportSaveTimer = setTimeout(() => {
        state.viewportSaveTimer = null;
        attemptPersist();
    }, delay);

    if (maxWaitMs > 0) {
        const now = Date.now();
        if (!state.viewportSaveFirstQueuedAt) {
            state.viewportSaveFirstQueuedAt = now;
        }
        if (!state.viewportSaveMaxTimer) {
            state.viewportSaveMaxTimer = setTimeout(() => {
                state.viewportSaveMaxTimer = null;
                attemptPersist();
            }, maxWaitMs);
        }
    }
}

// MARK: Settings Schema
function defaultSettings() {
    return {
        backgroundColor: '#1f1f1f',
        dotColor: '#dff1f7',
        dotOpacity: 0.26,
        dotSize: 0.7,
        majorDotScale: 1.65,
        majorGridSpacing: 10,
        majorGridPattern: 0,
        accentColor: '#f7f0ff',
        accentTone: 1.26,
        blockRadius: 8,
        arrowWidthScale: 0.49,
        blockShadowColor: '#000000',
        blockShadowIntensity: 0.42,
        blockShadowBlur: 50,
        blockDragShadowColor: '#000000',
        blockDragShadowIntensity: 0.7,
        blockDragShadowBlur: 30,
        textBlockPadding: 20,
        boardRadius: 10,
        zoomSpeed: 1,
        selectionScaleBoost: 0.03,
        resizeHandleSize: 30,
        textFontFamily: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
        titleFontFamily: "'Spectral', 'Times New Roman', serif",
        textFontScale: 1.15,
        titleFontScale: 1.25,
        textLetterSpacing: 1,
        textWordSpacing: 0,
        textLineHeight: 1.5,
        titleLetterSpacing: 4,
        titleWordSpacing: 0,
        titleLineHeight: 1.2,
        titleSmallCaps: false,
        textEditShadowColor: '#000000',
        textEditShadowIntensity: 0.2,
        textEditShadowBlur: 47,
        linkUrlMaxLines: 2,
        backupDirectory: ''
    };
}

// MARK: Settings Sanitization
function sanitizeSettings(raw) {
    const defaults = defaultSettings();
    const source = raw && typeof raw === 'object' ? raw : {};
    const parsed = { ...defaults };
    if (typeof source.backgroundColor === 'string') {
        parsed.backgroundColor = source.backgroundColor;
    }
    if (typeof source.dotColor === 'string') {
        parsed.dotColor = source.dotColor;
    }
    if (typeof source.accentColor === 'string') {
        parsed.accentColor = source.accentColor;
    }
    if (typeof source.blockShadowColor === 'string') {
        const candidate = source.blockShadowColor.trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate)) {
            parsed.blockShadowColor = candidate;
        }
    }
    const dotOpacity = Number(source.dotOpacity);
    if (Number.isFinite(dotOpacity)) {
        parsed.dotOpacity = Math.min(Math.max(dotOpacity, 0.02), 1);
    }
    const dotSize = Number(source.dotSize);
    if (Number.isFinite(dotSize)) {
        parsed.dotSize = Math.min(Math.max(dotSize, 0.05), 6);
    }
    const majorDotScale = Number(source.majorDotScale);
    if (Number.isFinite(majorDotScale)) {
        parsed.majorDotScale = Math.min(Math.max(majorDotScale, 1), 4);
    }
    const majorGridPattern = Number(source.majorGridPattern ?? defaults.majorGridPattern);
    if (Number.isFinite(majorGridPattern)) {
        parsed.majorGridPattern = utils.clamp(Math.round(majorGridPattern), 0, 5);
    } else {
        parsed.majorGridPattern = defaults.majorGridPattern ?? 0;
    }
    const majorGridSpacing = Number(source.majorGridSpacing ?? defaults.majorGridSpacing);
    if (Number.isFinite(majorGridSpacing)) {
        parsed.majorGridSpacing = utils.clamp(Math.round(majorGridSpacing), 2, 12);
    } else {
        parsed.majorGridSpacing = defaults.majorGridSpacing ?? 4;
    }
    const accentTone = Number(source.accentTone);
    if (Number.isFinite(accentTone)) {
        parsed.accentTone = Math.min(Math.max(accentTone, 0.6), 1.6);
    }
    const blockRadius = Number(source.blockRadius);
    if (Number.isFinite(blockRadius)) {
        parsed.blockRadius = Math.min(Math.max(blockRadius, 0), 72);
    }
    const arrowWidthScale = Number(source.arrowWidthScale);
    if (Number.isFinite(arrowWidthScale)) {
        parsed.arrowWidthScale = Math.min(Math.max(Math.abs(arrowWidthScale - 0.7) <= 0.0001 ? 0.49 : arrowWidthScale, 0.35), 1.8);
    }
    const shadowIntensity = Number(source.blockShadowIntensity ?? source.blockShadowStrength);
    if (Number.isFinite(shadowIntensity)) {
        parsed.blockShadowIntensity = Math.min(Math.max(shadowIntensity, 0), 1);
    }
    if (typeof source.blockDragShadowColor === 'string') {
        const candidate = source.blockDragShadowColor.trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate)) {
            parsed.blockDragShadowColor = candidate;
        }
    }
    const dragShadowIntensity = Number(source.blockDragShadowIntensity ?? defaults.blockDragShadowIntensity);
    if (Number.isFinite(dragShadowIntensity)) {
        parsed.blockDragShadowIntensity = Math.min(Math.max(dragShadowIntensity, 0), 1);
    }
    const blockShadowBlur = Number(source.blockShadowBlur ?? defaults.blockShadowBlur);
    if (Number.isFinite(blockShadowBlur)) {
        parsed.blockShadowBlur = Math.max(0, Math.round(blockShadowBlur));
    }
    const dragShadowBlur = Number(source.blockDragShadowBlur ?? defaults.blockDragShadowBlur);
    if (Number.isFinite(dragShadowBlur)) {
        parsed.blockDragShadowBlur = Math.max(0, Math.round(dragShadowBlur));
    }
    const boardRadius = Number(source.boardRadius);
    if (Number.isFinite(boardRadius)) {
        parsed.boardRadius = Math.min(Math.max(boardRadius, 0), 90);
    }
    const zoomSpeed = Number(source.zoomSpeed);
    if (Number.isFinite(zoomSpeed)) {
        parsed.zoomSpeed = Math.min(Math.max(zoomSpeed, 0.3), 2.5);
    }
    const selectionBoost = Number(source.selectionScaleBoost);
    if (Number.isFinite(selectionBoost)) {
        parsed.selectionScaleBoost = Math.min(Math.max(selectionBoost, 0), 0.24);
    }
    const handleSize = Number(source.resizeHandleSize ?? defaults.resizeHandleSize);
    if (Number.isFinite(handleSize)) {
        parsed.resizeHandleSize = Math.min(Math.max(Math.round(handleSize), 20), 80);
    }
    const textFontFamily = typeof source.textFontFamily === 'string' ? source.textFontFamily.trim() : defaults.textFontFamily;
    if (ALLOWED_TEXT_FONTS.includes(textFontFamily)) {
        parsed.textFontFamily = textFontFamily;
    }
    const titleFontFamily = typeof source.titleFontFamily === 'string' ? source.titleFontFamily.trim() : defaults.titleFontFamily;
    if (ALLOWED_TITLE_FONTS.includes(titleFontFamily)) {
        parsed.titleFontFamily = titleFontFamily;
    }
    const textFontScale = Number(source.textFontScale);
    if (Number.isFinite(textFontScale)) {
        parsed.textFontScale = Math.min(Math.max(textFontScale, 0.5), 2.6);
    }
    const titleFontScale = Number(source.titleFontScale);
    if (Number.isFinite(titleFontScale)) {
        parsed.titleFontScale = Math.min(Math.max(titleFontScale, 0.5), 3.2);
    }
    const linkUrlLines = Number(source.linkUrlMaxLines ?? source.linkUrlLines ?? defaults.linkUrlMaxLines);
    if (Number.isFinite(linkUrlLines)) {
        parsed.linkUrlMaxLines = Math.min(Math.max(Math.round(linkUrlLines), 1), 6);
    }
    const textLetterSpacing = Number(source.textLetterSpacing ?? defaults.textLetterSpacing);
    if (Number.isFinite(textLetterSpacing)) {
        parsed.textLetterSpacing = utils.clamp(textLetterSpacing, -2, 10);
    }
    const textWordSpacing = Number(source.textWordSpacing ?? defaults.textWordSpacing);
    if (Number.isFinite(textWordSpacing)) {
        parsed.textWordSpacing = utils.clamp(textWordSpacing, -1, 16);
    }
    const textLineHeight = Number(source.textLineHeight ?? defaults.textLineHeight);
    if (Number.isFinite(textLineHeight)) {
        parsed.textLineHeight = utils.clamp(textLineHeight, 1, 2.6);
    }
    const textBlockPadding = Number(source.textBlockPadding ?? defaults.textBlockPadding);
    if (Number.isFinite(textBlockPadding)) {
        parsed.textBlockPadding = utils.clamp(textBlockPadding, 4, 80);
    }
    const titleLetterSpacing = Number(source.titleLetterSpacing ?? defaults.titleLetterSpacing);
    if (Number.isFinite(titleLetterSpacing)) {
        parsed.titleLetterSpacing = utils.clamp(titleLetterSpacing, -2, 12);
    }
    const titleWordSpacing = Number(source.titleWordSpacing ?? defaults.titleWordSpacing);
    if (Number.isFinite(titleWordSpacing)) {
        parsed.titleWordSpacing = utils.clamp(titleWordSpacing, -1, 20);
    }
    const titleLineHeight = Number(source.titleLineHeight ?? defaults.titleLineHeight);
    if (Number.isFinite(titleLineHeight)) {
        parsed.titleLineHeight = utils.clamp(titleLineHeight, 0.8, 2.4);
    }
    if (typeof source.titleSmallCaps === 'boolean') {
        parsed.titleSmallCaps = source.titleSmallCaps;
    }
    if (typeof source.textEditShadowColor === 'string') {
        const candidate = source.textEditShadowColor.trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate)) {
            parsed.textEditShadowColor = candidate;
        }
    }
    const textEditShadowIntensity = Number(source.textEditShadowIntensity ?? defaults.textEditShadowIntensity);
    if (Number.isFinite(textEditShadowIntensity)) {
        parsed.textEditShadowIntensity = utils.clamp(textEditShadowIntensity, 0, 1);
    }
    const textEditShadowBlur = Number(source.textEditShadowBlur ?? defaults.textEditShadowBlur);
    if (Number.isFinite(textEditShadowBlur)) {
        parsed.textEditShadowBlur = utils.clamp(Math.round(textEditShadowBlur), 0, 120);
    }

    if (typeof source.backupDirectory === 'string') {
        parsed.backupDirectory = source.backupDirectory.trim();
    } else {
        parsed.backupDirectory = defaults.backupDirectory || '';
    }
    return parsed;
}

function persistBoardData(sync = false, reason = '') {
    if (!state.boardData) {
        return;
    }
    try {
        const persistGeneration = Number(state.persistGeneration || 0) + 1;
        state.persistGeneration = persistGeneration;
        const isCurrentPersistGeneration = () => persistGeneration === Number(state.persistGeneration || 0);
        const perf = env.utils?.perf;
        const t0 = perf ? perf.now() : 0;
        const t0Wall = perf ? 0 : Date.now();
        if (sync) {
            clearPendingPersistTimers();
        }
        if (sync && shouldSkipStaleSyncPersist(reason)) {
            const loadedMtime = Number(state.boardDataDiskMtimeMs) || 0;
            const diskMtime = getBoardsFileMtimeMs();
            console.warn('Skipped stale board save before reload because disk has newer board data', {
                reason,
                loadedMtimeMs: Number(loadedMtime.toFixed(1)),
                diskMtimeMs: Number(diskMtime.toFixed(1))
            });
            state.boardDataDiskMtimeMs = diskMtime;
            return;
        }
        updateViewportState({
            force: sync,
            reason: reason ? `persist-${reason}` : (sync ? 'persist-sync' : '')
        });
        ensureDataDirectories();
        const sanitizedSettings = sanitizeSettings(state.boardData.settings || {});
        state.boardData.settings = sanitizedSettings;
        const { settings, ...boardsPayload } = state.boardData;
        const useCompact = shouldUseCompactSave(reason);
        const spacing = useCompact ? 0 : 2;
        const serializeBoardsStart = perf ? perf.now() : 0;
        const serializedBoards = JSON.stringify(boardsPayload, null, spacing);
        const serializeBoardsMs = perf ? (perf.now() - serializeBoardsStart) : 0;
        const writeSettings = shouldWriteSettings(reason);
        const serializeSettingsStart = perf ? perf.now() : 0;
        const serializedSettings = writeSettings ? JSON.stringify(sanitizedSettings, null, spacing) : '';
        const serializeSettingsMs = perf ? (perf.now() - serializeSettingsStart) : 0;
        const invokeBackups = () => {
            if (env.backups && typeof env.backups.reconcileSettings === 'function') {
                env.backups.reconcileSettings(sanitizedSettings);
            }
            const backupReason = reason || 'board-save';
            if (env.backups && typeof env.backups.queueBoardBackup === 'function' && shouldQueueBackup(backupReason)) {
                env.backups.queueBoardBackup(backupReason);
            }
        };
        const logSave = (totalMs) => {
            if (!reason) {
                return;
            }
            const activeBoard = state.boardData?.boards?.[state.currentBoardId];
            console.debug('Board data saved', {
                reason,
                sync,
                writeMode: sync ? 'sync-explicit' : 'sync-debounced',
                boardId: state.currentBoardId || '',
                viewport: summarizeViewportForLog(activeBoard?.viewport || state.boardData?.viewport || {}),
                durationMs: Number(totalMs.toFixed(1)),
                boardsBytes: serializedBoards.length,
                settingsBytes: writeSettings ? serializedSettings.length : 0,
                serializeBoardsMs: Number(serializeBoardsMs.toFixed(1)),
                serializeSettingsMs: Number(serializeSettingsMs.toFixed(1))
            });
        };
        if (sync) {
            atomicWriteFileSync(paths.boardsFilePath, serializedBoards);
            markBoardsFileMtime();
            if (writeSettings) {
                atomicWriteFileSync(paths.settingsFilePath, serializedSettings);
            }
            invokeBackups();
            if (perf) {
                logSave(perf.now() - t0);
            } else {
                logSave(Date.now() - t0Wall);
            }
        } else {
            atomicWriteFileSync(paths.boardsFilePath, serializedBoards);
            markBoardsFileMtime();
            if (writeSettings) {
                atomicWriteFileSync(paths.settingsFilePath, serializedSettings);
            }
            invokeBackups();
            if (perf) {
                logSave(perf.now() - t0);
            } else {
                logSave(Date.now() - t0Wall);
            }
        }
        if (perf) {
            perf.logIfSlow('persistBoardData.serialize', (perf.now() - t0), {
                reason: reason || 'board-save',
                boardsBytes: serializedBoards.length,
                settingsBytes: writeSettings ? serializedSettings.length : 0,
                serializeBoardsMs: Number(serializeBoardsMs.toFixed(1)),
                serializeSettingsMs: Number(serializeSettingsMs.toFixed(1))
            });
        }
    } catch (error) {
        console.error('Failed to persist board data', error);
    }
}

function saveClipboardSnapshot(snapshot) {
    try {
        ensureDataDirectories();
        if (!snapshot) {
            if (fs.existsSync(paths.clipboardFilePath)) {
                fs.unlinkSync(paths.clipboardFilePath);
            }
            return;
        }
        atomicWriteFileSync(paths.clipboardFilePath, JSON.stringify({ snapshot }, null, 2));
    } catch (error) {
        console.error('Failed to persist clipboard snapshot', error);
    }
}

function loadClipboardSnapshot() {
    try {
        if (!fs.existsSync(paths.clipboardFilePath)) {
            return null;
        }
        const raw = fs.readFileSync(paths.clipboardFilePath, 'utf8');
        if (!raw.trim()) {
            return null;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        const snapshot = parsed.snapshot;
        if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) {
            return null;
        }
        return snapshot;
    } catch (error) {
        console.error('Failed to load clipboard snapshot', error);
        return null;
    }
}

function updateViewportState(options = {}) {
    const { boardContainer } = env.dom;
    const normalized = options && typeof options === 'object' ? options : {};
    const force = normalized.force === true;
    const reason = typeof normalized.reason === 'string' ? normalized.reason.trim() : '';
    if (!boardContainer || !state.boardData) {
        return;
    }
    if (!force && (state.viewportSyncSuspended || 0) > 0) {
        return;
    }
    const viewportWidth = boardContainer.clientWidth || 0;
    const viewportHeight = boardContainer.clientHeight || 0;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
        return;
    }
    let pad = null;
    if (typeof window !== 'undefined') {
        try {
            const raw = window.getComputedStyle(boardContainer).getPropertyValue('--canvas-pad');
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed) && parsed >= 0) {
                pad = parsed;
            }
        } catch {}
    }
    if (!Number.isFinite(pad)) {
        pad = Number.isFinite(state.canvasPad)
            ? state.canvasPad
            : (env.movement?.getCanvasPad ? env.movement.getCanvasPad() : Math.max(env.constants.CANVAS_MARGIN || 600, env.constants.GRID_SIZE * 8, boardContainer.clientWidth || 0, boardContainer.clientHeight || 0));
    }
    const snapshot = sanitizeViewport({
        scale: state.boardScale,
        scrollX: boardContainer.scrollLeft - pad,
        scrollY: boardContainer.scrollTop - pad,
        viewportWidth,
        viewportHeight
    });
    const board = state.boardData.boards?.[state.currentBoardId];
    const previousSnapshot = board?.viewport || state.boardData.viewport || null;
    const previousKey = viewportSnapshotKey(previousSnapshot);
    const nextKey = viewportSnapshotKey(snapshot);
    state.boardData.viewport = { ...snapshot };
    if (board) {
        board.viewport = { ...snapshot };
        board.updatedAt = new Date().toISOString();
    }
    state.boardData.activeBoardId = state.currentBoardId;
    if (reason) {
        console.debug('Viewport state captured', {
            reason,
            boardId: state.currentBoardId || '',
            force,
            changed: previousKey !== nextKey,
            suspendedDepth: state.viewportSyncSuspended || 0,
            viewport: summarizeViewportForLog(snapshot)
        });
    }
}

function collectReferencedAssetNames(sourceDataArg) {
    const referenced = new Set();
    const sourceData = sourceDataArg || state.boardData || loadBoardData();
    const boards = sourceData?.boards || {};
    const addReference = (candidate, type) => {
        const normalized = normalizeAssetReference(candidate);
        if (!normalized) {
            return;
        }
        referenced.add(normalized);
        referenced.add(`assets/${normalized}`);
        if (type === 'image' && !normalized.includes('/')) {
            referenced.add(`images/${normalized}`);
            referenced.add(`assets/images/${normalized}`);
        }
        if (type === 'audio' && !normalized.includes('/')) {
            referenced.add(`audio/${normalized}`);
            referenced.add(`assets/audio/${normalized}`);
        }
        if (type === 'video' && !normalized.includes('/')) {
            referenced.add(`video/${normalized}`);
            referenced.add(`assets/video/${normalized}`);
        }
    };
    Object.values(boards).forEach((board) => {
        const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
        blocks.forEach((block) => {
            if (!block || typeof block !== 'object') {
                return;
            }
            if ((block.type === 'image' || block.type === 'audio' || block.type === 'video') && block.assetName) {
                addReference(block.assetName, block.type);
            }
            if (block.type === 'animated3d' && block.packageRef) {
                getAnimated3dPackageReferences(block.packageRef).forEach((assetName) => addReference(assetName, 'animated3d'));
            }
        });
    });
    return referenced;
}

function listAssetFiles(rootDir) {
    const files = [];
    if (!rootDir || !fs.existsSync(rootDir)) {
        return files;
    }
    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (error) {
            console.error('Failed to read asset directory', { path: current, error });
            continue;
        }
        entries.forEach((entry) => {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(entryPath);
            } else if (entry.isFile()) {
                files.push(entryPath);
            }
        });
    }
    return files;
}

let assetIndexCache = null;

function invalidateAssetIndex() {
    assetIndexCache = null;
}

function buildAssetIndex() {
    const files = listAssetFiles(paths.assetsDir);
    const map = new Map();
    files.forEach((filePath) => {
        const relative = path.relative(paths.assetsDir, filePath).replace(/\\/g, '/');
        const fileName = path.basename(relative).toLowerCase();
        if (!fileName) {
            return;
        }
        if (!map.has(fileName)) {
            map.set(fileName, []);
        }
        map.get(fileName).push(relative);
    });
    return { files, map };
}

function getAssetIndex(options = {}) {
    if (!assetIndexCache || options.force) {
        assetIndexCache = buildAssetIndex();
    }
    return assetIndexCache;
}

function resolveAssetTargetPath(assetName) {
    const raw = typeof assetName === 'string' ? assetName.trim() : '';
    if (!raw) {
        return '';
    }
    const normalized = normalizeAssetReference(raw) || raw.replace(/\\/g, '/');
    const stripped = normalized.replace(/^assets\//, '');
    return path.join(paths.assetsDir, stripped.replace(/\//g, path.sep));
}

function selectPreferredAssetMatch(candidates, { type } = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return '';
    }
    if (!type) {
        return candidates[0];
    }
    const normalizedType = type.toLowerCase();
    const desiredPrefix = normalizedType === 'image' ? 'images/' : normalizedType === 'audio' ? 'audio/' : normalizedType === 'video' ? 'video/' : '';
    if (desiredPrefix) {
        const matched = candidates.find((candidate) => candidate.startsWith(desiredPrefix));
        if (matched) {
            return matched;
        }
    }
    return candidates[0];
}

function findAssetFilePath(assetName, options = {}) {
    const raw = typeof assetName === 'string' ? assetName.trim() : '';
    if (!raw) {
        return '';
    }
    const normalizedInput = raw.replace(/\\/g, '/');
    if (path.isAbsolute(normalizedInput) && fs.existsSync(normalizedInput)) {
        return normalizedInput;
    }
    const normalizedRelative = normalizeAssetReference(normalizedInput);
    const candidates = [];
    const addCandidate = (candidate) => {
        if (!candidate) {
            return;
        }
        if (!candidates.includes(candidate)) {
            candidates.push(candidate);
        }
    };
    if (normalizedRelative) {
        const stripped = normalizedRelative.replace(/^assets\//, '');
        addCandidate(path.join(paths.assetsDir, stripped.replace(/\//g, path.sep)));
        addCandidate(path.join(paths.dataDir, stripped.replace(/\//g, path.sep)));
        if (!normalizedRelative.includes('/')) {
            addCandidate(path.join(paths.imagesDir, stripped.replace(/\//g, path.sep)));
            addCandidate(path.join(paths.audioDir, stripped.replace(/\//g, path.sep)));
            addCandidate(path.join(paths.videoDir, stripped.replace(/\//g, path.sep)));
        }
    }
    if (normalizedInput.startsWith('assets/')) {
        const stripped = normalizedInput.slice('assets/'.length);
        addCandidate(path.join(paths.assetsDir, stripped.replace(/\//g, path.sep)));
    }
    addCandidate(path.join(paths.assetsDir, normalizedInput.replace(/\//g, path.sep)));
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    if (options.allowSearch === false) {
        return '';
    }
    const fileName = path.basename(normalizedRelative || normalizedInput || '').toLowerCase();
    if (!fileName) {
        return '';
    }
    const { map } = getAssetIndex();
    const matches = map.get(fileName) || [];
    const preferred = selectPreferredAssetMatch(matches, { type: options.type });
    if (!preferred) {
        return '';
    }
    return path.join(paths.assetsDir, preferred.replace(/\//g, path.sep));
}

function toAssetName(absolutePath) {
    if (!absolutePath) {
        return '';
    }
    const relative = path.relative(paths.assetsDir, absolutePath).replace(/\\/g, '/');
    return normalizeAssetReference(relative);
}

function refreshBlockData(options = {}) {
    try {
        ensureDataDirectories();
    } catch (error) {
        console.error('Failed to ensure data directories before refresh', error);
    }
    const forceIndex = options.forceIndex === true;
    invalidateAssetIndex();
    getAssetIndex({ force: forceIndex });
    const boardData = state.boardData || loadBoardData();
    const boards = boardData?.boards || {};
    const summary = {
        inspected: 0,
        repaired: 0,
        missing: 0,
        updatedBlocks: []
    };
    const now = new Date().toISOString();
    Object.values(boards).forEach((board) => {
        const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
        blocks.forEach((block) => {
            if (!block || typeof block !== 'object') {
                return;
            }
            if (block.type === 'animated3d') {
                summary.inspected += 1;
                const packageResult = resolveAnimated3dPackage(block.packageRef, { assetsDir: paths.assetsDir });
                if (!packageResult.ok) {
                    summary.missing += 1;
                    summary.updatedBlocks.push({ id: block.id, boardId: board.id, packageRef: block.packageRef || '', status: packageResult.reason || 'missing' });
                }
                return;
            }
            if (!block.assetName || (block.type !== 'image' && block.type !== 'audio' && block.type !== 'video')) {
                return;
            }
            summary.inspected += 1;
            const existingPath = findAssetFilePath(block.assetName, { type: block.type });
            if (existingPath && fs.existsSync(existingPath)) {
                const normalizedName = toAssetName(existingPath);
                if (normalizedName && normalizedName !== block.assetName) {
                    block.assetName = normalizedName;
                    block.updatedAt = now;
                    summary.repaired += 1;
                    summary.updatedBlocks.push({ id: block.id, boardId: board.id, assetName: normalizedName });
                }
                return;
            }
            summary.missing += 1;
            summary.updatedBlocks.push({ id: block.id, boardId: board.id, assetName: block.assetName, status: 'missing' });
        });
    });
    if (summary.repaired > 0) {
        try {
            persistBoardData(false, 'refresh-block-data');
        } catch (error) {
            console.error('Failed to persist after block data refresh', error);
        }
    }
    return summary;
}

function deleteOrphanAssets(sourceDataArg) {
    ensureDataDirectories();
    const referenced = collectReferencedAssetNames(sourceDataArg);
    const files = listAssetFiles(paths.assetsDir);
    let removed = 0;
    let checked = 0;
    files.forEach((filePath) => {
        const relative = path.relative(paths.assetsDir, filePath).replace(/\\/g, '/');
        if (!relative) {
            return;
        }
        checked += 1;
        if (referenced.has(relative) || referenced.has(`assets/${relative}`)) {
            return;
        }
        try {
            fs.unlinkSync(filePath);
            removed += 1;
        } catch (error) {
            console.error('Failed to remove orphan asset', { filePath, error });
        }
    });
    console.info('Orphan asset cleanup complete', { removed, checked, referenced: referenced.size });
    invalidateAssetIndex();
    return { removed, checked, referenced: referenced.size };
}

env.data.ensureDataDirectories = ensureDataDirectories;
env.data.defaultBoardData = defaultBoardData;
env.data.loadBoardData = loadBoardData;
env.data.hydrateLoadedData = hydrateLoadedData;
env.data.resolveInitialBoardId = resolveInitialBoardId;
env.data.applyBlockDefaults = applyBlockDefaults;
env.data.queueSave = queueSave;
env.data.queueViewportSave = queueViewportSave;
env.data.persistBoardData = persistBoardData;
env.data.saveClipboardSnapshot = saveClipboardSnapshot;
env.data.loadClipboardSnapshot = loadClipboardSnapshot;
env.data.updateViewportState = updateViewportState;
env.data.defaultSettings = defaultSettings;
env.data.sanitizeSettings = sanitizeSettings;
env.data.sanitizeViewport = sanitizeViewport;
env.data.deleteOrphanAssets = deleteOrphanAssets;
env.data.collectReferencedAssetNames = collectReferencedAssetNames;
env.data.listAssetFiles = listAssetFiles;
env.data.invalidateAssetIndex = invalidateAssetIndex;
env.data.resolveAssetTargetPath = resolveAssetTargetPath;
env.data.findAssetFilePath = findAssetFilePath;
env.data.toAssetName = toAssetName;
env.data.refreshBlockData = refreshBlockData;

env.paths.ensureDataDirectories = ensureDataDirectories;

env.utils.queueSave = queueSave;

env.images = env.images || {};

module.exports = env;
