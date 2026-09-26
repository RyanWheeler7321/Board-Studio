'use strict';

const crypto = require('crypto');

const GRID_SIZE = 32;
const DEFAULT_GAP = GRID_SIZE;
const ARROW_PADDING = 48;
const CAPTION_HEIGHT = 44;
const CAPTION_MAX_CHARS = 180;
const CAPTION_MAX_LINES = 3;
const CAPTION_PLACEMENTS = new Set(['below', 'above', 'overlay-top', 'overlay-bottom']);
const CAPTION_VISIBILITY = new Set(['always', 'hover']);

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function round(value) {
    return Math.round(finite(value));
}

function createId(prefix = 'block') {
    return `${String(prefix || 'block')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function blockBounds(block) {
    return {
        x: finite(block?.x),
        y: finite(block?.y),
        width: Math.max(1, finite(block?.width, GRID_SIZE * 4)),
        height: Math.max(1, finite(block?.height, GRID_SIZE * 4))
    };
}

function boundsForBlocks(blocks) {
    const items = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
    if (!items.length) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach((block) => {
        const rect = blockBounds(block);
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    });
    return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY)
    };
}

function visualSort(blocks) {
    return [...(Array.isArray(blocks) ? blocks : [])].sort((left, right) => {
        const ly = finite(left?.y);
        const ry = finite(right?.y);
        if (Math.abs(ly - ry) > 1) {
            return ly - ry;
        }
        const lx = finite(left?.x);
        const rx = finite(right?.x);
        if (Math.abs(lx - rx) > 1) {
            return lx - rx;
        }
        return String(left?.id || '').localeCompare(String(right?.id || ''));
    });
}

function explicitOrder(blocks, orderedIds) {
    const selected = Array.isArray(blocks) ? blocks : [];
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
        return visualSort(selected);
    }
    const ids = orderedIds.map((id) => String(id || '').trim()).filter(Boolean);
    const unique = new Set(ids);
    if (ids.length !== orderedIds.length || unique.size !== ids.length) {
        throw new Error('Arrange order contains empty or duplicate block ids');
    }
    const selectedIds = new Set(selected.map((block) => String(block?.id || '')));
    const missing = selected.filter((block) => !unique.has(String(block?.id || ''))).map((block) => block.id);
    const extra = ids.filter((id) => !selectedIds.has(id));
    if (ids.length !== selected.length || missing.length || extra.length) {
        const detail = [
            missing.length ? `missing ${missing.join(', ')}` : '',
            extra.length ? `extra ${extra.join(', ')}` : ''
        ].filter(Boolean).join('; ');
        throw new Error(`Arrange order must be an exact permutation of the selected blocks${detail ? `: ${detail}` : ''}`);
    }
    const byId = new Map(selected.map((block) => [String(block.id), block]));
    return ids.map((id) => byId.get(id));
}

function boardFilingMode(sourceBoardId, targetBoardId) {
    const source = String(sourceBoardId || '').trim().toLowerCase();
    const target = String(targetBoardId || '').trim().toLowerCase();
    return source === 'root' && (target === 'concepting' || target === 'library')
        ? 'copy'
        : 'move';
}

function cloneBlocksForBoardCopy(blocks, options = {}) {
    const source = Array.isArray(blocks) ? blocks : [];
    const createBlockId = typeof options.createId === 'function'
        ? options.createId
        : (prefix) => createId(prefix);
    const updatedAt = String(options.updatedAt || new Date().toISOString());
    const clones = deepClone(source);
    const idMap = new Map();
    clones.forEach((clone, index) => {
        const previousId = String(source[index]?.id || clone?.id || '');
        const nextId = createBlockId(String(clone?.type || 'block'));
        idMap.set(previousId, nextId);
        clone.id = nextId;
        clone.updatedAt = updatedAt;
    });
    clones.forEach((clone) => {
        if (clone?.type !== 'arrow' || !clone.agentConnection) {
            return;
        }
        const fromId = String(clone.agentConnection.fromBlockId || '');
        const toId = String(clone.agentConnection.toBlockId || '');
        clone.agentConnection.fromBlockId = idMap.get(fromId) || fromId;
        clone.agentConnection.toBlockId = idMap.get(toId) || toId;
    });
    return clones;
}

function createBlockRefs(blocks) {
    const counts = new Map();
    const refs = new Map();
    visualSort(blocks).forEach((block) => {
        const type = String(block?.type || 'block').trim().toLowerCase() || 'block';
        const next = (counts.get(type) || 0) + 1;
        counts.set(type, next);
        refs.set(block.id, `${type}:${next}`);
    });
    return refs;
}

function captionText(block) {
    if (typeof block?.caption === 'string') {
        return block.caption;
    }
    if (block?.caption && typeof block.caption === 'object') {
        return String(block.caption.text || '');
    }
    return '';
}

function blockBatchId(block) {
    return String(block?.boardDisplay?.batchId || '').trim();
}

function summarizeBlock(block, refs = null) {
    const rect = blockBounds(block);
    const connection = block?.agentConnection && typeof block.agentConnection === 'object'
        ? {
            fromBlockId: String(block.agentConnection.fromBlockId || ''),
            toBlockId: String(block.agentConnection.toBlockId || '')
        }
        : null;
    return {
        ref: refs?.get(block.id) || '',
        id: String(block?.id || ''),
        type: String(block?.type || ''),
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        caption: captionText(block),
        assetName: String(block?.assetName || ''),
        source: String(block?.sourceUrl || block?.url || ''),
        batchId: blockBatchId(block),
        displayKey: String(block?.boardDisplay?.displayKey || ''),
        connection
    };
}

function computeBoardRevision(board) {
    const payload = {
        id: String(board?.id || ''),
        title: String(board?.title || ''),
        blocks: Array.isArray(board?.blocks) ? board.blocks : []
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20);
}

function listBatches(board) {
    const groups = new Map();
    (Array.isArray(board?.blocks) ? board.blocks : []).forEach((block) => {
        const batchId = blockBatchId(block);
        if (!batchId) {
            return;
        }
        if (!groups.has(batchId)) {
            groups.set(batchId, {
                batchId,
                blockIds: [],
                displayedAt: String(block?.boardDisplay?.displayedAt || ''),
                storedAt: String(block?.boardDisplay?.storedAt || ''),
                displayKey: String(block?.boardDisplay?.displayKey || '')
            });
        }
        groups.get(batchId).blockIds.push(block.id);
    });
    return Array.from(groups.values()).sort((left, right) => {
        const leftAt = Date.parse(left.displayedAt || left.storedAt || 0) || 0;
        const rightAt = Date.parse(right.displayedAt || right.storedAt || 0) || 0;
        return rightAt - leftAt;
    });
}

function inspectBoard(board) {
    const blocks = visualSort(Array.isArray(board?.blocks) ? board.blocks : []);
    const refs = createBlockRefs(blocks);
    return {
        boardId: String(board?.id || ''),
        title: String(board?.title || ''),
        revision: computeBoardRevision(board),
        blockCount: blocks.length,
        batches: listBatches(board),
        blocks: blocks.map((block) => summarizeBlock(block, refs))
    };
}

function requireExactIds(board, blockIds) {
    const ids = Array.isArray(blockIds)
        ? blockIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
        throw new Error(`Unknown block id${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
    }
    return ids.map((id) => byId.get(id));
}

