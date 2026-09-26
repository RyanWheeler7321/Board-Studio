'use strict';

// MARK: IMPORTS
const { app, BrowserWindow, dialog, ipcMain, shell, screen, nativeImage } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createImageProxyCache } = require('./blocks/imageProxyCache');

let pty = null;
try {
    pty = require('node-pty');
} catch (error) {
    console.warn('node-pty unavailable, terminal disabled', error?.message || error);
}

const imageProxyCache = createImageProxyCache({ nativeImage });

// MARK: STATE
let boardWindow = null;
let boardRendererReady = false;
let agentPort = 0;
const BOARD_STUDIO_APP_ID = 'com.boardstudio.app';
const RAW_POINTER_CHANNEL = 'boardstudio:raw-pointer-input';
const DEFAULT_AGENT_PORT = 48321;
const MAX_AGENT_BODY_BYTES = 64 * 1024 * 1024;
const MAX_TERMINAL_INPUT_BYTES = 64 * 1024;
const TERMINAL_REPLAY_LIMIT = 256 * 1024;

const terminalSession = {
    process: null,
    generation: 0,
    sequence: 0,
    replay: '',
    shell: ''
};

function normalizeModifierList(modifiers) {
    if (!Array.isArray(modifiers)) {
        return [];
    }
    return modifiers
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter(Boolean);
}

function buildRawPointerPayload(source, input = {}) {
    const modifiers = normalizeModifierList(input.modifiers);
    return {
        source: String(source || 'unknown'),
        type: typeof input.type === 'string' ? input.type : '',
        button: typeof input.button === 'string' ? input.button.toLowerCase() : '',
        x: Number.isFinite(Number(input.x)) ? Number(input.x) : null,
        y: Number.isFinite(Number(input.y)) ? Number(input.y) : null,
        globalX: Number.isFinite(Number(input.globalX)) ? Number(input.globalX) : null,
        globalY: Number.isFinite(Number(input.globalY)) ? Number(input.globalY) : null,
        movementX: Number.isFinite(Number(input.movementX)) ? Number(input.movementX) : null,
        movementY: Number.isFinite(Number(input.movementY)) ? Number(input.movementY) : null,
        clickCount: Number.isFinite(Number(input.clickCount)) ? Number(input.clickCount) : null,
        modifiers,
        timestamp: Date.now()
    };
}

function shouldForwardRawPointerPayload(payload) {
    if (!payload || !payload.type) {
        return false;
    }
    const modifiers = new Set(Array.isArray(payload.modifiers) ? payload.modifiers : []);
    const rightActive = payload.button === 'right'
        || modifiers.has('rightmousebutton')
        || modifiers.has('rightbuttondown');
    if (rightActive) {
        return true;
    }
    const type = String(payload.type || '').toLowerCase();
    return type === 'contextmenu';
}

function attachBoardRawPointerBridge(windowHandle) {
    if (!windowHandle || windowHandle.isDestroyed()) {
        return;
    }
    const { webContents } = windowHandle;
    if (!webContents || webContents.isDestroyed()) {
        return;
    }
    const forward = (source, input) => {
        const payload = buildRawPointerPayload(source, input);
        if (!shouldForwardRawPointerPayload(payload)) {
            return;
        }
        console.info('Board Studio raw input observed', {
            source: payload.source,
            type: payload.type,
            button: payload.button,
            x: payload.x,
            y: payload.y,
            modifiers: payload.modifiers
        });
        webContents.send(RAW_POINTER_CHANNEL, payload);
    };
    webContents.on('before-mouse-event', (_event, input) => forward('before-mouse-event', input));
    webContents.on('input-event', (_event, input) => forward('input-event', input));
}

// MARK: PATHS
function resolveRootPath() {
    return __dirname;
}

function resolveBoardEntryPath() {
    return path.join(resolveRootPath(), 'board.html');
}

function resolveIconPath() {
    const extension = process.platform === 'win32' ? 'ico' : 'png';
    return path.join(resolveRootPath(), 'assets', 'icons', `boardstudio.${extension}`);
}

