'use strict';

// MARK: WINDOW STATE
const env = require('./state');
const { fs, path, paths, state } = env;

const POLL_INTERVAL_MS = 720;
const SAVE_DEBOUNCE_MS = 520;
const MIN_SIZE = 240;
const MAXIMIZE_EPSILON = 12;
const OFFSCREEN_COORDINATE_LIMIT = 20000;

const runtime = {
	initialized: false,
	isMaximized: null,
	lastNormalSnapshot: null,
	pollTimer: null,
	saveTimer: null,
	pendingSnapshot: null,
	lastSnapshot: null
};

function resolveStatePath() {
	const fallback = path.join(paths.dataDir, 'window-state.json');
	const target = typeof paths.windowStateFilePath === 'string' && paths.windowStateFilePath.trim() ? paths.windowStateFilePath : fallback;
	return path.resolve(target);
}

function isBogusCoordinate(value) {
	return Number.isFinite(value) && Math.abs(value) > OFFSCREEN_COORDINATE_LIMIT;
}

function readStateFile() {
	try {
		const filePath = resolveStatePath();
		const raw = fs.readFileSync(filePath, 'utf8');
		if (!raw.trim()) {
			return null;
		}
		const parsed = JSON.parse(raw);
		const width = Number(parsed.width);
		const height = Number(parsed.height);
		const x = Number(parsed.x);
		const y = Number(parsed.y);
		const maximized = parsed.maximized === true;
		const normalRaw = parsed.normalBounds && typeof parsed.normalBounds === 'object' ? parsed.normalBounds : null;
		const normalWidth = Number(normalRaw?.width);
		const normalHeight = Number(normalRaw?.height);
		const normalX = Number(normalRaw?.x);
		const normalY = Number(normalRaw?.y);
		const hasNormalBounds = Number.isFinite(normalWidth)
			&& Number.isFinite(normalHeight)
			&& !isBogusCoordinate(normalX)
			&& !isBogusCoordinate(normalY);
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			return null;
		}
		if (isBogusCoordinate(x) || isBogusCoordinate(y)) {
			return null;
		}
		const restoreBounds = hasNormalBounds
			? {
				x: Math.round(normalX),
				y: Math.round(normalY),
				width: Math.max(Math.round(normalWidth), MIN_SIZE),
				height: Math.max(Math.round(normalHeight), MIN_SIZE)
			}
			: {
				x: Number.isFinite(x) ? Math.round(x) : 0,
				y: Number.isFinite(y) ? Math.round(y) : 0,
				width: Math.max(Math.round(width), MIN_SIZE),
				height: Math.max(Math.round(height), MIN_SIZE)
			};
		const liveRaw = parsed.liveBounds && typeof parsed.liveBounds === 'object' ? parsed.liveBounds : null;
		const liveX = Number(liveRaw?.x);
		const liveY = Number(liveRaw?.y);
		const liveWidth = Number(liveRaw?.width);
		const liveHeight = Number(liveRaw?.height);
		const hasLiveBounds = Number.isFinite(liveWidth)
			&& Number.isFinite(liveHeight)
			&& Number.isFinite(liveX)
			&& Number.isFinite(liveY)
			&& !isBogusCoordinate(liveX)
			&& !isBogusCoordinate(liveY);
		return {
			x: restoreBounds.x,
			y: restoreBounds.y,
			width: restoreBounds.width,
			height: restoreBounds.height,
			maximized,
			normalBounds: { ...restoreBounds },
			liveBounds: hasLiveBounds
				? {
					x: Math.round(liveX),
					y: Math.round(liveY),
					width: Math.max(Math.round(liveWidth), MIN_SIZE),
					height: Math.max(Math.round(liveHeight), MIN_SIZE)
				}
				: null
		};
	} catch (error) {
		if (!error || error.code !== 'ENOENT') {
			console.error('Failed to load window state', error);
		}
		return null;
	}
}

