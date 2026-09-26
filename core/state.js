'use strict';

// MARK: ENVIRONMENT BOOTSTRAP
const { ipcRenderer, clipboard, nativeImage, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { pathToFileURL } = require('url');

const defaultDataDir = path.join(os.homedir(), 'Documents', 'BoardStudioData');
const defaultBackupDir = path.join(defaultDataDir, 'backups');

let axios = null;
try {
	axios = require('axios');
} catch {
	axios = createAxiosFallback();
}

function createAxiosFallback() {
	const fallback = async function axiosLike(config = {}) {
		if (typeof fetch !== 'function') {
			throw new Error('Fetch unavailable for axios fallback');
		}
		const request = { ...config };
		const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'GET';
		const url = request.url;
		if (!url) {
			throw new Error('axios fallback requires a url');
		}
		const init = {
			method,
			headers: { ...(request.headers || {}) }
		};
		if (request.data !== undefined && method !== 'GET' && method !== 'HEAD') {
			init.body = request.data;
		}
		let controller = null;
		let timeoutId = null;
		if (typeof AbortController === 'function' && typeof request.timeout === 'number' && request.timeout > 0) {
			controller = new AbortController();
			init.signal = controller.signal;
			timeoutId = setTimeout(() => controller.abort(), request.timeout);
		}
		let response;
		try {
			response = await fetch(url, init);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
		const headersEntries = typeof response.headers?.entries === 'function' ? Array.from(response.headers.entries()) : [];
		const headers = headersEntries.reduce((acc, [key, value]) => {
			acc[String(key).toLowerCase()] = value;
			return acc;
		}, {});
		const resolveData = async () => {
			const type = request.responseType;
			if (type === 'arraybuffer') {
				return await response.arrayBuffer();
			}
			if (type === 'json') {
				return await response.json();
			}
			if (type === 'text' || !type) {
				return await response.text();
			}
			return await response.arrayBuffer();
		};
		const buildResult = async () => ({
			status: response.status,
			statusText: response.statusText,
			headers,
			data: await resolveData()
		});
		if (!response.ok) {
			const error = new Error(`Request failed with status ${response.status}`);
			error.response = await buildResult();
			throw error;
		}
		return buildResult();
	};
	fallback.get = (url, config = {}) => fallback({ ...config, method: 'GET', url });
	fallback.post = (url, data, config = {}) => fallback({ ...config, method: 'POST', url, data });
	return fallback;
}

const constants = {
	GRID_SIZE: 32,
	AUTO_SAVE_DELAY: 5000,
	AUTO_SAVE_MAX_WAIT: 5 * 60 * 1000,
	IMAGE_MAX_DIMENSION: 1600,
	MIN_SCALE: 0.08,
	MAX_SCALE: 10,
	SCALE_MULTIPLIER: 1.08,
	SCALE_SENSITIVITY: 0.001275,
	ZOOM_ANIMATION_DURATION: 120,
	ZOOM_BOOST_THRESHOLD: 240,
	ZOOM_BOOST_DIVISOR: 480,
	ZOOM_MAX_BOOST: 1.8,
	INFINITE_CANVAS_PAD: 200000,
	BASE_CANVAS_WIDTH: 1152,
	BASE_CANVAS_HEIGHT: 1152,
	CANVAS_MARGIN: 600,
	CORNER_HIT_SIZE: 40
};

const locationWindowContext = { windowMode: 'board' };
function resolveWindowStateFileName() { return 'window-state.json'; }

const env = {
	electron: { ipcRenderer, clipboard, nativeImage, shell },
	axios,
	path,
	fs,
	util,
	constants,
	windowContext: locationWindowContext,
	windowMode: locationWindowContext.windowMode,
	windowControlChannel: 'board-window-control',
	paths: {
		baseDir: path.join(__dirname, '..'),
		defaultDataDir,
		defaultBackupDir,
		dataDir: defaultDataDir,
		backupDir: defaultBackupDir,
		assetsDir: path.join(defaultDataDir, 'assets'),
		imagesDir: path.join(defaultDataDir, 'assets', 'images'),
		audioDir: path.join(defaultDataDir, 'assets', 'audio'),
		videoDir: path.join(defaultDataDir, 'assets', 'video'),
		modelsDir: path.join(defaultDataDir, 'assets', 'models'),
		boardsFilePath: path.join(defaultDataDir, 'boards.json'),
		settingsFilePath: path.join(defaultDataDir, 'settings.json'),
		clipboardFilePath: path.join(defaultDataDir, 'clipboard.json'),
		historyFilePath: path.join(defaultDataDir, 'history.json'),
		windowStateFilePath: path.join(defaultDataDir, resolveWindowStateFileName(locationWindowContext.windowMode)),
		resolveDataPath(...segments) {
			return path.join(this.dataDir, ...segments);
		}
	},
	dom: {
		workspace: document.getElementById('workspace'),
		boardContainer: document.getElementById('boardContainer'),
		boardSurface: document.getElementById('boardSurface'),
		boardGrid: document.getElementById('boardGrid'),
		categoryEdgeTrigger: document.getElementById('categoryEdgeTrigger'),
		categoryDrawer: document.getElementById('categoryDrawer'),
		categoryDrawerList: document.getElementById('categoryDrawerList'),
		terminalPanel: document.getElementById('terminalPanel'),
		terminalHost: document.getElementById('terminalHost'),
		terminalDivider: document.getElementById('terminalDivider'),
		terminalEdge: document.getElementById('terminalEdge'),
		breadcrumbEl: document.getElementById('breadcrumb'),
		currentBoardTitleEl: document.getElementById('currentBoardTitle'),
		contextMenuEl: document.getElementById('contextMenu'),
		toastEl: document.getElementById('toast'),
		windowControlsEl: document.getElementById('windowControls'),
		navUpButton: document.getElementById('navUpButton'),
		refreshButton: document.getElementById('refreshButton'),
		settingsButton: document.getElementById('settingsButton'),
		settingsOverlay: document.getElementById('settingsOverlay'),
		settingsCloseButton: document.getElementById('settingsCloseButton'),
		settingsModal: document.querySelector('.settings-modal'),
		settingsNav: document.getElementById('settingsNav'),
	settingsSections: document.getElementById('settingsSections'),
	dataSetupOverlay: document.getElementById('dataSetupOverlay'),
	dataSetupSelectButton: document.getElementById('dataSetupSelectButton'),
	dataSetupCreateButton: document.getElementById('dataSetupCreateButton'),
	dataSetupMessage: document.getElementById('dataSetupMessage'),
	dataSettingsPath: document.getElementById('dataFolderPathDisplay'),
	dataSettingsChangeButton: document.getElementById('dataFolderChangeButton'),
	dataSettingsSplashButton: document.getElementById('dataFolderOpenSplashButton'),
	dataSettingsRefreshBlocksButton: document.getElementById('dataFolderRefreshBlocksButton'),
	dataSettingsCleanupButton: document.getElementById('dataFolderCleanupButton'),
	backupSettingsPath: document.getElementById('backupFolderPathDisplay'),
	backupSettingsChangeButton: document.getElementById('backupFolderChangeButton'),
	backupSettingsOpenButton: document.getElementById('backupFolderOpenButton'),
		consolePanel: document.getElementById('consolePanel'),
		consoleTitle: document.getElementById('consoleTitle'),
		consoleLog: document.getElementById('consoleLog'),
		consoleClearButton: document.getElementById('consoleClearButton'),
		consoleDivider: document.getElementById('consoleDivider'),
		imagePreviewOverlay: document.getElementById('imagePreviewOverlay'),
		imagePreviewImage: document.getElementById('imagePreviewImage'),
		backgroundColorInput: document.getElementById('backgroundColorInput'),
		dotColorInput: document.getElementById('dotColorInput'),
		dotSizeInput: document.getElementById('dotSizeInput'),
		dotSizeValue: document.getElementById('dotSizeValue'),
		majorDotScaleInput: document.getElementById('majorDotScaleInput'),
		majorDotScaleValue: document.getElementById('majorDotScaleValue'),
		accentColorInput: document.getElementById('accentColorInput'),
		accentToneInput: document.getElementById('accentToneInput'),
		accentToneValue: document.getElementById('accentToneValue'),
		blockRadiusInput: document.getElementById('blockRadiusInput'),
		blockRadiusValue: document.getElementById('blockRadiusValue'),
		arrowWidthScaleInput: document.getElementById('arrowWidthScaleInput'),
		arrowWidthScaleValue: document.getElementById('arrowWidthScaleValue'),
		blockShadowColorInput: document.getElementById('blockShadowColorInput'),
		blockShadowIntensityInput: document.getElementById('blockShadowIntensityInput'),
		blockShadowIntensityValue: document.getElementById('blockShadowIntensityValue'),
		blockShadowBlurInput: document.getElementById('blockShadowBlurInput'),
		blockShadowBlurValue: document.getElementById('blockShadowBlurValue'),
		blockDragShadowColorInput: document.getElementById('blockDragShadowColorInput'),
		blockDragShadowIntensityInput: document.getElementById('blockDragShadowIntensityInput'),
		blockDragShadowIntensityValue: document.getElementById('blockDragShadowIntensityValue'),
		blockDragShadowBlurInput: document.getElementById('blockDragShadowBlurInput'),
		blockDragShadowBlurValue: document.getElementById('blockDragShadowBlurValue'),
		boardRadiusInput: document.getElementById('boardRadiusInput'),
		boardRadiusValue: document.getElementById('boardRadiusValue'),
		zoomSpeedInput: document.getElementById('zoomSpeedInput'),
		zoomSpeedValue: document.getElementById('zoomSpeedValue'),
		selectionScaleInput: document.getElementById('selectionScaleInput'),
		selectionScaleValue: document.getElementById('selectionScaleValue'),
		textFontFamilySelect: document.getElementById('textFontFamilySelect'),
		titleFontFamilySelect: document.getElementById('titleFontFamilySelect'),
		resizeHandleSizeInput: document.getElementById('resizeHandleSizeInput'),
		resizeHandleSizeValue: document.getElementById('resizeHandleSizeValue'),
		textFontScaleInput: document.getElementById('textFontScaleInput'),
		textFontScaleValue: document.getElementById('textFontScaleValue'),
		titleFontScaleInput: document.getElementById('titleFontScaleInput'),
		titleFontScaleValue: document.getElementById('titleFontScaleValue'),
		textLetterSpacingInput: document.getElementById('textLetterSpacingInput'),
		textLetterSpacingValue: document.getElementById('textLetterSpacingValue'),
		textWordSpacingInput: document.getElementById('textWordSpacingInput'),
		textWordSpacingValue: document.getElementById('textWordSpacingValue'),
		textLineHeightInput: document.getElementById('textLineHeightInput'),
		textLineHeightValue: document.getElementById('textLineHeightValue'),
		textPaddingInput: document.getElementById('textPaddingInput'),
		textPaddingValue: document.getElementById('textPaddingValue'),
		titleLetterSpacingInput: document.getElementById('titleLetterSpacingInput'),
		titleLetterSpacingValue: document.getElementById('titleLetterSpacingValue'),
		titleWordSpacingInput: document.getElementById('titleWordSpacingInput'),
		titleWordSpacingValue: document.getElementById('titleWordSpacingValue'),
		titleLineHeightInput: document.getElementById('titleLineHeightInput'),
		titleLineHeightValue: document.getElementById('titleLineHeightValue'),
		titleSmallCapsInput: document.getElementById('titleSmallCapsInput'),
		textEditShadowColorInput: document.getElementById('textEditShadowColorInput'),
		textEditShadowIntensityInput: document.getElementById('textEditShadowIntensityInput'),
		textEditShadowIntensityValue: document.getElementById('textEditShadowIntensityValue'),
		textEditShadowBlurInput: document.getElementById('textEditShadowBlurInput'),
		textEditShadowBlurValue: document.getElementById('textEditShadowBlurValue'),
		linkUrlLinesInput: document.getElementById('linkUrlLinesInput'),
		linkUrlLinesValue: document.getElementById('linkUrlLinesValue'),
	},
	state: {
		boardData: null,
		currentBoardId: 'root',
		launchBoardRequest: null,
		boardScale: 1,
		saveTimer: null,
		saveMaxTimer: null,
		saveFirstQueuedAt: 0,
		saveDirty: false,
		lastSaveReason: '',
		persistGeneration: 0,
		boardDataDiskMtimeMs: 0,
		previewCaptureTimer: null,
		previewCaptureInFlight: false,
		previewDirtyBoards: new Set(),
		toastTimer: null,
		selectedBlockId: null,
	selectedBlockIds: new Set(),
		contextMenuTargetBlockId: null,
		suppressNextContextMenu: false,
		lastPointerBoardPos: { x: 32 * 8, y: 32 * 8 },
		lastPointerUpdateTs: 0,
		dragState: null,
		pendingDrag: null,
	scaleState: null,
		resizeState: null,
		panState: null,
		marqueeState: null,
		selectionMarqueeEl: null,
		suppressNextAnimation: false,
		activeBoardAnimation: null,
		lastAnimationPivot: null,
		copiedBlocks: null,
		pendingBoardPaste: false,
		categoryDrawerOpen: false,
		categoryDrawerOpenTimer: null,
		categoryDrawerCloseTimer: null,
		settingsPanelOpen: false,
		settingsControlsInitialized: false,
		settingsNavigationInitialized: false,
	activeSettingsSection: 'interface',
		dataDirectoryPath: null,
		dataDirectoryReady: false,
		dataDirectoryNeedsSetup: false,
		dataDirectoryMeta: null,
		backupDirectoryPath: null,
		backupDirectoryReady: false,
		dataSetupInitialized: false,
	dataDirectoryCleanupInProgress: false,
	blockDataRefreshInProgress: false,
		zoomModifierActive: false,
		zoomGesture: {
			active: false,
			lastEventTs: 0,
			source: 'none'
		},
		selectionChangedOnPointerDown: false,
		lastPointerDownBlockId: null,
		arrowEditState: null,
		arrowCreationState: null,
		viewportSyncSuspended: 0,
		imagePreviewBlockId: null,
		imageCaptionEditBlockId: null,
		imageCaptionEditSnapshot: null,
		console: {
			entries: [],
			selectedEntryIds: new Set(),
			focusedEntryId: null,
			selectionAnchorId: null,
			entryCounter: 0,
			maxEntries: 2000,
			isDragging: false,
			dragStartX: 0,
			dragStartWidth: 320,
			currentWidth: 320,
			isVisible: false
		},
		terminalPanel: {
			isOpen: false,
			width: 720,
			resize: null
		},
		tools2d: {
			activeTab: 'art',
			selectedProjectId: '',
			selectedVariantId: '',
			selectedFrameId: '',
			rangeStartIndex: 0,
			rangeEndIndex: 0,
			activePreviewProjectId: '',
			activePreviewType: '',
			isPlaying: false,
			playbackTimer: null,
			activeJobId: '',
			jobStatus: 'idle',
			jobMessage: '',
			lastJobError: '',
			jobProgress: 0
		}
	},
	timers: {},
	management: {},
	movement: {},
	blocks: {},
	images: {},
	consoleUi: {},
	data: {},
	utils: {},
	mediaBlocks: {},
	linkBlocks: {},
	imports: {},
	menus: {}
};

const state = env.state;

env.state.lastPointerBoardPos = { x: constants.GRID_SIZE * 8, y: constants.GRID_SIZE * 8 };
env.state.lastPointerUpdateTs = 0;
env.state.dataDirectoryPath = env.paths.dataDir;
env.state.backupDirectoryPath = env.paths.backupDir;
try {
	env.state.backupDirectoryReady = fs.existsSync(env.paths.backupDir);
} catch {
	env.state.backupDirectoryReady = false;
}

// MARK: Window Activity
function resolveWindowActivityMode(focused, visibilityState) {
	if (visibilityState === 'hidden') {
		return 'hidden';
	}
	return focused ? 'active' : 'background';
}

const initialWindowFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
	? document.hasFocus()
	: true;
const initialWindowVisibilityState = typeof document !== 'undefined' && typeof document.visibilityState === 'string'
	? document.visibilityState
	: 'visible';
const windowActivityListeners = new Set();

env.state.windowActivity = {
	focused: initialWindowFocused,
	visibilityState: initialWindowVisibilityState,
	mode: resolveWindowActivityMode(initialWindowFocused, initialWindowVisibilityState),
	source: 'bootstrap',
	lastChangedAt: Date.now()
};

env.windowActivity = {
	getSnapshot() {
		return { ...env.state.windowActivity };
	},
	getMode() {
		return String(env.state.windowActivity?.mode || 'active');
	},
	isBackground() {
		return this.getMode() !== 'active';
	},
	set(next = {}) {
		const focused = next.focused === undefined
			? !!env.state.windowActivity?.focused
			: !!next.focused;
		const visibilityState = typeof next.visibilityState === 'string' && next.visibilityState.trim()
			? next.visibilityState.trim()
			: String(env.state.windowActivity?.visibilityState || 'visible');
		const mode = resolveWindowActivityMode(focused, visibilityState);
		const previous = env.state.windowActivity || null;
		const changed = !previous
			|| previous.focused !== focused
			|| previous.visibilityState !== visibilityState
			|| previous.mode !== mode;
		const snapshot = {
			focused,
			visibilityState,
			mode,
			source: String(next.source || previous?.source || 'update'),
			lastChangedAt: changed ? Date.now() : (previous?.lastChangedAt || Date.now())
		};
		env.state.windowActivity = snapshot;
		if (changed) {
			windowActivityListeners.forEach((listener) => {
				try {
					listener({ ...snapshot });
				} catch {}
			});
		}
		return { ...snapshot };
	},
	subscribe(listener) {
		if (typeof listener !== 'function') {
			return () => {};
		}
		windowActivityListeners.add(listener);
		return () => {
			windowActivityListeners.delete(listener);
		};
	}
};

// MARK: DEBUG LOGGING
const originalConsole = {
	log: console.log.bind(console),
	info: console.info.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug.bind(console),
	clear: typeof console.clear === 'function' ? console.clear.bind(console) : () => {}
};

function formatDebugArgument(arg) {
	if (arg instanceof Error) {
		return arg.stack || arg.message;
	}
	if (typeof arg === 'string') {
		return arg;
	}
	if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
		return String(arg);
	}
	if (typeof arg === 'symbol' || typeof arg === 'undefined') {
		return String(arg);
	}
	try {
		return util.inspect(arg, { depth: 6, breakLength: Infinity });
	} catch (error) {
		return `[Unserializable: ${error.message || 'Unknown error'}]`;
	}
}

const LOCAL_DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;
let localDebugLogRotateCounter = -1;
let localRichLogRotateCounter = 0;
let localRichLogFlushTimer = null;
let localRichLogWriteChain = Promise.resolve();
const localRichLogQueue = [];
const LOCAL_RICH_LOG_FLUSH_MS = 80;
const LOCAL_RICH_LOG_BATCH_SIZE = 48;

function maybeRotateLocalDebugLog(logPath) {
	// Size check every 500th line keeps the cost negligible; one .1 archive bounds disk use.
	localDebugLogRotateCounter = (localDebugLogRotateCounter + 1) % 500;
	if (localDebugLogRotateCounter !== 0) {
		return;
	}
	try {
		if (fs.statSync(logPath).size > LOCAL_DEBUG_LOG_MAX_BYTES) {
			try { fs.unlinkSync(`${logPath}.1`); } catch {}
			fs.renameSync(logPath, `${logPath}.1`);
		}
	} catch (error) {
		// Missing file or a transient lock: skip silently, append proceeds regardless.
	}
}

async function maybeRotateLocalRichLog(logPath, appendedLineCount) {
	localRichLogRotateCounter += Math.max(1, Number(appendedLineCount) || 1);
	if (localRichLogRotateCounter < 500) {
		return;
	}
	localRichLogRotateCounter = 0;
	try {
		const stats = await fs.promises.stat(logPath);
		if (stats.size <= LOCAL_DEBUG_LOG_MAX_BYTES) {
			return;
		}
		await fs.promises.unlink(`${logPath}.1`).catch(() => {});
		await fs.promises.rename(logPath, `${logPath}.1`);
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			originalConsole.error('Failed to rotate local rich log', error);
		}
	}
}

