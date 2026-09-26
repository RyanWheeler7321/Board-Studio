'use strict';

const env = require('../core/state');
const { IMAGE_PROXY_MAX_EDGE } = require('./imageProxyCache');
const { createSerialImageRequestQueue, createImageRequestControl } = require('./imageRequestQueue');
const {
    IMAGE_PROXY_TIERS,
    PROXY_DECODED_PIXEL_BUDGET,
    calculatePixelDemand,
    allocateProxyCandidates
} = require('./imageResolutionPolicy');

const PRELOAD_MARGIN = '80%';
const INTERACTION_SETTLE_MS = 160;
const IMAGE_DECODE_TIMEOUT_MS = 8000;
const PROXY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif']);

const records = new Set();
const interactionReasons = new Set();
const activeImagePreloads = new Map();
const diagnostics = {
    requested: 0,
    cacheHits: 0,
    generated: 0,
    assigned: 0,
    directFallbacks: 0,
    failures: 0,
    requestsCanceled: 0,
    firstPresentations: 0,
    sourceCanceled: 0,
    sourceBudgetDeferred: 0,
    sourceDecodeMs: 0,
    maxSourceDecodeMs: 0
};
let observer = null;
let renderGeneration = 0;
let recordSequence = 0;
let settleTimer = null;
let refreshFrameId = null;
let windowActivityMode = String(env.windowActivity?.getMode?.() || 'active');
const requestQueue = createSerialImageRequestQueue({
    canStart: () => !isInteractionActive() && isWindowLoadable(),
    run: ({ record, requestToken, requestControl }) => performRecordRequest(record, requestToken, requestControl),
    onSettled: ({ record, requestToken }) => {
        if (record.pendingToken === requestToken) {
            record.pending = false;
            record.pendingToken = null;
            record.pendingResolution = '';
            record.pendingReason = isResolutionSatisfied(record) ? '' : record.loadingError ? 'failed' : 'deferred';
        }
    },
    onError: (error, { record, requestToken }) => {
        if (!isRecordCurrent(record) || record.requestToken !== requestToken) {
            return;
        }
        diagnostics.failures += 1;
        record.loadingError = error?.message || String(error);
        if (!record.img.naturalWidth) record.img.alt = 'Image unavailable';
        console.error('Board image request failed', {
            assetName: record.assetName,
            error: error?.message || String(error)
        });
    }
});

function isProxyCandidate(assetName) {
    const extension = env.path.extname(String(assetName || '')).toLowerCase();
    return PROXY_EXTENSIONS.has(extension);
}

function isRasterSource(assetName) {
    return env.path.extname(String(assetName || '')).toLowerCase() !== '.svg';
}

function isAnimatedSource(assetName) {
    return env.path.extname(String(assetName || '')).toLowerCase() === '.gif';
}

function resolveAnimationPlaybackUrl(record, activityMode) {
    if (!record.animated || !record.animationUrl || !record.posterUrl) return '';
    return activityMode === 'active' && record.strictlyVisible
        ? record.animationUrl : record.posterUrl;
}

function syncAnimationPlayback(record) {
    if (!isRecordCurrent(record) || record.currentResolution !== 'proxy') return;
    const url = resolveAnimationPlaybackUrl(record, windowActivityMode);
    if (!url) return;
    if (record.img.src !== url) record.img.src = url;
    record.img.dataset.animationPlaying = url === record.animationUrl ? '1' : '0';
}

function isInteractionActive() {
    recoverStaleInteractionReasons();
    return interactionReasons.size > 0 || settleTimer !== null;
}

function isWindowLoadable() {
    return windowActivityMode !== 'hidden';
}

function isWindowActive() {
    return isWindowLoadable();
}

function syncInteractionClass(active) {
    env.dom.boardContainer?.classList.toggle('is-viewport-interacting', !!active);
}

function isInteractionOwnerActive(reason) {
    if (reason === 'zoom') {
        return !!env.state.zoomAnimation || !!env.dom.boardGrid?.classList.contains('is-zooming');
    }
    if (reason === 'pan') {
        return !!env.state.panState || !!env.dom.boardContainer?.classList.contains('is-panning');
    }
    return true;
}

function recoverStaleInteractionReasons() {
    const recovered = [];
    interactionReasons.forEach((reason) => {
        if (isInteractionOwnerActive(reason)) {
            return;
        }
        interactionReasons.delete(reason);
        recovered.push(reason);
    });
    // Schedule recovery once; repeatedly rearming this timer would starve the request queue.
    if (recovered.length === 0 || interactionReasons.size > 0 || settleTimer) {
        return;
    }
    console.warn('Board image viewport interaction recovered', { reasons: recovered });
    scheduleInteractionSettle();
}