function getConfigPath() {
    try {
        return path.join(app.getPath('userData'), 'board-studio-config.json');
    } catch {
        return path.join(resolveRootPath(), 'board-studio-config.json');
    }
}

function loadConfig() {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            return {};
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

function saveConfig(config) {
    try {
        const configPath = getConfigPath();
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch {
        return false;
    }
}

function resolveDefaultDataDir() {
    try {
        return path.join(app.getPath('documents'), 'BoardStudioData');
    } catch {
        return path.join(resolveRootPath(), 'BoardStudioData');
    }
}

function resolveDefaultBackupDir(baseDataDir = resolveDefaultDataDir()) {
    return path.join(baseDataDir, 'backups');
}

function ensureDirectoryExists(targetPath) {
    fs.mkdirSync(targetPath, { recursive: true });
    return targetPath;
}

function resolveConfiguredDataDir() {
    const configured = loadConfig()?.dataDirectory;
    const target = typeof configured === 'string' && configured.trim()
        ? path.resolve(configured.trim())
        : resolveDefaultDataDir();
    return ensureDirectoryExists(target);
}

function loadWindowState(fileName) {
    try {
        const statePath = path.join(resolveConfiguredDataDir(), fileName);
        if (!fs.existsSync(statePath)) {
            return null;
        }
        const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (!Number.isFinite(Number(raw.width)) || !Number.isFinite(Number(raw.height))) {
            return null;
        }
        return {
            width: Math.round(Number(raw.width)),
            height: Math.round(Number(raw.height)),
            x: Number.isFinite(Number(raw.x)) ? Math.round(Number(raw.x)) : null,
            y: Number.isFinite(Number(raw.y)) ? Math.round(Number(raw.y)) : null,
            maximized: raw.maximized === true
        };
    } catch {
        return null;
    }
}

function createUniqueDataFolder(baseDir) {
    const root = path.resolve(String(baseDir || '').trim());
    if (!root) {
        throw new Error('Invalid base directory');
    }
    const baseName = 'BoardStudioData';
    for (let attempt = 0; attempt < 1000; attempt += 1) {
        const suffix = attempt === 0 ? '' : ` ${attempt + 1}`;
        const candidate = path.join(root, `${baseName}${suffix}`);
        if (!fs.existsSync(candidate)) {
            fs.mkdirSync(candidate, { recursive: true });
            return candidate;
        }
    }
    throw new Error('Unable to create a unique Board Studio data folder');
}

// MARK: WINDOWS
function applySavedWindowPosition(windowOptions, savedState) {
    if (!savedState) {
        return;
    }
    if (Number.isFinite(savedState.x) && Number.isFinite(savedState.y)) {
        windowOptions.x = savedState.x;
        windowOptions.y = savedState.y;
    }
}

function placeWindowForSavedState(windowHandle, savedState) {
    if (!windowHandle || windowHandle.isDestroyed() || !savedState) {
        return;
    }
    try {
        const width = savedState?.width ? Math.max(960, savedState.width) : 1280;
        const height = savedState?.height ? Math.max(640, savedState.height) : 860;
        const x = Number.isFinite(savedState?.x) ? Math.round(savedState.x) : 0;
        const y = Number.isFinite(savedState?.y) ? Math.round(savedState.y) : 0;
        const display = screen.getDisplayMatching({ x, y, width: Math.max(width, 100), height: Math.max(height, 100) });
        const workArea = display?.workArea || { x, y, width, height };
        const targetWidth = Math.min(width, workArea.width);
        const targetHeight = Math.min(height, workArea.height);
        const targetX = Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - targetWidth);
        const targetY = Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - targetHeight);
        windowHandle.setBounds({
            x: Math.round(targetX),
            y: Math.round(targetY),
            width: Math.round(targetWidth),
            height: Math.round(targetHeight)
        }, false);
    } catch {
    }
}

