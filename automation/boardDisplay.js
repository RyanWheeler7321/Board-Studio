'use strict';

// MARK: SYSTEM BOARDS
const GRID_SIZE = 32;
const ROOT_BOARD_ID = 'root';
const STORAGE_BOARD_ID = 'storage';
const CONCEPTING_BOARD_ID = 'concepting';
const LIBRARY_BOARD_ID = 'library';
const CATEGORY_BOARD_IDS = [CONCEPTING_BOARD_ID, LIBRARY_BOARD_ID];
const SYSTEM_BOARD_IDS = [ROOT_BOARD_ID, STORAGE_BOARD_ID, ...CATEGORY_BOARD_IDS];
const SYSTEM_BOARD_TITLES = {
  [ROOT_BOARD_ID]: 'Root',
  [STORAGE_BOARD_ID]: 'Storage',
  [CONCEPTING_BOARD_ID]: 'CONCEPTING',
  [LIBRARY_BOARD_ID]: 'LIBRARY'
};
const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STORAGE_ORIGIN_X = GRID_SIZE * 2;
const DEFAULT_STORAGE_ORIGIN_Y = GRID_SIZE * 2;
const DEFAULT_STORAGE_GAP_X = GRID_SIZE * 4;
const DEFAULT_STORAGE_GAP_Y = GRID_SIZE * 4;
const DEFAULT_STORAGE_MAX_ROW_WIDTH = GRID_SIZE * 160;
const DEFAULT_STORAGE_VIEW_PADDING = GRID_SIZE * 2;
const DEFAULT_STORAGE_MIN_FIT_SCALE = 0.08;
const DEFAULT_STORAGE_MAX_FIT_SCALE = 1;

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function snap(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function ceilSnap(value) {
  return Math.ceil(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isSystemBoardId(boardId) {
  return SYSTEM_BOARD_IDS.includes(String(boardId || '').trim().toLowerCase());
}

function getSystemBoardIds() {
  return [...SYSTEM_BOARD_IDS];
}

function isCategoryBoardId(boardId) {
  return CATEGORY_BOARD_IDS.includes(String(boardId || '').trim().toLowerCase());
}

function getCategoryBoardIds() {
  return [...CATEGORY_BOARD_IDS];
}

function getReachabilitySeedBoardIds(boardData) {
  const boards = boardData?.boards && typeof boardData.boards === 'object' ? boardData.boards : {};
  return SYSTEM_BOARD_IDS.filter((boardId) => !!boards[boardId]);
}

function createSystemBoardRecord(boardId, title, createdAt = nowIso()) {
  return {
    id: boardId,
    title,
    parentId: null,
    childIds: [],
    blocks: [],
    iconPreview: '',
    viewport: {
      scale: 1,
      scrollX: 0,
      scrollY: 0,
      viewportWidth: 0,
      viewportHeight: 0
    },
    createdAt,
    updatedAt: createdAt
  };
}

function createStorageBoardRecord(createdAt = nowIso()) {
  return createSystemBoardRecord(STORAGE_BOARD_ID, 'Storage', createdAt);
}

function createCategoryBoardRecord(boardId, createdAt = nowIso()) {
  const normalizedId = String(boardId || '').trim().toLowerCase();
  if (!isCategoryBoardId(normalizedId)) {
    throw new Error(`Unknown Board Studio category: ${boardId}`);
  }
  return createSystemBoardRecord(normalizedId, SYSTEM_BOARD_TITLES[normalizedId], createdAt);
}

function ensureSystemBoards(boardData, options = {}) {
  if (!boardData || typeof boardData !== 'object') {
    return { changed: false, added: [] };
  }
  let changed = false;
  if (!boardData.boards || typeof boardData.boards !== 'object') {
    boardData.boards = {};
    changed = true;
  }
  const boards = boardData.boards;
  const createdAt = options.createdAt || nowIso();
  const added = [];

  if (!boards[ROOT_BOARD_ID]) {
    boards[ROOT_BOARD_ID] = createSystemBoardRecord(ROOT_BOARD_ID, 'Root', createdAt);
    added.push(ROOT_BOARD_ID);
    changed = true;
  }

  if (!boards[STORAGE_BOARD_ID]) {
    boards[STORAGE_BOARD_ID] = createStorageBoardRecord(createdAt);
    added.push(STORAGE_BOARD_ID);
    changed = true;
  }

  for (const boardId of CATEGORY_BOARD_IDS) {
    if (!boards[boardId]) {
      boards[boardId] = createCategoryBoardRecord(boardId, createdAt);
      added.push(boardId);
      changed = true;
    }
  }

  for (const boardId of SYSTEM_BOARD_IDS) {
    const board = boards[boardId];
    if (!board || typeof board !== 'object') {
      continue;
    }
    const expectedTitle = SYSTEM_BOARD_TITLES[boardId] || board.title || boardId;
    if (board.id !== boardId || board.parentId !== null || !Array.isArray(board.childIds)
      || !Array.isArray(board.blocks) || board.title !== expectedTitle) {
      changed = true;
    }
    board.id = boardId;
    board.parentId = null;
    board.childIds = Array.isArray(board.childIds) ? board.childIds : [];
    board.blocks = Array.isArray(board.blocks) ? board.blocks : [];
    board.title = expectedTitle;
    if (!board.viewport || typeof board.viewport !== 'object') {
      board.viewport = { scale: 1, scrollX: 0, scrollY: 0, viewportWidth: 0, viewportHeight: 0 };
      changed = true;
    }
  }

  if (!boardData.activeBoardId || !boards[boardData.activeBoardId]) {
    boardData.activeBoardId = ROOT_BOARD_ID;
    changed = true;
  }

  return { changed, added };
}

// MARK: BATCHES
function rectFromBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const block of blocks) {
    const x = Number(block?.x) || 0;
    const y = Number(block?.y) || 0;
    const width = Number(block?.width) || 0;
    const height = Number(block?.height) || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX - minX) ? Math.max(0, maxX - minX) : 0,
    height: Number.isFinite(maxY - minY) ? Math.max(0, maxY - minY) : 0
  };
}

