'use strict';

const crypto = require('crypto');
const env = require('../core/state');
const boardDisplay = require('./boardDisplay');
const operations = require('./agentOperations');
const mediaAssets = require('./mediaAssets');
const { prepareDisplayCommit } = require('./displayTransaction');
const {
    normalizeAnimated3dPackageReference,
    normalizeAnimated3dPreferences,
    resolveAnimated3dPackage
} = require('../blocks/animated3dPackage');

const { state, data, management, movement, history, utils } = env;
const MAX_REMEMBERED_REQUESTS = 128;
const requestResponses = new Map();

function nowIso() {
    return new Date().toISOString();
}

function normalizeBoardId(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'active') {
        return String(state.currentBoardId || state.boardData?.activeBoardId || 'root');
    }
    return raw.toLowerCase() === 'root' ? 'root' : raw;
}

function getBoard(boardData, boardId) {
    const normalizedId = normalizeBoardId(boardId);
    const board = boardData?.boards?.[normalizedId];
    if (!board) {
        throw new Error(`Board not found: ${normalizedId}`);
    }
    if (!board.id) {
        board.id = normalizedId;
    }
    if (!Array.isArray(board.blocks)) {
        board.blocks = [];
    }
    return board;
}

function selectorFromPayload(payload = {}) {
    return payload.selector && typeof payload.selector === 'object'
        ? payload.selector
        : {};
}

function requestFingerprint(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
}

function rememberResponse(requestId, fingerprint, response) {
    const key = String(requestId || '').trim();
    if (!key) {
        return;
    }
    requestResponses.set(key, { fingerprint, response });
    while (requestResponses.size > MAX_REMEMBERED_REQUESTS) {
        const first = requestResponses.keys().next().value;
        requestResponses.delete(first);
    }
}

function resolveOperationBlocks(board, operation, scopeIds) {
    const requested = Array.isArray(operation?.blockIds) && operation.blockIds.length
        ? operations.resolveSelection(board, { blockIds: operation.blockIds })
        : operations.resolveSelection(board, { blockIds: Array.from(scopeIds) });
    const outside = requested.filter((block) => !scopeIds.has(block.id));
    if (outside.length) {
        throw new Error(`Operation references blocks outside the transaction selector: ${outside.map((block) => block.id).join(', ')}`);
    }
    return requested;
}

function touchBoard(boardData, board, timestamp = nowIso()) {
    board.updatedAt = timestamp;
    boardData.updatedAt = timestamp;
}

function applyCaptionOperation(board, operation, scopeIds, touchedIds) {
    const blocks = resolveOperationBlocks(board, operation, scopeIds);
    const values = operation?.values && typeof operation.values === 'object' ? operation.values : null;
    if (values) {
        const unknownValueIds = Object.keys(values).filter((id) => !blocks.some((block) => block.id === id));
        if (unknownValueIds.length) {
            throw new Error(`Caption values reference blocks outside the caption target: ${unknownValueIds.join(', ')}`);
        }
    }
    blocks.forEach((block) => {
        const text = values ? values[block.id] : operation.text;
        if (values && text === undefined) {
            return;
        }
        operations.applyCaption(block, {
            text: operation.clear === true ? '' : text,
            enabled: operation.clear === true ? false : operation.enabled,
            placement: operation.placement,
            visibility: operation.visibility,
            extendBorder: operation.extendBorder
        });
        block.updatedAt = nowIso();
        touchedIds.add(block.id);
    });
}

function applyArrangeOperation(board, operation, scopeIds, touchedIds) {
    const blocks = resolveOperationBlocks(board, operation, scopeIds);
    operations.arrangeBlocks(blocks, operation);
    blocks.forEach((block) => {
        block.updatedAt = nowIso();
        touchedIds.add(block.id);
    });
    operations.refreshConnectionArrows(board, touchedIds).forEach((id) => touchedIds.add(id));
}

