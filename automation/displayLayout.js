'use strict';

// MARK: IMPORTS
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { GRID_SIZE, ROOT_BOARD_ID, rectFromBlocks } = require('./boardDisplay');
const {
  normalizeAnimated3dPreferences,
  stageAnimated3dPackage
} = require('../blocks/animated3dPackage');

// MARK: CONSTANTS
const DEFAULT_TOP_BAR_HEIGHT = 48;
const DEFAULT_ROOT_SIDE_MARGIN = GRID_SIZE * 2;
const DEFAULT_ROOT_TOP_MARGIN = GRID_SIZE * 2;
const DEFAULT_BATCH_GAP_X = GRID_SIZE;
const DEFAULT_BATCH_GAP_Y = GRID_SIZE;
const DEFAULT_TITLE_HEIGHT = GRID_SIZE * 5;
const DEFAULT_NOTES_LINE_HEIGHT = 26;
const DEFAULT_NOTES_MIN_HEIGHT = GRID_SIZE * 3;
const DEFAULT_NOTES_MAX_HEIGHT = GRID_SIZE * 7;
const DEFAULT_CAPTION_HEIGHT = 26;
const DEFAULT_CAPTION_FONT_SIZE = 13;
const MIN_CAPTION_FONT_SIZE = 10;
const DEFAULT_CARD_ASPECT_MIN = 0.45;
const DEFAULT_CARD_ASPECT_MAX = 2.4;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);

