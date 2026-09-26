'use strict';

// MARK: AUDIO BLOCK RUNTIME
const env = require('../core/state');
const {
	fs,
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
	resolveAssetFilePath,
	resolveExistingAssetPath,
	renameBlockAsset,
	makeMediaPath
} = require('./mediaCommon');

const audioRuntime = new Map();
const audioOverviewCache = new Map();
const audioOverviewState = new Map();
const audioExtensions = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
const AudioContextRef = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
const OVERVIEW_TARGET_PEAKS = 1024;

function migrateAudioOverviewCache(oldAssetName, newAssetName) {
	if (!oldAssetName || !newAssetName || oldAssetName === newAssetName) {
		return;
	}
	const cached = audioOverviewCache.get(oldAssetName);
	if (cached) {
		audioOverviewCache.delete(oldAssetName);
		audioOverviewCache.set(newAssetName, cached);
	}
}

function toArrayBuffer(buffer) {
	if (!buffer) {
		return null;
	}
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function decodeAudioBufferFromFile(assetName) {
	if (!AudioContextRef) {
		return null;
	}
	const filePath = resolveExistingAssetPath(assetName, { type: 'audio' }) || resolveAssetFilePath(assetName);
	if (!filePath || !fs.existsSync(filePath)) {
		return null;
	}
	try {
		const fileBuffer = await fs.promises.readFile(filePath);
		const arrayBuffer = toArrayBuffer(fileBuffer);
		if (!arrayBuffer) {
			return null;
		}
		const context = new AudioContextRef();
		try {
			const decoded = await new Promise((resolve, reject) => {
				const result = context.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
				if (result && typeof result.then === 'function') {
					result.then(resolve).catch(reject);
				}
			});
			return decoded;
		} finally {
			if (typeof context.close === 'function') {
				context.close().catch(() => {});
			}
		}
	} catch (error) {
		console.error('Failed to decode audio asset for overview', { assetName, error });
		return null;
	}
}

function extractOverviewPeaks(audioBuffer) {
	if (!audioBuffer) {
		return null;
	}
	const sampleCount = audioBuffer.length;
	if (!sampleCount || sampleCount <= 0) {
		return null;
	}
	const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
	const targetBuckets = Math.min(OVERVIEW_TARGET_PEAKS, Math.max(256, Math.ceil(sampleCount / 400)));
	const bucketSize = Math.max(1, Math.floor(sampleCount / targetBuckets));
	const bucketCount = Math.max(1, Math.ceil(sampleCount / bucketSize));
	const peaks = new Float32Array(bucketCount);
	let globalMax = 0;
	for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
		const start = bucketIndex * bucketSize;
		const end = Math.min(start + bucketSize, sampleCount);
		let bucketPeak = 0;
		for (let channel = 0; channel < channelCount; channel += 1) {
			const channelData = audioBuffer.getChannelData(channel);
			for (let index = start; index < end; index += 1) {
				const value = Math.abs(channelData[index] || 0);
				if (value > bucketPeak) {
					bucketPeak = value;
				}
			}
		}
		peaks[bucketIndex] = bucketPeak;
		if (bucketPeak > globalMax) {
			globalMax = bucketPeak;
		}
	}
	if (globalMax > 0) {
		for (let i = 0; i < peaks.length; i += 1) {
			peaks[i] = Math.min(1, peaks[i] / globalMax);
		}
	}
	return peaks;
}

async function ensureAudioOverview(block) {
	if (!block || !block.assetName || !AudioContextRef) {
		return null;
	}
	const existing = audioOverviewCache.get(block.assetName);
	if (existing) {
		return existing;
	}
	const buffer = await decodeAudioBufferFromFile(block.assetName);
	if (!buffer) {
		return null;
	}
	const peaks = extractOverviewPeaks(buffer);
	if (!peaks) {
		return null;
	}
	const overview = {
		peaks,
		duration: buffer.duration || 0
	};
	audioOverviewCache.set(block.assetName, overview);
	return overview;
}

