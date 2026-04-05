'use strict';

// MARK: YOUTUBE BLOCK RENDERER
const env = require('../core/state');
const {
	utils,
	data,
	constants,
	management,
	movement
} = env;

const linkApi = require('./linkBlock');

function parseYoutubeVideoId(url) {
	if (!linkApi.isHttpUrl(url)) {
		return null;
	}
	try {
		const parsed = new URL(url.trim());
		if (parsed.hostname.includes('youtube.com')) {
			if (parsed.searchParams.has('v')) {
				return parsed.searchParams.get('v');
			}
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments[0] === 'embed' && segments[1]) {
				return segments[1];
			}
			if (segments[0] === 'shorts' && segments[1]) {
				return segments[1];
			}
		}
		if (parsed.hostname === 'youtu.be') {
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments[0]) {
				return segments[0];
			}
		}
	} catch {}
	return null;
}

function createYoutubeBlockRecord({ url, videoId, title, position }) {
	const now = new Date().toISOString();
	const fallback = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
	const snapped = utils.snapPointToGrid(position || fallback);
	const width = constants.GRID_SIZE * 26;
	const height = constants.GRID_SIZE * 16;
	return {
		id: utils.createId('youtube'),
		type: 'youtube',
		url,
		videoId,
		title: title || 'YouTube',
		x: snapped.x,
		y: snapped.y,
		width,
		height,
		createdAt: now,
		updatedAt: now
	};
}

function insertYoutubeBlock(url, position) {
	const trimmed = url.trim();
	const videoId = parseYoutubeVideoId(trimmed);
	if (!videoId) {
		console.warn('YouTube URL rejected', { url: trimmed });
		return null;
	}
	const block = createYoutubeBlockRecord({ url: trimmed, videoId, title: 'YouTube', position });
	management.insertBlock(block, { saveReason: 'youtube-added' });
	movement.selectBlock(block.id);
	console.info('YouTube block created', { id: block.id, videoId: block.videoId });
	return block;
}

function populateYoutubeBlockElement(block, element) {
	element.classList.add('youtube-block');
	element.style.display = 'flex';
	element.style.flexDirection = 'column';
	element.style.minHeight = '0';
	const container = document.createElement('div');
	container.classList.add('youtube-block-container');
	container.style.flex = '1';
	container.style.minHeight = '0';
	const resolvedVideoId = (typeof block.videoId === 'string' && block.videoId.trim()) ? block.videoId.trim() : parseYoutubeVideoId(block.url);
	const linkTarget = block.url || (resolvedVideoId ? `https://youtu.be/${resolvedVideoId}` : '');
	if (linkTarget) {
		const linkBar = document.createElement('div');
		linkBar.classList.add('youtube-block-link-bar');
		const linkButton = document.createElement('button');
		linkButton.type = 'button';
		linkButton.classList.add('youtube-block-link');
		linkButton.textContent = linkTarget;
		linkButton.title = linkTarget;
		linkButton.addEventListener('pointerdown', (event) => {
			if (event.button === 0) {
				movement.handleBlockPointerDown(event, block, element);
				event.stopPropagation();
			}
		});
		linkButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			linkApi.openUrlExternally(linkTarget);
		});
		linkButton.addEventListener('dblclick', (event) => {
			event.preventDefault();
			event.stopPropagation();
			linkApi.openUrlExternally(linkTarget);
		});
		linkBar.appendChild(linkButton);
		container.appendChild(linkBar);
	}
	const frameWrapper = document.createElement('div');
	frameWrapper.classList.add('youtube-block-frame');
	if (resolvedVideoId) {
		if (resolvedVideoId !== block.videoId) {
			block.videoId = resolvedVideoId;
			block.updatedAt = new Date().toISOString();
			data.queueSave('youtube-videoid-refresh');
		}
		const iframe = document.createElement('iframe');
		let origin = '';
		try {
			const candidate = window.location?.origin;
			if (typeof candidate === 'string' && candidate && candidate !== 'null') {
				origin = candidate;
			}
		} catch {}
		const originParam = origin ? `&origin=${encodeURIComponent(origin)}` : '';
		iframe.src = `https://www.youtube.com/embed/${resolvedVideoId}?modestbranding=1&rel=0&playsinline=1&enablejsapi=1${originParam}`;
		iframe.allowFullscreen = true;
		iframe.setAttribute('allowfullscreen', '');
		iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
		iframe.loading = 'lazy';
		frameWrapper.appendChild(iframe);
	} else {
		const fallback = document.createElement('div');
		fallback.classList.add('youtube-block-error');
		fallback.textContent = 'Unable to load video';
		frameWrapper.appendChild(fallback);
	}

	container.appendChild(frameWrapper);
	element.appendChild(container);
}

const youtubeApi = {
	parseVideoId: parseYoutubeVideoId,
	insertBlock: insertYoutubeBlock,
	populateElement: populateYoutubeBlockElement
};

env.blocks.youtube = youtubeApi;

env.linkBlocks = env.linkBlocks || {};
env.linkBlocks.parseYoutubeVideoId = parseYoutubeVideoId;
env.linkBlocks.insertYoutubeBlock = insertYoutubeBlock;
env.linkBlocks.populateYoutubeBlockElement = populateYoutubeBlockElement;

module.exports = youtubeApi;