// MARK: HELPERS
function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function snap(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function floorSnap(value) {
  return Math.floor(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function ceilSnap(value) {
  return Math.ceil(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPx(value) {
  return Math.round(Number(value) || 0);
}

function roundToStep(value, step = 4) {
  const safeStep = Math.max(1, Number(step) || 1);
  return Math.round((Number(value) || 0) / safeStep) * safeStep;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function lineCount(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split('\n').length;
}

function resolveNotesHeight(notes) {
  const count = Math.max(1, lineCount(notes));
  return clamp(ceilSnap((count * DEFAULT_NOTES_LINE_HEIGHT) + GRID_SIZE), DEFAULT_NOTES_MIN_HEIGHT, DEFAULT_NOTES_MAX_HEIGHT);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isSvgText(raw) {
  return typeof raw === 'string' && /<svg[\s>]/i.test(raw);
}

function resolveExtFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!type) {
    return '';
  }
  if (type === 'image/png') return '.png';
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/gif') return '.gif';
  if (type === 'image/svg+xml') return '.svg';
  return '';
}

function safeExtFromPath(source) {
  const ext = path.extname(String(source || '').split('?')[0]).toLowerCase();
  if (ext && ext.length <= 8) {
    return ext;
  }
  return '';
}

// MARK: IMPORT
function inferSvgSize(text) {
  const viewBoxMatch = text.match(/viewBox\s*=\s*['"]([^'"]+)['"]/i);
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      return { width: Math.max(1, parts[2]), height: Math.max(1, parts[3]) };
    }
  }
  const widthMatch = text.match(/width\s*=\s*['"]([^'"]+)['"]/i);
  const heightMatch = text.match(/height\s*=\s*['"]([^'"]+)['"]/i);
  if (widthMatch && heightMatch) {
    const width = Number(String(widthMatch[1]).replace(/[^0-9.]/g, ''));
    const height = Number(String(heightMatch[1]).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

async function readImageSize(filePath) {
  const buffer = await fsp.readFile(filePath);
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunkType === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
    if (chunkType === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const blockLength = buffer.readUInt16BE(offset + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }
      offset += 2 + blockLength;
    }
  }
  const maybeText = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
  if (isSvgText(maybeText)) {
    const size = inferSvgSize(maybeText);
    if (size) {
      return size;
    }
  }
  return { width: GRID_SIZE * 24, height: GRID_SIZE * 18 };
}

// Copies or downloads one file into the board's assets folder.
async function importSingleItem(item, context) {
  const source = String(item?.source || item?.path || item?.url || '').trim();
  if (!source) {
    throw new Error('Display item is missing a source');
  }
  let ext = safeExtFromPath(source);
  if (ext === '.gltf') {
    throw new Error('Animated 3D display requires a self-contained .glb file');
  }
  if (ext === '.glb') {
    let packageSource;
    if (isHttpUrl(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Failed to download animated 3D package: ${source} (${response.status})`);
      }
      const sourceName = path.basename(new URL(source).pathname) || 'animated-model.glb';
      const arrayBuffer = await response.arrayBuffer();
      packageSource = { name: sourceName, arrayBuffer: async () => arrayBuffer };
    } else {
      packageSource = path.isAbsolute(source)
        ? source
        : path.resolve(context.cwd || process.cwd(), source);
      await fsp.access(packageSource, fs.constants.R_OK);
    }
    const staged = await stageAnimated3dPackage(packageSource, {
      assetsDir: path.join(context.dataDir, 'assets')
    });
    return {
      type: 'animated3d',
      packageRef: staged.packageRef,
      width: GRID_SIZE * 26,
      height: GRID_SIZE * 18,
      caption: '',
      title: staged.sourceName,
      source,
      role: 'animated3d',
      group: typeof item?.group === 'string' ? item.group.trim() : '',
      priorityTier: typeof item?.priorityTier === 'string' ? item.priorityTier.trim().toLowerCase() : ''
    };
  }
  const mediaType = AUDIO_EXTENSIONS.has(ext) ? 'audio' : 'image';
  const assetDirectoryName = mediaType === 'audio' ? 'audio' : 'images';
  const assetDirectory = path.join(context.dataDir, 'assets', assetDirectoryName);
  await fsp.mkdir(assetDirectory, { recursive: true });

  let destPath = '';
  const ordinal = String(context.index + 1).padStart(2, '0');
  const baseName = `${context.fileStem}-${ordinal}`;

  if (isHttpUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to download media: ${source} (${response.status})`);
    }
    ext = ext || resolveExtFromContentType(response.headers.get('content-type')) || '.png';
    destPath = path.join(assetDirectory, `${baseName}${ext}`);
    const arrayBuffer = await response.arrayBuffer();
    await fsp.writeFile(destPath, Buffer.from(arrayBuffer));
  } else {
    const resolvedSource = path.isAbsolute(source) ? source : path.resolve(context.cwd || process.cwd(), source);
    await fsp.access(resolvedSource, fs.constants.R_OK);
    ext = ext || '.png';
    destPath = path.join(assetDirectory, `${baseName}${ext}`);
    await fsp.copyFile(resolvedSource, destPath);
  }

  const size = mediaType === 'audio'
    ? { width: GRID_SIZE * 22, height: GRID_SIZE * 8 }
    : await readImageSize(destPath);
  const label = typeof item?.caption === 'string' ? item.caption.trim() : '';
  return {
    type: mediaType,
    assetName: `${assetDirectoryName}/${path.basename(destPath)}`,
    destPath,
    width: Math.max(1, Number(size.width) || 1),
    height: Math.max(1, Number(size.height) || 1),
    caption: mediaType === 'audio' ? '' : label,
    title: mediaType === 'audio' ? (label || path.basename(source, ext)) : '',
    source,
    role: typeof item?.role === 'string' ? item.role.trim().toLowerCase() : '',
    group: typeof item?.group === 'string' ? item.group.trim() : '',
    priorityTier: typeof item?.priorityTier === 'string' ? item.priorityTier.trim().toLowerCase() : ''
  };
}

async function importDisplayItems({ items, dataDir, source, batchId, cwd }) {
  const results = [];
  const fileStem = `${String(source || 'display').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'display'}-${batchId}`;
  for (let index = 0; index < items.length; index += 1) {
    const imported = await importSingleItem(items[index], {
      dataDir,
      source,
      batchId,
      fileStem,
      index,
      cwd
    });
    results.push(imported);
  }
  return results;
}

// MARK: BLOCKS
function createDisplayMeta({ batchId, role, source, displayKey, batchTitle, displayedAt, storedAt = '', expiresAt = '', attachmentGroupId = '' }) {
  return {
    batchId,
    role,
    source,
    displayKey: String(displayKey || '').trim(),
    batchTitle: String(batchTitle || '').trim(),
    displayedAt,
    attachmentGroupId: String(attachmentGroupId || '').trim(),
    storedAt,
    expiresAt
  };
}

function createTitleBlock({ x, y, width, height = DEFAULT_TITLE_HEIGHT, content, meta, createdAt, fontScale = 1 }) {
  return {
    id: createId('title'),
    type: 'title',
    x: snap(x),
    y: snap(y),
    width: Math.max(GRID_SIZE * 8, floorSnap(width)),
    height: Math.max(GRID_SIZE * 2, ceilSnap(height)),
    content,
    fontScale,
    showBorder: false,
    showShadow: false,
    showUnderline: false,
    createdAt,
    updatedAt: createdAt,
    boardDisplay: meta
  };
}

function createTextBlock({ x, y, width, height, content, meta, createdAt }) {
  return {
    id: createId('text'),
    type: 'text',
    x: snap(x),
    y: snap(y),
    width: Math.max(GRID_SIZE * 6, floorSnap(width)),
    height: Math.max(GRID_SIZE * 2, ceilSnap(height)),
    content,
    createdAt,
    updatedAt: createdAt,
    boardDisplay: meta
  };
}

function createImageBlock({ x, y, width, height, assetName, meta, createdAt }) {
  return {
    id: createId('image'),
    type: 'image',
    x: roundPx(x),
    y: roundPx(y),
    width: Math.max(GRID_SIZE * 2, Math.round(Number(width) || 0)),
    height: Math.max(GRID_SIZE * 2, Math.round(Number(height) || 0)),
    assetName,
    caption: null,
    showBorder: false,
    createdAt,
    updatedAt: createdAt,
    boardDisplay: meta
  };
}

function createAudioBlock({ x, y, width, height, assetName, title, meta, createdAt }) {
  return {
    id: createId('audio'),
    type: 'audio',
    x: roundPx(x),
    y: roundPx(y),
    width: Math.max(GRID_SIZE * 6, Math.round(Number(width) || 0)),
    height: Math.max(GRID_SIZE * 4, Math.round(Number(height) || 0)),
    assetName,
    title: String(title || 'Audio').trim() || 'Audio',
    volume: 0.9,
    createdAt,
    updatedAt: createdAt,
    boardDisplay: meta
  };
}

function estimateCaptionLines(value, width) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }
  const safeWidth = Math.max(80, Number(width) || 0);
  const estimatedCharsPerLine = Math.max(8, Math.floor((safeWidth - 10) / 7.2));
  if (text.length <= estimatedCharsPerLine) {
    return 1;
  }
  return 2;
}

function estimateBatchCaptionHeight(importedItems, width) {
  const maxLines = importedItems.reduce((max, item) => Math.max(max, estimateCaptionLines(item.caption, width)), 0);
  if (!maxLines) {
    return 0;
  }
  return Math.max(DEFAULT_CAPTION_HEIGHT, Math.round((DEFAULT_CAPTION_HEIGHT - 2) * maxLines));
}

function estimateCaptionFontSize(text, width) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return DEFAULT_CAPTION_FONT_SIZE;
  }
  const safeWidth = Math.max(GRID_SIZE * 4, Number(width) || 0);
  const availableWidth = Math.max(80, safeWidth - 10);
  const estimatedTextWidthAtDefault = normalized.length * 7.2;
  const scale = Math.min(1, availableWidth / Math.max(estimatedTextWidthAtDefault, 1));
  const fontSize = DEFAULT_CAPTION_FONT_SIZE * scale;
  return Math.round(clamp(fontSize, MIN_CAPTION_FONT_SIZE, DEFAULT_CAPTION_FONT_SIZE) * 10) / 10;
}

function computeRepresentativeAspect(importedItems) {
  const ratios = importedItems
    .map((item) => (Number(item.width) || 1) / Math.max(1, Number(item.height) || 1))
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) {
    return 16 / 9;
  }
  if (ratios.length === 1) {
    return ratios[0];
  }
  const median = ratios[Math.floor(ratios.length / 2)];
  return clamp(median, DEFAULT_CARD_ASPECT_MIN, DEFAULT_CARD_ASPECT_MAX);
}

