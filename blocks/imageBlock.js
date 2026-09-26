'use strict';

// MARK: IMAGE MANAGEMENT
const env = require('../core/state');
const { electron, axios, fs, paths, state, data, utils, constants, movement } = env;
const { resolveImageLoadingPolicy } = require('./imageLoadingPolicy');
const imageViewportController = require('./imageViewportController');

const supportedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg']);
const IMAGE_CAPTION_PLACEMENTS = new Set(['below', 'above', 'overlay-top', 'overlay-bottom']);
const IMAGE_CAPTION_VISIBILITY = new Set(['always', 'hover']);
const IMAGE_CAPTION_MAX_LINES = 3;
const IMAGE_CAPTION_MAX_CHARS = 180;

function sanitizeCaptionText(value) {
	const raw = typeof value === 'string' ? value : String(value ?? '');
	const normalized = raw.replace(/\r\n?/g, '\n');
	const trimmedLines = normalized.split('\n').map((line) => line.trim()).slice(0, IMAGE_CAPTION_MAX_LINES);
	return trimmedLines.join('\n').trim().slice(0, IMAGE_CAPTION_MAX_CHARS);
}

function normalizeCaptionPlacement(value) {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return IMAGE_CAPTION_PLACEMENTS.has(normalized) ? normalized : 'below';
}

function normalizeCaptionVisibility(value) {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return IMAGE_CAPTION_VISIBILITY.has(normalized) ? normalized : 'always';
}

function normalizeCaptionExtendBorder(value) {
	return value === true;
}

function resolveCaptionState(block) {
	const raw = (block?.caption && typeof block.caption === 'object') ? block.caption : {};
	return {
		text: sanitizeCaptionText(raw.text),
		enabled: !!raw.enabled,
		placement: normalizeCaptionPlacement(raw.placement),
		visibility: normalizeCaptionVisibility(raw.visibility),
		extendBorder: normalizeCaptionExtendBorder(raw.extendBorder)
	};
}

function applyCaptionState(block, nextState) {
	if (!block || block.type !== 'image') {
		return null;
	}
	const text = sanitizeCaptionText(nextState?.text);
	const enabled = !!nextState?.enabled;
	const placement = normalizeCaptionPlacement(nextState?.placement);
	const visibility = normalizeCaptionVisibility(nextState?.visibility);
	const extendBorder = normalizeCaptionExtendBorder(nextState?.extendBorder);
	const hasAnyValue = enabled || !!text || placement !== 'below' || visibility !== 'always' || extendBorder;
	if (!hasAnyValue) {
		delete block.caption;
		return null;
	}
	block.caption = { text, enabled, placement, visibility, extendBorder };
	return block.caption;
}

function clearCaptionEditState() {
	state.imageCaptionEditBlockId = null;
	state.imageCaptionEditSnapshot = null;
}

function ensureCaptionBlockHeight(block) {
	if (!block || block.type !== 'image') {
		return;
	}
	const caption = resolveCaptionState(block);
	if (!caption.enabled) {
		return;
	}
	if (caption.placement === 'overlay-top' || caption.placement === 'overlay-bottom') {
		return;
	}
	const minHeight = constants.GRID_SIZE * 5;
	if ((Number(block.height) || 0) < minHeight) {
		block.height = utils.snapToGrid(minHeight);
	}
}

function focusCaptionEditor(blockId) {
	if (typeof document === 'undefined') {
		return false;
	}
	const editor = document.querySelector(`.board-block[data-id="${blockId}"] .image-caption-editor`);
	if (!editor) {
		return false;
	}
	editor.focus({ preventScroll: true });
	editor.select();
	return true;
}

function beginCaptionEditing(blockId) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		return false;
	}
	const caption = resolveCaptionState(block);
	caption.enabled = true;
	applyCaptionState(block, caption);
	ensureCaptionBlockHeight(block);
	state.imageCaptionEditBlockId = blockId;
	state.imageCaptionEditSnapshot = { ...caption };
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	setTimeout(() => {
		focusCaptionEditor(blockId);
	}, 0);
	return true;
}

