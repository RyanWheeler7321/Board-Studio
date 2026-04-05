'use strict';

const env = require('../../core/state');
const projectStore = require('./projectStore');
const assetActions = require('./assetActions');
const launchTargets = require('./paintLaunchTarget');

const { electron, path, state, utils } = env;

const runtime = {
    root: null,
    contextMenu: null,
    contextMenuHost: null
};

let listenersAttached = false;

function logLibraryEvent(scope, payload = {}) {
    try {
        const logDir = path.join(env.paths.baseDir, '..', 'logs');
        env.fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'workboard_paint.log');
        const timestamp = new Date().toISOString();
        env.fs.appendFileSync(logPath, `[${timestamp}] libraryView.${scope} ${JSON.stringify(payload)}\n`, 'utf8');
    } catch {}
}

function toolState() {
    state.tools2d = state.tools2d && typeof state.tools2d === 'object' ? state.tools2d : {};
    const current = state.tools2d;
    if (!Object.prototype.hasOwnProperty.call(current, 'selectedProjectId')) current.selectedProjectId = '';
    if (!Object.prototype.hasOwnProperty.call(current, 'search')) current.search = '';
    return current;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function render(root) {
    runtime.root = root;
    if (!root) {
        syncContextMenuHost(null);
        return;
    }
    ensureListeners();
    const current = toolState();
    const assets = filteredAssets();
    const selected = resolveSelectedAsset(assets);
    const contextMenuAsset = runtime.contextMenu?.assetId
        ? assets.find((asset) => asset.id === runtime.contextMenu.assetId) || null
        : null;
    if (!contextMenuAsset) {
        runtime.contextMenu = null;
    }
    root.innerHTML = `
        <div class="two-d-library">
            <div class="two-d-library-toolbar">
                <div class="two-d-library-toolbar-row two-d-library-toolbar-row--filters">
                    <input class="two-d-library-input two-d-library-search" type="search" placeholder="Search projects" value="${escapeHtml(current.search)}" data-role="search">
                </div>
            </div>
            <div class="two-d-library-projects">
                ${assets.length ? assets.map((asset) => renderProjectCard(asset, selected?.id === asset.id)).join('') : `
                    <div class="two-d-library-empty">No projects yet.</div>
                `}
            </div>
        </div>
    `;
    attachEvents(root);
    syncContextMenuHost(contextMenuAsset);
}

function ensureListeners() {
    if (listenersAttached) {
        return;
    }
    listenersAttached = true;
    document.addEventListener('pointerdown', handleGlobalPointerDown, true);
    document.addEventListener('keydown', handleGlobalKeyDown, true);
    window.addEventListener('resize', handleGlobalCloseRequest);
    window.addEventListener('scroll', handleGlobalCloseRequest, true);
}

function renderContextMenu(asset) {
    if (!asset || !runtime.contextMenu) {
        return '';
    }
    return `
        <div class="context-menu two-d-library-context-menu is-visible" data-role="context-menu" data-asset-id="${asset.id}" style="left:${Math.round(runtime.contextMenu.x || 0)}px; top:${Math.round(runtime.contextMenu.y || 0)}px;">
            <button type="button" class="context-menu-item" data-action="duplicate-project" data-asset-id="${asset.id}">Duplicate</button>
            <button type="button" class="context-menu-item danger" data-action="delete-project" data-asset-id="${asset.id}">Delete</button>
        </div>
    `;
}

function ensureContextMenuHost() {
    if (runtime.contextMenuHost && runtime.contextMenuHost.isConnected) {
        return runtime.contextMenuHost;
    }
    const host = document.createElement('div');
    host.setAttribute('data-role', 'two-d-library-context-menu-host');
    document.body.appendChild(host);
    runtime.contextMenuHost = host;
    return host;
}

function syncContextMenuHost(asset) {
    const host = ensureContextMenuHost();
    if (!asset || !runtime.contextMenu) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = renderContextMenu(asset);
    host.querySelectorAll('[data-action]').forEach((node) => {
        node.addEventListener('click', handleActionClick);
    });
    positionContextMenu();
}

function renderProjectCard(asset, isSelected) {
    const thumbPath = projectStore.resolveAssetThumbnailPath(asset);
    const thumbUrl = thumbPath ? projectStore.toFileUrl(asset, thumbPath) : '';
    return `
        <article class="two-d-library-card${isSelected ? ' is-selected' : ''}" data-role="project-card" data-asset-id="${asset.id}">
            <button type="button" class="two-d-library-card-open" data-action="open-project" data-asset-id="${asset.id}">
                <div class="two-d-library-thumb">
                    ${thumbUrl
                        ? `<img src="${thumbUrl}" alt="${escapeHtml(asset.name)}">`
                        : `<span>${escapeHtml(asset.name.slice(0, 2).toUpperCase() || '2D')}</span>`}
                    <div class="two-d-library-thumb-label">${escapeHtml(asset.name)}</div>
                </div>
            </button>
        </article>
    `;
}

function resolveSelectedAsset(assets = null) {
    const current = toolState();
    const assetList = Array.isArray(assets) ? assets : filteredAssets();
    const selectedId = String(current.selectedProjectId || '').trim();
    const selected = selectedId ? assetList.find((asset) => asset.id === selectedId) : null;
    if (selected) {
        return selected;
    }
    const fallback = projectStore.getSelectedAsset() || assetList[0] || null;
    current.selectedProjectId = fallback?.id || '';
    return fallback;
}

function filteredAssets() {
    const query = String(toolState().search || '').trim().toLowerCase();
    return projectStore.listAssets()
        .filter((asset) => {
            if (!query) {
                return true;
            }
            return [asset.name, asset.type]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query));
        })
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function attachEvents(root) {
    root.querySelectorAll('[data-action]').forEach((node) => {
        node.addEventListener('click', handleActionClick);
    });
    root.querySelectorAll('[data-role="project-card"]').forEach((node) => {
        node.addEventListener('contextmenu', handleProjectContextMenu);
    });
    root.querySelectorAll('[data-role="search"]').forEach((node) => {
        node.addEventListener('input', () => {
            toolState().search = String(node.value || '');
            render(runtime.root);
        });
    });
}