function resolveDisplayImageCaption(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return null;
  }
  return {
    text: normalized,
    enabled: true,
    placement: 'below',
    visibility: 'always',
    extendBorder: false
  };
}

function resolveDisplayTitleLayout(title, itemCount) {
  const lines = Math.max(1, lineCount(title));
  if (itemCount >= 10) {
    return {
      height: clamp(ceilSnap((lines * 26) + 12), GRID_SIZE * 2, GRID_SIZE * 3),
      fontScale: 0.56
    };
  }
  if (itemCount >= 6) {
    return {
      height: clamp(ceilSnap((lines * 30) + 16), GRID_SIZE * 2, GRID_SIZE * 4),
      fontScale: 0.72
    };
  }
  return {
    height: DEFAULT_TITLE_HEIGHT,
    fontScale: 1
  };
}

function createDisplayImageBlock({ x, y, width, mediaHeight, captionHeight, caption, assetName, batchId, source, displayKey, batchTitle, displayedAt, role = 'image', captionSingleLine = true }) {
  const block = createImageBlock({
    x,
    y,
    width,
    height: mediaHeight + captionHeight,
    assetName,
    createdAt: displayedAt,
    meta: createDisplayMeta({ batchId, role, source, displayKey, batchTitle, displayedAt })
  });
  block.caption = resolveDisplayImageCaption(caption);
  block.displayLayout = {
    mediaHeight,
    captionHeight,
    fitMode: 'contain',
    objectPosition: 'center center',
    captionFontSize: caption ? estimateCaptionFontSize(caption, width) : DEFAULT_CAPTION_FONT_SIZE,
    captionSingleLine
  };
  return block;
}

function createDisplayMediaBlock({ entry, x, y, width, mediaHeight, captionHeight, batchId, source, displayKey, batchTitle, displayedAt, role = 'image', captionSingleLine = true }) {
  if (entry?.type === 'animated3d') {
    return {
      id: createId('animated3d'),
      type: 'animated3d',
      x: snap(x),
      y: snap(y),
      width: Math.max(GRID_SIZE * 16, snap(width)),
      height: Math.max(GRID_SIZE * 10, snap(mediaHeight + captionHeight)),
      packageRef: entry.packageRef,
      preferences: normalizeAnimated3dPreferences(),
      createdAt: displayedAt,
      updatedAt: displayedAt,
      boardDisplay: createDisplayMeta({
        batchId,
        role: 'animated3d',
        source,
        displayKey,
        batchTitle,
        displayedAt
      })
    };
  }
  if (entry?.type === 'audio') {
    return createAudioBlock({
      x,
      y,
      width,
      height: mediaHeight,
      assetName: entry.assetName,
      title: entry.title,
      createdAt: displayedAt,
      meta: createDisplayMeta({ batchId, role: 'audio', source, displayKey, batchTitle, displayedAt })
    });
  }
  return createDisplayImageBlock({
    x,
    y,
    width,
    mediaHeight,
    captionHeight,
    caption: entry?.caption,
    assetName: entry?.assetName,
    batchId,
    source,
    displayKey,
    batchTitle,
    displayedAt,
    role,
    captionSingleLine
  });
}