function shiftBlocks(blocks, dx, dy) {
  blocks.forEach((block) => {
    block.x = snap((Number(block.x) || 0) + dx);
    block.y = snap((Number(block.y) || 0) + dy);
  });
}

function deriveArchiveTitle(rootBlocks) {
  const displayTitle = rootBlocks.find((block) => block?.boardDisplay?.role === 'title')?.content;
  if (displayTitle && String(displayTitle).trim()) {
    return String(displayTitle).trim();
  }
  const titleBlock = rootBlocks.find((block) => block?.type === 'title' && typeof block.content === 'string' && block.content.trim());
  if (titleBlock) {
    return titleBlock.content.trim();
  }
  return 'Archived display';
}

function shouldArchiveRootBlock(block) {
  if (!block || typeof block !== 'object') {
    return false;
  }
  const type = String(block.type || '').trim().toLowerCase();
  if (type === 'image' || type === 'audio' || type === 'video' || type === 'animated3d') {
    return true;
  }
  const role = String(block?.boardDisplay?.role || '').trim().toLowerCase();
  if (role === 'title' || role === 'notes' || role === 'snapshot-header') {
    return false;
  }
  if (type === 'text') {
    return String(block?.content || block?.text || '').trim().length >= 8;
  }
  return false;
}

function archiveRootToStorage(boardData, options = {}) {
  ensureSystemBoards(boardData);
  const rootBoard = boardData.boards[ROOT_BOARD_ID];
  const storageBoard = boardData.boards[STORAGE_BOARD_ID];
  const existingBlocks = Array.isArray(rootBoard?.blocks) ? rootBoard.blocks : [];
  if (existingBlocks.length === 0) {
    return { changed: false, archivedBatchId: '', archivedCount: 0 };
  }

  const archivableBlocks = existingBlocks.filter(shouldArchiveRootBlock);
  const archivedAt = options.archivedAt || nowIso();
  if (archivableBlocks.length === 0) {
    rootBoard.blocks = [];
    rootBoard.updatedAt = archivedAt;
    boardData.updatedAt = archivedAt;
    return {
      changed: true,
      archivedBatchId: '',
      archivedCount: 0,
      discardedCount: existingBlocks.length
    };
  }

  const expiresAt = new Date(Date.parse(archivedAt) + STORAGE_TTL_MS).toISOString();
  const batchId = options.batchId || createId('storage');
  const archiveTitle = String(options.archiveTitle || deriveArchiveTitle(archivableBlocks) || 'Archived display').trim();
  const rootRect = rectFromBlocks(archivableBlocks);

  const movedBlocks = archivableBlocks.map((block) => {
    const clone = JSON.parse(JSON.stringify(block));
    const existingMeta = clone.boardDisplay && typeof clone.boardDisplay === 'object' ? clone.boardDisplay : {};
    clone.boardDisplay = {
      ...existingMeta,
      batchId,
      role: existingMeta.role || 'snapshot-content',
      source: existingMeta.source || options.source || 'root-archive',
      displayKey: existingMeta.displayKey || String(options.displayKey || '').trim(),
      batchTitle: archiveTitle,
      displayedAt: existingMeta.displayedAt || archivedAt,
      storedAt: archivedAt,
      expiresAt
    };
    clone.updatedAt = archivedAt;
    clone.x = snap((Number(clone.x) || 0) - rootRect.x);
    clone.y = snap((Number(clone.y) || 0) - rootRect.y);
    return clone;
  });

  storageBoard.blocks = [...(Array.isArray(storageBoard.blocks) ? storageBoard.blocks : []), ...movedBlocks];
  rootBoard.blocks = [];
  rootBoard.updatedAt = archivedAt;
  storageBoard.updatedAt = archivedAt;
  boardData.updatedAt = archivedAt;
  return {
    changed: true,
    archivedBatchId: batchId,
    archivedCount: movedBlocks.length,
    discardedCount: existingBlocks.length - movedBlocks.length
  };
}