function applyWindowIconDetails(windowHandle) {
    if (!windowHandle || windowHandle.isDestroyed()) {
        return;
    }
    const iconPath = resolveIconPath();
    if (fs.existsSync(iconPath)) {
        windowHandle.setIcon(iconPath);
    }
    if (process.platform === 'win32' && typeof windowHandle.setAppDetails === 'function') {
        const appDetails = {
            appId: BOARD_STUDIO_APP_ID,
            relaunchDisplayName: 'Board Studio'
        };
        if (fs.existsSync(iconPath)) {
            appDetails.appIconPath = iconPath;
        }
        windowHandle.setAppDetails(appDetails);
    }
}

function createBoardWindow() {
    const boardEntry = resolveBoardEntryPath();
    const savedState = loadWindowState('window-state.json');
    const boardIconPath = resolveIconPath();
    const windowOptions = {
        width: savedState?.width ? Math.max(960, savedState.width) : 1280,
        height: savedState?.height ? Math.max(640, savedState.height) : 860,
        minWidth: 960,
        minHeight: 640,
        frame: false,
        show: false,
        backgroundColor: '#101015',
        title: 'Board Studio',
        icon: fs.existsSync(boardIconPath) ? boardIconPath : undefined,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: true
        }
    };
    applySavedWindowPosition(windowOptions, savedState);
    boardWindow = new BrowserWindow(windowOptions);
    attachBoardRawPointerBridge(boardWindow);
    applyWindowIconDetails(boardWindow);
    boardWindow.removeMenu();
    boardWindow.setMenuBarVisibility(false);
    boardRendererReady = false;
    boardWindow.loadFile(boardEntry);
    boardWindow.once('ready-to-show', () => {
        if (!boardWindow || boardWindow.isDestroyed()) {
            return;
        }
        if (savedState) {
            placeWindowForSavedState(boardWindow, savedState);
        }
        boardWindow.show();
        if (savedState?.maximized) {
            setTimeout(() => {
                if (!boardWindow || boardWindow.isDestroyed()) {
                    return;
                }
                placeWindowForSavedState(boardWindow, savedState);
                boardWindow.maximize();
            }, 40);
        }
    });
    boardWindow.on('closed', () => {
        boardWindow = null;
        boardRendererReady = false;
    });
    boardWindow.on('maximize', () => {
        boardWindow?.webContents.send('board-window-maximized', true);
    });
    boardWindow.on('unmaximize', () => {
        boardWindow?.webContents.send('board-window-maximized', false);
    });
    return boardWindow;
}

function ensureBoardWindow() {
    if (!boardWindow || boardWindow.isDestroyed()) {
        createBoardWindow();
    }
    return boardWindow;
}

function showBoardWindow() {
    const win = ensureBoardWindow();
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
    return win;
}

function isBoardSender(event) {
    return !!(boardWindow && !boardWindow.isDestroyed() && event?.sender === boardWindow.webContents);
}

// MARK: TERMINAL
function resolveDefaultShell() {
    if (process.platform === 'win32') {
        return 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
}

function resolveTerminalShell() {
    const configured = loadConfig()?.terminalShell;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : resolveDefaultShell();
}

function clampTerminalSize(size = {}) {
    return {
        cols: Math.max(20, Math.min(500, Math.round(Number(size?.cols) || 88))),
        rows: Math.max(6, Math.min(300, Math.round(Number(size?.rows) || 30)))
    };
}

function sendToBoard(channel, payload) {
    if (boardWindow && !boardWindow.isDestroyed()) {
        boardWindow.webContents.send(channel, payload);
    }
}

function startTerminal(size = {}) {
    if (terminalSession.process) {
        return;
    }
    const { cols, rows } = clampTerminalSize(size);
    const shellPath = resolveTerminalShell();
    const child = pty.spawn(shellPath, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    });
    terminalSession.process = child;
    terminalSession.generation += 1;
    terminalSession.sequence = 0;
    terminalSession.replay = '';
    terminalSession.shell = shellPath;
    const generation = terminalSession.generation;
    child.onData((data) => {
        if (terminalSession.process !== child) {
            return;
        }
        terminalSession.sequence += 1;
        terminalSession.replay = (terminalSession.replay + data).slice(-TERMINAL_REPLAY_LIMIT);
        sendToBoard('boardstudio:terminal-data', { generation, sequence: terminalSession.sequence, data });
    });
    child.onExit(({ exitCode }) => {
        if (terminalSession.process !== child) {
            return;
        }
        terminalSession.process = null;
        sendToBoard('boardstudio:terminal-state', { status: 'exited', generation, exitCode });
    });
    console.info('Terminal started', { shell: shellPath, cols, rows });
}

