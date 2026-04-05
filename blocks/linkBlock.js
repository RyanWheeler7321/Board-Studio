'use strict';

// MARK: LINK BLOCK RENDERER
const env = require('../core/state');
const {
	utils,
	state,
	data,
	constants,
	management,
	movement
} = env;

function isHttpUrl(text) {
	if (typeof text !== 'string') {
		return false;
	}
	const trimmed = text.trim().toLowerCase();
	return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

async function openUrlExternally(url) {
	if (!isHttpUrl(url)) {
		return;
	}
	const trimmed = url.trim();
	if (!trimmed) {
		return;
	}
	try {
		if (env.electron?.shell?.openExternal) {
			await env.electron.shell.openExternal(trimmed);
			return;
		}
	} catch (error) {
		console.warn('Shell external open failed', { url: trimmed, error: error?.message || error });
	}
	try {
		if (env.electron?.ipcRenderer?.invoke) {
			const result = await env.electron.ipcRenderer.invoke('workboard-open-external', trimmed);
			if (result) {
				return;
			}
		}
	} catch (error) {
		console.warn('IPC external open failed', { url: trimmed, error: error?.message || error });
	}
	try {
		window.open(trimmed, '_blank', 'noopener,noreferrer');
	} catch (error) {
		console.error('Fallback external open failed', error);
	}
}

function deriveDisplayName(url) {
	if (!url) {
		return 'Link';
	}
	try {
		const parsed = new URL(url.trim());
		const host = parsed.hostname.replace(/^www\./, '');
		return host || url;
	} catch {
		return url;
	}
}

function createLinkBlockRecord({ url, title, position }) {
	const now = new Date().toISOString();
	const fallback = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
	const snapped = utils.snapPointToGrid(position || fallback);
	const width = constants.GRID_SIZE * 14;
	const height = constants.GRID_SIZE * 6;
	return {
		id: utils.createId('link'),
		type: 'link',
		url,
		title: title || deriveDisplayName(url),
		x: snapped.x,
		y: snapped.y,
		width,
		height,
		createdAt: now,
		updatedAt: now
	};
}

function insertLinkBlock(url, position) {
	const block = createLinkBlockRecord({ url: url.trim(), title: deriveDisplayName(url), position });
	management.insertBlock(block, { saveReason: 'link-added' });
	movement.selectBlock(block.id);
	console.info('Link block created', { id: block.id, url: block.url });
	return block;
}

function populateLinkBlockElement(block, element) {
	element.classList.add('link-block');
	element.style.display = 'flex';
	element.style.flexDirection = 'column';
	element.style.minHeight = '0';
	const container = document.createElement('div');
	container.classList.add('link-block-card');
	container.style.flex = '1';
	container.style.minHeight = '0';
	const title = document.createElement('div');
	title.classList.add('link-block-title');
    title.textContent = block.title || deriveDisplayName(block.url);
    title.setAttribute('contenteditable', 'true');
    title.setAttribute('spellcheck', 'false');
	title.addEventListener('pointerdown', (event) => {
		if (event.button !== 0) {
			return;
		}
		if (!state.selectedBlockIds.has(block.id)) {
			// Prevent the title from stealing focus before the block is selected.
			event.preventDefault();
			const active = document.activeElement;
			if (active && active.isContentEditable && typeof active.blur === 'function') {
				active.blur();
			}
		}
	});
	container.appendChild(title);

	const urlButton = document.createElement('button');
	urlButton.type = 'button';
	urlButton.classList.add('link-block-url-button');
	urlButton.textContent = block.url || '';
	urlButton.title = block.url || '';
	urlButton.addEventListener('click', (event) => {
		if (window.getSelection && window.getSelection()?.toString()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		openUrlExternally(block.url);
	});
	urlButton.addEventListener('dblclick', (event) => {
		if (window.getSelection && window.getSelection()?.toString()) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		openUrlExternally(block.url);
	});

	container.appendChild(urlButton);
	element.appendChild(container);

	function commitTitle(value) {
		const trimmed = typeof value === 'string' ? value.trim() : '';
		const resolved = trimmed || deriveDisplayName(block.url);
		if (resolved === block.title) {
			title.textContent = resolved;
			return;
		}
		block.title = resolved;
		block.updatedAt = new Date().toISOString();
		title.textContent = resolved;
		data.queueSave('link-title');
	}

	title.addEventListener('blur', () => commitTitle(title.textContent));
    title.addEventListener('keydown', (event) => {
        // Let editing keys like Backspace work; avoid global shortcuts
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            commitTitle(title.textContent);
            title.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            title.textContent = block.title || deriveDisplayName(block.url);
            title.blur();
        }
    });

	const shouldOpen = (event) => {
		if (!isHttpUrl(block.url)) {
			return;
		}
		if (document.activeElement === title) {
			return;
		}
		const selection = window.getSelection && window.getSelection();
		if (selection && selection.toString()) {
			return;
		}
		event.preventDefault();
		openUrlExternally(block.url);
	};

	container.addEventListener('dblclick', shouldOpen);
	container.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
			shouldOpen(event);
		}
	});
	container.setAttribute('tabindex', '0');
}

const linkApi = {
	isHttpUrl,
	deriveDisplayName,
	openUrlExternally,
	insertBlock: insertLinkBlock,
	populateElement: populateLinkBlockElement
};

env.blocks.link = linkApi;

env.linkBlocks = env.linkBlocks || {};
env.linkBlocks.isHttpUrl = isHttpUrl;
env.linkBlocks.insertLinkBlock = insertLinkBlock;
env.linkBlocks.populateLinkBlockElement = populateLinkBlockElement;

module.exports = linkApi;