function finishCaptionEditing(blockId, nextValue, options = {}) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		clearCaptionEditState();
		return false;
	}
	const snapshot = state.imageCaptionEditSnapshot && state.imageCaptionEditBlockId === blockId
		? state.imageCaptionEditSnapshot
		: resolveCaptionState(block);
	let nextCaption;
	if (options.cancel) {
		nextCaption = { ...snapshot };
	} else {
		nextCaption = resolveCaptionState(block);
		nextCaption.text = sanitizeCaptionText(nextValue);
		nextCaption.enabled = true;
	}
	applyCaptionState(block, nextCaption);
	ensureCaptionBlockHeight(block);
	clearCaptionEditState();
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	if (!options.cancel) {
		data.queueSave('image-caption-edit');
	}
	return true;
}

function setCaptionEnabled(blockId, enabled) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		return false;
	}
	const caption = resolveCaptionState(block);
	caption.enabled = !!enabled;
	applyCaptionState(block, caption);
	if (caption.enabled) {
		ensureCaptionBlockHeight(block);
	}
	if (!caption.enabled && state.imageCaptionEditBlockId === blockId) {
		clearCaptionEditState();
	}
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	data.queueSave('image-caption-toggle');
	return true;
}

function setCaptionPlacement(blockId, placement) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		return false;
	}
	const caption = resolveCaptionState(block);
	caption.enabled = true;
	caption.placement = normalizeCaptionPlacement(placement);
	applyCaptionState(block, caption);
	ensureCaptionBlockHeight(block);
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	data.queueSave('image-caption-placement');
	return true;
}

function setCaptionVisibility(blockId, visibility) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		return false;
	}
	const caption = resolveCaptionState(block);
	caption.enabled = true;
	caption.visibility = normalizeCaptionVisibility(visibility);
	applyCaptionState(block, caption);
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	data.queueSave('image-caption-visibility');
	return true;
}

function setCaptionExtendBorder(blockId, extendBorder) {
	const block = env.management?.getBlockById?.(blockId);
	if (!block || block.type !== 'image') {
		return false;
	}
	const caption = resolveCaptionState(block);
	caption.enabled = true;
	caption.extendBorder = !!extendBorder;
	applyCaptionState(block, caption);
	block.updatedAt = new Date().toISOString();
	env.management.renderBoard();
	data.queueSave('image-caption-border-extend');
	return true;
}

function handlePaste(event) {
	const { clipboard } = electron;
	const clipboardImage = clipboard.readImage();
	if (!clipboardImage.isEmpty()) {
		return createImageBlockFromNativeImage(clipboardImage, state.lastPointerBoardPos)
			.then(() => {
				console.info('Image pasted from clipboard');
				event.preventDefault();
			})
			.catch((error) => {
				console.error('Failed to create image block from clipboard', error);
				utils.showToast('Clipboard image failed');
			});
	}
	const clipboardText = clipboard.readText();
	if (clipboardText && looksLikeImageUrl(clipboardText)) {
		return createImageBlockFromUrl(clipboardText.trim(), state.lastPointerBoardPos)
			.then(() => {
				console.info('Image pasted from URL', { length: clipboardText.trim().length });
				event.preventDefault();
			})
			.catch((error) => {
				console.error('Failed to create image block from URL', error);
				utils.showToast('Image download failed');
			});
	}
	return Promise.resolve();
}