function collectStorageBatches(storageBoard) {
  const groups = new Map();
  const blocks = Array.isArray(storageBoard?.blocks) ? storageBoard.blocks : [];
  blocks.forEach((block) => {
    if (!block || typeof block !== 'object') {
      return;
    }
    const meta = block.boardDisplay && typeof block.boardDisplay === 'object' ? block.boardDisplay : null;
    const batchId = String(meta?.batchId || '').trim();
    if (!batchId) {
      return;
    }
    if (!groups.has(batchId)) {
      groups.set(batchId, {
        batchId,
        storedAt: String(meta?.storedAt || block.updatedAt || block.createdAt || ''),
        expiresAt: String(meta?.expiresAt || ''),
        blocks: []
      });
    }
    groups.get(batchId).blocks.push(block);
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    rect: rectFromBlocks(group.blocks)
  }));
}

function expandDisplayAttachmentIds(board, blockIds) {
  const ids = Array.isArray(blockIds) ? blockIds : [blockIds];
  const blocks = Array.isArray(board?.blocks) ? board.blocks : [];
  if (!blocks.length || !ids.length) {
    return ids.filter(Boolean);
  }
  const seedIds = new Set(ids.filter(Boolean));
  const attachmentGroupIds = new Set();
  blocks.forEach((block) => {
    if (!block || !seedIds.has(block.id)) {
      return;
    }
    const attachmentGroupId = String(block?.boardDisplay?.attachmentGroupId || '').trim();
    if (attachmentGroupId) {
      attachmentGroupIds.add(attachmentGroupId);
    }
  });
  if (!attachmentGroupIds.size) {
    return Array.from(seedIds);
  }
  const expanded = new Set(seedIds);
  blocks.forEach((block) => {
    const attachmentGroupId = String(block?.boardDisplay?.attachmentGroupId || '').trim();
    if (attachmentGroupId && attachmentGroupIds.has(attachmentGroupId)) {
      expanded.add(block.id);
    }
  });
  return blocks.map((block) => block.id).filter((id) => expanded.has(id));
}

