'use strict';

// MARK: VIDEO BLOCK RUNTIME
const env = require('../core/state');
const {
	utils,
	state,
	data,
	constants,
	management,
	movement
} = env;

const {
	ensureMediaDirectories,
	sanitizeTitle,
	stageMediaAsset,
	resolveTitleSource,
	renameBlockAsset,
	makeMediaPath
} = require('./mediaCommon');

const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi']);

function createVideoBlockRecord({ assetName, title, position }) {
	const now = new Date().toISOString();
	const fallback = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
	const snapped = utils.snapPointToGrid(position || fallback);
	const width = constants.GRID_SIZE * 26;
	const height = constants.GRID_SIZE * 18;
	return {
		id: utils.createId('video'),
		type: 'video',
		x: snapped.x,
		y: snapped.y,
		width,
		height,
		assetName,
		title: title || 'Video',
		createdAt: now,
		updatedAt: now,
		poster: null,
		aspectRatio: null,
		intrinsicWidth: null,
		intrinsicHeight: null
	};
}

async function importVideoFile(source, position) {
	try {
		const assetName = await stageMediaAsset(source, 'video');
		const block = createVideoBlockRecord({ assetName, title: sanitizeTitle(resolveTitleSource(source)), position });
		management.insertBlock(block, { saveReason: 'video-added' });
		movement.selectBlock(block.id);
		console.info('Video block imported', { id: block.id, assetName });
		return block;
	} catch (error) {
		console.error('Video import failed', error);
		const message = (error.code === 'MEDIA_SOURCE_MISSING' || error.code === 'ENOENT') ? 'Video file is no longer available' : 'Unable to import video file';
		utils.showToast(message);
		return null;
	}
}

function isVideoExtension(extension) {
	return videoExtensions.has((extension || '').toLowerCase());
}

function populateVideoBlockElement(block, element) {
	element.classList.add('media-block', 'media-video-block');
	const container = document.createElement('div');
	container.classList.add('video-block');

	const header = document.createElement('div');
	header.classList.add('video-block-header');
    const title = document.createElement('div');
    title.classList.add('video-block-title');
    title.textContent = block.title || 'Video';
    title.setAttribute('contenteditable', 'true');
    title.setAttribute('spellcheck', 'false');
    header.appendChild(title);
    title.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }
        if (!state.selectedBlockIds.has(block.id)) {
            event.preventDefault();
            const active = document.activeElement;
            if (active && active.isContentEditable && typeof active.blur === 'function') {
                active.blur();
            }
        }
    });

	const video = document.createElement('video');
	video.classList.add('video-block-player');
	video.src = makeMediaPath(block.assetName);
	video.controls = true;
	video.preload = 'metadata';

	container.appendChild(header);
	container.appendChild(video);
	element.appendChild(container);

	function applyVideoAspect(width, height, ratio) {
		if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(ratio) || ratio <= 0) {
			return;
		}
		const snapped = utils.snapRectToGrid({ x: block.x, y: block.y, width, height }, {
			preserveRatio: true,
			aspectRatio: ratio,
			minWidthCells: Math.max(3, Math.round((constants.GRID_SIZE * 6) / constants.GRID_SIZE)),
			minHeightCells: Math.max(3, Math.round((constants.GRID_SIZE * 4) / constants.GRID_SIZE))
		});
		const sizeChanged = Math.abs(snapped.width - block.width) > 0.5 || Math.abs(snapped.height - block.height) > 0.5;
		const ratioChanged = !Number.isFinite(block.aspectRatio) || Math.abs(block.aspectRatio - ratio) > 0.0005;
		if (!sizeChanged && !ratioChanged) {
			block.aspectRatio = ratio;
			return;
		}
		block.aspectRatio = ratio;
		if (sizeChanged) {
			block.width = snapped.width;
			block.height = snapped.height;
			element.style.width = `${snapped.width}px`;
			element.style.height = `${snapped.height}px`;
		}
		block.updatedAt = new Date().toISOString();
		data.queueSave('video-aspect');
	}

	video.addEventListener('loadedmetadata', () => {
		const intrinsicWidth = Math.max(1, Number(video.videoWidth) || 0);
		const intrinsicHeight = Math.max(1, Number(video.videoHeight) || 0);
		if (!intrinsicWidth || !intrinsicHeight) {
			return;
		}
		const ratio = intrinsicWidth / intrinsicHeight;
		block.intrinsicWidth = intrinsicWidth;
		block.intrinsicHeight = intrinsicHeight;
		if (!Number.isFinite(ratio) || ratio <= 0) {
			return;
		}
		video.style.aspectRatio = `${ratio}`;
		const targetWidth = block.width || (block.height * ratio) || constants.GRID_SIZE * 18;
		const desiredHeight = targetWidth / ratio;
		applyVideoAspect(targetWidth, desiredHeight, ratio);
	});

	async function commitTitle(value) {
		const trimmed = typeof value === 'string' ? value.trim() : '';
		const resolved = trimmed || 'Video';
		const previousTitle = block.title || 'Video';
		if (resolved === previousTitle) {
			title.textContent = resolved;
			return;
		}
		const wasPlaying = !video.paused;
		const resumePosition = video.currentTime;
		if (wasPlaying) {
			video.pause();
		}
		// Release file handle before renaming (Windows-safe)
		try { video.removeAttribute('src'); video.load(); } catch {}

		let renameResult = { renamed: false, assetName: block.assetName };
		let renameError = null;
		try {
			renameResult = await renameBlockAsset(block, resolved, { category: 'video' });
		} catch (error) {
			renameError = error;
		}

		if (renameResult.renamed) {
				const handleLoaded = () => {
					video.removeEventListener('loadedmetadata', handleLoaded);
					try {
						if (Number.isFinite(resumePosition)) {
							video.currentTime = Math.max(0, Math.min(video.duration || resumePosition, resumePosition));
						}
					} catch {}
					if (wasPlaying) {
						video.play().catch((playError) => {
							console.error('Failed to resume video after rename', playError);
						});
					}
				};
				video.addEventListener('loadedmetadata', handleLoaded, { once: true });
				video.src = makeMediaPath(renameResult.assetName);
				video.load();
			block.title = resolved;
			block.updatedAt = new Date().toISOString();
			title.textContent = resolved;
			data.queueSave('video-title');
		} else {
			console.error('Video rename failed', renameError);
			utils.showToast('Unable to rename video file');
			title.textContent = previousTitle;
			try { video.src = makeMediaPath(block.assetName); video.load(); } catch {}
			if (wasPlaying) { video.play().catch(() => {}); }
		}
	}

	title.addEventListener('blur', () => {
		void commitTitle(title.textContent);
	});
    title.addEventListener('keydown', (event) => {
        // Prevent Backspace and other edits from bubbling to global handlers
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            void commitTitle(title.textContent);
            title.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            title.textContent = block.title || 'Video';
            title.blur();
        }
    });
}

const videoApi = {
	ensureDirectories: ensureMediaDirectories,
	importFile: importVideoFile,
	isSupportedExtension: isVideoExtension,
	populateElement: populateVideoBlockElement
};

env.blocks.video = videoApi;

env.mediaBlocks = env.mediaBlocks || {};
env.mediaBlocks.importVideoFile = importVideoFile;
env.mediaBlocks.isVideoExtension = isVideoExtension;
env.mediaBlocks.populateVideoBlockElement = populateVideoBlockElement;

ensureMediaDirectories();

module.exports = videoApi;