function getCssVar(name) {
    if (typeof window === 'undefined' || !document || !document.documentElement) {
        return '';
    }
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
    return (value || '').trim();
}

function hexToRgba(hex, alpha) {
    if (typeof hex !== 'string') return '';
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
    if (!m) return hex;
    let v = m[1];
    if (v.length === 3) v = v.split('').map((c) => c + c).join('');
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    const a = Math.max(0, Math.min(1, Number(alpha)));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawAudioOverview(canvas, peaks) {
	if (!canvas) {
		return;
	}
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return;
	}
	const width = canvas.clientWidth || 1;
	const height = canvas.clientHeight || 1;
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.max(1, Math.round(width * dpr));
	canvas.height = Math.max(1, Math.round(height * dpr));
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const bgTop = getCssVar('--bg-card');
    const bgBottom = getCssVar('--bg-card-deep') || getCssVar('--bg-primary');
    gradient.addColorStop(0, bgTop || '#222');
    gradient.addColorStop(1, bgBottom || '#111');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	if (!peaks || peaks.length === 0) {
		return;
	}
    const centerY = height / 2;
    ctx.strokeStyle = darkerAccent();
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x < width; x += 2) {
        const ratio = width <= 1 ? 0 : x / (width - 1);
        const index = Math.min(Math.floor(ratio * peaks.length), peaks.length - 1);
        const amplitude = Math.max(0, Math.min(1, peaks[index]));
        const halfHeight = Math.max(1, amplitude * 0.85 * (height / 2));
        ctx.moveTo(x + 0.5, centerY - halfHeight);
        ctx.lineTo(x + 0.5, centerY + halfHeight);
    }
	ctx.stroke();
}

function setOverviewMarker(blockId, ratio) {
	const entry = audioOverviewState.get(blockId);
	if (!entry || !entry.marker) {
		return;
	}
	const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
	entry.marker.style.left = `${(clamped * 100).toFixed(3)}%`;
}

function createAudioBlockRecord({ assetName, title, position }) {
	const now = new Date().toISOString();
	const fallback = { x: constants.GRID_SIZE * 6, y: constants.GRID_SIZE * 6 };
	const snapped = utils.snapPointToGrid(position || fallback);
	const width = constants.GRID_SIZE * 22;
	const height = constants.GRID_SIZE * 8;
	return {
		id: utils.createId('audio'),
		type: 'audio',
		x: snapped.x,
		y: snapped.y,
		width,
		height,
		assetName,
		title: title || 'Audio',
		volume: 0.9,
		createdAt: now,
		updatedAt: now
	};
}

async function importAudioFile(source, position) {
	try {
		const assetName = await stageMediaAsset(source, 'audio');
		const block = createAudioBlockRecord({ assetName, title: sanitizeTitle(resolveTitleSource(source)), position });
		management.insertBlock(block, { saveReason: 'audio-added' });
		movement.selectBlock(block.id);
		console.info('Audio block imported', { id: block.id, assetName });
		return block;
	} catch (error) {
		console.error('Audio import failed', error);
		const message = (error.code === 'MEDIA_SOURCE_MISSING' || error.code === 'ENOENT') ? 'Audio file is no longer available' : 'Unable to import audio file';
		utils.showToast(message);
		return null;
	}
}

function isAudioExtension(extension) {
	return audioExtensions.has((extension || '').toLowerCase());
}

function disposeAudioRuntime(blockId) {
	const runtime = audioRuntime.get(blockId);
	if (!runtime) {
		const overviewEntry = audioOverviewState.get(blockId);
		if (overviewEntry && overviewEntry.observer) {
			overviewEntry.observer.disconnect();
		}
		audioOverviewState.delete(blockId);
		return;
	}
	if (runtime.rafId) {
		cancelAnimationFrame(runtime.rafId);
	}
	if (runtime.analyser) {
		try {
			runtime.analyser.disconnect();
		} catch {}
	}
	if (runtime.source) {
		try {
			runtime.source.disconnect();
		} catch {}
	}
	if (runtime.context && typeof runtime.context.close === 'function') {
		runtime.context.close().catch(() => {});
	}
	audioRuntime.delete(blockId);
	const overviewEntry = audioOverviewState.get(blockId);
	if (overviewEntry && overviewEntry.observer) {
		overviewEntry.observer.disconnect();
	}
	audioOverviewState.delete(blockId);
}