function flushLocalRichLogQueue() {
	if (localRichLogFlushTimer) {
		clearTimeout(localRichLogFlushTimer);
		localRichLogFlushTimer = null;
	}
	if (!localRichLogQueue.length) {
		return localRichLogWriteChain;
	}
	const queued = localRichLogQueue.splice(0, localRichLogQueue.length);
	const batchesByPath = new Map();
	queued.forEach(({ logPath, line }) => {
		if (!batchesByPath.has(logPath)) {
			batchesByPath.set(logPath, []);
		}
		batchesByPath.get(logPath).push(line);
	});
	localRichLogWriteChain = localRichLogWriteChain.then(async () => {
		for (const [logPath, lines] of batchesByPath.entries()) {
			await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
			await maybeRotateLocalRichLog(logPath, lines.length);
			await fs.promises.appendFile(logPath, lines.join(''), 'utf8');
		}
	}).catch((error) => {
		originalConsole.error('Failed to append queued Board Studio rich log', error);
	});
	return localRichLogWriteChain;
}

function queueLocalRichLog(logPath, line) {
	localRichLogQueue.push({ logPath, line });
	if (localRichLogQueue.length >= LOCAL_RICH_LOG_BATCH_SIZE) {
		flushLocalRichLogQueue();
		return;
	}
	if (!localRichLogFlushTimer) {
		localRichLogFlushTimer = setTimeout(flushLocalRichLogQueue, LOCAL_RICH_LOG_FLUSH_MS);
	}
}