function stopTerminal() {
    const child = terminalSession.process;
    terminalSession.process = null;
    if (child) {
        try {
            child.kill();
        } catch {}
    }
}

function attachTerminal(size = {}, options = {}) {
    if (!pty) {
        return { success: false, error: 'Terminal needs node-pty, run npm install.' };
    }
    try {
        if (options.restart === true) {
            stopTerminal();
        }
        startTerminal(size);
        const { cols, rows } = clampTerminalSize(size);
        try {
            terminalSession.process?.resize(cols, rows);
        } catch {}
        return {
            success: true,
            generation: terminalSession.generation,
            replay: terminalSession.replay,
            lastSequence: terminalSession.sequence,
            shell: terminalSession.shell
        };
    } catch (error) {
        return { success: false, error: error?.message || 'terminal-start-failed' };
    }
}

// MARK: AGENT SERVER
// Local only. Scripts and agents post { command, data } to /command and the renderer bridge does the work.
function resolveAgentPort() {
    const candidates = [process.env.BOARD_STUDIO_PORT, loadConfig()?.agentPort];
    for (const candidate of candidates) {
        const port = Number(candidate);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
            return port;
        }
    }
    return DEFAULT_AGENT_PORT;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBoardWindowReady(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (boardWindow && !boardWindow.isDestroyed() && boardRendererReady && !boardWindow.webContents.isLoadingMainFrame()) {
            return true;
        }
        await wait(40);
    }
    return !!(boardWindow && !boardWindow.isDestroyed() && boardRendererReady);
}

