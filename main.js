'use strict';

// MARK: IMPORTS
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const paintLaunchTarget = require('./tools/twoD/paintLaunchTarget');

// MARK: STATE
let boardWindow = null;
let paintWindow = null;
let workboardRendererReady = false;
const WORKBOARD_APP_ID = 'com.boardstudio.app';
const WORKBOARD_PAINT_APP_ID = 'com.boardstudio.paint';

// MARK: PATHS
function resolveRootPath() {
    return __dirname;
}

function resolveBoardEntryPath() {
    return path.join(resolveRootPath(), 'board.html');
}

function resolveIconPath(stem) {
    const extension = process.platform === 'win32' ? 'ico' : 'png';
    return path.join(resolveRootPath(), 'assets', 'icons', `${stem}.${extension}`);
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

function applyWindowIconDetails(windowHandle, options = {}) {
    if (!windowHandle || windowHandle.isDestroyed()) {
        return;
    }
    const iconPath = resolveIconPath(options.iconStem || 'workboard');
    if (fs.existsSync(iconPath)) {
        windowHandle.setIcon(iconPath);
    }
    if (process.platform === 'win32' && typeof windowHandle.setAppDetails === 'function') {
        const appDetails = {
            appId: options.appId || WORKBOARD_APP_ID,
            relaunchDisplayName: options.title || 'Board Studio'
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
    const boardIconPath = resolveIconPath('workboard');
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
            enableRemoteModule: true,
            backgroundThrottling: true
        }
    };
    applySavedWindowPosition(windowOptions, savedState);
    boardWindow = new BrowserWindow(windowOptions);
    applyWindowIconDetails(boardWindow, {
        appId: WORKBOARD_APP_ID,
        iconStem: 'workboard',
        title: 'Board Studio'
    });
    boardWindow.removeMenu();
    boardWindow.setMenuBarVisibility(false);
    workboardRendererReady = false;
    boardWindow.loadFile(boardEntry);
    boardWindow.once('ready-to-show', () => {
        if (!boardWindow || boardWindow.isDestroyed()) {
            return;
        }
        if (savedState?.maximized) {
            boardWindow.maximize();
        }
        boardWindow.show();
    });
    boardWindow.on('closed', () => {
        boardWindow = null;
        workboardRendererReady = false;
    });
    boardWindow.on('maximize', () => {
        boardWindow?.webContents.send('board-window-maximized', true);
    });
    boardWindow.on('unmaximize', () => {
        boardWindow?.webContents.send('board-window-maximized', false);
    });
    return boardWindow;
}

function createPaintWindow(target = {}) {
    const boardEntry = resolveBoardEntryPath();
    const normalizedTarget = paintLaunchTarget.normalizePaintWindowPayload(target);
    const savedState = loadWindowState('paint-window-state.json');
    const query = paintLaunchTarget.buildPaintWindowQuery(normalizedTarget);
    if (paintWindow && !paintWindow.isDestroyed()) {
        paintWindow.loadFile(boardEntry, { query });
        applyWindowIconDetails(paintWindow, {
            appId: WORKBOARD_PAINT_APP_ID,
            iconStem: 'workboard-paint',
            title: 'Paint Studio'
        });
        paintWindow.show();
        paintWindow.focus();
        return { success: true, reused: true };
    }
    const paintIconPath = resolveIconPath('workboard-paint');
    const windowOptions = {
        width: savedState?.width ? Math.max(1180, savedState.width) : 1480,
        height: savedState?.height ? Math.max(760, savedState.height) : 980,
        minWidth: 1180,
        minHeight: 760,
        frame: false,
        show: false,
        backgroundColor: '#0d1118',
        title: 'Paint Studio',
        icon: fs.existsSync(paintIconPath) ? paintIconPath : undefined,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            backgroundThrottling: true
        }
    };
    applySavedWindowPosition(windowOptions, savedState);
    paintWindow = new BrowserWindow(windowOptions);
    applyWindowIconDetails(paintWindow, {
        appId: WORKBOARD_PAINT_APP_ID,
        iconStem: 'workboard-paint',
        title: 'Paint Studio'
    });
    paintWindow.removeMenu();
    paintWindow.setMenuBarVisibility(false);
    paintWindow.loadFile(boardEntry, { query });
    paintWindow.once('ready-to-show', () => {
        if (!paintWindow || paintWindow.isDestroyed()) {
            return;
        }
        if (savedState?.maximized) {
            paintWindow.maximize();
        }
        paintWindow.show();
        paintWindow.focus();
    });
    paintWindow.on('closed', () => {
        paintWindow = null;
    });
    return { success: true };
}

// MARK: IPC
ipcMain.handle('workboard:get-data-path', async () => {
    const configuredPath = resolveConfiguredDataDir();
    const fallback = resolveDefaultDataDir();
    return {
        path: configuredPath,
        exists: fs.existsSync(configuredPath),
        fallback: fs.existsSync(fallback) ? fallback : null,
        backupPath: resolveDefaultBackupDir(configuredPath)
    };
});

ipcMain.handle('workboard:get-root-path', async () => resolveRootPath());

ipcMain.handle('workboard:open-paint-window', async (_event, payload = {}) => {
    try {
        return createPaintWindow(payload);
    } catch (error) {
        return { success: false, error: error?.message || 'paint-window-open-failed' };
    }
});