function cancelPendingImageRequests() {
    diagnostics.sourceCanceled += Array.from(activeImagePreloads.values())
        .filter((task) => task.resolution === 'source').length;
    const canceled = new Set();
    requestQueue.clear().forEach((job) => {
        canceled.add(job.record);
    });
    const activeJob = requestQueue.cancelActive();
    if (activeJob?.record) {
        canceled.add(activeJob.record);
    }
    records.forEach((record) => {
        if (!isRecordCurrent(record) || !record.pending) {
            return;
        }
        record.requestToken += 1;
        record.pending = false;
        record.pendingToken = null;
        record.pendingResolution = '';
        canceled.add(record);
    });
    activeImagePreloads.forEach((task, record) => {
        canceled.add(record);
        try {
            task.cancel();
        } catch {}
    });
    activeImagePreloads.clear();
    diagnostics.requestsCanceled += canceled.size;
}

function handleWindowActivity(snapshot = {}) {
    const nextMode = String(snapshot.mode || 'active');
    if (nextMode === windowActivityMode) {
        return;
    }
    windowActivityMode = nextMode;
    records.forEach(syncAnimationPlayback);
    if (!isWindowLoadable()) {
        cancelPendingImageRequests();
        return;
    }
    scheduleRefresh();
    requestQueue.resume();
}

env.windowActivity?.subscribe?.(handleWindowActivity);

function scheduleInteractionSettle() {
    if (settleTimer) {
        clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(() => {
        settleTimer = null;
        syncInteractionClass(false);
        refreshVisiblePreviews();
        requestQueue.resume();
    }, INTERACTION_SETTLE_MS);
}

function beginViewportInteraction(reason = 'viewport') {
    const hadActiveGesture = interactionReasons.size > 0;
    if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }
    if (!hadActiveGesture) {
        cancelPendingImageRequests();
    }
    interactionReasons.add(String(reason || 'viewport'));
    syncInteractionClass(true);
}

function endViewportInteraction(reason = 'viewport') {
    const removed = interactionReasons.delete(String(reason || 'viewport'));
    if (interactionReasons.size > 0) {
        return;
    }
    if (!removed && settleTimer) {
        return;
    }
    scheduleInteractionSettle();
}

function waitForInteractionIdle(requestControl = null) {
    if (requestControl?.canceled) {
        return Promise.resolve(false);
    }
    if (!isInteractionActive()) {
        return Promise.resolve(true);
    }
    const idle = new Promise((resolve) => {
        const poll = () => {
            if (requestControl?.canceled) {
                resolve(false);
                return;
            }
            if (!isInteractionActive()) {
                resolve(true);
                return;
            }
            setTimeout(poll, 40);
        };
        poll();
    });
    return requestControl
        ? Promise.race([idle, requestControl.cancellation.then(() => false)])
        : idle;
}

function resetBindings() {
    renderGeneration += 1;
    observer?.disconnect?.();
    observer = null;
    if (refreshFrameId !== null && typeof window?.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(refreshFrameId);
    }
    refreshFrameId = null;
    if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
    }
    interactionReasons.clear();
    syncInteractionClass(false);
    requestQueue.clear();
    requestQueue.cancelActive();
    records.forEach((record) => {
        record.requestToken += 1;
    });
    activeImagePreloads.forEach((task) => {
        try {
            task.cancel();
        } catch {}
    });
    activeImagePreloads.clear();
    records.clear();
}

function scheduleRefresh() {
    if (refreshFrameId !== null) {
        return;
    }
    if (typeof window?.requestAnimationFrame !== 'function') {
        refreshVisiblePreviews();
        return;
    }
    refreshFrameId = window.requestAnimationFrame(() => {
        refreshFrameId = null;
        refreshVisiblePreviews();
    });
}

function ensureObserver() {
    if (observer || typeof IntersectionObserver !== 'function' || !env.dom.boardContainer) {
        return observer;
    }
    observer = new IntersectionObserver(() => {
        scheduleRefresh();
    }, {
        root: env.dom.boardContainer,
        rootMargin: PRELOAD_MARGIN,
        threshold: 0.001
    });
    return observer;
}

function isRecordCurrent(record) {
    return !!record
        && record.generation === renderGeneration
        && record.img?.isConnected
        && record.img.__boardImageRecord === record;
}

function isSourceResolution(resolution) {
    return resolution === 'source' || resolution === 'source-fallback';
}

function isResolutionSatisfied(record) {
    if (!record) {
        return true;
    }
    if (record.desiredResolution === 'source') {
        return isSourceResolution(record.currentResolution);
    }
    if (record.desiredResolution === 'source-direct') {
        return record.currentResolution === 'source-direct' || record.currentResolution === 'source-fallback';
    }
    if (record.desiredResolution === 'proxy') {
        return (record.currentResolution === 'proxy'
                && record.currentProxyMaxEdge === record.desiredProxyMaxEdge)
            || (record.proxyUnavailable && isSourceResolution(record.currentResolution));
    }
    return false;
}