function createDisplayImageBlocksFromLayout({
  importedItems,
  batchId,
  source,
  displayKey,
  batchTitle,
  displayedAt,
  x,
  y,
  columns,
  cardWidth,
  mediaHeight,
  captionHeight,
  cardHeight
}) {
  const blocks = [];
  const hasCaptions = importedItems.some((item) => !!String(item?.caption || '').trim());
  for (let index = 0; index < importedItems.length; index += 1) {
    const entry = importedItems[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const block = createDisplayMediaBlock({
      entry,
      x: x + (column * (cardWidth + DEFAULT_BATCH_GAP_X)),
      y: y + (row * (cardHeight + DEFAULT_BATCH_GAP_Y)),
      width: cardWidth,
      mediaHeight,
      captionHeight: hasCaptions ? captionHeight : 0,
      batchId,
      source,
      displayKey,
      batchTitle,
      displayedAt,
      role: 'image',
      captionSingleLine: hasCaptions
    });
    blocks.push(block);
  }
  return blocks;
}

// MARK: LAYOUT
function getRootViewportSize(dataDir, boardData) {
  const rootViewport = boardData?.boards?.[ROOT_BOARD_ID]?.viewport || boardData?.viewport || {};
  const liveWidth = Number(rootViewport.viewportWidth);
  const liveHeight = Number(rootViewport.viewportHeight);
  if (liveWidth > 0 && liveHeight > 0) {
    return { width: liveWidth, height: liveHeight, source: 'board-viewport' };
  }
  // No saved viewport yet, so guess from the window size.
  const statePath = path.join(dataDir, 'window-state.json');
  try {
    if (fs.existsSync(statePath)) {
      const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const width = Math.max(GRID_SIZE * 24, Math.round(Number(raw.width) || 0));
      const height = Math.max(GRID_SIZE * 18, Math.round((Number(raw.height) || 0) - DEFAULT_TOP_BAR_HEIGHT));
      return { width, height, source: 'window-state' };
    }
  } catch {}
  return { width: GRID_SIZE * 42, height: GRID_SIZE * 26, source: 'default' };
}

function computeGridColumns(count, viewportWidth, viewportHeight) {
  if (count <= 1) {
    return 1;
  }
  const aspect = Math.max(0.5, Number(viewportWidth) / Math.max(1, Number(viewportHeight)));
  const ideal = Math.ceil(Math.sqrt(count * aspect));
  return clamp(ideal, 1, Math.min(count, 4));
}

function buildRootGridCandidate({ columns, availableWidth, contentHeight, importedItems }) {
  const count = importedItems.length;
  const rows = Math.max(1, Math.ceil(count / columns));
  const representativeAspect = computeRepresentativeAspect(importedItems);
  const widthBound = Math.max(GRID_SIZE * 4, (availableWidth - (DEFAULT_BATCH_GAP_X * Math.max(0, columns - 1))) / columns);
  let captionHeight = estimateBatchCaptionHeight(importedItems, widthBound);
  let mediaHeight = Math.min(
    widthBound / representativeAspect,
    (contentHeight - (DEFAULT_BATCH_GAP_Y * Math.max(0, rows - 1)) - (rows * captionHeight)) / rows
  );
  if (!Number.isFinite(mediaHeight) || mediaHeight <= 0) {
    mediaHeight = GRID_SIZE * 3;
  }
  let cardWidth = clamp(roundToStep(mediaHeight * representativeAspect, 4), GRID_SIZE * 4, widthBound);
  captionHeight = estimateBatchCaptionHeight(importedItems, cardWidth);
  mediaHeight = Math.min(
    cardWidth / representativeAspect,
    (contentHeight - (DEFAULT_BATCH_GAP_Y * Math.max(0, rows - 1)) - (rows * captionHeight)) / rows
  );
  mediaHeight = clamp(roundToStep(mediaHeight, 4), GRID_SIZE * 3, GRID_SIZE * 18);
  cardWidth = clamp(roundToStep(mediaHeight * representativeAspect, 4), GRID_SIZE * 4, widthBound);
  const cardHeight = mediaHeight + captionHeight;
  const gridWidth = (columns * cardWidth) + (DEFAULT_BATCH_GAP_X * Math.max(0, columns - 1));
  const gridHeight = (rows * cardHeight) + (DEFAULT_BATCH_GAP_Y * Math.max(0, rows - 1));
  const overflowX = Math.max(0, gridWidth - availableWidth);
  const overflowY = Math.max(0, gridHeight - contentHeight);
  const overflowPenalty = (overflowX + overflowY) * 10000;
  const availableAspect = availableWidth / Math.max(1, contentHeight);
  const gridAspect = gridWidth / Math.max(1, gridHeight);
  const shapePenalty = Math.abs(gridAspect - availableAspect) * 22000;
  const cardArea = cardWidth * mediaHeight;
  const score = (cardArea * 5) - shapePenalty - overflowPenalty - (rows * 400) - (Math.abs(columns - rows) * 50);

  return {
    columns,
    rows,
    cardWidth,
    mediaHeight,
    captionHeight,
    cardHeight,
    gridWidth,
    gridHeight,
    overflowX,
    overflowY,
    score
  };
}

function safeAspect(item) {
  return clamp((Number(item?.width) || 1) / Math.max(1, Number(item?.height) || 1), 0.18, 8);
}

function estimateCaptionHeight(items, widthResolver) {
  const anyCaptions = items.some((item) => !!String(item?.caption || '').trim());
  if (!anyCaptions) {
    return 0;
  }
  const tallest = items.reduce((max, item, index) => {
    const width = Math.max(GRID_SIZE * 2, Number(widthResolver(item, index)) || 0);
    return Math.max(max, estimateBatchCaptionHeight([item], width));
  }, 0);
  return Math.max(DEFAULT_CAPTION_HEIGHT, tallest || 0);
}

function buildAspectRowCandidate({ items, availableWidth, targetMediaHeight, minMediaHeight, maxMediaHeight, gapX }) {
  const safeGapX = Math.max(0, Number(gapX) || 0);
  const aspects = items.map((item) => safeAspect(item));
  const fittedMediaHeight = Math.max(
    Number(minMediaHeight) || 0,
    Math.min(
      Number(maxMediaHeight) || Number(targetMediaHeight) || GRID_SIZE * 4,
      (availableWidth - (safeGapX * Math.max(0, items.length - 1))) / Math.max(0.01, sum(aspects))
    )
  );
  const mediaHeight = roundToStep(fittedMediaHeight, 2);
  const widths = aspects.map((aspect) => roundToStep(mediaHeight * aspect, 2));
  const captionHeight = estimateCaptionHeight(items, (_item, index) => widths[index]);
  const rowHeight = mediaHeight + captionHeight;
  const rowWidth = sum(widths) + (safeGapX * Math.max(0, widths.length - 1));
  return {
    items,
    widths,
    mediaHeight,
    captionHeight,
    rowHeight,
    rowWidth,
    gapX: safeGapX
  };
}

function buildAspectRows({ items, availableWidth, targetMediaHeight, minMediaHeight, maxMediaHeight, gapX, maxItemsPerRow = 5 }) {
  const rows = [];
  if (!Array.isArray(items) || items.length === 0) {
    return rows;
  }
  let index = 0;
  while (index < items.length) {
    const remaining = items.length - index;
    let rowSize = Math.min(maxItemsPerRow, remaining);
    // Avoid leaving a single item alone on the last row.
    if (remaining > maxItemsPerRow && remaining - rowSize === 1) {
      rowSize -= 1;
    }
    const rowItems = items.slice(index, index + rowSize);
    rows.push(buildAspectRowCandidate({
      items: rowItems,
      availableWidth,
      targetMediaHeight,
      minMediaHeight,
      maxMediaHeight,
      gapX
    }));
    index += rowSize;
  }
  return rows;
}

function shouldUseAspectAwareRootLayout(importedItems) {
  if (!Array.isArray(importedItems) || importedItems.length < 2) {
    return false;
  }
  const aspects = importedItems.map((item) => safeAspect(item)).filter((value) => Number.isFinite(value) && value > 0);
  if (aspects.length < 2) {
    return false;
  }
  const minAspect = Math.min(...aspects);
  const maxAspect = Math.max(...aspects);
  return maxAspect / Math.max(0.01, minAspect) >= 1.8;
}

function layoutAudioRootDisplayBatch({ title, notes, importedItems, batchId, source, displayKey, displayedAt, dataDir, boardData }) {
  const viewport = getRootViewportSize(dataDir, boardData);
  const columns = Math.max(1, Math.min(4, importedItems.length));
  const rows = Math.ceil(importedItems.length / columns);
  const cardWidth = GRID_SIZE * 13;
  const cardHeight = GRID_SIZE * 5;
  const gridWidth = (columns * cardWidth) + (DEFAULT_BATCH_GAP_X * Math.max(0, columns - 1));
  const gridHeight = (rows * cardHeight) + (DEFAULT_BATCH_GAP_Y * Math.max(0, rows - 1));
  const availableWidth = Math.max(GRID_SIZE * 16, viewport.width - (DEFAULT_ROOT_SIDE_MARGIN * 2));
  const groupWidth = Math.max(gridWidth, GRID_SIZE * 18);
  const anchorX = roundPx(DEFAULT_ROOT_SIDE_MARGIN + Math.max(0, (availableWidth - groupWidth) / 2));
  const normalizedNotes = String(notes || '').trim();
  const titleLayout = title ? resolveDisplayTitleLayout(title, importedItems.length) : { height: 0, fontScale: 1 };
  const notesHeight = normalizedNotes ? resolveNotesHeight(normalizedNotes) : 0;
  const contentTop = DEFAULT_ROOT_TOP_MARGIN
    + (title ? titleLayout.height + GRID_SIZE : 0)
    + (normalizedNotes ? notesHeight + GRID_SIZE : 0);
  const blocks = [];

  if (title) {
    blocks.push(createTitleBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN,
      width: groupWidth,
      height: titleLayout.height,
      content: title,
      createdAt: displayedAt,
      fontScale: titleLayout.fontScale,
      meta: createDisplayMeta({ batchId, role: 'title', source, displayKey, batchTitle: title, displayedAt })
    }));
  }
  if (normalizedNotes) {
    blocks.push(createTextBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN + (title ? titleLayout.height + GRID_SIZE : 0),
      width: groupWidth,
      height: notesHeight,
      content: normalizedNotes,
      createdAt: displayedAt,
      meta: createDisplayMeta({ batchId, role: 'notes', source, displayKey, batchTitle: title, displayedAt })
    }));
  }

  importedItems.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    blocks.push(createDisplayMediaBlock({
      entry,
      x: anchorX + (column * (cardWidth + DEFAULT_BATCH_GAP_X)),
      y: contentTop + (row * (cardHeight + DEFAULT_BATCH_GAP_Y)),
      width: cardWidth,
      mediaHeight: cardHeight,
      captionHeight: 0,
      batchId,
      source,
      displayKey,
      batchTitle: title,
      displayedAt,
      role: 'audio'
    }));
  });

  return {
    blocks,
    bounds: rectFromBlocks(blocks),
    viewport,
    audioGrid: { columns, rows, width: gridWidth, height: gridHeight }
  };
}

