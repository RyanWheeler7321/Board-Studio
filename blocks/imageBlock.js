'use strict';

// MARK: IMAGE MANAGEMENT
const env = require('../core/state');
const { electron, axios, fs, paths, state, data, utils, constants } = env;

const supportedImageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg']);
const loggedImageLoadFailures = new Set();
const imageFallbackCache = new Map();
const IMAGE_FALLBACK_CACHE_LIMIT = 128;

function resolvePaintPreviewKey(boardId, blockId) {
	return `${String(boardId || '')}:${String(blockId || '')}`;
}

function getLivePreviewForBlock(block) {
	if (!block?.id || !(state.paintLivePreviews instanceof Map)) {
		return '';
	}
	const boardId = state.currentBoardId || '';
	return state.paintLivePreviews.get(resolvePaintPreviewKey(boardId, block.id))
		|| state.paintLivePreviews.get(String(block.id))
		|| '';
}

async function handlePaste(event) {
	const { clipboard, nativeImage } = electron;
	const clipboardImage = clipboard.readImage();
	if (!clipboardImage.isEmpty()) {
		try {
			await createImageBlockFromNativeImage(clipboardImage, state.lastPointerBoardPos);
			console.info('Image pasted from clipboard');
			event.preventDefault();
			return;
		} catch (error) {
			console.error('Failed to create image block from clipboard', error);
			utils.showToast('Clipboard image failed');
		}
	}
	const clipboardText = clipboard.readText();
	if (clipboardText && looksLikeImageUrl(clipboardText)) {
		try {
			await createImageBlockFromUrl(clipboardText.trim(), state.lastPointerBoardPos);
			console.info('Image pasted from URL', { url: clipboardText.trim() });
			event.preventDefault();
			return;
		} catch (error) {
			console.error('Failed to create image block from URL', error);
			utils.showToast('Image download failed');
		}
	}
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
	console.info('Image asset downloaded', { assetName: block.assetName, url });
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
	populateElement(block, element) {
		const img = document.createElement('img');
		const livePreviewSrc = getLivePreviewForBlock(block);
		const assetPath = imageApi.resolveImageAssetPath(block.assetName);
		const src = imageApi.resolveImageAssetUrl(block.assetName);
		img.decoding = 'async';
		img.loading = 'lazy';
		img.setAttribute('fetchpriority', 'low');
		const assetKey = typeof block?.assetName === 'string' ? block.assetName : '';
		const cachedFallback = assetKey ? imageFallbackCache.get(assetKey) : null;
		const protocol = typeof window !== 'undefined' && window.location ? window.location.protocol : '';
		const canLoadFileUrls = protocol === 'file:';
		if (livePreviewSrc) {
			img.dataset.workboardPaintPreview = '1';
			img.src = livePreviewSrc;
			img.draggable = false;
			element.appendChild(img);
			element.classList.toggle('image-border-hidden', block.showBorder === false);
			return;
		}
		if (cachedFallback && (!canLoadFileUrls || !src)) {
			img.dataset.workboardFallbackApplied = '1';
			img.src = cachedFallback;
			img.draggable = false;
			element.appendChild(img);
			element.classList.toggle('image-border-hidden', block.showBorder === false);
			return;
		}
		img.addEventListener('error', () => {
			if (img.dataset.workboardFallbackApplied === '1') {
				return;
			}
			img.dataset.workboardFallbackApplied = '1';
			const previouslyCached = assetKey ? imageFallbackCache.get(assetKey) : null;
			if (previouslyCached) {
				img.src = previouslyCached;
				return;
			}
			if (block?.assetName && !loggedImageLoadFailures.has(block.assetName)) {
				loggedImageLoadFailures.add(block.assetName);
				console.warn('Image failed to load; applying native fallback', { assetName: block.assetName, src, assetPath });
			}
			try {
				if (!assetPath || !fs.existsSync(assetPath)) {
					img.alt = 'Image unavailable';
					return;
				}
				const nativeImg = electron.nativeImage.createFromPath(assetPath);
				if (!nativeImg || nativeImg.isEmpty()) {
					img.alt = 'Image unavailable';
					return;
				}
				const fallbackSrc = nativeImg.toDataURL();
				if (assetKey && fallbackSrc) {
					imageFallbackCache.set(assetKey, fallbackSrc);
					if (imageFallbackCache.size > IMAGE_FALLBACK_CACHE_LIMIT) {
						const firstKey = imageFallbackCache.keys().next().value;
						if (firstKey) {
							imageFallbackCache.delete(firstKey);
						}
					}
				}
				img.src = fallbackSrc;
			} catch (error) {
				console.warn('Image fallback failed', { assetName: block?.assetName, error });
				img.alt = 'Image unavailable';
			}
		});
		if (src) {
			img.src = src;
		} else {
			img.alt = 'Image unavailable';
		}
		img.draggable = false;
		element.appendChild(img);
		element.classList.toggle('image-border-hidden', block.showBorder === false);
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
