'use strict';

// MARK: IMPORTS
const fs = require('fs');
const path = require('path');
const boardDisplay = require('../automation/boardDisplay');
const displayLayout = require('../automation/displayLayout');
const { computeBoardRevision } = require('../automation/agentOperations');

const DEFAULT_PORT = 48321;
const BOOLEAN_FLAGS = new Set(['append', 'media', 'help']);
const CAPTURE_MODES = ['view', 'board', 'window'];

// MARK: ARGS
function parseArgs(argv) {
    const options = {};
    const positionals = [];
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }
        const key = token.slice(2);
        const next = argv[index + 1];
        if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith('--')) {
            options[key] = true;
            continue;
        }
        if (options[key] === undefined) {
            options[key] = next;
        } else if (Array.isArray(options[key])) {
            options[key].push(next);
        } else {
            options[key] = [options[key], next];
        }
        index += 1;
    }
    return { options, positionals };
}

function asArray(value) {
    if (value === undefined || value === true) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function splitValues(value) {
    return asArray(value)
        .flatMap((entry) => String(entry || '').split(','))
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function textOption(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function resolvePort(options) {
    const raw = options.port !== undefined ? options.port : (process.env.BOARD_STUDIO_PORT || DEFAULT_PORT);
    const port = raw === true ? NaN : Number(raw);
    if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
        throw new Error('--port needs a number between 1 and 65535');
    }
    return port;
}

function buildSelector(options) {
    const selector = {};
    const blockIds = splitValues(options.ids);
    if (blockIds.length) selector.blockIds = blockIds;
    const batchId = textOption(options.batch);
    if (batchId) selector.batchId = batchId;
    return selector;
}

function createRequestId() {
    return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// MARK: SERVER
async function postCommand(port, command, data = {}) {
    let response;
    try {
        response = await fetch(`http://127.0.0.1:${port}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, data })
        });
    } catch {
        throw new Error(`Board Studio isn't reachable on port ${port}, is it running?`);
    }
    const text = await response.text();
    let result = null;
    try {
        result = text.trim() ? JSON.parse(text) : { success: response.ok };
    } catch {
        result = { success: false, error: `invalid response (${response.status})` };
    }
    if (!response.ok || result?.success === false) {
        const error = new Error(`${command} failed: ${result?.error || response.status}`);
        error.result = result;
        throw error;
    }
    return result;
}

// MARK: COMMANDS
async function runDisplay(port, options, files) {
    if (!files.length) {
        throw new Error('display needs at least one file');
    }
    const labels = asArray(options.label).map((value) => String(value).trim());
    const items = files.map((source, index) => ({ source, caption: labels[index] || '' }));
    const append = options.append === true;

    const status = await postCommand(port, 'status');
    const dataDir = String(status.dataDir || '').trim();
    if (!dataDir) {
        throw new Error('Board Studio did not report its data folder');
    }
    // Saves the open board and switches to Root, so boards.json matches the screen.
    await postCommand(port, 'prepare-display');
    const boardData = JSON.parse(fs.readFileSync(path.join(dataDir, 'boards.json'), 'utf8'));
    boardDisplay.ensureSystemBoards(boardData);
    const expectedRevisions = {
        root: computeBoardRevision(boardData.boards.root),
        storage: computeBoardRevision(boardData.boards.storage)
    };

    // Only earlier displays get cleared, anything made by hand on Root stays put.
    const handMade = (boardData.boards.root.blocks || []).filter((block) => !block?.boardDisplay?.batchId);
    if (!append && handMade.length) {
        throw new Error(`Root has ${handMade.length} block(s) that didn't come from display, use --append or move them to another board first`);
    }
    const archive = append
        ? { changed: false, archivedCount: 0 }
        : boardDisplay.archiveRootToStorage(boardData, { source: 'root-archive' });
    const batchId = displayLayout.createId('display');
    const displayedAt = new Date().toISOString();
    const importedItems = await displayLayout.importDisplayItems({ items, dataDir, source: 'cli', batchId, cwd: process.cwd() });
    const rootBoard = boardData.boards.root;
    const layout = displayLayout.layoutDisplayBatch({
        preset: textOption(options.layout),
        append,
        existingBlocks: rootBoard.blocks,
        title: textOption(options.title),
        notes: textOption(options.notes),
        importedItems,
        batchId,
        source: 'cli',
        displayKey: '',
        displayedAt,
        dataDir,
        boardData
    });
    rootBoard.blocks = append ? [...rootBoard.blocks, ...layout.blocks] : layout.blocks;
    rootBoard.updatedAt = displayedAt;
    if (archive.changed) {
        boardDisplay.reflowStorageBatches(boardData);
    }

    // The app checks the revisions before it commits, so edits made during the import aren't overwritten.
    const commit = await postCommand(port, 'board-agent', {
        action: 'publish-display',
        requestId: batchId,
        expectedRevisions,
        append,
        focus: true,
        boards: { root: boardData.boards.root, storage: boardData.boards.storage }
    });
    if (!commit.committed) {
        throw new Error('display was not committed');
    }
    let ready = { presented: false, presentationReason: '' };
    try {
        await postCommand(port, 'open-board', { boardId: 'root', zoomToFit: true });
        ready = await postCommand(port, 'board-agent', { action: 'display-ready', requestId: batchId });
    } catch (error) {
        ready.presentationReason = error.message;
    }
    return {
        success: true,
        batchId,
        revision: commit.revision,
        blockIds: layout.blocks.map((block) => block.id),
        archivedCount: archive.archivedCount || 0,
        presented: ready.presented === true,
        presentationReason: ready.presentationReason || ''
    };
}

function runInspect(port, options) {
    const selector = buildSelector(options);
    return postCommand(port, 'board-agent', {
        action: 'inspect',
        boardId: textOption(options.board) || 'root',
        includeMedia: options.media === true,
        ...(Object.keys(selector).length ? { selector } : {})
    });
}

function runApply(port, options, file) {
    if (!file) {
        throw new Error('apply needs an ops file');
    }
    const expectedRevision = textOption(options.revision);
    if (!expectedRevision) {
        throw new Error('apply needs --revision, run inspect first');
    }
    const loaded = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const operations = Array.isArray(loaded) ? loaded : loaded?.operations;
    if (!Array.isArray(operations) || !operations.length) {
        throw new Error('ops file has no operations');
    }
    const fileSelector = !Array.isArray(loaded) && loaded?.selector && typeof loaded.selector === 'object' ? loaded.selector : {};
    return postCommand(port, 'board-agent', {
        action: 'apply',
        requestId: createRequestId(),
        boardId: textOption(options.board) || textOption(loaded?.boardId) || 'root',
        expectedRevision,
        selector: { ...fileSelector, ...buildSelector(options) },
        operations
    });
}

function runFocus(port, options, ids) {
    const blockIds = splitValues(ids);
    if (!blockIds.length) {
        throw new Error('focus needs at least one block id');
    }
    return postCommand(port, 'board-agent', {
        action: 'focus',
        boardId: textOption(options.board) || 'root',
        selector: { blockIds }
    });
}

function runCapture(port, options, mode = 'view') {
    const normalizedMode = String(mode).trim().toLowerCase();
    if (!CAPTURE_MODES.includes(normalizedMode)) {
        throw new Error('capture mode must be view, board or window');
    }
    const outputPath = textOption(options.path);
    return postCommand(port, 'capture', {
        mode: normalizedMode,
        path: outputPath ? path.resolve(outputPath) : ''
    });
}

// MARK: MAIN
function printUsage() {
    console.log(`Board Studio CLI

  node tools/board-cli.js display <files...> [--title T] [--notes N] [--label L ...] [--append] [--layout native-pixels]
  node tools/board-cli.js inspect [--board root] [--ids ID,ID] [--batch ID] [--media]
  node tools/board-cli.js apply <ops.json> --revision REV [--board root] [--ids ID,ID]
  node tools/board-cli.js focus <ids...> [--board root]
  node tools/board-cli.js capture view|board|window [--path out.png]

Every command takes --port N (default BOARD_STUDIO_PORT or ${DEFAULT_PORT}) and prints JSON. Errors go to stderr.`);
}

async function main() {
    const { options, positionals } = parseArgs(process.argv.slice(2));
    const command = String(positionals[0] || '').trim().toLowerCase();
    const args = positionals.slice(1);
    if (!command || command === 'help' || options.help === true) {
        printUsage();
        return;
    }
    const port = resolvePort(options);
    let result;
    if (command === 'display') {
        result = await runDisplay(port, options, args);
    } else if (command === 'inspect') {
        result = await runInspect(port, options);
    } else if (command === 'apply') {
        result = await runApply(port, options, args[0]);
    } else if (command === 'focus') {
        result = await runFocus(port, options, args);
    } else if (command === 'capture') {
        result = await runCapture(port, options, args[0]);
    } else {
        throw new Error(`Unknown command: ${command}, run with --help`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
    console.error(error?.message || String(error));
    if (error?.result) {
        console.error(JSON.stringify(error.result, null, 2));
    }
    process.exitCode = 1;
});