function layoutRootDisplayBatch({ title, notes, importedItems, batchId, source, displayKey, displayedAt, dataDir, boardData }) {
  if (importedItems.length > 0 && importedItems.every((item) => item.type === 'audio')) {
    return layoutAudioRootDisplayBatch({
      title,
      notes,
      importedItems,
      batchId,
      source,
      displayKey,
      displayedAt,
      dataDir,
      boardData
    });
  }
  const viewport = getRootViewportSize(dataDir, boardData);
  const availableWidth = Math.max(GRID_SIZE * 16, viewport.width - (DEFAULT_ROOT_SIDE_MARGIN * 2));
  const availableHeight = Math.max(GRID_SIZE * 12, viewport.height - (DEFAULT_ROOT_TOP_MARGIN * 2));
  notes = String(notes || '').trim();
  const notesHeight = notes ? resolveNotesHeight(notes) : 0;
  const titleLayout = title ? resolveDisplayTitleLayout(title, importedItems.length) : { height: 0, fontScale: 1 };
  const titleHeight = title ? titleLayout.height : 0;
  const contentTop = DEFAULT_ROOT_TOP_MARGIN + titleHeight + (title ? GRID_SIZE : 0) + notesHeight + (notes ? GRID_SIZE : 0);
  const contentHeight = Math.max(GRID_SIZE * 8, availableHeight - (contentTop - DEFAULT_ROOT_TOP_MARGIN));
  const count = importedItems.length;
  const hasCaptions = importedItems.some((item) => !!String(item?.caption || '').trim());
  if (shouldUseAspectAwareRootLayout(importedItems)) {
    // Mixed shapes go in rows sized by aspect instead of a fixed grid.
    const rows = buildAspectRows({
      items: importedItems,
      availableWidth,
      targetMediaHeight: Math.min(360, Math.max(190, contentHeight * 0.34)),
      minMediaHeight: 160,
      maxMediaHeight: Math.min(420, Math.max(190, contentHeight * 0.48)),
      gapX: DEFAULT_BATCH_GAP_X,
      maxItemsPerRow: 4
    });
    const gridWidth = rows.reduce((max, row) => Math.max(max, row.rowWidth), GRID_SIZE * 18);
    const gridHeight = sum(rows.map((row) => row.rowHeight)) + (DEFAULT_BATCH_GAP_Y * Math.max(0, rows.length - 1));
    const groupWidth = Math.max(gridWidth, GRID_SIZE * 18);
    const anchorX = roundPx(DEFAULT_ROOT_SIDE_MARGIN + Math.max(0, (availableWidth - groupWidth) / 2));
    const blocks = [];
    if (title) {
      blocks.push(createTitleBlock({
        x: anchorX,
        y: DEFAULT_ROOT_TOP_MARGIN,
        width: groupWidth,
        height: titleLayout.height,
        content: title,
        createdAt: displayedAt,
        fontScale: titleLayout.fontScale,
        meta: createDisplayMeta({ batchId, role: 'title', source, displayKey, batchTitle: title, displayedAt })
      }));
    }
    if (notes) {
      blocks.push(createTextBlock({
        x: anchorX,
        y: DEFAULT_ROOT_TOP_MARGIN + titleHeight + (title ? GRID_SIZE : 0),
        width: groupWidth,
        height: notesHeight,
        content: notes,
        createdAt: displayedAt,
        meta: createDisplayMeta({ batchId, role: 'notes', source, displayKey, batchTitle: title, displayedAt })
      }));
    }
    let cursorY = roundPx(contentTop + Math.max(0, (contentHeight - gridHeight) / 2));
    rows.forEach((row) => {
      let cursorX = roundPx(anchorX + Math.max(0, (groupWidth - row.rowWidth) / 2));
      row.items.forEach((entry, index) => {
        const blockWidth = row.widths[index];
        const block = createDisplayMediaBlock({
          entry,
          x: cursorX,
          y: cursorY,
          width: blockWidth,
          mediaHeight: row.mediaHeight,
          captionHeight: hasCaptions ? row.captionHeight : 0,
          batchId,
          source,
          displayKey,
          batchTitle: title,
          displayedAt,
          role: 'image',
          captionSingleLine: hasCaptions
        });
        blocks.push(block);
        cursorX += blockWidth + row.gapX;
      });
      cursorY += row.rowHeight + DEFAULT_BATCH_GAP_Y;
    });

    return {
      blocks,
      bounds: rectFromBlocks(blocks),
      viewport
    };
  }
  const maxColumns = Math.max(1, Math.min(count, 6));
  let bestCandidate = null;
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const candidate = buildRootGridCandidate({ columns, availableWidth, contentHeight, importedItems });
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }
  const {
    columns,
    rows,
    cardWidth,
    mediaHeight,
    captionHeight,
    cardHeight,
    gridWidth,
    gridHeight
  } = bestCandidate || buildRootGridCandidate({ columns: computeGridColumns(count, availableWidth, contentHeight), availableWidth, contentHeight, importedItems });
  const groupWidth = Math.max(gridWidth, GRID_SIZE * 18);
  const anchorX = roundPx(DEFAULT_ROOT_SIDE_MARGIN + Math.max(0, (availableWidth - groupWidth) / 2));

  const blocks = [];
  if (title) {
    blocks.push(createTitleBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN,
      width: groupWidth,
      height: titleLayout.height,
      content: title,
      createdAt: displayedAt,
      fontScale: titleLayout.fontScale,
      meta: createDisplayMeta({ batchId, role: 'title', source, displayKey, batchTitle: title, displayedAt })
    }));
  }
  if (notes) {
    blocks.push(createTextBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN + titleHeight + (title ? GRID_SIZE : 0),
      width: groupWidth,
      height: notesHeight,
      content: notes,
      createdAt: displayedAt,
      meta: createDisplayMeta({ batchId, role: 'notes', source, displayKey, batchTitle: title, displayedAt })
    }));
  }

  let cursorY = roundPx(contentTop + Math.max(0, (contentHeight - gridHeight) / 2));
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const rowCount = Math.min(columns, count - (rowIndex * columns));
    const rowWidth = (rowCount * cardWidth) + (DEFAULT_BATCH_GAP_X * Math.max(0, rowCount - 1));
    let cursorX = roundPx(anchorX + Math.max(0, (groupWidth - rowWidth) / 2));
    for (let columnIndex = 0; columnIndex < rowCount; columnIndex += 1) {
      const entry = importedItems[(rowIndex * columns) + columnIndex];
      const block = createDisplayMediaBlock({
        entry,
        x: cursorX,
        y: cursorY,
        width: cardWidth,
        mediaHeight,
        captionHeight: hasCaptions ? captionHeight : 0,
        batchId,
        source,
        displayKey,
        batchTitle: title,
        displayedAt,
        role: 'image',
        captionSingleLine: hasCaptions
      });
      blocks.push(block);
      cursorX += cardWidth + DEFAULT_BATCH_GAP_X;
    }
    cursorY += cardHeight + DEFAULT_BATCH_GAP_Y;
  }

  return {
    blocks,
    bounds: rectFromBlocks(blocks),
    viewport
  };
}