function serializeForRenderer(payload) {
    return JSON.stringify(payload || {})
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

async function callRendererBridge(bridgeName, method, payload) {
    const win = ensureBoardWindow();
    if (!await waitForBoardWindowReady(5000)) {
        return { success: false, error: 'board-window-not-ready' };
    }
    const argument = payload === undefined ? '' : serializeForRenderer(payload);
    try {
        return await win.webContents.executeJavaScript(`
            (async () => {
                try {
                    const bridge = window.${bridgeName};
                    if (!bridge || typeof bridge.${method} !== 'function') {
                        return { success: false, error: 'bridge-unavailable' };
                    }
                    return await bridge.${method}(${argument});
                } catch (error) {
                    return { success: false, error: error?.message || String(error) };
                }
            })();
        `, true);
    } catch (error) {
        return { success: false, error: error?.message || 'renderer-command-failed' };
    }
}

async function sendWhenReady(channel, payload) {
    ensureBoardWindow();
    if (!await waitForBoardWindowReady(5000)) {
        return { success: false, error: 'board-window-not-ready' };
    }
    boardWindow.webContents.send(channel, payload);
    return { success: true };
}

function resolveCaptureOutputPath(data = {}, mode = 'view') {
    const requestedPath = typeof data.path === 'string' ? data.path.trim() : '';
    if (requestedPath) {
        return path.resolve(requestedPath);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(resolveConfiguredDataDir(), 'captures', `board-studio-${mode}-${stamp}.png`);
}

async function captureBoard(data = {}) {
    const requestedMode = typeof data.mode === 'string' ? data.mode.trim().toLowerCase() : 'view';
    const mode = (requestedMode === 'board' || requestedMode === 'window') ? requestedMode : 'view';
    const outputPath = resolveCaptureOutputPath(data, mode);
    let capturePlan = null;
    try {
        const win = ensureBoardWindow();
        if (win.isMinimized()) {
            win.restore();
        }
        if (!win.isVisible()) {
            win.showInactive();
        }
        if (!await waitForBoardWindowReady(5000)) {
            return { success: false, error: 'board-window-not-ready' };
        }
        await wait(80);
        if (mode !== 'window') {
            capturePlan = await callRendererBridge('__boardStudioCaptureBridge', 'prepareCapture', { mode });
            if (!capturePlan || capturePlan.success === false) {
                return { success: false, error: capturePlan?.error || 'capture-plan-failed' };
            }
        }
        const rect = capturePlan?.rect && Number.isFinite(capturePlan.rect.width) && Number.isFinite(capturePlan.rect.height)
            ? {
                x: Math.max(0, Math.round(capturePlan.rect.x || 0)),
                y: Math.max(0, Math.round(capturePlan.rect.y || 0)),
                width: Math.max(1, Math.round(capturePlan.rect.width)),
                height: Math.max(1, Math.round(capturePlan.rect.height))
            }
            : undefined;
        const image = await win.webContents.capturePage(rect);
        if (!image || image.isEmpty()) {
            return { success: false, error: 'capture-failed' };
        }
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.promises.writeFile(outputPath, image.toPNG());
        const size = image.getSize();
        return { success: true, path: outputPath, mode, width: size.width, height: size.height, rect: rect || null };
    } catch (error) {
        return { success: false, error: error?.message || 'capture-error' };
    } finally {
        if (capturePlan?.restoreToken) {
            await callRendererBridge('__boardStudioCaptureBridge', 'finalizeCapture', capturePlan.restoreToken).catch(() => {});
        }
    }
}

async function handleAgentCommand(command, data = {}) {
    switch (command) {
        case 'status':
            return {
                success: true,
                dataDir: resolveConfiguredDataDir(),
                rendererReady: boardRendererReady,
                port: agentPort
            };
        case 'prepare-display':
            return callRendererBridge('__boardStudioDisplayBridge', 'prepareRoot');
        case 'board-agent':
            return callRendererBridge('__boardStudioAgentBridge', 'run', data);
        case 'open-board': {
            showBoardWindow();
            return sendWhenReady('boardstudio:open-board', {
                boardId: typeof data.boardId === 'string' ? data.boardId : '',
                boardTitle: typeof data.boardTitle === 'string' ? data.boardTitle : '',
                zoomToFit: data.zoomToFit === true
            });
        }
        case 'focus-blocks': {
            const blockIds = Array.isArray(data.blockIds)
                ? data.blockIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
                : [];
            if (!blockIds.length) {
                return { success: false, error: 'no-block-ids' };
            }
            showBoardWindow();
            return sendWhenReady('boardstudio:focus-blocks', { blockIds });
        }
        case 'refresh-workspace':
            return sendWhenReady('boardstudio:refresh-workspace', {
                source: typeof data.source === 'string' ? data.source : 'external',
                showToast: data.showToast !== false
            });
        case 'capture':
            return captureBoard(data);
        default:
            return { success: false, error: `unknown-command: ${command || '(none)'}` };
    }
}

function startAgentServer() {
    agentPort = resolveAgentPort();
    const server = http.createServer((request, response) => {
        const reply = (status, body) => {
            response.writeHead(status, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(body));
        };
        // Blocks browser pages and DNS rebinding from reaching the board.
        const host = String(request.headers.host || '').replace(/:\d+$/, '');
        if (host !== '127.0.0.1' && host !== 'localhost') {
            reply(403, { success: false, error: 'forbidden-host' });
            return;
        }
        if (request.method !== 'POST' || request.url !== '/command') {
            reply(404, { success: false, error: 'not-found' });
            return;
        }
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            reply(415, { success: false, error: 'json-required' });
            return;
        }
        const chunks = [];
        let received = 0;
        request.on('data', (chunk) => {
            received += chunk.length;
            if (received > MAX_AGENT_BODY_BYTES) {
                reply(413, { success: false, error: 'body-too-large' });
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', async () => {
            let parsed = null;
            try {
                parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            } catch {
                reply(400, { success: false, error: 'invalid-json' });
                return;
            }
            try {
                const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};
                const result = await handleAgentCommand(String(parsed?.command || '').trim(), data);
                reply(200, result || { success: false, error: 'empty-result' });
            } catch (error) {
                reply(500, { success: false, error: error?.message || 'command-failed' });
            }
        });
    });
    server.on('error', (error) => {
        console.warn('Board Studio agent server unavailable', { port: agentPort, error: error?.message || error });
    });
    server.listen(agentPort, '127.0.0.1', () => {
        console.info('Board Studio agent server listening', { port: agentPort });
    });
    return server;
}

// MARK: IPC
ipcMain.handle('boardstudio:get-data-path', async () => {
    const configuredPath = resolveConfiguredDataDir();
    const fallback = resolveDefaultDataDir();
    return {
        path: configuredPath,
        exists: fs.existsSync(configuredPath),
        fallback: fs.existsSync(fallback) ? fallback : null,
        backupPath: resolveDefaultBackupDir(configuredPath)
    };
});

ipcMain.handle('boardstudio:get-root-path', async () => resolveRootPath());

ipcMain.handle('boardstudio:image-proxy', async (event, payload = {}) => {
    if (!isBoardSender(event)) {
        return { success: false, error: 'board-renderer-required' };
    }
    try {
        const dataDir = resolveConfiguredDataDir();
        const result = await imageProxyCache.request({
            dataDir,
            sourcePath: payload.sourcePath,
            maxEdge: payload.maxEdge
        });
        imageProxyCache.scheduleCleanup(dataDir);
        return result;
    } catch (error) {
        console.warn('Board image proxy failed', error);
        return { success: false, error: error?.message || 'image-proxy-failed' };
    }
});

ipcMain.handle('boardstudio:relaunch-window', async () => {
    try {
        console.info('Board Studio relaunch requested');
        stopTerminal();
        app.relaunch();
        setTimeout(() => {
            app.exit(0);
        }, 120);
        return { success: true, restarting: true };
    } catch (error) {
        return { success: false, error: error?.message || 'window-relaunch-failed' };
    }
});

ipcMain.handle('boardstudio:choose-data-path', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: 'Select Board Studio data folder',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result?.canceled) {
            return { canceled: true };
        }
        const selected = Array.isArray(result?.filePaths) ? result.filePaths[0] : '';
        return selected ? { canceled: false, path: path.resolve(selected) } : { canceled: true };
    } catch (error) {
        return { canceled: true, error: error?.message || 'SELECT_FAILED' };
    }
});

