'use strict';

// MARK: CONTEXT MENUS
const env = require('../core/state');
const { dom, state, management, mediaBlocks, linkBlocks, utils, data, constants } = env;

function initialize() {
    if (!dom.contextMenuEl) {
        return;
    }
    dom.contextMenuEl.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        event.preventDefault();
        const action = button.dataset.action;
        executeAction(action).catch((error) => {
            console.error('Context menu action failed', error);
        }).finally(() => {
            management.hideContextMenu();
        });
    });
}

function populateMenu(targetBlockId) {
    const menu = dom.contextMenuEl;
    if (!menu) {
        return false;
    }
    menu.innerHTML = '';
    const items = targetBlockId ? buildBlockMenu(targetBlockId) : buildGlobalMenu();
    if (!items.length) {
        return false;
    }
    items.forEach((item) => {
        if (item.type === 'separator') {
            const separator = document.createElement('div');
            separator.classList.add('context-menu-separator');
            menu.appendChild(separator);
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.action = item.id;
        button.classList.add('context-menu-item');
        if (item.kind === 'danger') {
            button.classList.add('danger');
        }
        if (item.kind === 'toggle') {
            button.classList.add('toggle');
            button.setAttribute('aria-pressed', item.active ? 'true' : 'false');
        }
        button.textContent = item.label;
        menu.appendChild(button);
    });
    return true;
}

function buildGlobalMenu() {
    return [
        { type: 'action', id: 'new-text', label: 'New Text Block' },
        { type: 'action', id: 'new-title', label: 'New Title Block' },
        { type: 'action', id: 'new-audio', label: 'New Audio Block' },
        { type: 'action', id: 'new-video', label: 'New Video Block' },
        { type: 'action', id: 'new-link', label: 'New Link Block' },
        { type: 'action', id: 'new-youtube', label: 'New YouTube Embed' },
        { type: 'separator' },
        { type: 'action', id: 'new-board', label: 'Create Board' }
    ];
}

function buildBlockMenu(blockId) {
    const block = management.getBlockById(blockId);
    if (!block) {
        return [
            { type: 'action', id: 'delete-block', label: 'Delete Block', kind: 'danger' }
        ];
    }
    const entries = [];
    if (block.type === 'board-link') {
        entries.push({ type: 'action', id: 'board-icon-increase', label: 'Larger Board Preview' });
        entries.push({ type: 'action', id: 'board-icon-decrease', label: 'Smaller Board Preview' });
        entries.push({ type: 'separator' });
    }
    if (block.type === 'image') {
        entries.push({ type: 'action', id: 'copy-image-to-clipboard', label: 'Copy Image' });
        entries.push({ type: 'action', id: 'show-image-in-explorer', label: 'Show Image in Explorer' });
        const borderActive = block.showBorder !== false;
        entries.push({ type: 'action', id: 'toggle-image-border', label: borderActive ? 'Hide Border' : 'Show Border', kind: 'toggle', active: borderActive });
    }
    if (block.type === 'title') {
        const borderActive = !!block.showBorder;
        const shadowActive = !!block.showShadow;
        const underlineActive = !!block.showUnderline;
        entries.push({ type: 'action', id: 'toggle-title-border', label: borderActive ? 'Hide Border' : 'Show Border', kind: 'toggle', active: borderActive });
        entries.push({ type: 'action', id: 'toggle-title-shadow', label: shadowActive ? 'Hide Drop Shadow' : 'Show Drop Shadow', kind: 'toggle', active: shadowActive });
        entries.push({ type: 'action', id: 'toggle-title-underline', label: underlineActive ? 'Hide Underline' : 'Show Underline', kind: 'toggle', active: underlineActive });
    }
    if (block.type === 'text' || block.type === 'title') {
        const smallCapsActive = resolveBlockSmallCaps(block);
        entries.push({ type: 'action', id: 'toggle-block-small-caps', label: smallCapsActive ? 'Disable Small Caps' : 'Enable Small Caps', kind: 'toggle', active: smallCapsActive });
        entries.push({ type: 'action', id: 'text-font-increase', label: 'Increase Font Size' });
        entries.push({ type: 'action', id: 'text-font-decrease', label: 'Decrease Font Size' });
        if (block.type === 'text') {
            entries.push({ type: 'action', id: 'text-trim-height', label: 'Trim Height' });
        }
    }
    if (entries.length) {
        entries.push({ type: 'separator' });
    }
    entries.push({ type: 'action', id: 'delete-block', label: 'Delete Block', kind: 'danger' });
    return entries;
}

async function executeAction(actionId) {
    const blockId = state.contextMenuTargetBlockId;
    // Board icon sizing
    if ((actionId === 'board-icon-increase' || actionId === 'board-icon-decrease') && blockId) {
        const block = management.getBlockById(blockId);
        if (block && block.type === 'board-link') {
            const base = constants.GRID_SIZE * 3; // 96px
            const step = constants.GRID_SIZE; // 32px
            const delta = actionId === 'board-icon-increase' ? step : -step;
            const nextW = utils.clamp((block.width || base) + delta, base * 0.6, base * 3);
            const nextH = utils.clamp((block.height || base) + delta, base * 0.6, base * 3);
            block.width = utils.snapToGrid(nextW);
            block.height = utils.snapToGrid(nextH);
            block.updatedAt = new Date().toISOString();
            management.renderBoard();
            data.queueSave('board-icon-size');
            populateMenu(blockId);
        }
        return;
    }
    if (actionId === 'new-text') {
        management.createTextBlockAt(state.lastPointerBoardPos);
        return;
    }
    if (actionId === 'new-title') {
        management.createTitleBlockAt(state.lastPointerBoardPos);
        return;
    }
    if (actionId === 'new-board') {
        await management.promptAndCreateBoard();
        return;
    }
    if (actionId === 'new-audio') {
        const filePath = await pickFile('audio/*');
        if (filePath) {
            await mediaBlocks.importAudioFile(filePath, state.lastPointerBoardPos);
        }
        return;
    }
    if (actionId === 'new-video') {
        const filePath = await pickFile('video/*');
        if (filePath) {
            await mediaBlocks.importVideoFile(filePath, state.lastPointerBoardPos);
        }
        return;
    }
    if (actionId === 'new-link') {
        const value = await promptForInput({
            title: 'Create Link',
            placeholder: 'https://example.com',
            confirmLabel: 'Create'
        });
        if (!value) {
            return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            utils.showToast('Enter a link');
            return;
        }
        const videoId = linkBlocks.parseYoutubeVideoId(trimmed);
        if (videoId) {
            linkBlocks.insertYoutubeBlock(trimmed, state.lastPointerBoardPos);
            return;
        }
        if (linkBlocks.isHttpUrl(trimmed)) {
            linkBlocks.insertLinkBlock(trimmed, state.lastPointerBoardPos);
            return;
        }
        utils.showToast('Invalid link');
        return;
    }
    if (actionId === 'new-youtube') {
        const value = await promptForInput({
            title: 'Embed YouTube',
            placeholder: 'YouTube link',
            confirmLabel: 'Embed'
        });
        if (!value) {
            return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            utils.showToast('Enter a YouTube link');
            return;
        }
        const videoId = linkBlocks.parseYoutubeVideoId(trimmed);
        if (!videoId) {
            utils.showToast('Link must be YouTube');
            return;
        }
        linkBlocks.insertYoutubeBlock(trimmed, state.lastPointerBoardPos);
        return;
    }
    if (actionId === 'delete-block') {
        if (state.selectedBlockIds.size > 1) {
            management.deleteSelectedBlocks();
            return;
        }
        if (blockId) {
            management.deleteBlock(blockId);
        }
        return;
    }
    if (actionId === 'toggle-title-border' && blockId) {
        toggleTitleBorder(blockId);
        populateMenu(blockId);
        return;
    }
    if (actionId === 'copy-image-to-clipboard' && blockId) {
        await copyImageToClipboard(blockId);
        return;
    }
    if (actionId === 'show-image-in-explorer' && blockId) {
        showImageInExplorer(blockId);
        return;
    }
    if (actionId === 'toggle-image-border' && blockId) {
        toggleImageBorder(blockId);
        populateMenu(blockId);
        return;
    }
    if (actionId === 'toggle-title-shadow' && blockId) {
        toggleTitleShadow(blockId);
        populateMenu(blockId);
        return;
    }
    if (actionId === 'toggle-title-underline' && blockId) {
        toggleTitleUnderline(blockId);
        populateMenu(blockId);
        return;
    }
    if (actionId === 'toggle-block-small-caps' && blockId) {
        toggleBlockSmallCaps(blockId);
        populateMenu(blockId);
        return;
    }
    if ((actionId === 'text-font-increase' || actionId === 'text-font-decrease') && blockId) {
        const delta = actionId === 'text-font-increase' ? 0.15 : -0.15;
        adjustBlockFontScale(blockId, delta);
        populateMenu(blockId);
        return;
    }
    if (actionId === 'text-trim-height' && blockId) {
        management.trimTextBlockHeight(blockId);
        populateMenu(blockId);
        return;
    }
}

function resolveBlockSmallCaps(block) {
    if (!block || (block.type !== 'text' && block.type !== 'title')) {
        return false;
    }
    const defaultValue = block.type === 'title' ? !!(state.boardData?.settings?.titleSmallCaps) : false;
    if (typeof block.smallCaps === 'boolean') {
        return block.smallCaps;
    }
    return defaultValue;
}

function toggleTitleBorder(blockId) {
    const block = management.getBlockById(blockId);
    if (!block) {
        return;
    }
    block.showBorder = !block.showBorder;
    if (block.showBorder) {
        block.showUnderline = false;
    }
    block.updatedAt = new Date().toISOString();
    management.refreshTextBlock(blockId);
    data.queueSave('title-border-toggle');
}

function toggleTitleShadow(blockId) {
    const block = management.getBlockById(blockId);
    if (!block) {
        return;
    }
    block.showShadow = !block.showShadow;
    block.updatedAt = new Date().toISOString();
    management.refreshTextBlock(blockId);
    data.queueSave('title-shadow-toggle');
}

function toggleTitleUnderline(blockId) {
    const block = management.getBlockById(blockId);
    if (!block) {
        return;
    }
    const nextUnderline = !block.showUnderline;
    block.showUnderline = nextUnderline;
    if (nextUnderline) {
        block.showBorder = false;
    }
    block.updatedAt = new Date().toISOString();
    management.refreshTextBlock(blockId);
    data.queueSave('title-underline-toggle');
}

async function copyImageToClipboard(blockId) {
    const block = management.getBlockById(blockId);
    if (!block || block.type !== 'image') {
        return;
    }
    try {
        const { electron, fs, images } = env;
        const assetPath = images.resolveImageAssetPath(block.assetName);
        if (!assetPath || !fs.existsSync(assetPath)) {
            utils.showToast('Image file not found');
            return;
        }
        const buffer = await fs.promises.readFile(assetPath);
        const nativeImg = electron.nativeImage.createFromBuffer(buffer);
        if (!nativeImg || nativeImg.isEmpty()) {
            utils.showToast('Failed to load image');
            return;
        }
        electron.clipboard.writeImage(nativeImg);
        utils.showToast('Image copied to clipboard');
    } catch (error) {
        console.error('Failed to copy image to clipboard', error);
        utils.showToast('Copy failed');
    }
}

function showImageInExplorer(blockId) {
    const block = management.getBlockById(blockId);
    if (!block || block.type !== 'image') {
        return;
    }
    try {
        const { electron, fs, images } = env;
        const assetPath = images.resolveImageAssetPath(block.assetName);
        if (!assetPath || !fs.existsSync(assetPath)) {
            utils.showToast('Image file not found');
            return;
        }
        electron.shell.showItemInFolder(assetPath);
    } catch (error) {
        console.error('Failed to show image in Explorer', error);
        utils.showToast('Explorer failed');
    }
}

function toggleImageBorder(blockId) {
    const block = management.getBlockById(blockId);
    if (!block || block.type !== 'image') {
        return;
    }
    block.showBorder = block.showBorder === false;
    block.updatedAt = new Date().toISOString();
    management.renderBoard();
    data.queueSave('image-border-toggle');
}

function toggleBlockSmallCaps(blockId) {
    const block = management.getBlockById(blockId);
    if (!block || (block.type !== 'text' && block.type !== 'title')) {
        return;
    }
    const defaultValue = block.type === 'title' ? !!(state.boardData?.settings?.titleSmallCaps) : false;
    const current = typeof block.smallCaps === 'boolean' ? block.smallCaps : defaultValue;
    const next = !current;
    if (next === defaultValue) {
        delete block.smallCaps;
    } else {
        block.smallCaps = next;
    }
    block.updatedAt = new Date().toISOString();
    management.refreshTextBlock(blockId);
    data.queueSave('block-small-caps-toggle');
}

function adjustBlockFontScale(blockId, delta) {
    const block = management.getBlockById(blockId);
    if (!block) {
        return;
    }
    if (block.type !== 'text' && block.type !== 'title') {
        return;
    }
    const current = Number(block.fontScale);
    const value = Number.isFinite(current) && current > 0 ? current : 1;
    const next = utils.clamp(value + delta, 0.6, 2.8);
    if (Math.abs(next - value) < 0.01) {
        return;
    }
    block.fontScale = next;
    block.updatedAt = new Date().toISOString();
    management.refreshTextBlock(blockId);
    data.queueSave(delta > 0 ? 'text-font-increase' : 'text-font-decrease');
}

function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (file && file.path) {
                resolve(file.path);
            } else {
                resolve(null);
            }
            input.remove();
        });
        document.body.appendChild(input);
        input.click();
    });
}