function appendLocalDebugLog(level, args) {
	try {
		const logDir = path.join(env.paths.baseDir, '..', 'logs');
		const normalizedLevel = String(level || '').toLowerCase();
		const isRich = ['log', 'debug'].includes(normalizedLevel);
		const logFile = isRich ? 'board_studio_rich.log' : 'board_studio_main.log';
		const logPath = path.join(logDir, logFile);
		const message = args.map((arg) => formatDebugArgument(arg)).join(' ');
		const timestamp = new Date().toISOString();
		const line = `[${timestamp}] [${String(level || 'info').toUpperCase()}] ${message}\n`;
		if (isRich) {
			queueLocalRichLog(logPath, line);
			return;
		}
		fs.mkdirSync(logDir, { recursive: true });
		maybeRotateLocalDebugLog(logPath);
		fs.appendFileSync(logPath, line, 'utf8');
	} catch (error) {
		originalConsole.error('Failed to append local log', error);
	}
}

function forwardDebugLog(level, args) {
	const normalizedLevel = typeof level === 'string' && level.trim() ? level.trim().toLowerCase() : 'debug';
	const normalizedArgs = Array.isArray(args) ? args : [args];
	try {
		if (typeof env.consoleUi.appendEntry === 'function') {
			env.consoleUi.appendEntry(normalizedLevel, normalizedArgs);
		}
	} catch (error) {
		originalConsole.error('Failed to update in-app console', error);
	}
	try {
		appendLocalDebugLog(normalizedLevel, normalizedArgs);
	} catch (error) {
		originalConsole.error('Failed to write local Board Studio log', error);
	}
}