function resolveSelection(board, selector = {}) {
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    const requestedIds = Array.isArray(selector?.blockIds)
        ? selector.blockIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
    let selected = requestedIds.length ? requireExactIds(board, requestedIds) : [...blocks];
    const batchId = String(selector?.batchId || '').trim();
    const type = String(selector?.type || '').trim().toLowerCase();
    const assetName = String(selector?.assetName || '').trim();
    const source = String(selector?.source || '').trim();
    const caption = selector?.caption === undefined ? '' : String(selector.caption);

    if (!requestedIds.length && !batchId && !type && !assetName && !source && selector?.caption === undefined && selector?.all !== true) {
        throw new Error('An exact selector is required');
    }
    if (batchId) {
        selected = selected.filter((block) => blockBatchId(block) === batchId);
    }
    if (type) {
        selected = selected.filter((block) => String(block?.type || '').toLowerCase() === type);
    }
    if (assetName) {
        selected = selected.filter((block) => String(block?.assetName || '') === assetName);
    }
    if (source) {
        selected = selected.filter((block) => String(block?.sourceUrl || block?.url || '') === source);
    }
    if (selector?.caption !== undefined) {
        selected = selected.filter((block) => captionText(block) === caption);
    }
    if (!selected.length) {
        throw new Error('Selector matched no blocks');
    }
    if (Number.isFinite(Number(selector?.requireCount)) && selected.length !== Number(selector.requireCount)) {
        throw new Error(`Selector matched ${selected.length} blocks; expected ${Number(selector.requireCount)}`);
    }
    return requestedIds.length ? selected : visualSort(selected);
}

