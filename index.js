'use strict';

// MARK: BOARD STUDIO ENTRY
const env = require('./core/state');
require('./core/windowState');
require('./blocks/blockMetrics');
require('./data/dataStore');
require('./data/backupManager');
require('./blocks/imageBlock');
require('./blocks/audioBlock');
require('./blocks/videoBlock');
require('./blocks/animated3dBlock');
require('./blocks/linkBlock');
require('./blocks/youtubeBlock');
require('./blocks/arrowBlock');
require('./blocks/boardLinkBlock');
require('./blocks/textBlock');
require('./blocks/titleBlock');
require('./blocks/creationBlock');
require('./appearance/consolePanel');
require('./tools/terminalView');
require('./tools/terminalPanel');
require('./core/movement');
require('./text/textEditing');
require('./core/management');
require('./core/history');
require('./core/blockNavigator');
require('./core/imports');
require('./categories/categories');
require('./menus/menus');
require('./data/setup');
const agentBridge = require('./automation/agentBridge');

function normalizeToken(value) {
    return String(value || '').trim();
}

function isRootRequest(boardId, boardTitle) {
    const id = normalizeToken(boardId).toLowerCase();
    const title = normalizeToken(boardTitle).toLowerCase();
    return (id && id === 'root') || (title && title === 'root');
}

function findBoardIdByTitle(boards, wantedTitle) {
    if (!boards || typeof boards !== 'object') {
        return '';
    }
    const wanted = normalizeToken(wantedTitle).toLowerCase();
    if (!wanted) {
        return '';
    }
    const ids = Object.keys(boards);
    let firstMatch = '';
    let rootChildMatch = '';

    for (const boardId of ids) {
        const board = boards[boardId];
        if (!board || boardId === 'root') {
            continue;
        }
        const title = normalizeToken(board.title).toLowerCase();
        if (!title || title !== wanted) {
            continue;
        }
        if (!firstMatch) {
            firstMatch = boardId;
        }
        if (!rootChildMatch && board.parentId === 'root') {
            rootChildMatch = boardId;
        }
        if (rootChildMatch) {
            break;
        }
    }

    return rootChildMatch || firstMatch;
}

function queueBoardPreviewCapture(options) {
    if (!env.management?.queueBoardPreviewCapture) {
        return;
    }
    env.management.queueBoardPreviewCapture(options);
}

const boardCaptureRestores = new Map();

function waitForAnimationFrames(count = 2) {
    let remaining = Math.max(1, Math.round(Number(count) || 1));
    return new Promise((resolve) => {
        const step = () => {
            if (remaining <= 1) {
                resolve();
                return;
            }
            remaining -= 1;
            window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    });
}

function getBoardViewportCaptureRect() {
    const container = env.dom?.boardContainer;
    if (!container) {
        return null;
    }
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 0));
    const height = Math.max(1, Math.round(rect.height || 0));
    return {
        x: Math.max(0, Math.round(rect.left || 0)),
        y: Math.max(0, Math.round(rect.top || 0)),
        width,
        height
    };
}

async function prepareBoardCapture(options = {}) {
    const mode = normalizeToken(options?.mode || 'view').toLowerCase();
    if (mode === 'window') {
        return { success: true, mode: 'window', rect: null };
    }
    const rect = getBoardViewportCaptureRect();
    if (!rect) {
        return { success: false, error: 'board-viewport-unavailable' };
    }
    if (mode !== 'board') {
        return { success: true, mode: 'view', rect };
    }
    const movement = env.movement;
    const previousViewport = movement?.getCurrentViewportSnapshot ? movement.getCurrentViewportSnapshot() : null;
    const fitViewport = movement?.getZoomToFitViewport ? movement.getZoomToFitViewport() : null;
    if (!previousViewport || !fitViewport || typeof movement?.restoreViewport !== 'function') {
        return { success: true, mode: 'view', rect };
    }
    movement.restoreViewport({
        viewport: fitViewport,
        skipSave: true,
        syncState: false,
        reason: 'capture-fit'
    });
    await waitForAnimationFrames(2);
    const token = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    boardCaptureRestores.set(token, {
        boardId: env.state?.currentBoardId || '',
        viewport: previousViewport
    });
    return {
        success: true,
        mode: 'board',
        rect: getBoardViewportCaptureRect(),
        restoreToken: token
    };
}