function installDebugConsoleCapture() {
	['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
		console[level] = (...args) => {
			originalConsole[level](...args);
			try {
				if (typeof env.consoleUi.appendEntry === 'function') {
					env.consoleUi.appendEntry(level, args);
				}
			} catch (error) {
				originalConsole.error('Failed to update in-app console', error);
			}
			try {
				appendLocalDebugLog(level, args);
			} catch (error) {
				originalConsole.error('Failed to write local Board Studio log', error);
			}
		};
	});
	console.clear = () => {
		originalConsole.clear();
		if (typeof env.consoleUi.clear === 'function') {
			env.consoleUi.clear();
		}
	};
}

installDebugConsoleCapture();

env.utils.forwardDebugLog = forwardDebugLog;
env.utils.formatDebugArgument = formatDebugArgument;

// MARK: Data Path Configuration
function configureDataDirectory(targetDir) {
	const candidate = typeof targetDir === 'string' && targetDir.trim() ? targetDir.trim() : env.paths.defaultDataDir;
	const resolved = path.resolve(candidate);
	env.paths.dataDir = resolved;
	env.paths.defaultBackupDir = path.join(resolved, 'backups');
	env.paths.assetsDir = path.join(resolved, 'assets');
	env.paths.imagesDir = path.join(env.paths.assetsDir, 'images');
	env.paths.audioDir = path.join(env.paths.assetsDir, 'audio');
	env.paths.videoDir = path.join(env.paths.assetsDir, 'video');
	env.paths.modelsDir = path.join(env.paths.assetsDir, 'models');
	env.paths.boardsFilePath = path.join(resolved, 'boards.json');
	env.paths.settingsFilePath = path.join(resolved, 'settings.json');
	env.paths.windowStateFilePath = path.join(resolved, resolveWindowStateFileName(env.windowMode));
	if (env.images) {
		env.images.assetDirectory = env.paths.imagesDir;
	}
	if (env.windowState && typeof env.windowState.reconfigure === 'function') {
		env.windowState.reconfigure();
	}
}