function sanitizeCaptionText(value) {
    const normalized = String(value ?? '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, CAPTION_MAX_LINES);
    return lines.join('\n').slice(0, CAPTION_MAX_CHARS).trim();
}

function currentCaptionState(block) {
    const raw = block?.caption && typeof block.caption === 'object' ? block.caption : {};
    return {
        text: sanitizeCaptionText(raw.text),
        enabled: raw.enabled === true,
        placement: CAPTION_PLACEMENTS.has(raw.placement) ? raw.placement : 'below',
        visibility: CAPTION_VISIBILITY.has(raw.visibility) ? raw.visibility : 'always',
        extendBorder: raw.extendBorder === true
    };
}

function applyCaption(block, patch = {}) {
    if (!block || block.type !== 'image') {
        throw new Error(`Captions require image blocks: ${block?.id || 'unknown'}`);
    }
    const previous = currentCaptionState(block);
    const next = {
        ...previous,
        text: patch.text === undefined ? previous.text : sanitizeCaptionText(patch.text),
        enabled: patch.enabled === undefined ? true : patch.enabled === true,
        placement: patch.placement === undefined ? previous.placement : String(patch.placement),
        visibility: patch.visibility === undefined ? previous.visibility : String(patch.visibility),
        extendBorder: patch.extendBorder === undefined ? previous.extendBorder : patch.extendBorder === true
    };
    if (!CAPTION_PLACEMENTS.has(next.placement)) {
        throw new Error(`Unsupported caption placement: ${next.placement}`);
    }
    if (!CAPTION_VISIBILITY.has(next.visibility)) {
        throw new Error(`Unsupported caption visibility: ${next.visibility}`);
    }
    const layout = block.displayLayout && typeof block.displayLayout === 'object'
        ? block.displayLayout
        : null;
    const previousExternal = previous.enabled && (previous.placement === 'below' || previous.placement === 'above');
    const nextExternal = next.enabled && (next.placement === 'below' || next.placement === 'above');
    const previousHeight = layout ? Math.max(0, finite(layout.captionHeight)) : 0;
    if (layout) {
        if (previousExternal && !nextExternal && previousHeight > 0) {
            block.height = Math.max(GRID_SIZE * 2, finite(block.height) - previousHeight);
            layout.captionHeight = 0;
        } else if (!previousExternal && nextExternal) {
            const captionHeight = previousHeight || CAPTION_HEIGHT;
            block.height = finite(block.height) + captionHeight;
            layout.captionHeight = captionHeight;
        } else if (nextExternal && previousHeight <= 0) {
            block.height = finite(block.height) + CAPTION_HEIGHT;
            layout.captionHeight = CAPTION_HEIGHT;
        }
        if (nextExternal) {
            const singleLineCapacity = Math.max(16, Math.floor(blockBounds(block).width / 10));
            const singleLine = !next.text.includes('\n') && next.text.length <= singleLineCapacity;
            const currentHeight = Math.max(0, finite(layout.captionHeight));
            const desiredHeight = singleLine ? Math.max(CAPTION_HEIGHT, currentHeight) : Math.max(64, currentHeight);
            if (desiredHeight > currentHeight) {
                block.height = finite(block.height) + (desiredHeight - currentHeight);
            }
            layout.captionHeight = desiredHeight;
            layout.captionSingleLine = singleLine;
        }
    } else if (nextExternal && !previousExternal) {
        block.height = Math.max(finite(block.height), GRID_SIZE * 5);
    }
    if (!next.enabled && !next.text && next.placement === 'below' && next.visibility === 'always' && !next.extendBorder) {
        delete block.caption;
    } else {
        block.caption = next;
    }
    return block.caption || null;
}

function shiftBlock(block, dx, dy) {
    const offsetX = round(dx);
    const offsetY = round(dy);
    if (block?.type === 'arrow' && Array.isArray(block.points)) {
        block.points = block.points.map((point) => ({
            x: round(point?.x) + offsetX,
            y: round(point?.y) + offsetY
        }));
    }
    block.x = round(finite(block?.x) + offsetX);
    block.y = round(finite(block?.y) + offsetY);
}

function arrangeBlocks(blocks, options = {}) {
    const selected = Array.isArray(blocks) ? blocks : [];
    if (!selected.length) {
        throw new Error('Arrange requires at least one block');
    }
    if (selected.some((block) => block.type === 'arrow')) {
        throw new Error('Arrange targets content blocks; connected arrows follow automatically');
    }
    const ordered = explicitOrder(selected, options.order);
    const currentBounds = boundsForBlocks(ordered);
    const startX = round(options.x === undefined ? currentBounds.x : options.x);
    const startY = round(options.y === undefined ? currentBounds.y : options.y);
    const gap = Math.max(0, round(options.gap === undefined ? DEFAULT_GAP : options.gap));
    const layout = String(options.layout || 'grid').trim().toLowerCase();
    let columns;
    if (layout === 'row') {
        columns = ordered.length;
    } else if (layout === 'column') {
        columns = 1;
    } else if (layout === 'grid') {
        columns = Math.max(1, Math.min(ordered.length, round(options.columns || Math.ceil(Math.sqrt(ordered.length)))));
    } else {
        throw new Error(`Unsupported layout: ${layout}`);
    }
    const rows = Math.ceil(ordered.length / columns);
    const columnWidths = Array(columns).fill(0);
    const rowHeights = Array(rows).fill(0);
    ordered.forEach((block, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const rect = blockBounds(block);
        columnWidths[column] = Math.max(columnWidths[column], rect.width);
        rowHeights[row] = Math.max(rowHeights[row], rect.height);
    });
    const columnX = [];
    const rowY = [];
    let cursor = startX;
    columnWidths.forEach((width, index) => {
        columnX[index] = cursor;
        cursor += width + gap;
    });
    cursor = startY;
    rowHeights.forEach((height, index) => {
        rowY[index] = cursor;
        cursor += height + gap;
    });
    ordered.forEach((block, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        shiftBlock(block, columnX[column] - finite(block.x), rowY[row] - finite(block.y));
    });
    return ordered;
}

function replaceBlockMedia(block, replacement = {}, options = {}) {
    if (!block || block.type !== 'image') {
        throw new Error(`Media replacement requires an image block: ${block?.id || 'unknown'}`);
    }
    const assetName = String(replacement.assetName || '').trim();
    const nextWidth = Number(replacement.width);
    const nextHeight = Number(replacement.height);
    if (!assetName || !Number.isFinite(nextWidth) || !Number.isFinite(nextHeight) || nextWidth <= 0 || nextHeight <= 0) {
        throw new Error(`Replacement media is incomplete for ${block.id}`);
    }
    const arPolicy = String(options.arPolicy || 'exact').trim().toLowerCase();
    if (!['exact', 'natural'].includes(arPolicy)) {
        throw new Error(`Unsupported replacement aspect policy: ${arPolicy}`);
    }
    const oldAspect = Number(replacement.oldAspect);
    const newAspect = nextWidth / nextHeight;
    const tolerance = Math.max(0, Number(options.aspectTolerance) || 0.015);
    if (arPolicy === 'exact' && Number.isFinite(oldAspect) && oldAspect > 0) {
        const relativeDifference = Math.abs(newAspect - oldAspect) / oldAspect;
        if (relativeDifference > tolerance) {
            throw new Error(`Replacement aspect mismatch for ${block.id}: ${oldAspect.toFixed(4)} -> ${newAspect.toFixed(4)}; use natural aspect policy explicitly`);
        }
    }

    const previousAssetName = String(block.assetName || '');
    let frameChanged = false;
    if (arPolicy === 'natural') {
        const caption = currentCaptionState(block);
        const externalCaption = caption.enabled && (caption.placement === 'below' || caption.placement === 'above');
        const layout = block.displayLayout && typeof block.displayLayout === 'object'
            ? block.displayLayout
            : null;
        const captionHeight = externalCaption
            ? Math.max(0, finite(layout?.captionHeight, CAPTION_HEIGHT))
            : 0;
        const previousHeight = Math.max(1, finite(block.height));
        const mediaWidth = Math.max(1, finite(block.width));
        const mediaHeight = Math.max(1, round(mediaWidth / newAspect));
        const nextBlockHeight = mediaHeight + captionHeight;
        block.y = round(finite(block.y) + ((previousHeight - nextBlockHeight) / 2));
        block.height = nextBlockHeight;
        block.displayLayout = {
            ...(layout || {}),
            fitMode: 'contain',
            mediaHeight,
            ...(externalCaption ? { captionHeight } : {})
        };
        frameChanged = nextBlockHeight !== previousHeight;
    }
    block.assetName = assetName;
    return {
        blockId: String(block.id || ''),
        previousAssetName,
        assetName,
        arPolicy,
        oldAspect: Number.isFinite(oldAspect) && oldAspect > 0 ? oldAspect : null,
        newAspect,
        frameChanged
    };
}

function syncArrowBounds(block) {
    const points = Array.isArray(block?.points) ? block.points : [];
    if (points.length < 2) {
        return block;
    }
    const xs = points.map((point) => finite(point?.x));
    const ys = points.map((point) => finite(point?.y));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    block.x = round(minX - ARROW_PADDING);
    block.y = round(minY - ARROW_PADDING);
    block.width = Math.max(1, round((maxX - minX) + (ARROW_PADDING * 2)));
    block.height = Math.max(1, round((maxY - minY) + (ARROW_PADDING * 2)));
    return block;
}

function connectionPoints(fromBlock, toBlock, margin = 8) {
    const from = blockBounds(fromBlock);
    const to = blockBounds(toBlock);
    const fromCenter = { x: from.x + (from.width / 2), y: from.y + (from.height / 2) };
    const toCenter = { x: to.x + (to.width / 2), y: to.y + (to.height / 2) };
    const dx = toCenter.x - fromCenter.x;
    const dy = toCenter.y - fromCenter.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx >= 0) {
            return {
                start: { x: round(from.x + from.width + margin), y: round(fromCenter.y) },
                end: { x: round(to.x - margin), y: round(toCenter.y) }
            };
        }
        return {
            start: { x: round(from.x - margin), y: round(fromCenter.y) },
            end: { x: round(to.x + to.width + margin), y: round(toCenter.y) }
        };
    }
    if (dy >= 0) {
        return {
            start: { x: round(fromCenter.x), y: round(from.y + from.height + margin) },
            end: { x: round(toCenter.x), y: round(to.y - margin) }
        };
    }
    return {
        start: { x: round(fromCenter.x), y: round(from.y - margin) },
        end: { x: round(toCenter.x), y: round(to.y + to.height + margin) }
    };
}

