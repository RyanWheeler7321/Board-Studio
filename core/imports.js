'use strict';

// MARK: IMPORT HANDLERS
const env = require('./state');
const { dom, state, constants, utils, mediaBlocks, linkBlocks, images, movement, management, path, fs } = env;

function runAsync(task, failureMessage) {
    Promise.resolve().then(task).catch((error) => {
        console.error('Import task failed', error);
        if (failureMessage) {
            utils.showToast(failureMessage);
        }
    });
}

function isFinitePoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function rememberPastePosition(point) {
    state.lastPointerBoardPos = point;
    state.lastPointerUpdateTs = Date.now();
    return point;
}

function resolvePastePosition() {
    const lastPos = state.lastPointerBoardPos;
    if (state.lastPointerUpdateTs > 0 && isFinitePoint(lastPos)) {
        return lastPos;
    }
    const container = dom.boardContainer;
    if (container && movement && typeof movement.convertClientToBoard === 'function') {
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + (rect.width / 2);
        const centerY = rect.top + (rect.height / 2);
        const center = movement.convertClientToBoard(centerX, centerY);
        if (isFinitePoint(center)) {
            const snapped = utils.snapPointToGrid(center);
            return rememberPastePosition(snapped);
        }
    }
    const fallback = isFinitePoint(lastPos)
        ? lastPos
        : { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    return rememberPastePosition(fallback);
}

// MARK: Initialization
function initialize() {
    const container = dom.boardContainer;
    if (!container) {
        return;
    }
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
}

// MARK: Drag-and-Drop
function handleDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
    }
}

async function handleDrop(event) {
    event.preventDefault();
    management.hideContextMenu();
    const position = movement.getBoardCoordinates(event);
    const files = Array.from(event.dataTransfer?.files || []);
    const uriList = event.dataTransfer?.getData('text/uri-list');
    const text = event.dataTransfer?.getData('text/plain');
    console.info('Drop received', { files: files.length, position });
    runAsync(async () => {
        if (files.length > 0) {
            const handledFiles = await processFiles(files, position);
            if (handledFiles) {
                return;
            }
        }
        if (uriList && await handleTextPayload(uriList, position)) {
            return;
        }
        if (text && await handleTextPayload(text, position)) {
            return;
        }
    }, 'Drop import failed');
}

// MARK: File Processing
async function processFiles(files, basePosition) {
    console.info('Processing file payload', { count: files.length });
    let offsetIndex = 0;
    let handled = false;
    for (const file of files) {
        if (!file) {
            continue;
        }
        const absolutePath = typeof file.path === 'string' ? file.path.trim() : '';
        const name = typeof file.name === 'string' ? file.name : absolutePath;
        const extension = path.extname(absolutePath || name).toLowerCase();
        const mimeType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
        console.debug('Evaluating file for import', { name, extension, mimeType, hasPath: !!absolutePath });
        const source = {
            path: absolutePath,
            name
        };
        if (typeof file.arrayBuffer === 'function') {
            source.arrayBuffer = () => file.arrayBuffer();
        }
        const offset = constants.GRID_SIZE * 4 * offsetIndex;
        const position = {
            x: basePosition.x + offset,
            y: basePosition.y + offset
        };
        if (mediaBlocks.isAudioExtension(extension)) {
            const block = await mediaBlocks.importAudioFile(source, position);
            if (block) {
                offsetIndex += 1;
                handled = true;
            }
            continue;
        }
        if (mediaBlocks.isVideoExtension(extension)) {
            const block = await mediaBlocks.importVideoFile(source, position);
            if (block) {
                offsetIndex += 1;
                handled = true;
            }
            continue;
        }
        if (isImageFile(extension, mimeType)) {
            const buffer = await resolveFileBuffer(file, absolutePath);
            if (!buffer) {
                console.warn('Image file skipped: unreadable buffer', { name, extension, hasPath: !!absolutePath });
                continue;
            }
            const block = await images.createImageBlockFromBuffer(buffer, position);
            if (block) {
                offsetIndex += 1;
                handled = true;
            } else {
                console.warn('Image file skipped: creation failed', { name, extension });
            }
            continue;
        }
        console.warn('File skipped during import', { name, extension });
    }
    return handled;
}

// MARK: File Resolution
async function resolveFileBuffer(file, absolutePath) {
    if (file && typeof file.arrayBuffer === 'function') {
        try {
            const arrayBuffer = await file.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            console.error('File arrayBuffer read failed', error);
        }
    }
    if (absolutePath) {
        try {
            return await fs.promises.readFile(absolutePath);
        } catch (error) {
            console.error('File system read failed', error);
        }
    }
    return null;
}