async function finalizeBoardCapture(token) {
    const key = normalizeToken(token);
    if (!key) {
        return { success: false, error: 'capture-token-missing' };
    }
    const restore = boardCaptureRestores.get(key);
    if (!restore) {
        return { success: false, error: 'capture-token-not-found' };
    }
    boardCaptureRestores.delete(key);
    if (!restore.viewport || typeof env.movement?.restoreViewport !== 'function') {
        return { success: true };
    }
    env.movement.restoreViewport({
        viewport: restore.viewport,
        skipSave: true,
        syncState: false,
        reason: 'capture-restore'
    });
    await waitForAnimationFrames(2);
    return { success: true };
}

window.__boardStudioCaptureBridge = {
    prepareCapture: prepareBoardCapture,
    finalizeCapture: finalizeBoardCapture,
    getViewportRect: getBoardViewportCaptureRect
};

window.__boardStudioDisplayBridge = {
    prepareRoot() {
        if (!env.categories?.prepareRootForDisplay) {
            return { success: false, error: 'category-controller-unavailable' };
        }
        return env.categories.prepareRootForDisplay();
    }
};

window.__boardStudioAgentBridge = {
    run(payload) {
        return agentBridge.run(payload || {});
    }
};

function applyWindowActivitySnapshot(snapshot) {
    const body = document.body;
    if (!body) {
        return;
    }
    const mode = String(snapshot?.mode || 'active');
    body.dataset.windowActivity = mode;
    body.classList.toggle('is-window-active', mode === 'active');
    body.classList.toggle('is-window-background', mode === 'background');
    body.classList.toggle('is-window-hidden', mode === 'hidden');
}

function syncWindowActivity(source = 'sync') {
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const visibilityState = typeof document.visibilityState === 'string' ? document.visibilityState : 'visible';
    const snapshot = env.windowActivity?.set({
        focused,
        visibilityState,
        source
    }) || {
        focused,
        visibilityState,
        mode: visibilityState === 'hidden' ? 'hidden' : (focused ? 'active' : 'background')
    };
    applyWindowActivitySnapshot(snapshot);
}

function initializeWindowActivity() {
    if (env.windowActivity?.subscribe) {
        env.windowActivity.subscribe((snapshot) => {
            applyWindowActivitySnapshot(snapshot);
        });
    }
    syncWindowActivity('init');
    window.addEventListener('focus', () => syncWindowActivity('window-focus'));
    window.addEventListener('blur', () => syncWindowActivity('window-blur'));
    window.addEventListener('pageshow', () => syncWindowActivity('page-show'));
    window.addEventListener('pagehide', () => syncWindowActivity('page-hide'));
    document.addEventListener('visibilitychange', () => syncWindowActivity('visibility-change'));
}

initializeWindowActivity();
console.info('board-renderer-loaded');