ipcMain.handle('workboard:relaunch-window', async () => {
    try {
        if (paintWindow && !paintWindow.isDestroyed()) {
            paintWindow.close();
        }
        if (boardWindow && !boardWindow.isDestroyed()) {
            boardWindow.close();
        }
        setTimeout(() => {
            if (!boardWindow || boardWindow.isDestroyed()) {
                createBoardWindow();
            }
        }, 60);
        return { success: true };
    } catch (error) {
        return { success: false, error: error?.message || 'workboard-window-relaunch-failed' };
    }
});

ipcMain.handle('workboard:choose-data-path', async () => {
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

ipcMain.handle('workboard:create-data-folder', async () => {
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

ipcMain.handle('workboard:set-data-path', async (_event, targetPath) => {
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

ipcMain.handle('workboard:capture-board-preview', async (_event, payload = {}) => {
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

ipcMain.handle('workboard:2d-open-path', async (_event, payload = {}) => {
    try {
        const targetPath = typeof payload.targetPath === 'string' ? payload.targetPath.trim() : '';
        if (!targetPath) {
            return { success: false, error: 'Target path is required' };
        }
        const resolvedPath = path.resolve(targetPath);
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
            shell.showItemInFolder(resolvedPath);
            return { success: true };
        }
        const errorMessage = await shell.openPath(resolvedPath);
        return errorMessage ? { success: false, error: errorMessage } : { success: true };
    } catch (error) {
        return { success: false, error: error?.message || 'open-path-failed' };
    }
});

ipcMain.handle('workboard:2d-pick-sheet-path', async (_event, payload = {}) => {
    try {
        const mode = String(payload?.mode || 'open').trim().toLowerCase() === 'save' ? 'save' : 'open';
        const title = typeof payload?.title === 'string' && payload.title.trim()
            ? payload.title.trim()
            : (mode === 'save' ? 'Choose sprite sheet export path' : 'Choose existing sprite sheet');
        const initialPath = typeof payload?.initialPath === 'string' ? payload.initialPath.trim() : '';
        if (mode === 'save') {
            const result = await dialog.showSaveDialog({
                title,
                defaultPath: initialPath || undefined,
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            });
            return {
                canceled: !!result?.canceled || !result?.filePath,
                path: result?.filePath ? path.resolve(result.filePath) : ''
            };
        }
        const result = await dialog.showOpenDialog({
            title,
            defaultPath: initialPath || undefined,
            properties: ['openFile'],
            filters: [
                { name: 'Image Files', extensions: ['png', 'webp', 'jpg', 'jpeg'] },
                { name: 'PNG Image', extensions: ['png'] }
            ]
        });
        const selectedPath = Array.isArray(result?.filePaths) ? result.filePaths[0] : '';
        return {
            canceled: !!result?.canceled || !selectedPath,
            path: selectedPath ? path.resolve(selectedPath) : ''
        };
    } catch (error) {
        return { canceled: true, error: error?.message || 'sheet-path-pick-failed', path: '' };
    }
});

ipcMain.handle('workboard-open-external', async (_event, url) => {
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
    if (action === 'close') {
        boardWindow.close();
        return { success: true };
    }
    return { success: false, error: 'unknown-action' };
});

ipcMain.handle('paint-window-control', async (_event, action) => {
    if (!paintWindow || paintWindow.isDestroyed()) {
        return { success: false, error: 'paint-window-unavailable' };
    }
    if (action === 'minimize') {
        paintWindow.minimize();
        return { success: true };
    }
    if (action === 'maximize') {
        if (paintWindow.isMaximized()) {
            paintWindow.unmaximize();
        } else {
            paintWindow.maximize();
        }
        return { success: true };
    }
    if (action === 'close') {
        paintWindow.close();
        return { success: true };
    }
    return { success: false, error: 'unknown-action' };
});

ipcMain.on('workboard:renderer-ready', (event) => {
    if (!boardWindow || boardWindow.isDestroyed()) {
        return;
    }
    if (event?.sender !== boardWindow.webContents) {
        return;
    }
    workboardRendererReady = true;
});

ipcMain.on('workboard:paint-preview', (event, payload = {}) => {
    if (!paintWindow || paintWindow.isDestroyed() || event?.sender !== paintWindow.webContents) {
        return;
    }
    if (!boardWindow || boardWindow.isDestroyed()) {
        return;
    }
    boardWindow.webContents.send('workboard:paint-preview', payload);
});

ipcMain.on('workboard:paint-clear-preview', (event, payload = {}) => {
    if (!paintWindow || paintWindow.isDestroyed() || event?.sender !== paintWindow.webContents) {
        return;
    }
    if (!boardWindow || boardWindow.isDestroyed()) {
        return;
    }
    boardWindow.webContents.send('workboard:paint-clear-preview', payload);
});

ipcMain.on('workboard:paint-commit', (event, payload = {}) => {
    if (!paintWindow || paintWindow.isDestroyed() || event?.sender !== paintWindow.webContents) {
        return;
    }
    if (!boardWindow || boardWindow.isDestroyed()) {
        return;
    }
    boardWindow.webContents.send('workboard:paint-commit', payload);
});

// MARK: APP
app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId(WORKBOARD_APP_ID);
    }
    createBoardWindow();
    app.on('activate', () => {
        if (!boardWindow || boardWindow.isDestroyed()) {
            createBoardWindow();
        }
    });
});

app.on('window-all-closed', () => {
    app.quit();
});