function ensureAudioRuntime(block, audioEl, canvas) {
	if (!AudioContextRef) {
		return null;
	}
	const existing = audioRuntime.get(block.id);
	if (existing && existing.audio === audioEl) {
		if (existing.context?.state === 'closed') {
			audioRuntime.delete(block.id);
		} else {
			if (existing.canvas !== canvas) {
				existing.canvas = canvas;
				existing.ctx = canvas.getContext('2d');
			}
			resizeWaveformCanvas(existing);
			return existing;
		}
	} else if (existing) {
		disposeAudioRuntime(block.id);
	}
	const context = new AudioContextRef();
	const analyser = context.createAnalyser();
	analyser.fftSize = 1024;
	const bufferLength = analyser.fftSize;
	const dataArray = new Uint8Array(bufferLength);
	const source = context.createMediaElementSource(audioEl);
	source.connect(analyser);
	analyser.connect(context.destination);
	const ctx = canvas.getContext('2d');
	const runtime = { context, analyser, dataArray, source, canvas, ctx, rafId: null, audio: audioEl };
	audioRuntime.set(block.id, runtime);
	resizeWaveformCanvas(runtime);
	return runtime;
}

function resizeWaveformCanvas(runtime) {
	if (!runtime || !runtime.canvas || !runtime.ctx) {
		return;
	}
	const dpr = window.devicePixelRatio || 1;
	const width = runtime.canvas.clientWidth || 1;
	const height = runtime.canvas.clientHeight || 1;
	runtime.canvas.width = Math.max(Math.round(width * dpr), 1);
	runtime.canvas.height = Math.max(Math.round(height * dpr), 1);
	runtime.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	runtime.ctx.clearRect(0, 0, width, height);
}

function parseHexToRgb(hex) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    let v = m[1];
    if (v.length === 3) v = v.split('').map((c) => c + c).join('');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rgbToCss([r, g, b], a = 1) {
    const alpha = Math.max(0, Math.min(1, a));
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

function mixRgbArray(a, b, t) {
    const ratio = Math.max(0, Math.min(1, t));
    return [
        a[0] + (b[0] - a[0]) * ratio,
        a[1] + (b[1] - a[1]) * ratio,
        a[2] + (b[2] - a[2]) * ratio
    ];
}

function darkerAccent() {
    const acc = getCssVar('--accent');
    const rgb = parseHexToRgb(acc);
    if (!rgb) return getCssVar('--accent-strong') || '#eadbff';
    // Darken towards black for saturation feel
    const mixed = mixRgbArray(rgb, [0, 0, 0], 0.25);
    return rgbToCss(mixed, 1);
}

function drawWaveform(blockId) {
	const runtime = audioRuntime.get(blockId);
	if (!runtime || !runtime.audio || runtime.audio.paused) {
		return;
	}
	resizeWaveformCanvas(runtime);
	const { analyser, dataArray, canvas, ctx } = runtime;
	if (!analyser || !canvas || !ctx) {
		return;
	}
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    ctx.clearRect(0, 0, width, height);
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = hexToRgba(getCssVar('--bg-card-deep') || getCssVar('--bg-card') || '#242429', 0.6);
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = darkerAccent();
    ctx.beginPath();
    const sliceWidth = width / dataArray.length;
    let x = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
        const v = dataArray[i] / 128.0; // 0..2 around 1
        const mid = height / 2;
        const y = mid + (v - 1) * mid * 0.85; // reduce amplitude ~15%
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    runtime.rafId = requestAnimationFrame(() => drawWaveform(blockId));
}

function startWaveform(blockId) {
	const runtime = audioRuntime.get(blockId);
	if (!runtime) {
		return;
	}
	if (runtime.context.state === 'suspended') {
		runtime.context.resume().catch(() => {});
	}
	if (runtime.rafId) {
		cancelAnimationFrame(runtime.rafId);
	}
	runtime.rafId = requestAnimationFrame(() => drawWaveform(blockId));
}

function stopWaveform(blockId) {
	const runtime = audioRuntime.get(blockId);
	if (!runtime) {
		return;
	}
	if (runtime.rafId) {
		cancelAnimationFrame(runtime.rafId);
		runtime.rafId = null;
	}
}

function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return '0:00';
	}
	const minutes = Math.floor(seconds / 60);
	const leftover = Math.floor(seconds % 60);
	return `${minutes}:${leftover.toString().padStart(2, '0')}`;
}