async function writeStateFile(snapshot) {
	try {
		const filePath = resolveStatePath();
		await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
		await fs.promises.writeFile(filePath, JSON.stringify(snapshot, null, 2));
	} catch (error) {
		console.error('Failed to persist window state', error);
	}
}

function maybeMaximized(width, height) {
	const availWidth = window.screen?.availWidth;
	const availHeight = window.screen?.availHeight;
	if (!Number.isFinite(availWidth) || !Number.isFinite(availHeight)) {
		return false;
	}
	return Math.abs(width - availWidth) <= MAXIMIZE_EPSILON && Math.abs(height - availHeight) <= MAXIMIZE_EPSILON;
}

function captureSnapshot() {
	const width = Math.max(Number(window.outerWidth) || 0, MIN_SIZE);
	const height = Math.max(Number(window.outerHeight) || 0, MIN_SIZE);
	const x = Number.isFinite(window.screenX) ? window.screenX : Number(window.screenLeft) || 0;
	const y = Number.isFinite(window.screenY) ? window.screenY : Number(window.screenTop) || 0;
	if (isBogusCoordinate(x) || isBogusCoordinate(y)) {
		return null;
	}
	const maximized = runtime.isMaximized === true || maybeMaximized(width, height);
	const liveBounds = {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.max(Math.round(width), MIN_SIZE),
		height: Math.max(Math.round(height), MIN_SIZE)
	};
	if (!maximized) {
		runtime.lastNormalSnapshot = { ...liveBounds };
	}
	const normalBounds = runtime.lastNormalSnapshot ? { ...runtime.lastNormalSnapshot } : { ...liveBounds };
	return {
		x: normalBounds.x,
		y: normalBounds.y,
		width: normalBounds.width,
		height: normalBounds.height,
		maximized,
		normalBounds,
		// Real current bounds, even while maximized, so launch can target the
		// monitor the window actually lives on instead of stale normal bounds.
		liveBounds
	};
}

function hasChanged(a, b) {
	if (!a || !b) {
		return true;
	}
	if (a.maximized !== b.maximized) {
		return true;
	}
	if (Math.abs(a.x - b.x) > 1) {
		return true;
	}
	if (Math.abs(a.y - b.y) > 1) {
		return true;
	}
	if (Math.abs(a.width - b.width) > 1) {
		return true;
	}
	if (Math.abs(a.height - b.height) > 1) {
		return true;
	}
	const liveA = a.liveBounds;
	const liveB = b.liveBounds;
	if (liveA && liveB) {
		// A maximized window dragged to another monitor changes only liveBounds.
		if (Math.abs(liveA.x - liveB.x) > 1 || Math.abs(liveA.y - liveB.y) > 1) {
			return true;
		}
		if (Math.abs(liveA.width - liveB.width) > 1 || Math.abs(liveA.height - liveB.height) > 1) {
			return true;
		}
	} else if (liveA || liveB) {
		return true;
	}
	return false;
}

function scheduleSave(snapshot) {
	if (runtime.saveTimer) {
		clearTimeout(runtime.saveTimer);
	}
	runtime.pendingSnapshot = snapshot;
	runtime.saveTimer = setTimeout(() => {
		runtime.saveTimer = null;
		const pending = runtime.pendingSnapshot || runtime.lastSnapshot;
		runtime.pendingSnapshot = null;
		if (!pending) {
			return;
		}
		writeStateFile(pending);
	}, SAVE_DEBOUNCE_MS);
}

function evaluateSnapshot() {
	const snapshot = captureSnapshot();
	if (!snapshot) {
		return;
	}
	if (!runtime.lastSnapshot || hasChanged(snapshot, runtime.lastSnapshot)) {
		runtime.lastSnapshot = snapshot;
		state.windowState = snapshot;
		scheduleSave(snapshot);
	}
}

function startPolling() {
	if (runtime.pollTimer) {
		return;
	}
	const tick = () => {
		runtime.pollTimer = setTimeout(() => {
			runtime.pollTimer = null;
			evaluateSnapshot();
			tick();
		}, POLL_INTERVAL_MS);
	};
	evaluateSnapshot();
	tick();
}