function applyReplaceMediaOperation(board, operation, scopeIds, touchedIds, replacementResults) {
    const blocks = resolveOperationBlocks(board, operation, scopeIds);
    const replacements = Array.isArray(operation?.replacements) ? operation.replacements : [];
    const byId = new Map();
    replacements.forEach((replacement) => {
        const blockId = String(replacement?.blockId || '').trim();
        if (!blockId || byId.has(blockId)) {
            throw new Error('Media replacements require unique explicit block ids');
        }
        byId.set(blockId, replacement);
    });
    const targetIds = new Set(blocks.map((block) => block.id));
    const extra = Array.from(byId.keys()).filter((id) => !targetIds.has(id));
    const missing = blocks.filter((block) => !byId.has(block.id)).map((block) => block.id);
    if (replacements.length !== blocks.length || extra.length || missing.length) {
        throw new Error(`Media replacements must exactly match the selected blocks${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; extra ${extra.join(', ')}` : ''}`);
    }
    const changedIds = new Set();
    blocks.forEach((block) => {
        const result = operations.replaceBlockMedia(block, byId.get(block.id), operation);
        block.updatedAt = nowIso();
        touchedIds.add(block.id);
        changedIds.add(block.id);
        replacementResults.push(result);
    });
    operations.refreshConnectionArrows(board, changedIds).forEach((id) => touchedIds.add(id));
}

function applyMoveOperation(board, operation, scopeIds, touchedIds) {
    const blocks = resolveOperationBlocks(board, operation, scopeIds);
    const dx = Number(operation.dx);
    const dy = Number(operation.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new Error('Move requires finite dx and dy values');
    }
    blocks.forEach((block) => {
        operations.shiftBlock(block, dx, dy);
        block.updatedAt = nowIso();
        touchedIds.add(block.id);
    });
    operations.refreshConnectionArrows(board, touchedIds).forEach((id) => touchedIds.add(id));
}

function applyConnectOperation(board, operation, scopeIds, touchedIds) {
    const pairs = Array.isArray(operation?.pairs) ? operation.pairs : [];
    pairs.forEach((pair) => {
        const fromId = String(pair?.fromBlockId || pair?.from || '').trim();
        const toId = String(pair?.toBlockId || pair?.to || '').trim();
        if (!scopeIds.has(fromId) || !scopeIds.has(toId)) {
            throw new Error(`Connect pair is outside the transaction selector: ${fromId} -> ${toId}`);
        }
    });
    const created = operations.createConnections(board, pairs, {
        allowDuplicate: operation.allowDuplicate === true,
        createId: (prefix) => utils.createId(prefix)
    });
    created.forEach((block) => touchedIds.add(block.id));
}

function arrowConnectionState(block, movedIds) {
    if (block?.type !== 'arrow' || !block.agentConnection) {
        return 'none';
    }
    const fromMoved = movedIds.has(String(block.agentConnection.fromBlockId || ''));
    const toMoved = movedIds.has(String(block.agentConnection.toBlockId || ''));
    if (fromMoved && toMoved) {
        return 'internal';
    }
    if (fromMoved || toMoved) {
        return 'dangling';
    }
    return 'none';
}

function shiftGroupToBoard(blocks, targetBoard) {
    const groupBounds = operations.boundsForBlocks(blocks);
    const existingBounds = operations.boundsForBlocks(targetBoard.blocks || []);
    const targetX = existingBounds.width > 0 ? existingBounds.x : operations.GRID_SIZE * 2;
    const targetY = existingBounds.height > 0
        ? existingBounds.y + existingBounds.height + (operations.GRID_SIZE * 2)
        : operations.GRID_SIZE * 2;
    const dx = targetX - groupBounds.x;
    const dy = targetY - groupBounds.y;
    blocks.forEach((block) => operations.shiftBlock(block, dx, dy));
}

function annotateStorageBatch(blocks, sourceBoardId) {
    const storedAt = nowIso();
    const expiresAt = new Date(Date.parse(storedAt) + boardDisplay.STORAGE_TTL_MS).toISOString();
    const batchId = utils.createId('storage');
    blocks.forEach((block) => {
        const meta = block.boardDisplay && typeof block.boardDisplay === 'object'
            ? block.boardDisplay
            : {};
        block.boardDisplay = {
            ...meta,
            batchId,
            role: meta.role || 'snapshot-content',
            source: meta.source || 'board-agent-file',
            batchTitle: meta.batchTitle || 'Filed from display',
            displayedAt: meta.displayedAt || storedAt,
            storedAt,
            expiresAt,
            sourceBoardId
        };
        block.updatedAt = storedAt;
    });
    return batchId;
}

function repairStorageArrowPointsAfterReflow(storageBoard, beforePositions) {
    (storageBoard.blocks || []).forEach((block) => {
        if (block?.type !== 'arrow' || !Array.isArray(block.points)) {
            return;
        }
        const before = beforePositions.get(block.id);
        if (!before) {
            return;
        }
        const dx = Number(block.x || 0) - before.x;
        const dy = Number(block.y || 0) - before.y;
        if (dx === 0 && dy === 0) {
            return;
        }
        block.points = block.points.map((point) => ({
            x: Math.round(Number(point?.x || 0) + dx),
            y: Math.round(Number(point?.y || 0) + dy)
        }));
        operations.syncArrowBounds(block);
    });
}

function applyMoveToBoardOperation(boardData, sourceBoard, operation, scopeIds, touchedIds, touchedBoardIds) {
    const selected = resolveOperationBlocks(sourceBoard, operation, scopeIds);
    const movedIds = new Set(selected.map((block) => block.id));
    (sourceBoard.blocks || []).forEach((block) => {
        const connectionState = arrowConnectionState(block, movedIds);
        if (connectionState === 'internal') {
            movedIds.add(block.id);
        } else if (connectionState === 'dangling') {
            throw new Error(`Move would leave a dangling connected arrow: ${block.id}`);
        }
    });
    const targetBoard = getBoard(boardData, operation.targetBoardId);
    if (targetBoard.id === sourceBoard.id) {
        throw new Error(`Blocks are already on ${targetBoard.id}`);
    }
    const selectedForFiling = sourceBoard.blocks.filter((block) => movedIds.has(block.id));
    if (!selectedForFiling.length) {
        throw new Error('Move-to-board matched no blocks');
    }
    const filingMode = operations.boardFilingMode(sourceBoard.id, targetBoard.id);
    const moving = filingMode === 'copy'
        ? operations.cloneBlocksForBoardCopy(selectedForFiling, {
            createId: (prefix) => utils.createId(prefix),
            updatedAt: nowIso()
        })
        : selectedForFiling;
    if (filingMode === 'move') {
        sourceBoard.blocks = sourceBoard.blocks.filter((block) => !movedIds.has(block.id));
    }

    let storageBatchId = '';
    if (targetBoard.id === boardDisplay.STORAGE_BOARD_ID) {
        const groupBounds = operations.boundsForBlocks(moving);
        moving.forEach((block) => operations.shiftBlock(block, -groupBounds.x, -groupBounds.y));
        storageBatchId = annotateStorageBatch(moving, sourceBoard.id);
        targetBoard.blocks.push(...moving);
        const beforePositions = new Map((targetBoard.blocks || []).map((block) => [block.id, {
            x: Number(block.x || 0),
            y: Number(block.y || 0)
        }]));
        boardDisplay.reflowStorageBatches(boardData);
        repairStorageArrowPointsAfterReflow(targetBoard, beforePositions);
    } else {
        shiftGroupToBoard(moving, targetBoard);
        targetBoard.blocks.push(...moving);
    }
    const timestamp = nowIso();
    moving.forEach((block) => {
        block.updatedAt = timestamp;
        touchedIds.add(block.id);
    });
    sourceBoard.updatedAt = timestamp;
    targetBoard.updatedAt = timestamp;
    boardData.updatedAt = timestamp;
    touchedBoardIds.add(sourceBoard.id);
    touchedBoardIds.add(targetBoard.id);
    return {
        mode: filingMode,
        sourceIds: Array.from(movedIds),
        filedIds: moving.map((block) => block.id),
        targetBoardId: targetBoard.id,
        storageBatchId
    };
}

function applyReplaceAnimated3dPackageOperation(board, operation, scopeIds, touchedIds) {
    const blocks = resolveOperationBlocks(board, operation, scopeIds);
    const packageRef = normalizeAnimated3dPackageReference(operation?.packageRef);
    if (!packageRef) {
        throw new Error('Animated 3D replacement requires a valid managed package reference');
    }
    blocks.forEach((block) => {
        if (block.type !== 'animated3d') {
            throw new Error(`Animated 3D replacement cannot target ${block.type || 'unknown'} block ${block.id}`);
        }
        block.packageRef = packageRef;
        block.preferences = operation?.resetPreferences === true
            ? normalizeAnimated3dPreferences()
            : normalizeAnimated3dPreferences(block.preferences);
        block.updatedAt = nowIso();
        touchedIds.add(block.id);
    });
}

function applyTransactionToClone(boardData, payload) {
    const board = getBoard(boardData, payload.boardId);
    const selected = operations.resolveSelection(board, selectorFromPayload(payload));
    const scopeIds = new Set(selected.map((block) => block.id));
    const transactionOperations = Array.isArray(payload.operations) ? payload.operations : [];
    if (!transactionOperations.length) {
        throw new Error('Apply requires at least one operation');
    }
    const touchedIds = new Set();
    const touchedBoardIds = new Set([board.id]);
    const moveResults = [];
    const replacementResults = [];
    transactionOperations.forEach((operation, index) => {
        const type = String(operation?.type || '').trim().toLowerCase();
        if (type === 'set-captions') {
            applyCaptionOperation(board, operation, scopeIds, touchedIds);
        } else if (type === 'arrange') {
            applyArrangeOperation(board, operation, scopeIds, touchedIds);
        } else if (type === 'replace-media') {
            applyReplaceMediaOperation(board, operation, scopeIds, touchedIds, replacementResults);
        } else if (type === 'replace-animated3d-package') {
            applyReplaceAnimated3dPackageOperation(board, operation, scopeIds, touchedIds);
        } else if (type === 'move') {
            applyMoveOperation(board, operation, scopeIds, touchedIds);
        } else if (type === 'connect') {
            applyConnectOperation(board, operation, scopeIds, touchedIds);
        } else if (type === 'move-to-board') {
            if (index !== transactionOperations.length - 1) {
                throw new Error('move-to-board must be the final operation in a transaction');
            }
            moveResults.push(applyMoveToBoardOperation(boardData, board, operation, scopeIds, touchedIds, touchedBoardIds));
        } else {
            throw new Error(`Unsupported Board Studio operation: ${type || '(missing)'}`);
        }
    });
    touchBoard(boardData, board);
    return {
        board,
        selectedIds: Array.from(scopeIds),
        touchedIds: Array.from(touchedIds),
        touchedBoardIds: Array.from(touchedBoardIds),
        moveResults,
        replacementResults
    };
}

function resolveBlockMedia(block) {
    if (!block || block.type !== 'image') {
        return null;
    }
    const assetName = String(block.assetName || '').trim();
    const externalSource = String(block.sourceUrl || block.url || '').trim();
    const base = {
        assetName,
        externalSource,
        sourceType: 'unresolved',
        exists: false,
        path: ''
    };
    if (!assetName) {
        return {
            ...base,
            sourceType: /^https?:\/\//i.test(externalSource) ? 'remote' : 'unresolved'
        };
    }
    const filePath = typeof data.findAssetFilePath === 'function'
        ? String(data.findAssetFilePath(assetName, { type: 'image' }) || '')
        : '';
    if (!filePath || !env.fs?.existsSync?.(filePath)) {
        return { ...base, sourceType: 'missing' };
    }
    try {
        const info = mediaAssets.readImageInfoSync(filePath);
        return {
            ...base,
            sourceType: 'local',
            exists: true,
            path: filePath,
            mimeType: info.mimeType,
            width: info.width,
            height: info.height,
            aspectRatio: info.aspectRatio,
            orientation: info.orientation,
            hasAlpha: info.hasAlpha,
            byteLength: info.byteLength,
            sha256: info.sha256
        };
    } catch (error) {
        return {
            ...base,
            sourceType: 'local',
            exists: true,
            path: filePath,
            error: error?.message || String(error)
        };
    }
}

function fallbackBlockAspect(block) {
    const width = Math.max(1, Number(block?.width) || 1);
    const layoutMediaHeight = Number(block?.displayLayout?.mediaHeight);
    const height = Number.isFinite(layoutMediaHeight) && layoutMediaHeight > 0
        ? layoutMediaHeight
        : Math.max(1, Number(block?.height) || 1);
    return width / height;
}

function prepareReplacementOperations(board, payload) {
    const scope = operations.resolveSelection(board, selectorFromPayload(payload));
    const scopeIds = new Set(scope.map((block) => block.id));
    const prepared = operations.deepClone(payload);
    (prepared.operations || []).forEach((operation) => {
        const operationType = String(operation?.type || '').trim().toLowerCase();
        if (operationType === 'replace-animated3d-package') {
            const packageResult = resolveAnimated3dPackage(operation?.packageRef, { assetsDir: env.paths.assetsDir });
            if (!packageResult.ok) {
                throw new Error(`Animated 3D replacement package is unavailable: ${packageResult.reason || 'invalid-package'}`);
            }
            operation.packageRef = packageResult.packageRef;
            return;
        }
        if (operationType !== 'replace-media') {
            return;
        }
        const blocks = resolveOperationBlocks(board, operation, scopeIds);
        const replacements = Array.isArray(operation.replacements) ? operation.replacements : [];
        const replacementIds = replacements.map((entry) => String(entry?.blockId || '').trim());
        if (new Set(replacementIds).size !== replacementIds.length) {
            throw new Error('Media replacements contain duplicate block ids');
        }
        const byId = new Map(replacements.map((entry) => [String(entry?.blockId || '').trim(), entry]));
        const targetIds = new Set(blocks.map((block) => block.id));
        const missing = blocks.filter((block) => !byId.has(block.id)).map((block) => block.id);
        const extra = Array.from(byId.keys()).filter((id) => !targetIds.has(id));
        if (replacements.length !== blocks.length || missing.length || extra.length) {
            throw new Error(`Media replacements must exactly match the selected blocks${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; extra ${extra.join(', ')}` : ''}`);
        }
        operation.replacements = blocks.map((block) => {
            const requested = byId.get(block.id);
            const assetName = String(requested?.assetName || '').trim();
            const filePath = typeof data.findAssetFilePath === 'function'
                ? String(data.findAssetFilePath(assetName, { type: 'image' }) || '')
                : '';
            if (!filePath || !env.fs?.existsSync?.(filePath)) {
                throw new Error(`Replacement asset is missing for ${block.id}: ${assetName}`);
            }
            const nextInfo = mediaAssets.readImageInfoSync(filePath);
            const expectedHash = String(requested?.sha256 || '').trim().toLowerCase();
            if (expectedHash && expectedHash !== nextInfo.sha256) {
                throw new Error(`Replacement asset hash changed for ${block.id}`);
            }
            const currentInfo = resolveBlockMedia(block);
            return {
                blockId: block.id,
                assetName,
                width: nextInfo.width,
                height: nextInfo.height,
                sha256: nextInfo.sha256,
                oldAspect: currentInfo?.sourceType === 'local' && Number(currentInfo.aspectRatio) > 0
                    ? Number(currentInfo.aspectRatio)
                    : fallbackBlockAspect(block)
            };
        });
    });
    return prepared;
}