// Shows every image at its real pixel size, two per row.
function layoutNativePixelDisplayBatch({ title, notes, importedItems, batchId, source, displayKey, displayedAt, dataDir, boardData }) {
  const viewport = getRootViewportSize(dataDir, boardData);
  const columns = importedItems.length <= 1 ? 1 : 2;
  const rows = [];
  for (let index = 0; index < importedItems.length; index += columns) {
    const items = importedItems.slice(index, index + columns);
    const captionHeight = items.some((item) => !!String(item.caption || '').trim()) ? DEFAULT_CAPTION_HEIGHT : 0;
    rows.push({
      items,
      captionHeight,
      width: sum(items.map((item) => item.width)) + (DEFAULT_BATCH_GAP_X * Math.max(0, items.length - 1)),
      height: Math.max(...items.map((item) => item.height + captionHeight))
    });
  }

  const gridWidth = Math.max(GRID_SIZE * 2, ...rows.map((row) => row.width));
  const gridHeight = sum(rows.map((row) => row.height)) + (DEFAULT_BATCH_GAP_Y * Math.max(0, rows.length - 1));
  const titleLayout = title ? resolveDisplayTitleLayout(title, importedItems.length) : { height: 0, fontScale: 1 };
  const titleGap = title ? GRID_SIZE : 0;
  const notesHeight = notes ? resolveNotesHeight(notes) : 0;
  const notesGap = notes ? GRID_SIZE : 0;
  const anchorX = DEFAULT_ROOT_SIDE_MARGIN;
  let cursorY = DEFAULT_ROOT_TOP_MARGIN;
  const blocks = [];

  if (title) {
    blocks.push(createTitleBlock({
      x: anchorX,
      y: cursorY,
      width: gridWidth,
      height: titleLayout.height,
      content: title,
      createdAt: displayedAt,
      fontScale: titleLayout.fontScale,
      meta: createDisplayMeta({ batchId, role: 'title', source, displayKey, batchTitle: title, displayedAt })
    }));
    cursorY += titleLayout.height + titleGap;
  }
  if (notes) {
    blocks.push(createTextBlock({
      x: anchorX,
      y: cursorY,
      width: gridWidth,
      height: notesHeight,
      content: notes,
      createdAt: displayedAt,
      meta: createDisplayMeta({ batchId, role: 'notes', source, displayKey, batchTitle: title, displayedAt })
    }));
    cursorY += notesHeight + notesGap;
  }

  rows.forEach((row) => {
    let cursorX = anchorX + Math.max(0, (gridWidth - row.width) / 2);
    row.items.forEach((entry) => {
      const block = createDisplayMediaBlock({
        entry,
        x: cursorX,
        y: cursorY,
        width: entry.width,
        mediaHeight: entry.height,
        captionHeight: row.captionHeight,
        batchId,
        source,
        displayKey,
        batchTitle: title,
        displayedAt,
        role: 'image',
        captionSingleLine: true
      });
      if (block.type === 'image') {
        block.displayLayout.nativePixels = true;
        block.displayLayout.sourceWidth = entry.width;
        block.displayLayout.sourceHeight = entry.height;
      }
      blocks.push(block);
      cursorX += entry.width + DEFAULT_BATCH_GAP_X;
    });
    cursorY += row.height + DEFAULT_BATCH_GAP_Y;
  });

  return {
    blocks,
    bounds: rectFromBlocks(blocks),
    viewport,
    nativePixelGrid: { columns, width: gridWidth, height: gridHeight }
  };
}