async function handleActionClick(event) {
    const actionEl = event.currentTarget;
    const action = String(actionEl?.getAttribute('data-action') || '').trim();
    const assetId = String(actionEl?.getAttribute('data-asset-id') || '').trim();
    if (action && action !== 'open-project') {
        closeContextMenu({ shouldRender: false });
    }
    logLibraryEvent('handleActionClick', {
        action,
        assetId
    });
    try {
        if (action === 'open-project') {
            const asset = projectStore.getAsset(assetId);
            if (!asset) {
                return;
            }
            toolState().selectedProjectId = asset.id;
            projectStore.selectAsset(asset.id, 'asset2d-select');
            await openTarget(projectStore.resolveLastOpenedTarget(asset.id));
            render(runtime.root);
            return;
        }
        if (action === 'delete-project') {
            const asset = projectStore.getAsset(assetId);
            if (!asset) {
                return;
            }
            const confirmed = window.confirm(`Delete "${asset.name}"?\n\nThis removes the project folder and its files.`);
            if (!confirmed) {
                return;
            }
            const deleted = projectStore.deleteAsset(asset.id, 'asset2d-delete-confirmed');
            if (deleted) {
                const current = toolState();
                if (current.selectedProjectId === asset.id) {
                    current.selectedProjectId = projectStore.getSelectedAsset()?.id || '';
                }
                render(runtime.root);
            }
            return;
        }
        if (action === 'duplicate-project') {
            const result = await assetActions.duplicateAssetProject(assetId);
            toolState().selectedProjectId = result.asset.id;
            projectStore.selectAsset(result.asset.id, 'asset2d-select');
            render(runtime.root);
        }
    } catch (error) {
        utils.showToast?.(error?.message || '2D project action failed');
    }
}

function handleProjectContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget;
    const assetId = String(card?.getAttribute('data-asset-id') || '').trim();
    if (!assetId) {
        return;
    }
    toolState().selectedProjectId = assetId;
    projectStore.selectAsset(assetId, 'asset2d-select');
    runtime.contextMenu = {
        assetId,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0
    };
    render(runtime.root);
}

function closeContextMenu(options = {}) {
    if (!runtime.contextMenu) {
        return;
    }
    runtime.contextMenu = null;
    if (options.shouldRender !== false && runtime.root) {
        render(runtime.root);
    }
}

function handleGlobalPointerDown(event) {
    if (!runtime.contextMenu) {
        return;
    }
    if (event.target?.closest?.('[data-role="context-menu"]')) {
        return;
    }
    closeContextMenu();
}

function handleGlobalKeyDown(event) {
    if (event.key === 'Escape') {
        closeContextMenu();
    }
}

function handleGlobalCloseRequest() {
    closeContextMenu();
}

function positionContextMenu() {
    const menu = runtime.contextMenuHost?.querySelector?.('[data-role="context-menu"]');
    if (!menu || !runtime.contextMenu) {
        return;
    }
    const padding = 8;
    const width = Math.round(menu.offsetWidth || 0);
    const height = Math.round(menu.offsetHeight || 0);
    const maxX = Math.max(padding, window.innerWidth - width - padding);
    const maxY = Math.max(padding, window.innerHeight - height - padding);
    menu.style.left = `${Math.max(padding, Math.min(Math.round(runtime.contextMenu.x || padding), maxX))}px`;
    menu.style.top = `${Math.max(padding, Math.min(Math.round(runtime.contextMenu.y || padding), maxY))}px`;
}

async function openTarget(target) {
    const normalizedTarget = launchTargets.normalizePaintLaunchTarget(target);
    logLibraryEvent('openTarget.begin', {
        target: normalizedTarget
    });
    projectStore.selectAsset(normalizedTarget.assetId || toolState().selectedProjectId || '', 'asset2d-select');
    if (env.paintMode?.openTarget) {
        const response = await env.paintMode.openTarget(normalizedTarget);
        logLibraryEvent('openTarget.rendererResponse', {
            target: normalizedTarget,
            response: response || null
        });
        return;
    }
    const response = await electron.ipcRenderer.invoke('workboard:open-paint-window', normalizedTarget);
    logLibraryEvent('openTarget.ipcResponse', {
        target: normalizedTarget,
        response: response || null
    });
    if (!response?.success) {
        throw new Error(response?.error || 'Paint window failed to open');
    }
}

module.exports = {
    render
};