async function waitForBoard(boardId, timeoutMs = 2500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (state.currentBoardId === boardId && !state.boardTransition) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 35));
    }
    return state.currentBoardId === boardId;
}

async function focus(payload) {
    const board = getBoard(state.boardData, payload.boardId);
    const expectedRevision = String(payload.expectedRevision || '').trim();
    const revision = operations.computeBoardRevision(board);
    if (expectedRevision && expectedRevision !== revision) {
        return { success: false, error: 'stale-revision', expectedRevision, actualRevision: revision };
    }
    const selected = operations.resolveSelection(board, selectorFromPayload(payload));
    if (state.currentBoardId !== board.id) {
        management.navigateToBoard(board.id, { direction: 'in' });
        if (!(await waitForBoard(board.id))) {
            return { success: false, error: 'board-navigation-timeout', boardId: board.id };
        }
    }
    movement.setSelectedBlocks(selected.map((block) => block.id), selected[0]?.id || null);
    movement.zoomToFit({ useSelection: true });
    setTimeout(() => movement.clearSelection(), 160);
    return {
        success: true,
        action: 'focus',
        boardId: board.id,
        revision,
        matchedIds: selected.map((block) => block.id)
    };
}

function inspect(payload) {
    const board = getBoard(state.boardData, payload.boardId);
    const summary = operations.inspectBoard(board);
    if (payload.selector && typeof payload.selector === 'object') {
        const selected = operations.resolveSelection(board, payload.selector);
        const ids = new Set(selected.map((block) => block.id));
        summary.blocks = summary.blocks.filter((block) => ids.has(block.id));
        summary.matchedIds = selected.map((block) => block.id);
        summary.matchCount = selected.length;
    }
    if (payload.includeMedia === true) {
        const byId = new Map((board.blocks || []).map((block) => [block.id, block]));
        summary.blocks = summary.blocks.map((entry) => ({
            ...entry,
            ...(entry.type === 'image' ? { media: resolveBlockMedia(byId.get(entry.id)) } : {})
        }));
    }
    return {
        success: true,
        action: 'inspect',
        ...summary,
        dataDirectory: {
            path: String(env.paths.dataDir || '')
        },
        terminal: {
            open: env.terminalPanel?.isOpen?.() === true
        }
    };
}