env.paths.configureDataDirectory = configureDataDirectory;
configureDataDirectory(env.paths.dataDir);

// MARK: Utility Primitives
env.utils.clamp = (value, min, max) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		const lower = Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY;
		const upper = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
		const fallback = Math.min(Math.max(1, lower), upper);
		return Number.isFinite(fallback) ? fallback : 1;
	}
	if (numeric < min) {
		return min;
	}
	if (numeric > max) {
		return max;
	}
	return numeric;
};

env.utils.snapToGrid = (value) => {
	return Math.round(value / constants.GRID_SIZE) * constants.GRID_SIZE;
};

env.utils.snapPointToGrid = (point) => {
	return {
		x: env.utils.snapToGrid(point?.x ?? 0),
		y: env.utils.snapToGrid(point?.y ?? 0)
	};
};

env.utils.snapDimensionsToGrid = (width, height, options = {}) => {
	const minWidthCells = Math.max(options.minWidthCells ?? 1, 1);
	const minHeightCells = Math.max(options.minHeightCells ?? 1, 1);
	const preserveRatio = !!options.preserveRatio && width > 0 && height > 0;
	if (!preserveRatio) {
		const widthCells = Math.max(Math.round(width / constants.GRID_SIZE), minWidthCells);
		const heightCells = Math.max(Math.round(height / constants.GRID_SIZE), minHeightCells);
		return {
			width: widthCells * constants.GRID_SIZE,
			height: heightCells * constants.GRID_SIZE
		};
	}
	const ratio = width / height;
	const baseWidthCells = Math.max(Math.round(width / constants.GRID_SIZE), minWidthCells);
	const baseHeightCells = Math.max(Math.round(height / constants.GRID_SIZE), minHeightCells);
	const candidates = [
		{
			width: baseWidthCells,
			height: Math.max(Math.round(baseWidthCells / ratio), minHeightCells)
		},
		{
			width: Math.max(Math.round(baseHeightCells * ratio), minWidthCells),
			height: baseHeightCells
		}
	];
	const evaluated = candidates.map((candidate) => {
		const snappedWidth = candidate.width * constants.GRID_SIZE;
		const snappedHeight = candidate.height * constants.GRID_SIZE;
		const error = Math.abs(snappedWidth - width) + Math.abs(snappedHeight - height);
		return { width: snappedWidth, height: snappedHeight, error };
	});
	evaluated.sort((a, b) => a.error - b.error);
	const best = evaluated[0];
	return { width: best.width, height: best.height };
};

