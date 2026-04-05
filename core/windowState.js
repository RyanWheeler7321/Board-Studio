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
		if (!Number.isFinite(width) || !Number.isFinite(height)) {
			return null;
		}
		if (isBogusCoordinate(x) || isBogusCoordinate(y)) {
			return null;
		}
		return {
			x: Number.isFinite(x) ? x : 0,
			y: Number.isFinite(y) ? y : 0,
			width: Math.max(width, MIN_SIZE),
			height: Math.max(height, MIN_SIZE),
			maximized
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
	const maximized = maybeMaximized(width, height);
	return { x, y, width, height, maximized };
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
	const width = Math.max(Number(snapshot.width) || 0, MIN_SIZE);
	const height = Math.max(Number(snapshot.height) || 0, MIN_SIZE);
	const x = Number(snapshot.x);
	const y = Number(snapshot.y);
	try {
		window.resizeTo(Math.round(width), Math.round(height));
		if (Number.isFinite(x) && Number.isFinite(y) && !isBogusCoordinate(x) && !isBogusCoordinate(y)) {
			window.moveTo(Math.round(x), Math.round(y));
		}
		if (snapshot.maximized && env.electron?.ipcRenderer?.invoke) {
			env.electron.ipcRenderer.invoke(env.windowControlChannel || 'board-window-control', 'maximize').catch((error) => {
				console.error('Failed to request window maximize', error);
			});
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
		runtime.lastSnapshot = saved;
		state.windowState = saved;
		applyWindowState(saved);
	}
	startPolling();
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