function previewArrange(payload) {
    const board = getBoard(state.boardData, payload.boardId);
    const revision = operations.computeBoardRevision(board);
    const expectedRevision = String(payload.expectedRevision || '').trim();
    if (!expectedRevision) {
        return { success: false, error: 'expected-revision-required', actualRevision: revision };
    }
    if (expectedRevision !== revision) {
        return { success: false, error: 'stale-revision', expectedRevision, actualRevision: revision };
    }
    const selected = operations.resolveSelection(board, selectorFromPayload(payload));
    const clones = operations.deepClone(selected);
    const ordered = operations.arrangeBlocks(clones, payload.arrange || {});
    return {
        success: true,
        action: 'preview-arrange',
        boardId: board.id,
        revision,
        placements: ordered.map((block) => ({ id: block.id, ...operations.blockBounds(block) }))
    };
}

function setTerminal(payload) {
    const mode = String(payload.mode || '').trim().toLowerCase();
    if (!['open', 'close', 'toggle'].includes(mode)) {
        return { success: false, action: 'terminal', error: 'terminal-mode-must-be-open-close-or-toggle' };
    }
    const open = mode === 'toggle'
        ? env.terminalPanel?.isOpen?.() !== true
        : mode === 'open';
    env.terminalPanel?.setOpen?.(open, { focus: false });
    return {
        success: true,
        action: 'terminal',
        terminal: {
            open: env.terminalPanel?.isOpen?.() === true
        }
    };
}