function createConnectionArrow(fromBlock, toBlock, options = {}) {
    const now = options.now || new Date().toISOString();
    const points = connectionPoints(fromBlock, toBlock, options.margin);
    const block = {
        id: options.id || createId('arrow'),
        type: 'arrow',
        points: [points.start, points.end],
        baseWidth: 20,
        neckWidth: 14,
        headLength: 26,
        headWidth: 32,
        cornerRadius: 18,
        agentConnection: {
            fromBlockId: fromBlock.id,
            toBlockId: toBlock.id
        },
        createdAt: now,
        updatedAt: now
    };
    return syncArrowBounds(block);
}

function refreshConnectionArrows(board, changedIds = null) {
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const changed = changedIds ? new Set(changedIds) : null;
    const refreshed = [];
    blocks.forEach((block) => {
        if (block?.type !== 'arrow' || !block.agentConnection) {
            return;
        }
        const fromId = String(block.agentConnection.fromBlockId || '');
        const toId = String(block.agentConnection.toBlockId || '');
        if (changed && !changed.has(fromId) && !changed.has(toId)) {
            return;
        }
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) {
            return;
        }
        const points = connectionPoints(from, to);
        block.points = [points.start, points.end];
        syncArrowBounds(block);
        refreshed.push(block.id);
    });
    return refreshed;
}