function createImageBlock({ assetName, width, height, position }) {
	const board = state.boardData.boards[state.currentBoardId];
	if (!board) {
		console.warn('Image block creation skipped: board unavailable');
		return null;
	}
	const fallbackPosition = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
	const basePosition = (position && typeof position.x === 'number' && typeof position.y === 'number') ? position : fallbackPosition;
	const snappedPosition = utils.snapPointToGrid(basePosition);
	const snappedSize = utils.snapDimensionsToGrid(width, height, { preserveRatio: true, minWidthCells: 3, minHeightCells: 3 });
	const block = {
		id: utils.createId('image'),
		type: 'image',
		x: snappedPosition.x,
		y: snappedPosition.y,
		width: snappedSize.width,
		height: snappedSize.height,
		assetName,
		showBorder: true,
		opaqueBackground: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
	board.blocks.push(block);
	data.queueSave('image-added');
	env.management.renderBoard();
	console.info('Image block created', { id: block.id, assetName });
	return block;
}

function scaleDimensions(width, height, maxDim) {
	const maxSide = Math.max(width, height);
	if (maxSide <= maxDim) {
		return { width, height };
	}
	const ratio = maxDim / maxSide;
	return {
		width: Math.round(width * ratio),
		height: Math.round(height * ratio)
	};
}

async function createImageBlockFromNativeImage(nativeImg, position) {
	const block = await stageNativeImage(nativeImg, position);
	if (!block) {
		console.warn('Image asset stage skipped: native image invalid');
		return null;
	}
	console.info('Image asset staged from clipboard', { assetName: block.assetName });
	return block;
}

async function createImageBlockFromUrl(url, position) {
	const response = await axios({
		url,
		method: 'GET',
		responseType: 'arraybuffer',
		timeout: 8000
	});
	const buffer = Buffer.from(response.data);
	const block = await createImageBlockFromBuffer(buffer, position);
	if (!block) {
		throw new Error('Image buffer invalid');
	}
	console.info('Image asset downloaded', { assetName: block.assetName });
	return block;
}

async function createImageBlockFromBuffer(buffer, position) {
	if (!buffer || buffer.length === 0) {
		console.warn('Image buffer import skipped: buffer empty');
		return null;
	}
	const image = electron.nativeImage.createFromBuffer(buffer);
	if (!image || image.isEmpty()) {
		console.warn('Image buffer import skipped: native image empty', { byteLength: buffer.length });
		return null;
	}
	return stageNativeImage(image, position);
}

async function stageNativeImage(nativeImg, position) {
	if (!nativeImg || nativeImg.isEmpty()) {
		console.warn('Image staging failed: native image empty');
		return null;
	}
	const size = nativeImg.getSize();
	const width = size?.width || 800;
	const height = size?.height || 600;
	const scaled = scaleDimensions(width, height, constants.IMAGE_MAX_DIMENSION);
	const resized = nativeImg.resize({ width: scaled.width, height: scaled.height, quality: 'best' });
	const finalImage = resized && !resized.isEmpty() ? resized : nativeImg;
	const pngBuffer = finalImage.toPNG();
	const assetName = await persistImageBuffer(pngBuffer, 'png');
	return createImageBlock({ assetName, width: scaled.width, height: scaled.height, position });
}

async function persistImageBuffer(buffer, extension) {
	await data.ensureDataDirectories();
	const fileName = `${utils.createId('image')}.${extension}`;
	const assetPath = env.path.join(paths.imagesDir, fileName);
	await fs.promises.writeFile(assetPath, buffer);
	if (typeof data.invalidateAssetIndex === 'function') {
		data.invalidateAssetIndex();
	}
	return env.path.join('images', fileName).replace(/\\/g, '/');
}

function normalizeImageExtension(value) {
	if (!value) {
		return '';
	}
	const trimmed = String(value).trim().toLowerCase();
	if (!trimmed) {
		return '';
	}
	return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function isImageExtension(value) {
	const normalized = normalizeImageExtension(value);
	if (!normalized) {
		return false;
	}
	return supportedImageExtensions.has(normalized);
}

function looksLikeImageUrl(text) {
	const trimmed = text.trim().toLowerCase();
	return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function determineImageExtension(contentType, fallbackUrl) {
	if (contentType) {
		if (contentType.includes('png')) {
			return 'png';
		}
		if (contentType.includes('jpeg') || contentType.includes('jpg')) {
			return 'jpg';
		}
		if (contentType.includes('gif')) {
			return 'gif';
		}
		if (contentType.includes('webp')) {
			return 'webp';
		}
	}
	const lower = fallbackUrl.toLowerCase();
	if (lower.endsWith('.png')) {
		return 'png';
	}
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
		return 'jpg';
	}
	if (lower.endsWith('.gif')) {
		return 'gif';
	}
	if (lower.endsWith('.webp')) {
		return 'webp';
	}
	return 'png';
}

function resolveImageAssetPath(assetName) {
	if (!assetName) {
		return '';
	}
	const located = typeof data.findAssetFilePath === 'function' ? data.findAssetFilePath(assetName, { type: 'image' }) : '';
	if (located) {
		return located;
	}
	const normalized = String(assetName).replace(/\\/g, '/');
	if (normalized.startsWith('assets/')) {
		return env.path.join(paths.dataDir, normalized);
	}
	if (normalized.startsWith('images/')) {
		const relative = normalized.slice('images/'.length);
		return env.path.join(paths.imagesDir, relative);
	}
	if (normalized.includes('/')) {
		return env.path.join(paths.dataDir, normalized);
	}
	const imagePath = env.path.join(paths.imagesDir, normalized);
	if (fs.existsSync(imagePath)) {
		return imagePath;
	}
	return env.path.join(paths.assetsDir, normalized);
}

function resolveImageAssetUrl(assetName) {
	const filePath = resolveImageAssetPath(assetName);
	return env.utils.toFileUrl(filePath);
}

function createManagedImageElement(block, element, options = {}) {
	const img = document.createElement('img');
	const assetPath = resolveImageAssetPath(block.assetName);
	const src = resolveImageAssetUrl(block.assetName);
	const loadingPolicy = resolveImageLoadingPolicy(options);
	img.decoding = loadingPolicy.decoding;
	img.loading = loadingPolicy.loading;
	img.setAttribute('fetchpriority', loadingPolicy.fetchPriority);
	img.dataset.imageResolution = 'pending';
	if (!src || !assetPath) {
		img.alt = 'Image unavailable';
	} else {
		imageViewportController.bindImage(img, {
			assetName: block.assetName,
			sourcePath: assetPath,
			sourceUrl: src
		});
	}
	img.draggable = false;
	const fitMode = block?.displayLayout?.fitMode === 'fill' ? 'cover' : 'contain';
	img.style.objectFit = fitMode;
	if (typeof block?.displayLayout?.objectPosition === 'string' && block.displayLayout.objectPosition.trim()) {
		img.style.objectPosition = block.displayLayout.objectPosition.trim();
	}
	return img;
}

function wireCaptionDisplay(block, display) {
	display.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	display.addEventListener('dblclick', (event) => {
		event.preventDefault();
		event.stopPropagation();
		beginCaptionEditing(block.id);
	});
	display.addEventListener('click', (event) => {
		if (event.button !== 0) {
			return;
		}
		if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		if (state.dragState || state.pendingDrag) {
			return;
		}
		if (state.selectedBlockId !== block.id) {
			movement.selectBlock(block.id);
		} else {
			beginCaptionEditing(block.id);
		}
		event.preventDefault();
		event.stopPropagation();
	});
}

function wireCaptionEditor(block, editor) {
	editor.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	editor.addEventListener('click', (event) => {
		event.stopPropagation();
	});
	editor.addEventListener('dblclick', (event) => {
		event.stopPropagation();
	});
	editor.addEventListener('blur', () => {
		finishCaptionEditing(block.id, editor.value);
	});
	editor.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			finishCaptionEditing(block.id, editor.value, { cancel: true });
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			finishCaptionEditing(block.id, editor.value);
		}
	});
}