function apply(payload) {
    const requestId = String(payload.requestId || '').trim();
    if (!requestId) {
        return { success: false, error: 'request-id-required' };
    }
    const fingerprint = requestFingerprint(payload);
    if (requestResponses.has(requestId)) {
        const existing = requestResponses.get(requestId);
        if (existing.fingerprint !== fingerprint) {
            return { success: false, error: 'request-id-conflict', requestId };
        }
        return { ...existing.response, replayed: true };
    }
    const liveBoard = getBoard(state.boardData, payload.boardId);
    const beforeRevision = operations.computeBoardRevision(liveBoard);
    const expectedRevision = String(payload.expectedRevision || '').trim();
    if (!expectedRevision) {
        return { success: false, error: 'expected-revision-required', actualRevision: beforeRevision };
    }
    if (expectedRevision !== beforeRevision) {
        return { success: false, error: 'stale-revision', expectedRevision, actualRevision: beforeRevision };
    }

    try {
        const preparedPayload = prepareReplacementOperations(liveBoard, payload);
        const workingData = operations.deepClone(state.boardData);
        const result = applyTransactionToClone(workingData, preparedPayload);

        history.record('board-agent-before');
        state.boardData = workingData;
        movement.clearSelection();
        management.renderBoard();
        const afterRevisions = {};
        result.touchedBoardIds.forEach((boardId) => {
            afterRevisions[boardId] = operations.computeBoardRevision(getBoard(state.boardData, boardId));
        });
        data.persistBoardData(true, 'board-agent-apply');
        history.record('board-agent-apply');

        const response = {
            success: true,
            action: 'apply',
            requestId,
            transactionId: utils.createId('boardtx'),
            boardId: result.board.id,
            beforeRevision,
            afterRevision: afterRevisions[result.board.id],
            boardRevisions: afterRevisions,
            matchedIds: result.selectedIds,
            touchedIds: result.touchedIds,
            moveResults: result.moveResults,
            replacementResults: result.replacementResults,
            appliedAt: nowIso()
        };
        rememberResponse(requestId, fingerprint, response);
        console.info('Board agent transaction applied', {
            requestId,
            transactionId: response.transactionId,
            boardId: result.board.id,
            matched: result.selectedIds.length,
            touched: result.touchedIds.length,
            operationCount: payload.operations.length
        });
        return response;
    } catch (error) {
        console.error('Board agent transaction rejected', {
            requestId,
            boardId: liveBoard.id,
            error: error?.message || String(error)
        });
        return { success: false, error: error?.message || String(error), requestId, boardId: liveBoard.id };
    }
}