function promptForInput(options) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.classList.add('context-dialog-overlay');
        const card = document.createElement('div');
        card.classList.add('context-dialog-card');
        const heading = document.createElement('h3');
        heading.textContent = options.title || 'Input';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = options.placeholder || '';
        if (options.initialValue) {
            input.value = options.initialValue;
        }
        const actions = document.createElement('div');
        actions.classList.add('context-dialog-actions');
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.textContent = options.confirmLabel || 'Confirm';
        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        card.appendChild(heading);
        card.appendChild(input);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const cleanup = (value) => {
            overlay.remove();
            resolve(value || null);
        };

        cancelButton.addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                cleanup(null);
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                cleanup(null);
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                cleanup(input.value);
            }
        });
        confirmButton.addEventListener('click', () => cleanup(input.value));
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    });
}

function resolveBoardFromBlock(blockId) {
    if (!blockId || !state.boardData?.boards) {
        return null;
    }
    const block = management.getBlockById(blockId);
    if (!block || block.type !== 'board-link') {
        return null;
    }
    const boardId = block.targetBoardId;
    return boardId ? state.boardData.boards[boardId] : null;
}

env.menus.initialize = initialize;
env.menus.populateMenu = populateMenu;
env.menus.buildGlobalMenu = buildGlobalMenu;
env.menus.buildBlockMenu = buildBlockMenu;

env.menus.initialize();

module.exports = env;