function isAssignmentStillWanted(record, resolution, requestToken, proxyMaxEdge = 0) {
    if (!isRecordCurrent(record) || record.requestToken !== requestToken) {
        return false;
    }
    if (resolution === 'source') {
        return record.desiredResolution === 'source' && record.strictlyVisible;
    }
    if (resolution === 'source-direct') {
        return record.desiredResolution === 'source-direct' && record.nearViewport;
    }
    if (resolution === 'source-fallback') {
        return record.nearViewport;
    }
    if (resolution === 'proxy') {
        if (record.desiredResolution === 'source') {
            return record.strictlyVisible;
        }
        if (record.desiredResolution !== 'proxy') {
            return false;
        }
        if (proxyMaxEdge && record.desiredProxyMaxEdge !== proxyMaxEdge) {
            return false;
        }
        return record.nearViewport || isSourceResolution(record.currentResolution);
    }
    return false;
}

function sourceFitsRuntimeBudget(record, pixels) {
    let used = 0;
    for (const other of records) {
        if (other !== record && isRecordCurrent(other)) {
            used += (other.img.naturalWidth || 0) * (other.img.naturalHeight || 0);
        }
    }
    return used + pixels <= PROXY_DECODED_PIXEL_BUDGET;
}

function logResolutionChange(record, fromResolution, resolution, decodedWidth, decodedHeight, decodeMs) {
    if (fromResolution === resolution) {
        return;
    }
    console.debug('Board image resolution changed', {
        blockId: record.id,
        assetName: record.assetName,
        from: fromResolution,
        to: resolution,
        demandLongEdge: Number((record.pixelDemand || 0).toFixed(1)),
        decodedWidth,
        decodedHeight,
        decodeMs: Number(decodeMs.toFixed(1))
    });
}

async function assignDecodedSource(record, sourceUrl, resolution, requestToken, requestControl) {
    if (!sourceUrl || !isRecordCurrent(record)) {
        return false;
    }
    if (!await waitForInteractionIdle(requestControl)) {
        return false;
    }
    if (!isAssignmentStillWanted(record, resolution, requestToken)) {
        return false;
    }

    // Decode the still to validate dimensions; only the displayed element animates.
    sourceUrl = record.animated ? record.posterUrl : sourceUrl;
    const preload = new Image();
    preload.decoding = 'async';
    const startedAt = typeof performance?.now === 'function' ? performance.now() : Date.now();
    let timeoutId = null;
    const task = {
        preload,
        resolution,
        requestToken,
        cancel() {
            requestControl?.cancel();
            try {
                preload.src = '';
            } catch {}
        }
    };
    activeImagePreloads.set(record, task);
    try {
        preload.src = sourceUrl;
        const decode = typeof preload.decode === 'function'
            ? preload.decode()
            : new Promise((resolve, reject) => {
                preload.onload = resolve;
                preload.onerror = reject;
            });
        const decoded = Promise.resolve(decode).then(
            () => ({ status: 'decoded' }),
            (error) => ({ status: 'failed', error })
        );
        const timeout = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve({ status: 'timeout' }), IMAGE_DECODE_TIMEOUT_MS);
        });
        const outcome = await Promise.race([decoded, requestControl.cancellation, timeout]);
        if (outcome.status !== 'decoded') {
            if (outcome.status === 'timeout') {
                console.warn('Board image decode timed out; keeping current resolution', {
                    assetName: record.assetName,
                    resolution,
                    timeoutMs: IMAGE_DECODE_TIMEOUT_MS
                });
            }
            return false;
        }
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (activeImagePreloads.get(record) === task) {
            activeImagePreloads.delete(record);
        }
    }

    const finishedAt = typeof performance?.now === 'function' ? performance.now() : Date.now();
    const decodeMs = Math.max(0, finishedAt - startedAt);
    const decodedWidth = Math.max(0, Number(preload.naturalWidth) || 0);
    const decodedHeight = Math.max(0, Number(preload.naturalHeight) || 0);
    const decodedPixels = decodedWidth * decodedHeight;
    if (resolution === 'source') {
        record.sourcePixels = decodedPixels;
        record.sourceMaxEdge = Math.max(decodedWidth, decodedHeight);
        diagnostics.sourceDecodeMs += decodeMs;
        diagnostics.maxSourceDecodeMs = Math.max(diagnostics.maxSourceDecodeMs, decodeMs);
    }

    if (!await waitForInteractionIdle(requestControl)) {
        return false;
    }
    if (!isAssignmentStillWanted(record, resolution, requestToken)) {
        return false;
    }
    if (resolution === 'source' && !sourceFitsRuntimeBudget(record, decodedPixels)) {
        record.desiredResolution = 'proxy';
        record.budgetSelected = false;
        diagnostics.sourceBudgetDeferred += 1;
        return false;
    }

    const fromResolution = record.currentResolution;
    record.img.dataset.imageResolution = resolution;
    record.img.dataset.proxyMaxEdge = resolution === 'proxy' ? String(record.desiredProxyMaxEdge) : '';
    record.img.src = resolveAnimationPlaybackUrl(record, windowActivityMode) || sourceUrl;
    record.currentResolution = resolution;
    record.currentProxyMaxEdge = resolution === 'proxy' ? record.desiredProxyMaxEdge : 0;
    syncAnimationPlayback(record);
    // Detached GIF preloads must not retain an animated decoder.
    if (record.animated) preload.src = '';
    if (!record.firstPresentedAt) {
        record.firstPresentedAt = Date.now();
        diagnostics.firstPresentations += 1;
    }
    record.loadingError = '';
    record.pendingReason = '';
    diagnostics.assigned += 1;
    logResolutionChange(record, fromResolution, resolution, decodedWidth, decodedHeight, decodeMs);
    return true;
}