ipcMain.handle('boardstudio:create-data-folder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: 'Choose parent directory for Board Studio data',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result?.canceled) {
            return { canceled: true };
        }
        const baseDir = Array.isArray(result?.filePaths) ? result.filePaths[0] : '';
        if (!baseDir) {
            return { canceled: true, error: 'NO_BASE_PATH' };
        }
        return {
            canceled: false,
            success: true,
            path: createUniqueDataFolder(baseDir)
        };
    } catch (error) {
        return { canceled: false, success: false, error: error?.message || 'CREATE_FAILED' };
    }
});

ipcMain.handle('boardstudio:set-data-path', async (_event, targetPath) => {
    const trimmed = typeof targetPath === 'string' ? targetPath.trim() : '';
    if (!trimmed) {
        return { success: false, error: 'INVALID_PATH' };
    }
    const nextConfig = {
        ...loadConfig(),
        dataDirectory: path.resolve(trimmed)
    };
    if (!saveConfig(nextConfig)) {
        return { success: false, error: 'SAVE_FAILED' };
    }
    return {
        success: true,
        path: nextConfig.dataDirectory,
        exists: fs.existsSync(nextConfig.dataDirectory)
    };
});

ipcMain.handle('boardstudio:capture-board-preview', async (_event, payload = {}) => {
    try {
        if (!boardWindow || boardWindow.isDestroyed()) {
            return { success: false, error: 'board-window-unavailable' };
        }
        const targetSize = Number.isFinite(payload?.size) ? Math.max(48, Math.min(512, Math.round(payload.size))) : 192;
        const rect = payload?.rect && typeof payload.rect === 'object' ? payload.rect : null;
        const captureRect = rect && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 1 && rect.height > 1
            ? {
                x: Math.max(0, Math.round(rect.x || 0)),
                y: Math.max(0, Math.round(rect.y || 0)),
                width: Math.max(1, Math.round(rect.width)),
                height: Math.max(1, Math.round(rect.height))
            }
            : undefined;
        const image = await boardWindow.webContents.capturePage(captureRect);
        if (!image || image.isEmpty()) {
            return { success: false, error: 'capture-failed' };
        }
        const resized = image.resize({ width: targetSize, height: targetSize, quality: 'good' });
        return { success: true, dataUrl: resized.toDataURL() };
    } catch (error) {
        return { success: false, error: error?.message || 'capture-error' };
    }
});

