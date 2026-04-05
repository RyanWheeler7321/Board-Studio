'use strict';

// MARK: BOARD BACKUPS
const env = require('../core/state');
const { fs, path, data, state } = env;

const backupRuntime = {
    directory: '',
    queueHandle: null,
    running: false,
    pendingReason: '',
    initialized: false
};

function resolveDefaultDirectory() {
    const fallback = env.paths?.defaultBackupDir || path.join(env.paths.dataDir, 'backups');
    return path.resolve(fallback);
}

function normalizeAssetName(value) {
    if (!value) {
        return '';
    }
    const normalized = String(value).trim().replace(/\\/g, '/');
    return normalized.replace(/^assets\//, '');
}

function notifySettingsPanel() {
    if (env.management && typeof env.management.refreshDataSettingsUi === 'function') {
        env.management.refreshDataSettingsUi();
    }
}

async function ensureDirectory(target) {
    const resolved = path.resolve(target);
    try {
        await fs.promises.mkdir(resolved, { recursive: true });
        state.backupDirectoryReady = true;
    } catch (error) {
        state.backupDirectoryReady = false;
        console.error('Failed to ensure backup directory', { path: resolved, error });
        throw error;
    }
    return resolved;
}

function configureDirectory(candidate) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    const resolved = path.resolve(trimmed || resolveDefaultDirectory());
    backupRuntime.directory = resolved;
    env.paths.backupDir = resolved;
    state.backupDirectoryPath = resolved;
    ensureDirectory(resolved).then(() => {
        notifySettingsPanel();
    }).catch(() => {
        notifySettingsPanel();
    });
    return resolved;
}

function getDirectory() {
    if (backupRuntime.directory) {
        return backupRuntime.directory;
    }
    return resolveDefaultDirectory();
}

function queueBoardBackup(reason) {
    backupRuntime.pendingReason = reason || backupRuntime.pendingReason || 'auto';
    if (backupRuntime.queueHandle) {
        return;
    }
    backupRuntime.queueHandle = setTimeout(() => {
        backupRuntime.queueHandle = null;
        triggerBackups(backupRuntime.pendingReason);
        backupRuntime.pendingReason = '';
    }, 360);
}

function triggerBackups(reason) {
    if (backupRuntime.running) {
        backupRuntime.pendingReason = reason || backupRuntime.pendingReason || 'auto';
        return;
    }
    backupRuntime.running = true;
    const effectiveReason = reason || backupRuntime.pendingReason || 'auto';
    backupRuntime.pendingReason = '';
    runBackups(effectiveReason).catch((error) => {
        console.error('Board backup run failed', error);
    }).finally(() => {
        backupRuntime.running = false;
        if (backupRuntime.pendingReason) {
            const pending = backupRuntime.pendingReason;
            backupRuntime.pendingReason = '';
            queueBoardBackup(pending);
        }
    });
}

async function runBackups(reason) {
    const directory = getDirectory();
    try {
        await ensureDirectory(directory);
    } catch (error) {
        console.error('Board backup skipped: unable to prepare directory', { path: directory, error });
        return;
    }
    const boards = state.boardData?.boards;
    if (!boards) {
        return;
    }
    for (const boardId of Object.keys(boards)) {
        const board = boards[boardId];
        if (!board || typeof board !== 'object') {
            continue;
        }
        try {
            await backupBoard(board, directory);
        } catch (error) {
            console.error('Board backup failed', { boardId, error });
        }
    }
    if (reason && reason !== 'auto') {
        console.info('Board backups completed', { reason, directory });
    }
}

async function backupBoard(board, baseDir) {
    const boardDir = path.join(baseDir, board.id);
    await resetBoardDirectory(boardDir);
    await writeBoardPayload(boardDir, board);
    await backupAssets(board, boardDir);
}

async function resetBoardDirectory(boardDir) {
    try {
        await fs.promises.rm(boardDir, { recursive: true, force: true });
    } catch (error) {
        console.error('Failed to reset board backup directory', { boardDir, error });
    }
    await fs.promises.mkdir(boardDir, { recursive: true });
}

function buildBoardPayload(board) {
    const clone = JSON.parse(JSON.stringify(board));
    const ancestry = [];
    let parentId = board.parentId;
    while (parentId && state.boardData?.boards?.[parentId]) {
        const parent = state.boardData.boards[parentId];
        ancestry.unshift({ id: parent.id, title: parent.title });
        parentId = parent.parentId;
    }
    return {
        exportedAt: new Date().toISOString(),
        version: state.boardData?.version ?? 1,
        ancestry,
        board: clone
    };
}

async function writeBoardPayload(boardDir, board) {
    const payload = buildBoardPayload(board);
    const filePath = path.join(boardDir, 'board.json');
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2));
}

function collectBoardAssets(board) {
    const result = new Map();
    const blocks = Array.isArray(board.blocks) ? board.blocks : [];
    blocks.forEach((block) => {
        if (!block || typeof block !== 'object') {
            return;
        }
        if (!block.assetName) {
            return;
        }
        if (block.type !== 'image' && block.type !== 'audio' && block.type !== 'video') {
            return;
        }
        const key = normalizeAssetName(block.assetName) || block.assetName;
        if (!result.has(key)) {
            result.set(key, { assetName: block.assetName, type: block.type });
        }
    });
    return Array.from(result.values());
}

async function backupAssets(board, boardDir) {
    const entries = collectBoardAssets(board);
    if (!entries.length) {
        return;
    }
    for (const entry of entries) {
        const sourcePath = data.findAssetFilePath(entry.assetName, { type: entry.type });
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            console.warn('Board backup skipped missing asset', { boardId: board.id, assetName: entry.assetName });
            continue;
        }
        const normalized = normalizeAssetName(entry.assetName);
        const baseName = normalized || path.basename(sourcePath);
        let targetRelative = baseName;
        if (!targetRelative.includes('/')) {
            if (entry.type === 'image') {
                targetRelative = path.join('images', targetRelative);
            } else if (entry.type === 'audio') {
                targetRelative = path.join('audio', targetRelative);
            } else if (entry.type === 'video') {
                targetRelative = path.join('video', targetRelative);
            }
        }
        const targetPath = path.join(boardDir, 'assets', targetRelative);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, targetPath);
    }
}

function reconcileSettings(settings) {
    const configured = configureDirectory(settings?.backupDirectory || '');
    return configured;
}

function runImmediateBackup(reason) {
    triggerBackups(reason || 'manual');
}

function isReady() {
    return state.backupDirectoryReady === true;
}

function initialize() {
    if (backupRuntime.initialized) {
        return;
    }
    backupRuntime.initialized = true;
    configureDirectory('');
}

initialize();

env.backups = env.backups || {};
env.backups.configureDirectory = configureDirectory;
env.backups.getDirectory = getDirectory;
env.backups.queueBoardBackup = queueBoardBackup;
env.backups.runImmediateBackup = runImmediateBackup;
env.backups.reconcileSettings = reconcileSettings;
env.backups.isReady = isReady;

delayInitialBackup();

function delayInitialBackup() {
    if (!state.boardData) {
        return;
    }
    queueBoardBackup('startup');
}

module.exports = env;