env.utils.snapRectToGrid = (rect, options = {}) => {
	const snappedPoint = env.utils.snapPointToGrid(rect || {});
	const snappedSize = env.utils.snapDimensionsToGrid(rect?.width ?? 0, rect?.height ?? 0, options);
	return { x: snappedPoint.x, y: snappedPoint.y, width: snappedSize.width, height: snappedSize.height };
};

env.utils.roundRectToPixels = (rect, options = {}) => {
	const minWidth = Math.max(1, Math.round(options.minWidth ?? 1));
	const minHeight = Math.max(1, Math.round(options.minHeight ?? 1));
	return {
		x: Math.round(Number(rect?.x) || 0),
		y: Math.round(Number(rect?.y) || 0),
		width: Math.max(minWidth, Math.round(Number(rect?.width) || 0)),
		height: Math.max(minHeight, Math.round(Number(rect?.height) || 0))
	};
};

env.utils.createId = (prefix) => {
	const random = Math.random().toString(36).slice(2, 8);
	const timestamp = Date.now().toString(36);
	return `${prefix}-${timestamp}-${random}`;
};

env.utils.toFileUrl = (filePath) => {
	if (!filePath) {
		return '';
	}
	try {
		let normalizedPath = String(filePath).trim();
		// Mounted drive paths like /mnt/c/... map back to C:\ on Windows.
		const driveMatch = process.platform === 'win32' ? normalizedPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/) : null;
		if (driveMatch) {
			const drive = `${driveMatch[1].toUpperCase()}:\\`;
			const remainder = driveMatch[2].replace(/\//g, '\\');
			normalizedPath = drive + remainder;
		}
		return pathToFileURL(normalizedPath).href;
	} catch {
		return '';
	}
};