async function publishDisplay(payload) {
    const requestId = String(payload.requestId || '');
    if (!requestId) throw new Error('request-id-required');
    const fingerprint = requestFingerprint(payload);
    const prior = requestResponses.get(requestId);
    if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error('request-id-conflict');
        return { ...prior.response, replayed: true };
    }
    if (state.currentBoardId !== 'root') throw new Error('display-navigation-changed');
    const working = prepareDisplayCommit(state.boardData, payload);
    state.boardData = working;
    movement.clearSelection();
    management.renderBoard();
    data.persistBoardData(true, 'display-commit');
    history.rebase(state.boardData, 'display-commit');
    const response = { success: true, action: 'publish-display', requestId,
        revision: operations.computeBoardRevision(working.boards.root), committed: true };
    // Remember the commit before presenting it so a retry can't import twice.
    rememberResponse(requestId, fingerprint, response);
    console.info('Board display committed', { requestId, revision: response.revision });
    return response;
}

async function waitForDisplay(payload) {
    const requestId = String(payload.requestId || '');
    const stored = requestResponses.get(requestId);
    if (!stored?.response?.committed) throw new Error('display-commit-missing');
    const response = { ...stored.response };
    response.presented = false;
    const deadline = Date.now() + 10000;
    let diagnostics;
    do {
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (state.currentBoardId !== 'root'
            || operations.computeBoardRevision(state.boardData.boards.root) !== response.revision) {
            response.presentationReason = 'display-changed';
            return response;
        }
        diagnostics = env.images?.getViewportImageDiagnostics?.();
        if (diagnostics && diagnostics.windowActivityMode !== 'hidden' && !diagnostics.interactionActive
            && diagnostics.pendingCount === 0 && diagnostics.requestQueueDepth === 0
            && diagnostics.activePreloadCount === 0
            && diagnostics.visibleImages.every((image) => image.decodedWidth > 0)) {
            response.presented = true;
            break;
        }
    } while (Date.now() < deadline && state.currentBoardId === 'root');
    response.presented = response.presented === true;
    response.presentationReason = response.presented ? 'visible-images-ready'
        : diagnostics?.windowActivityMode === 'hidden' ? 'window-hidden' : 'images-not-ready';
    rememberResponse(requestId, stored.fingerprint, response);
    console.info('Board display presentation', { requestId, presented: response.presented,
        reason: response.presentationReason });
    return response;
}