function applyWindowState(snapshot) {
	if (!snapshot) {
		return;
	}
	if (env?.electron?.ipcRenderer) {
		console.info(`Window state apply delegated to main process max=${snapshot.maximized ? 1 : 0}`);
		return;
	}
	const restoreBounds = snapshot.normalBounds && typeof snapshot.normalBounds === 'object'
		? snapshot.normalBounds
		: snapshot;
	const width = Math.max(Number(restoreBounds.width) || 0, MIN_SIZE);
	const height = Math.max(Number(restoreBounds.height) || 0, MIN_SIZE);
	const x = Number(restoreBounds.x);
	const y = Number(restoreBounds.y);
	console.info(`Window state apply x=${Number.isFinite(x) ? Math.round(x) : 'n/a'} y=${Number.isFinite(y) ? Math.round(y) : 'n/a'} w=${Math.round(width)} h=${Math.round(height)} max=${snapshot.maximized ? 1 : 0}`);
	try {
		const shouldApplyBounds = !snapshot.maximized || runtime.isMaximized !== true;
		if (shouldApplyBounds) {
			window.resizeTo(Math.round(width), Math.round(height));
			if (Number.isFinite(x) && Number.isFinite(y) && !isBogusCoordinate(x) && !isBogusCoordinate(y)) {
				window.moveTo(Math.round(x), Math.round(y));
			}
		} else {
			console.info('Window state apply skipped duplicate maximized bounds');
		}
	} catch (error) {
		console.error('Failed to apply saved window bounds', error);
	}
}

function initialize() {
	if (runtime.initialized) {
		return;
	}
	runtime.initialized = true;
	const saved = readStateFile();
	if (saved) {
		runtime.isMaximized = saved.maximized === true;
		runtime.lastNormalSnapshot = saved.normalBounds ? { ...saved.normalBounds } : {
			x: saved.x,
			y: saved.y,
			width: saved.width,
			height: saved.height
		};
		runtime.lastSnapshot = saved;
		state.windowState = saved;
		applyWindowState(saved);
	}
	startPolling();
	if (env?.electron?.ipcRenderer?.on) {
		env.electron.ipcRenderer.on('board-window-maximized', (_event, isMaximized) => {
			runtime.isMaximized = isMaximized === true;
			console.info(`Window maximize state max=${runtime.isMaximized ? 1 : 0}`);
			if (!runtime.isMaximized) {
				setTimeout(evaluateSnapshot, 0);
			}
		});
	}
	window.addEventListener('resize', evaluateSnapshot, { passive: true });
	window.addEventListener('beforeunload', flushPending);
}

function flushPending() {
	if (runtime.saveTimer) {
		clearTimeout(runtime.saveTimer);
		runtime.saveTimer = null;
	}
	const snapshot = runtime.pendingSnapshot || runtime.lastSnapshot;
	if (!snapshot) {
		return;
	}
	runtime.pendingSnapshot = null;
	writeStateFile(snapshot);
}

function reconfigure() {
	runtime.pendingSnapshot = null;
	const saved = readStateFile();
	if (saved) {
		if (runtime.lastSnapshot && !hasChanged(saved, runtime.lastSnapshot)) {
			state.windowState = saved;
			console.info('Window state reconfigure skipped duplicate snapshot');
			return;
		}
		runtime.isMaximized = saved.maximized === true;
		runtime.lastNormalSnapshot = saved.normalBounds ? { ...saved.normalBounds } : {
			x: saved.x,
			y: saved.y,
			width: saved.width,
			height: saved.height
		};
		runtime.lastSnapshot = saved;
		state.windowState = saved;
		applyWindowState(saved);
	}
}

initialize();

env.windowState = env.windowState || {};
env.windowState.reconfigure = reconfigure;
env.windowState.flush = flushPending;
env.windowState.getSnapshot = () => runtime.lastSnapshot;

module.exports = env;