const perf = {
	thresholdMs: 45,
	now() {
		if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
			return performance.now();
		}
		return Date.now();
	},
	logIfSlow(label, elapsedMs, details = null) {
		if (!Number.isFinite(elapsedMs) || elapsedMs < this.thresholdMs) {
			return;
		}
		const payload = details ? { label, ms: Number(elapsedMs.toFixed(1)), ...details } : { label, ms: Number(elapsedMs.toFixed(1)) };
		console.debug('[PERF]', payload);
	}
};

env.utils.perf = perf;

// MARK: Launch Args
function parseLaunchBoardRequest(argv) {
	const args = Array.isArray(argv) ? argv : [];
	let board = '';
	let boardId = '';
	let boardTitle = '';
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (typeof arg !== 'string') {
			continue;
		}
		const trimmed = arg.trim();
		if (!trimmed.startsWith('--')) {
			continue;
		}
		const equalsIndex = trimmed.indexOf('=');
		const key = (equalsIndex >= 0 ? trimmed.slice(2, equalsIndex) : trimmed.slice(2)).trim().toLowerCase();
		let value = (equalsIndex >= 0 ? trimmed.slice(equalsIndex + 1) : '').trim();
		if (!value && equalsIndex < 0) {
			const next = args[i + 1];
			if (typeof next === 'string') {
				const nextTrimmed = next.trim();
				if (nextTrimmed && !nextTrimmed.startsWith('--')) {
					value = nextTrimmed;
					i += 1;
				}
			}
		}
		if (!value) {
			continue;
		}
		if (key === 'board') {
			board = value;
		} else if (key === 'board-id' || key === 'boardid') {
			boardId = value;
		} else if (key === 'board-title' || key === 'boardtitle') {
			boardTitle = value;
		}
	}
	const resolvedId = boardId || '';
	const resolvedTitle = boardTitle || '';
	const resolvedGeneric = board || '';
	if (!resolvedId && !resolvedTitle && !resolvedGeneric) {
		return null;
	}
	return {
		board: resolvedGeneric,
		boardId: resolvedId,
		boardTitle: resolvedTitle
	};
}