(async () => {
    try {
        await env.initialize();
    } catch (error) {
        console.error('Board Studio data initialization failed', error);
    }
    env.management.initializeBoard();

    if (env.electron?.ipcRenderer?.on) {
        env.electron.ipcRenderer.on('boardstudio:open-board', (_event, payload) => {
            const wantsFit = !!payload?.zoomToFit;
            const scheduleZoomToFit = () => {
                if (!wantsFit) {
                    return;
                }
                if (!env.movement || typeof env.movement.zoomToFit !== 'function') {
                    return;
                }
                const runZoomToFit = () => {
                    env.movement.zoomToFit({ useSelection: false });
                    setTimeout(() => {
                        env.movement?.zoomToFit?.({ useSelection: false });
                    }, 90);
                };
                const started = Date.now();
                const deadline = started + 2000;
                const tick = () => {
                    const container = env.dom?.boardContainer;
                    const isTransitioning = !!env.state?.boardTransition || !!container?.classList?.contains('is-transitioning');
                    if (!isTransitioning || Date.now() >= deadline) {
                        runZoomToFit();
                        return;
                    }
                    setTimeout(tick, 50);
                };
                setTimeout(tick, 50);
            };
            const title = normalizeToken(payload?.boardTitle || payload?.title);
            const id = normalizeToken(payload?.boardId || payload?.id);
            const wantsRoot = isRootRequest(id, title);
            const boards = env.state?.boardData?.boards;
            const previousBoardId = env.state?.currentBoardId;
            const queueFitOnCurrentBoard = () => {
                if (wantsFit && env.state?.currentBoardId === previousBoardId) {
                    scheduleZoomToFit();
                }
            };

            if (wantsRoot && boards?.root && typeof env.management.navigateToBoard === 'function') {
                env.management.navigateToBoard('root', { direction: 'out' });
                if (env.state?.currentBoardId && env.state.currentBoardId !== previousBoardId) {
                    scheduleZoomToFit();
                } else {
                    queueFitOnCurrentBoard();
                }
                return;
            }
            if (id && boards?.[id] && typeof env.management.navigateToBoard === 'function') {
                env.management.navigateToBoard(id, { direction: 'in' });
                if (env.state?.currentBoardId && env.state.currentBoardId !== previousBoardId) {
                    scheduleZoomToFit();
                } else {
                    queueFitOnCurrentBoard();
                }
                return;
            }

            if (!title) {
                return;
            }

            if (!boards) {
                env.state.launchBoardRequest = { boardTitle: title, boardId: id, zoomToFit: wantsFit };
                return;
            }

            const matchId = findBoardIdByTitle(boards, title);

            if (matchId && typeof env.management.navigateToBoard === 'function') {
                env.management.navigateToBoard(matchId, { direction: 'in' });
                if (env.state?.currentBoardId && env.state.currentBoardId !== previousBoardId) {
                    scheduleZoomToFit();
                } else {
                    queueFitOnCurrentBoard();
                }
            } else {
                env.utils.showToast?.(`Board not found: ${title}`);
            }
        });

        env.electron.ipcRenderer.on('boardstudio:focus-blocks', (_event, payload) => {
            const incomingIds = Array.isArray(payload?.blockIds) ? payload.blockIds : [];
            const requestedIds = incomingIds
                .map((id) => normalizeToken(id))
                .filter((id) => !!id);
            if (!requestedIds.length || !env.state?.boardData?.boards || !env.state.currentBoardId) {
                return;
            }

            const board = env.state.boardData.boards[env.state.currentBoardId];
            const availableIds = new Set(Array.isArray(board?.blocks) ? board.blocks.map((block) => block?.id).filter(Boolean) : []);
            const blockIds = requestedIds.filter((id) => availableIds.has(id));
            if (!blockIds.length) {
                return;
            }

            env.state.selectedBlockIds = new Set(blockIds);
            env.state.selectedBlockId = blockIds[0] || null;
            env.movement?.zoomToFit?.({ useSelection: true });
            setTimeout(() => {
                env.movement?.clearSelection?.();
            }, 140);
            console.info('Board Studio focus-blocks applied', { count: blockIds.length, first: blockIds[0] });
        });

        env.electron.ipcRenderer.on('boardstudio:refresh-workspace', (_event, payload) => {
            if (!env.management || typeof env.management.refreshWorkspace !== 'function') {
                return;
            }
            env.management.refreshWorkspace({
                source: normalizeToken(payload?.source) || 'external',
                showToast: payload?.showToast !== false
            });
        });

        env.electron.ipcRenderer.on('boardstudio:raw-pointer-input', (_event, payload) => {
            if (!env.movement?.handleElectronRawPointerInput) {
                return;
            }
            env.movement.handleElectronRawPointerInput(payload);
        });

        try {
            env.electron.ipcRenderer.send('boardstudio:renderer-ready');
        } catch {}

    }

    window.addEventListener('beforeunload', () => {
        queueBoardPreviewCapture({
            boardId: env.state?.currentBoardId,
            delay: 0,
            size: 192
        });
    });
})();