ipcMain.handle('boardstudio:open-external', async (_event, url) => {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) {
        return false;
    }
    try {
        await shell.openExternal(trimmed);
        return true;
    } catch {
        return false;
    }
});

ipcMain.handle('board-window-control', async (_event, action) => {
    if (!boardWindow || boardWindow.isDestroyed()) {
        return { success: false, error: 'board-window-unavailable' };
    }
    if (action === 'minimize') {
        boardWindow.minimize();
        return { success: true };
    }
    if (action === 'maximize') {
        if (boardWindow.isMaximized()) {
            boardWindow.unmaximize();
        } else {
            boardWindow.maximize();
        }
        return { success: true };
    }
    if (action === 'maximize-on') {
        if (!boardWindow.isMaximized()) {
            boardWindow.maximize();
        }
        return { success: true };
    }
    if (action === 'maximize-off') {
        if (boardWindow.isMaximized()) {
            boardWindow.unmaximize();
        }
        return { success: true };
    }
    if (action === 'close') {
        boardWindow.close();
        return { success: true };
    }
    return { success: false, error: 'unknown-action' };
});

ipcMain.on('boardstudio:renderer-ready', (event) => {
    if (!isBoardSender(event)) {
        return;
    }
    boardRendererReady = true;
});

ipcMain.handle('boardstudio:terminal-capability', async () => ({
    available: !!pty,
    shell: resolveTerminalShell(),
    error: pty ? '' : 'node-pty-unavailable'
}));

ipcMain.handle('boardstudio:terminal-start', async (event, size = {}) => {
    if (!isBoardSender(event)) {
        return { success: false, error: 'board-renderer-required' };
    }
    return attachTerminal(size);
});

ipcMain.handle('boardstudio:terminal-restart', async (event, size = {}) => {
    if (!isBoardSender(event)) {
        return { success: false, error: 'board-renderer-required' };
    }
    return attachTerminal(size, { restart: true });
});

ipcMain.on('boardstudio:terminal-input', (event, text) => {
    if (!isBoardSender(event) || !terminalSession.process || typeof text !== 'string') {
        return;
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_TERMINAL_INPUT_BYTES) {
        return;
    }
    terminalSession.process.write(text);
});

ipcMain.on('boardstudio:terminal-resize', (event, size = {}) => {
    if (!isBoardSender(event) || !terminalSession.process) {
        return;
    }
    const { cols, rows } = clampTerminalSize(size);
    try {
        terminalSession.process.resize(cols, rows);
    } catch {}
});

ipcMain.handle('boardstudio:get-terminal-shell', async () => ({
    shell: resolveTerminalShell(),
    defaultShell: resolveDefaultShell()
}));

ipcMain.handle('boardstudio:set-terminal-shell', async (_event, value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    const nextConfig = { ...loadConfig() };
    if (trimmed && trimmed !== resolveDefaultShell()) {
        nextConfig.terminalShell = trimmed;
    } else {
        delete nextConfig.terminalShell;
    }
    if (!saveConfig(nextConfig)) {
        return { success: false, error: 'SAVE_FAILED' };
    }
    return { success: true, shell: resolveTerminalShell() };
});

// MARK: APP
app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId(BOARD_STUDIO_APP_ID);
    }
    createBoardWindow();
    startAgentServer();
    app.on('activate', () => {
        if (!boardWindow || boardWindow.isDestroyed()) {
            createBoardWindow();
        }
    });
});

app.on('before-quit', () => {
    stopTerminal();
});

app.on('window-all-closed', () => {
    app.quit();
});