function isImageFile(extension, mimeType) {
    if (images.isImageExtension(extension)) {
        return true;
    }
    if (mimeType && mimeType.startsWith('image/')) {
        const subtype = mimeType.slice('image/'.length);
        return images.isImageExtension(subtype);
    }
    return false;
}

// MARK: Clipboard Imports
async function handlePasteEvent(event) {
    if (env.windowMode === 'paint-editor') {
        if (typeof env.paintMode?.handlePasteEvent === 'function') {
            try {
                await env.paintMode.handlePasteEvent(event);
            } catch (error) {
                console.error('Paint paste failed', error);
            }
        }
        return;
    }
    const activeElement = document.activeElement;
    if (activeElement && typeof activeElement.closest === 'function') {
        const editingBlock = activeElement.closest('.board-block.is-editing');
        if (editingBlock) {
            return;
        }
        if (activeElement.closest('.context-dialog-card')) {
            return;
        }
    }
    const tagName = activeElement && activeElement.tagName ? activeElement.tagName.toLowerCase() : '';
    if (tagName === 'input' || tagName === 'textarea' || (activeElement && activeElement.isContentEditable)) {
        return;
    }
    const pastePosition = resolvePastePosition();
    try {
        const electronClipboard = env.electron?.clipboard;
        if (electronClipboard && typeof electronClipboard.availableFormats === 'function' && typeof electronClipboard.readBuffer === 'function') {
            const formats = electronClipboard.availableFormats() || [];
            if (Array.isArray(formats) && formats.includes('application/x-workboard-blocks')) {
                try {
                    const buffer = electronClipboard.readBuffer('application/x-workboard-blocks');
                    if (buffer && buffer.length && env.management && typeof env.management.pasteBlocksFromClipboardPayload === 'function') {
                        const payload = JSON.parse(buffer.toString('utf8'));
                        const pasted = env.management.pasteBlocksFromClipboardPayload(payload);
                        if (pasted) {
                            event.preventDefault();
                            return;
                        }
                    }
                } catch (error) {
                    console.warn('Failed to paste Workboard blocks from clipboard', error);
                }
            }
        }
        const clipboardFiles = Array.from(event.clipboardData?.files || []);
        const clipboardText = event.clipboardData?.getData('text/plain');
        console.info('Paste detected', { files: clipboardFiles.length, hasText: !!(clipboardText && clipboardText.trim()) });
        if (clipboardFiles.length > 0) {
            const position = pastePosition;
            const textPayload = clipboardText;
            runAsync(async () => {
                const handledFiles = await processFiles(clipboardFiles, position);
                if (handledFiles) {
                    return;
                }
                if (textPayload && textPayload.trim()) {
                    await handleTextPayload(textPayload, position);
                }
            }, 'Paste import failed');
            state.pendingWorkboardPaste = false;
            event.preventDefault();
            return;
        }
        if (clipboardText && clipboardText.trim()) {
            const textValue = clipboardText;
            const position = pastePosition;
            runAsync(async () => {
                await handleTextPayload(textValue, position);
            }, 'Paste import failed');
            state.pendingWorkboardPaste = false;
            event.preventDefault();
            return;
        }
        images.handlePasteEvent(event);
        if (event.defaultPrevented) {
            state.pendingWorkboardPaste = false;
            return;
        }
        if (state.pendingWorkboardPaste && env.management && typeof env.management.pasteCopiedBlocks === 'function') {
            const pasted = env.management.pasteCopiedBlocks();
            if (pasted) {
                event.preventDefault();
                return;
            }
        }
    } catch (error) {
        console.error('Import paste failed', error);
    }
}

// MARK: Text Payload Imports
async function handleTextPayload(raw, basePosition) {
    if (typeof raw !== 'string') {
        return false;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return false;
    }
    const position = basePosition || { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
    const parts = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    const candidate = parts[0] || trimmed;
    const youtubeId = linkBlocks.parseYoutubeVideoId(candidate);
    if (youtubeId) {
        console.info('Detected YouTube URL from text payload', { url: candidate });
        linkBlocks.insertYoutubeBlock(candidate, position);
        return true;
    }
    if (linkBlocks.isHttpUrl(candidate)) {
        console.info('Detected link from text payload', { url: candidate });
        linkBlocks.insertLinkBlock(candidate, position);
        return true;
    }
    console.info('Creating text block from pasted content', { length: trimmed.length });
    const block = management.createTextBlockWithContent(position, trimmed);
    if (!block) {
        console.warn('Text payload import failed', { length: trimmed.length });
        return false;
    }
    return true;
}

env.imports.initialize = initialize;
env.imports.handleDrop = handleDrop;
env.imports.handlePasteEvent = handlePasteEvent;
env.imports.handleTextPayload = handleTextPayload;

env.imports.initialize();

module.exports = env;