function populateAudioBlockElement(block, element) {
	disposeAudioRuntime(block.id);
	element.classList.add('media-block', 'media-audio-block');
	const container = document.createElement('div');
	container.classList.add('audio-block');

	const header = document.createElement('div');
	header.classList.add('audio-block-header');
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.classList.add('audio-block-toggle');
	toggle.textContent = 'Play';
	toggle.setAttribute('aria-label', 'Play audio');
	toggle.textContent = '▶';
	const title = document.createElement('div');
	title.classList.add('audio-block-title');
	title.textContent = block.title || 'Audio';
	title.setAttribute('contenteditable', 'true');
	header.appendChild(toggle);
	header.appendChild(title);
	title.setAttribute('spellcheck', 'false');
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

	const overviewContainer = document.createElement('div');
	overviewContainer.classList.add('audio-block-overview');
	const overviewCanvas = document.createElement('canvas');
	overviewCanvas.classList.add('audio-block-waveform-overview');
	const overviewMarker = document.createElement('div');
	overviewMarker.classList.add('audio-block-overview-marker');
	const timeDisplay = document.createElement('div');
	timeDisplay.classList.add('audio-block-time-display');
	const currentTimeLabel = document.createElement('span');
	currentTimeLabel.classList.add('audio-block-time', 'is-current');
	currentTimeLabel.textContent = '0:00';
	const durationLabel = document.createElement('span');
	durationLabel.classList.add('audio-block-time', 'is-duration');
	durationLabel.textContent = '0:00';
	timeDisplay.appendChild(currentTimeLabel);
	timeDisplay.appendChild(durationLabel);
	overviewContainer.appendChild(overviewCanvas);
	overviewContainer.appendChild(overviewMarker);
	overviewContainer.appendChild(timeDisplay);

	const waveform = document.createElement('canvas');
	waveform.classList.add('audio-block-waveform');

	container.appendChild(header);
	container.appendChild(overviewContainer);
	container.appendChild(waveform);
	element.appendChild(container);

	const audio = document.createElement('audio');
	audio.src = makeMediaPath(block.assetName);
	audio.load();
	audio.preload = 'metadata';
	audio.volume = (block.volume ?? 0.9);
	element.appendChild(audio);

	const overviewEntry = {
		canvas: overviewCanvas,
		marker: overviewMarker,
		peaks: null,
		duration: 0,
		assetName: block.assetName,
		observer: null
	};
	if (typeof ResizeObserver === 'function') {
		try {
			const observer = new ResizeObserver(() => {
				if (!overviewEntry.canvas) {
					return;
				}
				drawAudioOverview(overviewEntry.canvas, overviewEntry.peaks);
			});
			observer.observe(overviewCanvas);
			overviewEntry.observer = observer;
		} catch (error) {
			console.warn('ResizeObserver unavailable for audio overview', error);
		}
	}
	audioOverviewState.set(block.id, overviewEntry);
	setOverviewMarker(block.id, 0);

	function syncOverviewMarkerFromAudio() {
		if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
			setOverviewMarker(block.id, 0);
			return;
		}
		const ratio = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
		setOverviewMarker(block.id, ratio);
	}

	async function refreshOverview(options = {}) {
		if (!AudioContextRef) {
			return;
		}
		const entry = audioOverviewState.get(block.id);
		if (!entry) {
			return;
		}
		if (!options.force && entry.assetName === block.assetName && entry.peaks && entry.peaks.length > 0) {
			drawAudioOverview(entry.canvas, entry.peaks);
			return;
		}
		const overview = await ensureAudioOverview(block);
		entry.assetName = block.assetName;
		if (!overview) {
			entry.peaks = null;
			entry.duration = 0;
			drawAudioOverview(entry.canvas, null);
			return;
		}
		entry.peaks = overview.peaks;
		entry.duration = overview.duration;
		drawAudioOverview(entry.canvas, overview.peaks);
	}

	function seekOverview(event) {
		if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
			return;
		}
		const rect = overviewCanvas.getBoundingClientRect();
		if (!rect || rect.width <= 0) {
			return;
		}
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		audio.currentTime = audio.duration * ratio;
		setOverviewMarker(block.id, ratio);
		updateProgressUI();
	}

	function hasOverviewCapture(pointerId) {
		return typeof overviewContainer.hasPointerCapture === 'function' && overviewContainer.hasPointerCapture(pointerId);
	}

	overviewContainer.addEventListener('pointerdown', (event) => {
		event.preventDefault();
		event.stopPropagation();
		try {
			overviewContainer.setPointerCapture(event.pointerId);
		} catch {}
		seekOverview(event);
	});

	overviewContainer.addEventListener('pointermove', (event) => {
		if (hasOverviewCapture(event.pointerId)) {
			event.preventDefault();
			seekOverview(event);
		}
	});

	overviewContainer.addEventListener('pointerup', (event) => {
		if (hasOverviewCapture(event.pointerId)) {
			event.preventDefault();
			seekOverview(event);
			try {
				overviewContainer.releasePointerCapture(event.pointerId);
			} catch {}
		}
	});

	overviewContainer.addEventListener('pointercancel', (event) => {
		if (hasOverviewCapture(event.pointerId)) {
			try {
				overviewContainer.releasePointerCapture(event.pointerId);
			} catch {}
		}
	});

	if (AudioContextRef) {
		refreshOverview().catch((error) => {
			console.error('Failed to initialize audio overview', error);
		});
	}

	async function commitTitle(value) {
		const trimmed = typeof value === 'string' ? value.trim() : '';
		const resolved = trimmed || 'Audio';
		const previousTitle = block.title || 'Audio';
		if (resolved === previousTitle) {
			title.textContent = resolved;
			return;
		}
		const wasPlaying = !audio.paused;
		const resumePosition = audio.currentTime;
		if (wasPlaying) {
			audio.pause();
		}
		// Release file handle before renaming (Windows-safe)
		try { audio.removeAttribute('src'); audio.load(); } catch {}

		let renameResult = { renamed: false, assetName: block.assetName };
		let renameError = null;
		try {
			renameResult = await renameBlockAsset(block, resolved, {
				afterRename: ({ previous, next }) => {
					migrateAudioOverviewCache(previous, next);
					const overview = audioOverviewState.get(block.id);
					if (overview) {
						overview.peaks = null;
					}
				}
			});
		} catch (error) {
			renameError = error;
		}

		if (renameResult.renamed) {
				const resumePlayback = () => {
					audio.removeEventListener('loadedmetadata', resumePlayback);
					try {
						if (Number.isFinite(resumePosition)) {
							audio.currentTime = Math.max(0, Math.min(audio.duration || resumePosition, resumePosition));
						}
					} catch {}
					if (wasPlaying) {
						audio.play().catch((playError) => {
							console.error('Failed to resume audio after rename', playError);
						});
					}
				};
				audio.addEventListener('loadedmetadata', resumePlayback, { once: true });
				audio.src = makeMediaPath(renameResult.assetName);
				audio.load();
			await refreshOverview({ force: true });
			block.title = resolved;
			block.updatedAt = new Date().toISOString();
			title.textContent = resolved;
			data.queueSave('audio-title');
		} else {
			// Rename failed: restore previous source and title, but keep playback usable
			console.error('Audio rename failed', renameError);
			utils.showToast('Unable to rename audio file');
			title.textContent = previousTitle;
			try { audio.src = makeMediaPath(block.assetName); audio.load(); } catch {}
			if (wasPlaying) { audio.play().catch(() => {}); }
		}
	}

	function updateProgressUI() {
		if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
			currentTimeLabel.textContent = '0:00';
			durationLabel.textContent = '0:00';
			setOverviewMarker(block.id, 0);
			return;
		}
		const ratio = Math.max(0, Math.min(1, audio.currentTime / audio.duration));
		currentTimeLabel.textContent = formatTime(audio.currentTime);
		durationLabel.textContent = formatTime(audio.duration);
		setOverviewMarker(block.id, ratio);
	}

	function updateToggleState() {
		if (audio.paused) {
			toggle.textContent = '▶';
			toggle.setAttribute('aria-label', 'Play audio');
			toggle.classList.remove('is-playing');
		} else {
			toggle.textContent = '■';
			toggle.setAttribute('aria-label', 'Stop audio');
			toggle.classList.add('is-playing');
		}
	}

	toggle.addEventListener('click', () => {
		if (audio.paused) {
			audio.play().catch((error) => {
				console.error('Audio playback failed', error);
				utils.showToast('Unable to start playback');
			});
		} else {
			audio.pause();
		}
	});

	title.addEventListener('blur', () => {
		void commitTitle(title.textContent);
	});
	title.addEventListener('keydown', (event) => {
		// Ensure editing keys like Backspace don't bubble to global handlers
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			void commitTitle(title.textContent);
			title.blur();
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			title.textContent = block.title || 'Audio';
			title.blur();
		}
	});

	audio.addEventListener('loadedmetadata', () => {
		updateProgressUI();
		syncOverviewMarkerFromAudio();
	});

	audio.addEventListener('timeupdate', updateProgressUI);
	audio.addEventListener('ended', () => {
		audio.currentTime = 0;
		audio.pause();
		updateProgressUI();
		stopWaveform(block.id);
		updateToggleState();
	});

	audio.addEventListener('play', () => {
		updateToggleState();
		syncOverviewMarkerFromAudio();
		if (AudioContextRef) {
			const entry = audioOverviewState.get(block.id);
			if (!entry?.peaks || entry.peaks.length === 0) {
				refreshOverview({ force: true }).catch((error) => {
					console.error('Audio overview refresh failed on play', error);
				});
			}
		}
		const runtime = ensureAudioRuntime(block, audio, waveform);
		if (runtime) {
			resizeWaveformCanvas(runtime);
			startWaveform(block.id);
		}
	});

	audio.addEventListener('pause', () => {
		updateToggleState();
		syncOverviewMarkerFromAudio();
		stopWaveform(block.id);
	});

	audio.addEventListener('error', () => {
		console.error('Audio element encountered an error', audio.error);
		utils.showToast('Audio playback failed');
		updateToggleState();
	});

	updateToggleState();
}

const audioApi = {
	ensureDirectories: ensureMediaDirectories,
	importFile: importAudioFile,
	isSupportedExtension: isAudioExtension,
	populateElement: populateAudioBlockElement,
	disposeRuntime: disposeAudioRuntime
};

env.blocks.audio = audioApi;

env.mediaBlocks = env.mediaBlocks || {};
env.mediaBlocks.ensureMediaDirectories = ensureMediaDirectories;
env.mediaBlocks.importAudioFile = importAudioFile;
env.mediaBlocks.isAudioExtension = isAudioExtension;
env.mediaBlocks.populateAudioBlockElement = populateAudioBlockElement;
env.mediaBlocks.disposeAudioRuntime = disposeAudioRuntime;

ensureMediaDirectories();

module.exports = audioApi;