async function ensureProxyUrl(record, requestControl) {
    const maxEdge = record.desiredProxyMaxEdge;
    if (record.proxyUrls.has(maxEdge)) {
        if (record.animated) {
            record.animationUrl = record.proxyUrls.get(maxEdge);
            record.posterUrl = record.posterUrls.get(maxEdge) || '';
        }
        return record.proxyUrls.get(maxEdge);
    }
    if (record.proxyUnavailable) {
        throw new Error('image-proxy-previously-unavailable');
    }
    diagnostics.requested += 1;
    const responseOutcome = await Promise.race([
        env.electron.ipcRenderer.invoke('boardstudio:image-proxy', {
            sourcePath: record.sourcePath,
            maxEdge,
            animation: record.animated
        }).then(
            (response) => ({ status: 'response', response }),
            (error) => ({ status: 'failed', error })
        ),
        requestControl.cancellation
    ]);
    if (responseOutcome.status === 'canceled') {
        return '';
    }
    if (responseOutcome.status === 'failed') {
        throw responseOutcome.error;
    }
    const response = responseOutcome.response;
    if (!response?.success || !response.path) {
        throw new Error(response?.error || 'image-proxy-request-failed');
    }
    if (response.cached) {
        diagnostics.cacheHits += 1;
    } else {
        diagnostics.generated += 1;
    }
    const proxyUrl = env.utils.toFileUrl(response.path);
    if (record.animated) {
        if (!response.posterPath) throw new Error('animated-image-poster-missing');
        record.animationUrl = proxyUrl;
        record.posterUrl = env.utils.toFileUrl(response.posterPath);
        record.posterUrls.set(maxEdge, record.posterUrl);
    }
    record.proxyUrls.set(maxEdge, proxyUrl);
    return proxyUrl;
}

async function assignDirectFallback(record, requestToken, requestControl) {
    if (!record.sourceUrl || !isRecordCurrent(record)) {
        return false;
    }
    diagnostics.directFallbacks += 1;
    return assignDecodedSource(record, record.sourceUrl, 'source-fallback', requestToken, requestControl);
}

async function performProxyRequest(record, requestToken, requestControl) {
    try {
        const proxyUrl = await ensureProxyUrl(record, requestControl);
        if (!proxyUrl || requestControl.canceled) {
            return false;
        }
        const assigned = await assignDecodedSource(record, proxyUrl, 'proxy', requestToken, requestControl);
        if (!assigned && isAssignmentStillWanted(record, 'proxy', requestToken)) {
            throw new Error('image-proxy-decode-failed');
        }
        return assigned;
    } catch (error) {
        if (!isRecordCurrent(record) || record.requestToken !== requestToken) {
            return false;
        }
        diagnostics.failures += 1;
        record.loadingError = error?.message || String(error);
        record.proxyUnavailable = true;
        if (!record.failureLogged) {
            record.failureLogged = true;
            console.warn(record.animated
                ? 'Board animated preview unavailable; retaining last still'
                : 'Board image proxy unavailable; using source fallback', {
                assetName: record.assetName,
                error: error?.message || String(error)
            });
        }
        if (record.animated) return false;
        return assignDirectFallback(record, requestToken, requestControl);
    }
}

async function performRecordRequest(record, requestToken, requestControl) {
    if (!await waitForInteractionIdle(requestControl)) {
        return;
    }
    if (!isRecordCurrent(record) || record.requestToken !== requestToken || isResolutionSatisfied(record)) {
        return;
    }
    const desiredResolution = record.desiredResolution;
    if (desiredResolution === 'source-direct') {
        await assignDecodedSource(record, record.sourceUrl, 'source-direct', requestToken, requestControl);
        return;
    }
    if (desiredResolution === 'proxy') {
        await performProxyRequest(record, requestToken, requestControl);
        return;
    }
    if (desiredResolution !== 'source') {
        return;
    }

    if (record.currentResolution !== 'proxy' && !record.proxyUnavailable) {
        const proxyAssigned = await performProxyRequest(record, requestToken, requestControl);
        if (!proxyAssigned && !isSourceResolution(record.currentResolution)) {
            return;
        }
    }
    if (!isAssignmentStillWanted(record, 'source', requestToken)
        || isSourceResolution(record.currentResolution)) {
        return;
    }
    const assigned = await assignDecodedSource(record, record.sourceUrl, 'source', requestToken, requestControl);
    if (!assigned
        && isAssignmentStillWanted(record, 'source', requestToken)
        && record.desiredResolution === 'source') {
        diagnostics.failures += 1;
        console.warn('Board source image decode failed; keeping proxy', {
            assetName: record.assetName
        });
    }
}