function createCaptionElement(block, caption, editing) {
	const container = document.createElement('div');
	container.classList.add('image-caption', `image-caption-placement-${caption.placement}`);
	if (caption.visibility === 'hover') {
		container.classList.add('image-caption-visibility-hover');
	}
	if (editing) {
		container.classList.add('is-editing');
	}
	if (editing) {
		const editor = document.createElement('textarea');
		editor.classList.add('image-caption-editor');
		editor.value = caption.text || '';
		editor.placeholder = 'Caption';
		editor.setAttribute('spellcheck', 'false');
		wireCaptionEditor(block, editor);
		container.appendChild(editor);
		setTimeout(() => {
			if (state.imageCaptionEditBlockId === block.id) {
				focusCaptionEditor(block.id);
			}
		}, 0);
		return container;
	}
	if (!caption.text) {
		return null;
	}
	const display = document.createElement('div');
	display.classList.add('image-caption-display');
	display.textContent = caption.text;
	wireCaptionDisplay(block, display);
	container.appendChild(display);
	return container;
}

function appendCaptionForPlacement(card, media, captionEl, placement, captionHeight) {
	if (!captionEl) {
		return;
	}
	if (captionHeight > 0 && (placement === 'above' || placement === 'below')) {
		captionEl.style.height = `${captionHeight}px`;
	}
	if (placement === 'overlay-top' || placement === 'overlay-bottom') {
		media.appendChild(captionEl);
		return;
	}
	if (placement === 'above') {
		card.appendChild(captionEl);
		card.appendChild(media);
		return;
	}
	card.appendChild(media);
	card.appendChild(captionEl);
}