function pickAppendCandidate({ importedItems, availableWidth, availableHeight }) {
  const maxColumns = Math.max(1, Math.min(importedItems.length, 4));
  let bestCandidate = null;
  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const candidate = buildRootGridCandidate({
      columns,
      availableWidth,
      contentHeight: availableHeight,
      importedItems
    });
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }
  return bestCandidate || buildRootGridCandidate({
    columns: computeGridColumns(importedItems.length, availableWidth, availableHeight),
    availableWidth,
    contentHeight: availableHeight,
    importedItems
  });
}

// Puts new items to the right of what's already on Root, or below it if there's no room.
function layoutAppendDisplayBatch({ importedItems, existingBlocks, batchId, source, displayKey, displayedAt, dataDir, boardData }) {
  const viewport = getRootViewportSize(dataDir, boardData);
  const existingBounds = rectFromBlocks(existingBlocks);
  const margin = DEFAULT_ROOT_SIDE_MARGIN;
  const gap = DEFAULT_BATCH_GAP_X;
  const safeViewportWidth = Math.max(GRID_SIZE * 24, viewport.width);
  const safeViewportHeight = Math.max(GRID_SIZE * 18, viewport.height);

  if (!existingBlocks.length || existingBounds.width <= 0 || existingBounds.height <= 0) {
    return layoutRootDisplayBatch({
      title: '',
      notes: '',
      importedItems,
      batchId,
      source,
      displayKey,
      displayedAt,
      dataDir,
      boardData
    });
  }

  const rightX = snap(existingBounds.x + existingBounds.width + gap);
  const rightWidth = safeViewportWidth - rightX - margin;
  const sideHeight = Math.max(GRID_SIZE * 8, existingBounds.height);
  const sideFits = rightWidth >= GRID_SIZE * 10;
  const availableWidth = sideFits
    ? rightWidth
    : Math.max(GRID_SIZE * 16, Math.min(existingBounds.width, safeViewportWidth - (margin * 2)));
  const availableHeight = sideFits
    ? sideHeight
    : Math.max(GRID_SIZE * 8, safeViewportHeight - margin);
  const candidate = pickAppendCandidate({ importedItems, availableWidth, availableHeight });
  const x = sideFits
    ? rightX
    : snap(existingBounds.x);
  const y = sideFits
    ? snap(existingBounds.y + Math.max(0, (sideHeight - candidate.gridHeight) / 2))
    : snap(existingBounds.y + existingBounds.height + gap);

  const blocks = createDisplayImageBlocksFromLayout({
    importedItems,
    batchId,
    source,
    displayKey,
    batchTitle: '',
    displayedAt,
    x,
    y,
    columns: candidate.columns,
    cardWidth: candidate.cardWidth,
    mediaHeight: candidate.mediaHeight,
    captionHeight: candidate.captionHeight,
    cardHeight: candidate.cardHeight
  });

  return {
    blocks,
    bounds: rectFromBlocks([...existingBlocks, ...blocks]),
    viewport
  };
}