function requestRecord(record) {
    if (!record || record.pending || !isRecordCurrent(record) || isResolutionSatisfied(record)) {
        return Promise.resolve(false);
    }
    if (record.desiredResolution === 'source' && !record.strictlyVisible) {
        return Promise.resolve(false);
    }
    if (record.desiredResolution === 'source-direct' && !record.nearViewport) {
        return Promise.resolve(false);
    }
    if (record.desiredResolution === 'proxy'
        && !record.nearViewport
        && !isSourceResolution(record.currentResolution)) {
        return Promise.resolve(false);
    }

    record.pending = true;
    record.pendingReason = isInteractionActive() ? 'gesture' : !isWindowLoadable() ? 'hidden' : 'queued';
    record.requestToken += 1;
    const requestToken = record.requestToken;
    const requestControl = createImageRequestControl();
    record.pendingToken = requestToken;
    record.pendingResolution = record.desiredResolution;
    const queued = requestQueue.enqueue({
        key: record,
        record,
        requestToken,
        requestControl,
        resolution: record.desiredResolution,
        cancel: () => {
            requestControl.cancel();
            const task = activeImagePreloads.get(record);
            if (task?.requestToken === requestToken) {
                task.cancel();
            }
        }
    });
    if (!queued) {
        record.pending = false;
        record.pendingToken = null;
        record.pendingResolution = '';
    }
    return Promise.resolve(queued);
}

function bindImage(img, options = {}) {
    if (!img) {
        return null;
    }
    const blockId = String(img.closest?.('.board-block')?.dataset?.id || '').trim();
    const record = {
        id: blockId || `image-${renderGeneration}-${recordSequence += 1}`,
        img,
        assetName: String(options.assetName || ''),
        sourcePath: String(options.sourcePath || ''),
        sourceUrl: String(options.sourceUrl || ''),
        proxyCandidate: isProxyCandidate(options.assetName),
        animated: isAnimatedSource(options.assetName),
        animationUrl: '',
        posterUrl: '',
        posterUrls: new Map(),
        rasterSource: isRasterSource(options.assetName),
        proxyUrls: new Map(),
        proxyUnavailable: false,
        generation: renderGeneration,
        requestToken: 0,
        pendingToken: null,
        pendingResolution: '',
        nearViewport: false,
        strictlyVisible: false,
        distance: Number.POSITIVE_INFINITY,
        pixelDemand: 0,
        pixelDemandPixels: 0,
        sourcePixels: 0,
        sourceMaxEdge: 0,
        currentProxyMaxEdge: 0,
        desiredProxyMaxEdge: IMAGE_PROXY_MAX_EDGE,
        pending: false,
        currentResolution: 'pending',
        desiredResolution: isProxyCandidate(options.assetName) ? 'proxy' : 'source-direct',
        failureLogged: false,
        pendingReason: 'initial-visibility',
        loadingError: '',
        firstPresentedAt: 0
    };
    img.__boardImageRecord = record;
    img.dataset.imageResolution = 'pending';
    img.dataset.sourceAsset = record.assetName;
    img.dataset.imageRaster = record.rasterSource ? '1' : '0';
    records.add(record);
    const activeObserver = ensureObserver();
    if (activeObserver) {
        activeObserver.observe(img);
    }
    scheduleRefresh();
    return record;
}

function refreshVisiblePreviews() {
    const container = env.dom.boardContainer;
    if (!container || !isWindowLoadable() || isInteractionActive()) {
        return;
    }
    const root = container.getBoundingClientRect();
    const marginX = root.width * 0.8;
    const marginY = root.height * 0.8;
    const centerX = root.left + (root.width / 2);
    const centerY = root.top + (root.height / 2);
    const devicePixelRatio = Math.max(1, Number(window?.devicePixelRatio) || 1);
    const ordered = [];

    records.forEach((record) => {
        if (!isRecordCurrent(record)) {
            return;
        }
        const rect = record.img.getBoundingClientRect();
        record.strictlyVisible = rect.right > root.left
            && rect.left < root.right
            && rect.bottom > root.top
            && rect.top < root.bottom;
        record.nearViewport = rect.right >= root.left - marginX
            && rect.left <= root.right + marginX
            && rect.bottom >= root.top - marginY
            && rect.top <= root.bottom + marginY;
        syncAnimationPlayback(record);
        record.distance = Math.hypot(
            (rect.left + rect.width / 2) - centerX,
            (rect.top + rect.height / 2) - centerY
        );
        const demand = calculatePixelDemand(rect, devicePixelRatio);
        record.pixelDemand = demand.longEdge;
        record.pixelDemandPixels = demand.pixels;
        if (record.nearViewport || isSourceResolution(record.currentResolution)) {
            ordered.push(record);
        }
    });
    ordered.sort((left, right) => left.distance - right.distance);

    const proxyAllocation = allocateProxyCandidates(
        ordered
            .filter((record) => record.proxyCandidate)
            .map((record) => ({
                id: record.id,
                strictlyVisible: record.strictlyVisible,
                pixelDemand: record.pixelDemand,
                sourcePixels: record.sourcePixels,
                sourceMaxEdge: record.sourceMaxEdge,
                currentProxyMaxEdge: record.currentProxyMaxEdge
            })),
        {
            tiers: IMAGE_PROXY_TIERS,
            pixelBudget: PROXY_DECODED_PIXEL_BUDGET
        }
    );

    ordered.forEach((record) => {
        if (!record.proxyCandidate) {
            record.desiredResolution = 'source-direct';
            record.budgetSelected = false;
            return;
        }
        record.desiredResolution = 'proxy';
        record.desiredProxyMaxEdge = proxyAllocation.selected.get(record.id) || IMAGE_PROXY_MAX_EDGE;
    });
    let sourceBudget = PROXY_DECODED_PIXEL_BUDGET - proxyAllocation.allocatedPixels;
    for (const record of ordered) {
        const sourceThreshold = isSourceResolution(record.currentResolution) ? 1536 : 2048 * 1.05;
        if (!record.proxyCandidate || record.animated || !record.strictlyVisible || record.pixelDemand <= sourceThreshold) continue;
        const estimate = record.sourcePixels || Math.max(1_000_000, record.pixelDemandPixels);
        if (estimate > sourceBudget) continue;
        record.desiredResolution = 'source';
        sourceBudget -= estimate;
    }
    ordered.forEach((record) => requestRecord(record));
}

