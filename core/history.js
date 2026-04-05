'use strict';

// MARK: UNDO/REDO HISTORY
const env = require('./state');
const perf = env.utils?.perf;

const MAX_HISTORY = 50;
const HISTORY_FILE_VERSION = 1;
const HISTORY_PERSIST_DELAY = 1200;
let pendingPersistTimer = null;

function sanitizeEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    if (!entry.snapshot || typeof entry.snapshot !== 'object') {
        return null;
    }
    const normalized = {
        snapshot: entry.snapshot,
        reason: entry.reason || 'unknown',
        timestamp: Number(entry.timestamp) || Date.now(),
        signature: entry.signature || computeSignature(entry.snapshot)
    };
    return normalized;
}

function loadHistoryFromDisk() {
    try {
        const filePath = env.paths?.historyFilePath;
        if (!filePath || !env.fs?.existsSync || !env.fs.existsSync(filePath)) {
            return { undo: [], redo: [], isApplying: false };
        }
        const raw = env.fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) {
            return { undo: [], redo: [], isApplying: false };
        }
        const parsed = JSON.parse(raw);
        const undo = Array.isArray(parsed?.undo) ? parsed.undo : [];
        const redo = Array.isArray(parsed?.redo) ? parsed.redo : [];
        const normalizedUndo = undo.map(sanitizeEntry).filter(Boolean);
        const normalizedRedo = redo.map(sanitizeEntry).filter(Boolean);
        return {
            undo: normalizedUndo.slice(-MAX_HISTORY),
            redo: normalizedRedo.slice(-MAX_HISTORY),
            isApplying: false
        };
    } catch (error) {
        console.error('Failed to load history file', error);
        return { undo: [], redo: [], isApplying: false };
    }
}

function persistHistory(history) {
    try {
        const t0 = perf ? perf.now() : 0;
        if (env.data?.ensureDataDirectories) {
            env.data.ensureDataDirectories();
        }
        const payload = {
            version: HISTORY_FILE_VERSION,
            undo: history.undo,
            redo: history.redo,
            savedAt: Date.now()
        };
        if (env.fs?.writeFileSync && env.paths?.historyFilePath) {
            env.fs.writeFileSync(env.paths.historyFilePath, JSON.stringify(payload, null, 2));
        }
        if (perf) {
            perf.logIfSlow('history.persist', perf.now() - t0, {
                undo: history.undo.length,
                redo: history.redo.length
            });
        }
    } catch (error) {
        console.error('Failed to persist history file', error);
    }
}

function queuePersistHistory(history) {
    if (pendingPersistTimer) {
        return;
    }
    pendingPersistTimer = setTimeout(() => {
        pendingPersistTimer = null;
        persistHistory(history);
    }, HISTORY_PERSIST_DELAY);
}

function cloneData(data) {
    try {
        return JSON.parse(JSON.stringify(data));
    } catch {
        return null;
    }
}

function computeSignature(snapshot) {
    try {
        const serialized = JSON.stringify(snapshot);
        return computeSignatureFromSerialized(serialized);
    } catch {
        return null;
    }
}

function computeSignatureFromSerialized(serialized) {
    try {
        let hash = 0;
        for (let index = 0; index < serialized.length; index += 1) {
            hash = ((hash << 5) - hash) + serialized.charCodeAt(index);
            hash |= 0;
        }
        return `${serialized.length}:${hash}`;
    } catch {
        return null;
    }
}

function createHistoryEntry(snapshot, reason) {
    return {
        snapshot,
        reason: reason || 'unknown',
        timestamp: Date.now(),
        signature: computeSignature(snapshot)
    };
}

function ensureHistoryState() {
    if (!env.state.history) {
        env.state.history = loadHistoryFromDisk();
    }
    return env.state.history;
}

function pushEntry(stack, entry) {
    stack.push(entry);
    while (stack.length > MAX_HISTORY) {
        stack.shift();
    }
}

function record(reason) {
    const history = ensureHistoryState();
    if (history.isApplying) {
        return;
    }
    let serialized = '';
    const serializeStart = perf ? perf.now() : 0;
    try {
        serialized = JSON.stringify(env.state.boardData);
    } catch {
        serialized = '';
    }
    if (perf) {
        perf.logIfSlow('history.serialize', perf.now() - serializeStart, {
            reason: reason || 'unknown',
            bytes: serialized.length
        });
    }
    if (!serialized) {
        return;
    }
    let snapshot = null;
    try {
        snapshot = JSON.parse(serialized);
    } catch {
        snapshot = null;
    }
    if (!snapshot) {
        return;
    }
    const entry = {
        snapshot,
        reason: reason || 'unknown',
        timestamp: Date.now(),
        signature: computeSignatureFromSerialized(serialized)
    };
    const previous = history.undo[history.undo.length - 1];
    if (previous && previous.signature && entry.signature && previous.signature === entry.signature) {
        history.redo = [];
        return;
    }
    pushEntry(history.undo, entry);
    history.redo = [];
    queuePersistHistory(history);
}

function applySnapshot(snapshot, source) {
    const history = ensureHistoryState();
    if (!snapshot) {
        return false;
    }
    history.isApplying = true;
    try {
        env.state.boardData = cloneData(snapshot);
        if (env.data && typeof env.data.hydrateLoadedData === 'function') {
            env.data.hydrateLoadedData(env.state.boardData);
        }
        // Validate current board
        const currentId = env.state.currentBoardId;
        const boards = env.state.boardData?.boards || {};
        if (!boards[currentId]) {
            env.state.currentBoardId = env.data.resolveInitialBoardId(env.state.boardData);
        }
        if (env.management && typeof env.management.renderBoard === 'function') {
            const preserveViewport = source === 'undo' || source === 'redo';
            env.management.renderBoard({ preserveViewport });
        }
        if (env.data && typeof env.data.queueSave === 'function') {
            env.data.queueSave(source || 'history-apply');
        }
        return true;
    } finally {
        history.isApplying = false;
    }
}

function undo() {
    const history = ensureHistoryState();
    if (history.undo.length <= 1) {
        return false;
    }
    const current = history.undo.pop();
    if (current) {
        pushEntry(history.redo, current);
    }
    const target = history.undo[history.undo.length - 1];
    if (!target) {
        return false;
    }
    const applied = applySnapshot(target.snapshot, 'undo');
    if (applied) {
        queuePersistHistory(history);
    }
    return applied;
}

function redo() {
    const history = ensureHistoryState();
    if (history.redo.length === 0) {
        return false;
    }
    const entry = history.redo.pop();
    if (!entry) {
        return false;
    }
    const applied = applySnapshot(entry.snapshot, 'redo');
    if (!applied) {
        return false;
    }
    const lastUndo = history.undo[history.undo.length - 1];
    if (!lastUndo || !lastUndo.signature || lastUndo.signature !== entry.signature) {
        pushEntry(history.undo, entry);
    } else {
        history.undo[history.undo.length - 1] = entry;
    }
    queuePersistHistory(history);
    return true;
}

env.history = { record, undo, redo };

module.exports = env.history;