function reflowStorageBatches(boardData) {
  ensureSystemBoards(boardData);
  const storageBoard = boardData.boards[STORAGE_BOARD_ID];
  const groups = collectStorageBatches(storageBoard);
  if (groups.length === 0) {
    return { changed: false, batchCount: 0 };
  }
  groups.sort((a, b) => {
    const at = Date.parse(a.storedAt || 0) || 0;
    const bt = Date.parse(b.storedAt || 0) || 0;
    return bt - at;
  });
  let changed = false;
  let cursorX = DEFAULT_STORAGE_ORIGIN_X;
  let cursorY = DEFAULT_STORAGE_ORIGIN_Y;
  let rowHeight = 0;
  const rowLimitX = DEFAULT_STORAGE_ORIGIN_X + DEFAULT_STORAGE_MAX_ROW_WIDTH;

  groups.forEach((group, index) => {
    const groupWidth = Math.max(GRID_SIZE * 8, ceilSnap(group.rect.width));
    const groupHeight = Math.max(GRID_SIZE * 6, ceilSnap(group.rect.height));
    if (index > 0 && cursorX + groupWidth > rowLimitX) {
      cursorX = DEFAULT_STORAGE_ORIGIN_X;
      cursorY = snap(cursorY + rowHeight + DEFAULT_STORAGE_GAP_Y);
      rowHeight = 0;
    }
    const targetX = snap(cursorX);
    const targetY = snap(cursorY);
    const dx = targetX - group.rect.x;
    const dy = targetY - group.rect.y;
    if (dx !== 0 || dy !== 0) {
      shiftBlocks(group.blocks, dx, dy);
      changed = true;
    }
    cursorX = snap(cursorX + groupWidth + DEFAULT_STORAGE_GAP_X);
    rowHeight = Math.max(rowHeight, groupHeight);
  });

  if (changed) {
    const viewportWidth = Number(storageBoard?.viewport?.viewportWidth) || 0;
    const viewportHeight = Number(storageBoard?.viewport?.viewportHeight) || 0;
    if (viewportWidth > 0 && viewportHeight > 0) {
      const bounds = rectFromBlocks(storageBoard.blocks);
      const contentWidth = Math.max(1, bounds.width + (DEFAULT_STORAGE_VIEW_PADDING * 2));
      const contentHeight = Math.max(1, bounds.height + (DEFAULT_STORAGE_VIEW_PADDING * 2));
      const scale = clamp(
        Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight),
        DEFAULT_STORAGE_MIN_FIT_SCALE,
        DEFAULT_STORAGE_MAX_FIT_SCALE
      );
      storageBoard.viewport = {
        ...storageBoard.viewport,
        scale,
        scrollX: ((bounds.x + (bounds.width / 2)) * scale) - (viewportWidth / 2),
        scrollY: ((bounds.y + (bounds.height / 2)) * scale) - (viewportHeight / 2)
      };
    }
    storageBoard.updatedAt = nowIso();
    boardData.updatedAt = storageBoard.updatedAt;
  }
  return { changed, batchCount: groups.length };
}

function cleanupExpiredStorageBatches(boardData, options = {}) {
  ensureSystemBoards(boardData);
  const storageBoard = boardData.boards[STORAGE_BOARD_ID];
  const blocks = Array.isArray(storageBoard.blocks) ? storageBoard.blocks : [];
  if (blocks.length === 0) {
    return { changed: false, removedBatchIds: [], removedBlocks: 0 };
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const expiredBatchIds = new Set();
  blocks.forEach((block) => {
    const expiresAt = block?.boardDisplay?.expiresAt;
    const batchId = String(block?.boardDisplay?.batchId || '').trim();
    if (!batchId || !expiresAt) {
      return;
    }
    const expiresMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      expiredBatchIds.add(batchId);
    }
  });
  if (expiredBatchIds.size === 0) {
    return { changed: false, removedBatchIds: [], removedBlocks: 0 };
  }
  const kept = blocks.filter((block) => !expiredBatchIds.has(String(block?.boardDisplay?.batchId || '').trim()));
  const removedBlocks = blocks.length - kept.length;
  storageBoard.blocks = kept;
  storageBoard.updatedAt = nowIso();
  boardData.updatedAt = storageBoard.updatedAt;
  reflowStorageBatches(boardData);
  return {
    changed: removedBlocks > 0,
    removedBatchIds: Array.from(expiredBatchIds),
    removedBlocks
  };
}

module.exports = {
  GRID_SIZE,
  ROOT_BOARD_ID,
  STORAGE_BOARD_ID,
  CONCEPTING_BOARD_ID,
  LIBRARY_BOARD_ID,
  CATEGORY_BOARD_IDS,
  STORAGE_TTL_MS,
  isSystemBoardId,
  isCategoryBoardId,
  getSystemBoardIds,
  getCategoryBoardIds,
  getReachabilitySeedBoardIds,
  createStorageBoardRecord,
  createCategoryBoardRecord,
  ensureSystemBoards,
  archiveRootToStorage,
  reflowStorageBatches,
  cleanupExpiredStorageBatches,
  expandDisplayAttachmentIds,
  rectFromBlocks
};
