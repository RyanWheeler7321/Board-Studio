'use strict';

// MARK: PUBLIC JOB RUNNER STUBS
module.exports = function createPaintJobRunnerModule(deps) {
    const { dom, paintWorkspaceState, utils } = deps;

    function clearPaintJobHudTimer() {}

    function buildPaintJobTimingKey() {
        return '';
    }

    function formatPaintEtaMs(value) {
        const ms = Math.max(0, Math.round(Number(value) || 0));
        if (!ms) {
            return '';
        }
        const seconds = Math.ceil(ms / 1000);
        return `${seconds}s`;
    }

    function isTimeoutLikePaintJobError() {
        return false;
    }

    function classifyPaintJobRetryReason() {
        return '';
    }

    function extractUsefulFailureLine(raw) {
        return String(raw || '').trim();
    }

    function extractStructuredFailureMessage(raw) {
        return String(raw || '').trim();
    }

    function normalizePaintTimingRecord(value) {
        return value && typeof value === 'object' ? { ...value } : {};
    }

    function getPaintTimingEstimateMs() {
        return 0;
    }

    function derivePaintJobTimeoutMs() {
        return 0;
    }

    function getPaintTimingRecord() {
        return null;
    }

    function estimatePaintJobDurationMs() {
        return 0;
    }

    function clearPaintJobEstimateTimer() {}

    function loadPaintJobTimingHistory() {
        return [];
    }

    function persistPaintJobTimingHistory() {
        return true;
    }

    function beginPaintTimedJob() {
        return { startedAt: Date.now() };
    }

    function snapshotPaintTimedJob() {
        return null;
    }

    function finishPaintTimedJob() {
        return true;
    }

    function recordPaintJobTimingFailure() {
        return false;
    }

    function buildPaintRetryEstimateFloor() {
        return 0;
    }

    function buildPaintRetryTimeoutFloor() {
        return 0;
    }

    async function invokePaintJobWithRetry() {
        utils.showToast?.('This public build does not include automated job dispatch.');
        throw new Error('Automated jobs are unavailable in the public build');
    }

    function renderPaintJobHud() {
        if (!dom.paintJobHud) {
            return;
        }
        const visible = paintWorkspaceState.jobStatus === 'running';
        dom.paintJobHud.hidden = !visible;
        if (dom.paintJobHudTitle) {
            dom.paintJobHudTitle.textContent = paintWorkspaceState.jobMessage || 'Working...';
        }
        if (dom.paintJobHudEta) {
            dom.paintJobHudEta.textContent = paintWorkspaceState.jobDetailMessage || '';
        }
        if (dom.paintJobHudBar) {
            const progress = Math.max(0, Math.min(1, Number(paintWorkspaceState.jobProgress) || 0));
            dom.paintJobHudBar.style.width = `${Math.round(progress * 100)}%`;
        }
    }

    return {
        clearPaintJobHudTimer,
        buildPaintJobTimingKey,
        formatPaintEtaMs,
        isTimeoutLikePaintJobError,
        classifyPaintJobRetryReason,
        extractUsefulFailureLine,
        extractStructuredFailureMessage,
        normalizePaintTimingRecord,
        getPaintTimingEstimateMs,
        derivePaintJobTimeoutMs,
        getPaintTimingRecord,
        estimatePaintJobDurationMs,
        clearPaintJobEstimateTimer,
        loadPaintJobTimingHistory,
        persistPaintJobTimingHistory,
        beginPaintTimedJob,
        snapshotPaintTimedJob,
        finishPaintTimedJob,
        recordPaintJobTimingFailure,
        buildPaintRetryEstimateFloor,
        buildPaintRetryTimeoutFloor,
        invokePaintJobWithRetry,
        renderPaintJobHud
    };
};