function createConnections(board, pairs, options = {}) {
    const normalizedPairs = Array.isArray(pairs) ? pairs : [];
    if (!normalizedPairs.length) {
        throw new Error('Connect requires at least one explicit pair');
    }
    const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const created = [];
    normalizedPairs.forEach((pair) => {
        const fromId = String(pair?.fromBlockId || pair?.from || '').trim();
        const toId = String(pair?.toBlockId || pair?.to || '').trim();
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) {
            throw new Error(`Connect pair references an unknown block: ${fromId} -> ${toId}`);
        }
        if (fromId === toId) {
            throw new Error(`Connect pair cannot target the same block: ${fromId}`);
        }
        const duplicate = blocks.find((block) => block?.agentConnection?.fromBlockId === fromId && block?.agentConnection?.toBlockId === toId);
        if (duplicate && options.allowDuplicate !== true) {
            created.push(duplicate);
            return;
        }
        const arrow = createConnectionArrow(from, to, {
            id: typeof options.createId === 'function' ? options.createId('arrow') : createId('arrow')
        });
        blocks.push(arrow);
        byId.set(arrow.id, arrow);
        created.push(arrow);
    });
    return created;
}

module.exports = {
    GRID_SIZE,
    DEFAULT_GAP,
    deepClone,
    blockBounds,
    boundsForBlocks,
    visualSort,
    explicitOrder,
    boardFilingMode,
    cloneBlocksForBoardCopy,
    createBlockRefs,
    summarizeBlock,
    computeBoardRevision,
    inspectBoard,
    resolveSelection,
    sanitizeCaptionText,
    applyCaption,
    shiftBlock,
    arrangeBlocks,
    replaceBlockMedia,
    connectionPoints,
    createConnectionArrow,
    createConnections,
    refreshConnectionArrows,
    syncArrowBounds
};