// Items with role 'scene' get a big top row, everything else goes in smaller rows below.
function layoutReferenceReviewBatch({ title, notes, importedItems, batchId, source, displayKey, displayedAt, dataDir, boardData }) {
  const viewport = getRootViewportSize(dataDir, boardData);
  const availableWidth = Math.max(GRID_SIZE * 20, viewport.width - (DEFAULT_ROOT_SIDE_MARGIN * 2));
  const availableHeight = Math.max(GRID_SIZE * 14, viewport.height - (DEFAULT_ROOT_TOP_MARGIN * 2));
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedNotes = typeof notes === 'string' ? notes.trim() : '';
  const titleLayout = normalizedTitle ? resolveDisplayTitleLayout(normalizedTitle, importedItems.length) : { height: 0, fontScale: 1 };
  const titleHeight = normalizedTitle ? titleLayout.height : 0;
  const notesHeight = normalizedNotes ? resolveNotesHeight(normalizedNotes) : 0;
  const contentTop = DEFAULT_ROOT_TOP_MARGIN + titleHeight + (normalizedTitle ? GRID_SIZE : 0) + notesHeight + (normalizedNotes ? GRID_SIZE : 0);
  const contentHeight = Math.max(GRID_SIZE * 10, availableHeight - (contentTop - DEFAULT_ROOT_TOP_MARGIN));
  const blocks = [];
  const groupWidth = availableWidth;
  const anchorX = roundPx(DEFAULT_ROOT_SIDE_MARGIN);

  if (normalizedTitle) {
    blocks.push(createTitleBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN,
      width: groupWidth,
      height: titleLayout.height,
      content: normalizedTitle,
      createdAt: displayedAt,
      fontScale: titleLayout.fontScale,
      meta: createDisplayMeta({ batchId, role: 'title', source, displayKey, batchTitle: normalizedTitle, displayedAt })
    }));
  }
  if (normalizedNotes) {
    blocks.push(createTextBlock({
      x: anchorX,
      y: DEFAULT_ROOT_TOP_MARGIN + titleHeight + (normalizedTitle ? GRID_SIZE : 0),
      width: groupWidth,
      height: notesHeight,
      content: normalizedNotes,
      createdAt: displayedAt,
      meta: createDisplayMeta({ batchId, role: 'notes', source, displayKey, batchTitle: normalizedTitle, displayedAt })
    }));
  }

  const sceneItems = importedItems.filter((item) => item.role === 'scene');
  const supportItems = importedItems.filter((item) => item.role !== 'scene');
  const hasCaptions = importedItems.some((item) => !!String(item?.caption || '').trim());
  const rowGapY = GRID_SIZE * 0.75;
  let cursorY = roundPx(contentTop);

  if (sceneItems.length > 0) {
    const sceneRow = buildAspectRowCandidate({
      items: sceneItems.slice(0, 3),
      availableWidth,
      targetMediaHeight: Math.min(360, contentHeight * 0.34),
      minMediaHeight: Math.min(220, contentHeight * 0.24),
      maxMediaHeight: Math.min(420, contentHeight * 0.42),
      gapX: GRID_SIZE * 0.75
    });
    let cursorX = roundPx(anchorX + Math.max(0, (groupWidth - sceneRow.rowWidth) / 2));
    sceneRow.items.forEach((item, index) => {
      const blockWidth = sceneRow.widths[index];
      blocks.push(createDisplayMediaBlock({
        entry: item,
        x: cursorX,
        y: cursorY,
        width: blockWidth,
        mediaHeight: sceneRow.mediaHeight,
        captionHeight: hasCaptions ? sceneRow.captionHeight : 0,
        batchId,
        source,
        displayKey,
        batchTitle: normalizedTitle,
        displayedAt,
        role: 'image',
        captionSingleLine: false
      }));
      cursorX += blockWidth + sceneRow.gapX;
    });
    cursorY += sceneRow.rowHeight + rowGapY;
  }

  const supportRows = buildAspectRows({
    items: supportItems,
    availableWidth,
    targetMediaHeight: Math.min(236, Math.max(172, contentHeight * 0.2)),
    minMediaHeight: 164,
    maxMediaHeight: 244,
    gapX: GRID_SIZE * 0.6,
    maxItemsPerRow: 4
  });
  supportRows.forEach((row) => {
    let cursorX = roundPx(anchorX + Math.max(0, (groupWidth - row.rowWidth) / 2));
    row.items.forEach((item, index) => {
      const blockWidth = row.widths[index];
      blocks.push(createDisplayMediaBlock({
        entry: item,
        x: cursorX,
        y: cursorY,
        width: blockWidth,
        mediaHeight: row.mediaHeight,
        captionHeight: hasCaptions ? row.captionHeight : 0,
        batchId,
        source,
        displayKey,
        batchTitle: normalizedTitle,
        displayedAt,
        role: 'image',
        captionSingleLine: false
      }));
      cursorX += blockWidth + row.gapX;
    });
    cursorY += row.rowHeight + rowGapY;
  });

  return {
    blocks,
    bounds: rectFromBlocks(blocks),
    viewport
  };
}

function layoutDisplayBatch({ preset = '', append = false, existingBlocks = [], ...options }) {
  const normalizedPreset = String(preset || '').trim().toLowerCase();
  if (append) {
    if (normalizedPreset === 'native-pixels') {
      throw new Error('native-pixels shows a batch on its own and cannot append');
    }
    return layoutAppendDisplayBatch({ ...options, existingBlocks });
  }
  if (normalizedPreset === 'native-pixels') {
    return layoutNativePixelDisplayBatch(options);
  }
  if (normalizedPreset === 'reference-review') {
    return layoutReferenceReviewBatch(options);
  }
  if (normalizedPreset) {
    throw new Error(`Unknown layout: ${preset}`);
  }
  return layoutRootDisplayBatch(options);
}

module.exports = {
  AUDIO_EXTENSIONS,
  createId,
  inferSvgSize,
  readImageSize,
  importSingleItem,
  importDisplayItems,
  getRootViewportSize,
  createDisplayMeta,
  createTitleBlock,
  createTextBlock,
  createImageBlock,
  createAudioBlock,
  createDisplayImageBlock,
  createDisplayMediaBlock,
  createDisplayImageBlocksFromLayout,
  layoutAudioRootDisplayBatch,
  layoutRootDisplayBatch,
  layoutNativePixelDisplayBatch,
  layoutAppendDisplayBatch,
  layoutReferenceReviewBatch,
  layoutDisplayBatch
};