function restoreBlockPreview(blockId, options = {}) {
    const selectorId = String(blockId || '').replace(/"/g, '\\"');
    const img = env.dom.boardGrid?.querySelector(`.board-block[data-id="${selectorId}"] img`);
    const record = img?.__boardImageRecord;
    if (!record) {
        return false;
    }
    requestQueue.removeWhere((job) => job.record === record);
    const activePreload = activeImagePreloads.get(record);
    if (activePreload) {
        try {
            activePreload.cancel();
        } catch {}
        activeImagePreloads.delete(record);
    }
    if (options.assetName) {
        record.assetName = String(options.assetName);
        record.animated = isAnimatedSource(record.assetName);
        record.animationUrl = '';
        record.posterUrl = '';
        record.posterUrls.clear();
        record.sourcePath = String(options.sourcePath || '');
        record.sourceUrl = String(options.sourceUrl || '');
        record.proxyCandidate = isProxyCandidate(record.assetName);
        record.rasterSource = isRasterSource(record.assetName);
        img.dataset.sourceAsset = record.assetName;
        img.dataset.imageRaster = record.rasterSource ? '1' : '0';
    }
    record.requestToken += 1;
    record.pending = false;
    record.pendingToken = null;
    record.pendingResolution = '';
    record.currentResolution = img.currentSrc || img.src ? 'stale' : 'pending';
    record.desiredResolution = record.proxyCandidate ? 'proxy' : 'source-direct';
    record.desiredProxyMaxEdge = IMAGE_PROXY_MAX_EDGE;
    record.currentProxyMaxEdge = 0;
    record.proxyUrls = new Map();
    record.proxyUnavailable = false;
    record.sourcePixels = 0;
    record.sourceMaxEdge = 0;
    record.failureLogged = false;
    record.pendingReason = 'replacement';
    record.loadingError = '';
    scheduleRefresh();
    return true;
}

function getDiagnostics() {
    const resolutionCounts = {};
    let decodedPixels = 0;
    let visibleSourceCount = 0;
    let selectedSourceCount = 0;
    let strictlyVisibleCount = 0;
    let pendingCount = 0;
    const visibleImages = [];
    records.forEach((record) => {
        if (!isRecordCurrent(record)) {
            return;
        }
        const resolution = record.img.dataset.imageResolution || 'unknown';
        resolutionCounts[resolution] = (resolutionCounts[resolution] || 0) + 1;
        decodedPixels += (Number(record.img.naturalWidth) || 0) * (Number(record.img.naturalHeight) || 0);
        if (record.strictlyVisible && isSourceResolution(record.currentResolution)) {
            visibleSourceCount += 1;
        }
        if (record.strictlyVisible) {
            strictlyVisibleCount += 1;
            visibleImages.push({
                id: record.id,
                assetName: record.assetName,
                currentResolution: record.currentResolution,
                animated: record.animated,
                animationPlaying: record.img.dataset.animationPlaying === '1',
                desiredResolution: record.desiredResolution,
                imageRendering: typeof getComputedStyle === 'function'
                    ? getComputedStyle(record.img).imageRendering
                    : String(record.img.style?.imageRendering || ''),
                decodedWidth: Number(record.img.naturalWidth) || 0,
                decodedHeight: Number(record.img.naturalHeight) || 0,
                demandLongEdge: Number((record.pixelDemand || 0).toFixed(1)),
                proxyMaxEdge: record.currentProxyMaxEdge || record.desiredProxyMaxEdge || 0,
                pending: record.pending,
                pendingReason: record.pendingReason || '',
                loadingError: record.loadingError || '',
                firstPresentedAt: record.firstPresentedAt || 0
            });
        }
        if (record.pending) {
            pendingCount += 1;
        }
    });
    const queueState = requestQueue.getState();
    return {
        records: records.size,
        interactionActive: isInteractionActive(),
        resolutionCounts,
        decodedMegapixels: Number((decodedPixels / 1_000_000).toFixed(1)),
        visibleSourceCount,
        strictlyVisibleCount,
        selectedSourceCount,
        visibleImages,
        pendingCount,
        requestQueueDepth: queueState.queuedCount,
        activeRequestResolution: queueState.active?.resolution || '',
        activePreloadCount: activeImagePreloads.size,
        windowActivityMode,
        proxyDecodedPixelBudgetMegapixels: Number((PROXY_DECODED_PIXEL_BUDGET / 1_000_000).toFixed(1)),
        ...diagnostics
    };
}

function waitForCondition(predicate, timeoutMs = 1000) {
    const startedAt = typeof performance?.now === 'function' ? performance.now() : Date.now();
    let spins = 0;
    return new Promise((resolve) => {
        const poll = () => {
            if (predicate()) {
                resolve(true);
                return;
            }
            const now = typeof performance?.now === 'function' ? performance.now() : Date.now();
            if (now - startedAt >= timeoutMs) {
                resolve(false);
                return;
            }
            spins += 1;
            if (spins % 32 === 0) {
                setTimeout(poll, 0);
            } else {
                queueMicrotask(poll);
            }
        };
        poll();
    });
}

async function waitForRequestQueueIdle(timeoutMs = IMAGE_DECODE_TIMEOUT_MS + 1000) {
    let timeoutId = null;
    const result = await Promise.race([
        requestQueue.whenIdle().then(() => true),
        new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(false), timeoutMs);
        })
    ]);
    if (timeoutId) {
        clearTimeout(timeoutId);
    }
    return result;
}