async function run(payload = {}) {
    if (!state.boardData?.boards) {
        return { success: false, error: 'board-data-unavailable' };
    }
    const action = String(payload?.action || 'inspect').trim().toLowerCase();
    try {
        if (action === 'publish-display') {
            return await publishDisplay(payload);
        }
        if (action === 'display-ready') {
            return await waitForDisplay(payload);
        }
        if (action === 'inspect') {
            return inspect(payload);
        }
        if (action === 'focus') {
            return await focus(payload);
        }
        if (action === 'terminal') {
            return setTerminal(payload);
        }
        if (action === 'preview-arrange') {
            return previewArrange(payload);
        }
        if (action === 'profile-zoom') {
            if (typeof movement.profileZoomPerformance !== 'function') {
                return { success: false, error: 'zoom-profiler-unavailable' };
            }
            return await movement.profileZoomPerformance(payload);
        }
        if (action === 'profile-pan') {
            if (typeof movement.profilePanPerformance !== 'function') {
                return { success: false, error: 'pan-profiler-unavailable' };
            }
            return await movement.profilePanPerformance(payload);
        }
        if (action === 'profile-image-resolution') {
            if (typeof env.images?.profileViewportImageResolution !== 'function') {
                return { success: false, error: 'image-resolution-profiler-unavailable' };
            }
            return await env.images.profileViewportImageResolution(payload);
        }
        if (action === 'image-resolution-status') {
            if (typeof env.images?.getViewportImageDiagnostics !== 'function') {
                return { success: false, error: 'image-resolution-diagnostics-unavailable' };
            }
            return {
                success: true,
                diagnostics: env.images.getViewportImageDiagnostics()
            };
        }
        if (action === 'profile-image-focus-recovery') {
            if (typeof env.images?.profileViewportImageFocusRecovery !== 'function') {
                return { success: false, error: 'image-focus-profiler-unavailable' };
            }
            return await env.images.profileViewportImageFocusRecovery(payload || {});
        }
        if (action === 'animated3d-status') {
            if (typeof env.blocks.animated3d?.getRuntimeDiagnostics !== 'function') {
                return { success: false, error: 'animated3d-diagnostics-unavailable' };
        }
            return {
                success: true,
                diagnostics: env.blocks.animated3d.getRuntimeDiagnostics()
            };
        }
        if (action === 'animated3d-activate') {
            if (typeof env.blocks.animated3d?.activateBlockForAutomation !== 'function') {
                return { success: false, error: 'animated3d-automation-unavailable' };
        }
            return await env.blocks.animated3d.activateBlockForAutomation(payload.blockId);
        }
        if (action === 'animated3d-deactivate') {
            if (typeof env.blocks.animated3d?.deactivateBlockForAutomation !== 'function') {
                return { success: false, error: 'animated3d-automation-unavailable' };
        }
            return env.blocks.animated3d.deactivateBlockForAutomation('agent-api');
        }
        if (action === 'animated3d-control') {
            if (typeof env.blocks.animated3d?.controlActiveRuntimeForAutomation !== 'function') {
                return { success: false, error: 'animated3d-automation-unavailable' };
            }
            return env.blocks.animated3d.controlActiveRuntimeForAutomation(payload);
        }
        if (action === 'apply') {
            return apply(payload);
        }
        return { success: false, error: `unsupported-action:${action}` };
    } catch (error) {
        return { success: false, action, error: error?.message || String(error) };
    }
}

module.exports = {
    run,
    inspect,
    setTerminal,
    apply,
    focus,
    previewArrange,
    applyTransactionToClone
};