function parseLocationLaunchRequest(windowContext) {
	const boardId = String(windowContext?.boardId || '').trim();
	if (!boardId) {
		return null;
	}
	return {
		board: boardId,
		boardId,
		boardTitle: ''
	};
}

try {
	state.launchBoardRequest = parseLocationLaunchRequest(env.windowContext) || parseLaunchBoardRequest(process?.argv);
} catch {
	state.launchBoardRequest = parseLocationLaunchRequest(env.windowContext);
}

// MARK: Data Directory Lifecycle
async function initializeDataEnvironment() {
	if (state.dataDirectoryReady) {
		return env.paths.dataDir;
	}
	let response = null;
	if (env.electron?.ipcRenderer?.invoke) {
		try {
			response = await env.electron.ipcRenderer.invoke('boardstudio:get-data-path');
		} catch (error) {
			console.error('Failed to retrieve Board Studio data directory', error);
		}
	}
	const preferred = path.resolve(env.paths.defaultDataDir);
	let candidate = preferred;
	const considerPath = (value) => {
		if (typeof value !== 'string' || !value.trim()) {
			return;
		}
		const resolvedValue = path.resolve(value.trim());
		candidate = resolvedValue;
	};
	if (response && typeof response.path === 'string') {
		considerPath(response.path);
	}
	if (candidate === preferred && response && typeof response.fallback === 'string') {
		considerPath(response.fallback);
	}
	configureDataDirectory(candidate);
	state.dataDirectoryPath = env.paths.dataDir;
	state.dataDirectoryNeedsSetup = !fs.existsSync(env.paths.dataDir);
	state.dataDirectoryMeta = { ...response, resolvedPath: env.paths.dataDir, backupPath: env.paths.defaultBackupDir };
	state.dataDirectoryReady = true;
	if (env.management && typeof env.management.refreshDataSettingsUi === 'function') {
		env.management.refreshDataSettingsUi();
	}
	return env.paths.dataDir;
}

env.initialize = initializeDataEnvironment;

// MARK: UI Helpers
env.utils.showToast = (message, options = {}) => {
	const { toastEl } = env.dom;
	const { state } = env;
	if (!toastEl) {
		return;
	}
	const position = String(options.position || '').trim().toLowerCase();
	const variant = String(options.variant || '').trim().toLowerCase();
	const duration = Math.max(400, Number(options.duration) || 2400);
	toastEl.hidden = true;
	toastEl.textContent = message;
	toastEl.classList.toggle('is-bottom-right', position === 'bottom-right');
	toastEl.classList.toggle('is-strong', variant === 'strong' || variant === 'save');
	void toastEl.offsetWidth;
	toastEl.hidden = false;
	clearTimeout(state.toastTimer);
	state.toastTimer = setTimeout(() => {
		toastEl.hidden = true;
		toastEl.classList.remove('is-bottom-right');
		toastEl.classList.remove('is-strong');
	}, duration);
};

try {
	if (document?.body) {
		document.body.dataset.windowMode = env.windowMode || 'board';
	}
	document.title = 'Board Studio';
} catch {}

	if (env?.electron?.ipcRenderer?.on) {
		env.electron.ipcRenderer.on('board-window-maximized', () => {
			try {
				if (env?.movement?.resetPointerStates) {
					env.movement.resetPointerStates();
				}
			} catch (error) {
				console.error('Failed to respond to maximize change', error);
			}
		});
	}

env.terminalPanel = env.terminalPanel || {};
env.terminalView = env.terminalView || {};
env.sfxTools = env.sfxTools || {};

module.exports = env;