function waitForNextFrame() {
    return new Promise((resolve) => {
        if (typeof window?.requestAnimationFrame !== 'function') {
            setTimeout(resolve, 0);
            return;
        }
        window.requestAnimationFrame(() => resolve());
    });
}

async function profileResolutionCancellation() {
    if (!isWindowActive()) {
        return { success: false, error: 'window-background', diagnostics: getDiagnostics() };
    }
    if (isInteractionActive()) {
        return { success: false, error: 'viewport-interaction-active' };
    }
    refreshVisiblePreviews();
    if (!await waitForRequestQueueIdle()) {
        return { success: false, error: 'image-request-queue-timeout', diagnostics: getDiagnostics() };
    }
    const target = Array.from(records)
        .filter((record) => isRecordCurrent(record) && record.proxyCandidate && !record.animated && record.strictlyVisible)
        .sort((left, right) => left.distance - right.distance)[0];
    if (!target) {
        return { success: false, error: 'no-visible-proxy-image' };
    }

    target.budgetSelected = false;
    target.desiredResolution = 'proxy';
    requestRecord(target);
    if (!await waitForRequestQueueIdle()) {
        return { success: false, error: 'proxy-downgrade-timeout', targetId: target.id, diagnostics: getDiagnostics() };
    }
    if (target.currentResolution !== 'proxy') {
        return { success: false, error: 'proxy-downgrade-failed', targetId: target.id };
    }

    const sourceCanceledBefore = diagnostics.sourceCanceled;
    target.budgetSelected = true;
    target.desiredResolution = 'source';
    requestRecord(target);
    const preloadObserved = await waitForCondition(() => activeImagePreloads.get(target)?.resolution === 'source', 1000);
    if (!preloadObserved) {
        return { success: false, error: 'source-preload-not-observed', targetId: target.id };
    }

    beginViewportInteraction('resolution-profile');
    await new Promise((resolve) => setTimeout(resolve, 16));
    endViewportInteraction('resolution-profile');
    await new Promise((resolve) => setTimeout(resolve, INTERACTION_SETTLE_MS + 40));
    if (!await waitForRequestQueueIdle()) {
        return { success: false, error: 'source-recovery-timeout', targetId: target.id, diagnostics: getDiagnostics() };
    }

    const result = getDiagnostics();
    const sourceCanceledDelta = diagnostics.sourceCanceled - sourceCanceledBefore;
    const success = isResolutionSatisfied(target)
        && sourceCanceledDelta > 0
        && result.requestQueueDepth === 0
        && result.pendingCount === 0;
    return {
        success,
        error: success ? '' : 'resolution-cancellation-recovery-failed',
        targetId: target.id,
        assetName: target.assetName,
        finalResolution: target.currentResolution,
        sourceCanceledDelta,
        preloadObserved,
        diagnostics: result
    };
}