function restoreManagedBlockPreview(blockId, assetName = '') {
	const board = state.boardData?.boards?.[state.currentBoardId];
	const block = board?.blocks?.find((candidate) => candidate?.id === blockId && candidate.type === 'image');
	const resolvedAssetName = String(assetName || block?.assetName || '');
	if (!resolvedAssetName) {
		return false;
	}
	return imageViewportController.restoreBlockPreview(blockId, {
		assetName: resolvedAssetName,
		sourcePath: resolveImageAssetPath(resolvedAssetName),
		sourceUrl: resolveImageAssetUrl(resolvedAssetName)
	});
}

const imageApi = {
	handlePaste,
	createImageBlock,
	createImageBlockFromNativeImage,
	createImageBlockFromBuffer,
	createImageBlockFromUrl,
	scaleDimensions,
	persistImageBuffer,
	looksLikeImageUrl,
	determineImageExtension,
	isImageExtension,
	resolveImageAssetPath,
	resolveImageAssetUrl,
	resolveCaptionState,
	beginCaptionEditing,
	finishCaptionEditing,
	setCaptionEnabled,
	setCaptionPlacement,
	setCaptionVisibility,
	setCaptionExtendBorder,
	resetViewportImageBindings: imageViewportController.resetBindings,
	refreshVisiblePreviews: imageViewportController.refreshVisiblePreviews,
	restoreBlockPreview: restoreManagedBlockPreview,
	beginViewportInteraction: imageViewportController.beginViewportInteraction,
	endViewportInteraction: imageViewportController.endViewportInteraction,
	getViewportImageDiagnostics: imageViewportController.getDiagnostics,
	profileViewportImageResolution: imageViewportController.profileResolutionCancellation,
	profileViewportImageFocusRecovery: imageViewportController.profileWindowActivityRecovery,
	populateElement(block, element, options = {}) {
		const caption = resolveCaptionState(block);
		const editingCaption = state.imageCaptionEditBlockId === block.id;
		element.classList.add('image-block');
		element.classList.toggle('image-border-hidden', block.showBorder === false);
		element.classList.toggle('image-background-opaque', block.opaqueBackground === true);
		if (caption.enabled) {
			element.classList.add('image-has-caption', `image-caption-placement-${caption.placement}`);
			if (caption.visibility === 'hover') {
				element.classList.add('image-caption-hover-only');
			}
			if (caption.extendBorder) {
				element.classList.add('image-caption-extend-border');
			}
		}
		const card = document.createElement('div');
		card.classList.add('image-block-card');
		const media = document.createElement('div');
		media.classList.add('image-block-media');
		if (block?.displayLayout?.mediaHeight) {
			const mediaHeight = Math.max(constants.GRID_SIZE * 2, Number(block.displayLayout.mediaHeight) || 0);
			media.style.flex = '0 0 auto';
			media.style.flexBasis = `${mediaHeight}px`;
			media.style.height = `${mediaHeight}px`;
		}
		const img = createManagedImageElement(block, element, options);
		media.appendChild(img);
		const captionEl = (caption.enabled || editingCaption)
			? createCaptionElement(block, caption, editingCaption)
			: null;
		if (captionEl && Number(block?.displayLayout?.captionFontSize) > 0) {
			captionEl.style.fontSize = `${Number(block.displayLayout.captionFontSize)}px`;
		}
		if (captionEl && block?.displayLayout?.captionSingleLine) {
			captionEl.classList.add('image-caption-single-line');
		}
		const captionHeight = Number(block?.displayLayout?.captionHeight) || 0;
		appendCaptionForPlacement(card, media, captionEl, caption.placement, captionHeight);
		if (!card.contains(media)) {
			card.appendChild(media);
		}
		element.appendChild(card);
	}
};

imageApi.handlePasteEvent = (event) => {
	handlePaste(event).catch((error) => {
		console.error('Paste handling failed', error);
		utils.showToast('Unable to paste image right now');
	});
};

imageApi.assetDirectory = paths.imagesDir;

env.blocks.image = imageApi;
env.images = imageApi;

module.exports = imageApi;
