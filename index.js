'use strict';

// MARK: WORKBOARD ENTRY
const env = require('./core/state');
require('./core/windowState');
require('./blocks/blockMetrics');
require('./data/dataStore');
require('./data/backupManager');
require('./blocks/imageBlock');
require('./blocks/audioBlock');
require('./blocks/videoBlock');
require('./blocks/linkBlock');
require('./blocks/youtubeBlock');
require('./blocks/boardLinkBlock');
require('./blocks/textBlock');
require('./blocks/titleBlock');
require('./paint/paintMode');
require('./appearance/consolePanel');
require('./sublists/sublists');
require('./tools/toolShell');
require('./tools/twoD/projectStore');
require('./tools/twoD/twoDTools');
require('./core/movement');
require('./text/textEditing');
require('./core/management');
require('./core/history');
require('./core/blockNavigator');
require('./core/imports');
require('./menus/menus');
require('./data/setup');

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

(async () => {
    try {
        await env.initialize();
    } catch (error) {
        console.error('Board Studio data initialization failed', error);
    }
    env.management.initializeBoard();

    if (env.electron?.ipcRenderer?.on) {
        env.electron.ipcRenderer.on('workboard:open-board', (_event, payload) => {
            const wantsFit = !!payload?.zoomToFit;
            const scheduleZoomToFit = () => {
                if (!wantsFit) {
                    return;
                }
                if (!env.movement || typeof env.movement.zoomToFit !== 'function') {
                    return;
                }
                const started = Date.now();
                const deadline = started + 2000;
                const tick = () => {
                    const container = env.dom?.boardContainer;
                    const isTransitioning = !!env.state?.boardTransition || !!container?.classList?.contains('is-transitioning');
                    if (!isTransitioning || Date.now() >= deadline) {
                        env.movement.zoomToFit();
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

            if (wantsRoot && boards?.root && typeof env.management.navigateToBoard === 'function') {
                env.management.navigateToBoard('root', { direction: 'out' });
                if (env.state?.currentBoardId && env.state.currentBoardId !== previousBoardId) {
                    scheduleZoomToFit();
                }
                return;
            }
            if (id && boards?.[id] && typeof env.management.navigateToBoard === 'function') {
                env.management.navigateToBoard(id, { direction: 'in' });
                if (env.state?.currentBoardId && env.state.currentBoardId !== previousBoardId) {
                    scheduleZoomToFit();
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
                }
            } else {
                env.utils.showToast?.(`Board not found: ${title}`);
            }
        });

        env.electron.ipcRenderer.on('workboard:request-preview', (_event, payload) => {
            queueBoardPreviewCapture({
                boardId: env.state?.currentBoardId,
                delay: 80,
                size: payload?.size || 192
            });
        });

        env.electron.ipcRenderer.on('workboard:sublists-add-entry', (_event, payload) => {
            const sublists = env.sublists;
            if (!sublists || typeof sublists.addEntryToList !== 'function') {
                return;
            }

            const listTitle = normalizeToken(payload?.listTitle);
            const listId = normalizeToken(payload?.listId);
            const ensureVisible = payload?.ensureVisible !== false;
            if (!listTitle && !listId) {
                return;
            }
            sublists.addEntryToList(listTitle, { listId, ensureVisible });
        });

        env.electron.ipcRenderer.on('workboard:wheel', (_event, payload) => {
            const movement = env.movement;
            if (!movement?.handleZoom) {
                return;
            }
            const clientX = Number(payload?.x);
            const clientY = Number(payload?.y);
            const deltaX = Number(payload?.deltaX) || 0;
            const deltaY = Number(payload?.deltaY) || 0;
            const ctrlKey = !!payload?.ctrlKey;
            const metaKey = !!payload?.metaKey;
            const shiftKey = !!payload?.shiftKey;
            const altKey = !!payload?.altKey;

            movement.handleZoom({
                deltaX,
                deltaY,
                deltaMode: 0,
                clientX,
                clientY,
                ctrlKey,
                metaKey,
                shiftKey,
                altKey,
                preventDefault() {},
                getModifierState(key) {
                    if (key === 'Control') {
                        return ctrlKey;
                    }
                    if (key === 'Meta') {
                        return metaKey;
                    }
                    if (key === 'Shift') {
                        return shiftKey;
                    }
                    if (key === 'Alt') {
                        return altKey;
                    }
                    return false;
                }
            });
        });

        try {
            env.electron.ipcRenderer.send('workboard:renderer-ready');
        } catch {}

        env.electron.ipcRenderer.on('workboard:paint-preview', (_event, payload) => {
            env.paintMode?.applyLivePreview?.(payload);
        });

        env.electron.ipcRenderer.on('workboard:paint-clear-preview', (_event, payload) => {
            env.paintMode?.clearLivePreview?.(payload);
        });

        env.electron.ipcRenderer.on('workboard:paint-commit', (_event, payload) => {
            env.paintMode?.applyCommittedImage?.(payload);
        });
    }

    if (env.windowMode === 'paint-editor' && env.paintMode?.openFromWindowContext) {
        setTimeout(() => {
            env.paintMode.openFromWindowContext().catch((error) => {
                console.error('Paint editor launch failed', error);
            });
        }, 0);
    }

    window.addEventListener('beforeunload', () => {
        if (env.windowMode === 'paint-editor') {
            return;
        }
        queueBoardPreviewCapture({
            boardId: env.state?.currentBoardId,
            delay: 0,
            size: 192
        });
    });
})();