async function profileWindowActivityRecovery() {
    if (isInteractionActive()) {
        return { success: false, error: 'viewport-interaction-active' };
    }
    const originalActivity = env.windowActivity?.getSnapshot?.() || {
        focused: true,
        visibilityState: 'visible',
        mode: 'active',
        source: 'image-focus-profile-fallback'
    };
    const setActivity = (focused, source, visibilityState = 'visible') => env.windowActivity?.set?.({
        focused,
        visibilityState,
        source
    });
    let result = null;
    try {
        setActivity(true, 'image-focus-profile-active');
        await waitForNextFrame();
        refreshVisiblePreviews();
        if (!await waitForRequestQueueIdle()) {
            return { success: false, error: 'initial-active-queue-timeout', diagnostics: getDiagnostics() };
        }
        const animatedTargets = Array.from(records).filter((record) => (
            isRecordCurrent(record) && record.animated && record.strictlyVisible
        ));
        const animationsPlaying = await waitForCondition(() => animatedTargets.every((record) => (
            record.img.src === record.animationUrl && record.img.complete && record.img.naturalWidth > 0
        )), 5000);
        const target = Array.from(records)
            .filter((record) => isRecordCurrent(record) && record.proxyCandidate && !record.animated && record.strictlyVisible)
            .sort((left, right) => left.distance - right.distance)[0];
        if (!target) {
            return { success: false, error: 'no-visible-proxy-image', diagnostics: getDiagnostics() };
        }

        target.budgetSelected = false;
        target.desiredResolution = 'proxy';
        requestRecord(target);
        if (!await waitForRequestQueueIdle() || target.currentResolution !== 'proxy') {
            return { success: false, error: 'proxy-downgrade-failed', targetId: target.id, diagnostics: getDiagnostics() };
        }

        const sourceCanceledBefore = diagnostics.sourceCanceled;
        target.budgetSelected = true;
        target.desiredResolution = 'source';
        requestRecord(target);
        const preloadObserved = await waitForCondition(
            () => activeImagePreloads.get(target)?.resolution === 'source',
            1000
        );
        if (!preloadObserved) {
            return { success: false, error: 'source-preload-not-observed', targetId: target.id, diagnostics: getDiagnostics() };
        }

        setActivity(false, 'image-focus-profile-hidden', 'hidden');
        if (!await waitForRequestQueueIdle(1000)) {
            return { success: false, error: 'background-cancel-timeout', targetId: target.id, diagnostics: getDiagnostics() };
        }
        const backgroundDiagnostics = getDiagnostics();

        // Exercise a cold visible image without requiring keyboard focus.
        target.img.removeAttribute('src');
        target.currentResolution = 'pending';
        target.currentProxyMaxEdge = 0;
        setActivity(false, 'image-focus-profile-visible-unfocused');
        await waitForNextFrame();
        refreshVisiblePreviews();
        if (!await waitForRequestQueueIdle()) {
            return { success: false, error: 'focus-return-queue-timeout', targetId: target.id, diagnostics: getDiagnostics() };
        }
        const activeDiagnostics = getDiagnostics();
        const animationsStopped = animatedTargets.every((record) => (
            record.img.src === record.posterUrl && record.img.complete && record.img.naturalWidth > 0
        ));
        const visibleTarget = activeDiagnostics.visibleImages.find((candidate) => candidate.id === target.id);
        const sourceCanceledDelta = diagnostics.sourceCanceled - sourceCanceledBefore;
        const success = isResolutionSatisfied(target)
            && animationsPlaying && animationsStopped
            && visibleTarget?.decodedWidth > 0
            && visibleTarget?.imageRendering === 'auto'
            && sourceCanceledDelta > 0
            && activeDiagnostics.requestQueueDepth === 0
            && activeDiagnostics.pendingCount === 0
            && activeDiagnostics.activePreloadCount === 0;
        result = {
            success,
            error: success ? '' : 'focus-resolution-recovery-failed',
            targetId: target.id,
            assetName: target.assetName,
            finalResolution: target.currentResolution,
            sourceCanceledDelta,
            preloadObserved,
            backgroundDiagnostics,
            coldVisibleUnfocused: true,
            animatedImageCount: animatedTargets.length,
            animationsPlaying,
            animationsStopped,
            activeDiagnostics
        };
        return result;
    } finally {
        env.windowActivity?.set?.({
            focused: originalActivity.focused,
            visibilityState: originalActivity.visibilityState,
            source: originalActivity.source || 'image-focus-profile-restore'
        });
        if (originalActivity.mode !== 'hidden') {
            scheduleRefresh();
            requestQueue.resume();
        }
    }
}

module.exports = {
    PRELOAD_MARGIN,
    INTERACTION_SETTLE_MS,
    IMAGE_DECODE_TIMEOUT_MS,
    isProxyCandidate,
    isRasterSource,
    isAnimatedSource,
    resolveAnimationPlaybackUrl,
    resetBindings,
    bindImage,
    refreshVisiblePreviews,
    restoreBlockPreview,
    beginViewportInteraction,
    endViewportInteraction,
    isInteractionActive,
    getDiagnostics,
    profileResolutionCancellation,
    profileWindowActivityRecovery
};
