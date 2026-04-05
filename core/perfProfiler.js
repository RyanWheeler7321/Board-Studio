'use strict';

// MARK: MODULE
module.exports = function createWorkboardProfiler(options = {}) {
    // MARK: STATE
    const namespace = String(options.namespace || 'workboard.profiler').trim() || 'workboard.profiler';
    const flushIntervalMs = Math.max(250, Math.round(Number(options.flushIntervalMs) || 5000));
    const summaryLimit = Math.max(1, Math.round(Number(options.summaryLimit) || 8));
    const slowThresholdMs = Math.max(0, Number(options.slowThresholdMs) || 8);
    const log = typeof options.log === 'function' ? options.log : () => {};
    const now = typeof options.now === 'function' ? options.now : defaultNow;
    const durationScopes = new Map();
    const counterScopes = new Map();
    let enabled = options.enabled !== false;
    let flushTimer = null;
    let windowStartedAt = Date.now();
    let dirty = false;

    // MARK: HELPERS
    function defaultNow() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function clonePayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return payload == null ? null : payload;
        }
        const output = {};
        Object.keys(payload).slice(0, 16).forEach((key) => {
            const value = payload[key];
            if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                output[key] = value;
                return;
            }
            output[key] = String(value);
        });
        return output;
    }

    function ensureDurationScope(name) {
        const key = String(name || '').trim() || 'unnamed.duration';
        if (!durationScopes.has(key)) {
            durationScopes.set(key, {
                name: key,
                count: 0,
                totalMs: 0,
                maxMs: 0,
                lastMs: 0,
                slowCount: 0,
                windowCount: 0,
                windowTotalMs: 0,
                windowMaxMs: 0,
                windowSlowCount: 0,
                lastPayload: null
            });
        }
        return durationScopes.get(key);
    }

    function ensureCounterScope(name) {
        const key = String(name || '').trim() || 'unnamed.counter';
        if (!counterScopes.has(key)) {
            counterScopes.set(key, {
                name: key,
                count: 0,
                windowCount: 0,
                lastPayload: null
            });
        }
        return counterScopes.get(key);
    }

    function clearFlushTimer() {
        if (!flushTimer) {
            return;
        }
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    function scheduleFlush() {
        if (!enabled || flushTimer || !dirty) {
            return;
        }
        flushTimer = setTimeout(() => {
            flush('interval');
        }, flushIntervalMs);
    }

    function buildDurationSummary(scope, windowMs) {
        const avgMs = scope.windowCount > 0 ? scope.windowTotalMs / scope.windowCount : 0;
        const ratePerSecond = windowMs > 0 ? scope.windowCount / (windowMs / 1000) : 0;
        return {
            name: scope.name,
            count: scope.windowCount,
            totalMs: Number(scope.windowTotalMs.toFixed(3)),
            avgMs: Number(avgMs.toFixed(3)),
            maxMs: Number(scope.windowMaxMs.toFixed(3)),
            ratePerSecond: Number(ratePerSecond.toFixed(3)),
            slowCount: scope.windowSlowCount,
            lastMs: Number(scope.lastMs.toFixed(3)),
            lastPayload: scope.lastPayload
        };
    }

    function buildCounterSummary(scope, windowMs) {
        const ratePerSecond = windowMs > 0 ? scope.windowCount / (windowMs / 1000) : 0;
        return {
            name: scope.name,
            count: scope.windowCount,
            ratePerSecond: Number(ratePerSecond.toFixed(3)),
            lastPayload: scope.lastPayload
        };
    }

    function resetWindow() {
        windowStartedAt = Date.now();
        dirty = false;
        durationScopes.forEach((scope) => {
            scope.windowCount = 0;
            scope.windowTotalMs = 0;
            scope.windowMaxMs = 0;
            scope.windowSlowCount = 0;
        });
        counterScopes.forEach((scope) => {
            scope.windowCount = 0;
        });
    }

    // MARK: API
    function recordDuration(name, durationMs, payload = null) {
        if (!enabled) {
            return 0;
        }
        const safeDurationMs = Math.max(0, Number(durationMs) || 0);
        const scope = ensureDurationScope(name);
        scope.count += 1;
        scope.totalMs += safeDurationMs;
        scope.maxMs = Math.max(scope.maxMs, safeDurationMs);
        scope.lastMs = safeDurationMs;
        scope.windowCount += 1;
        scope.windowTotalMs += safeDurationMs;
        scope.windowMaxMs = Math.max(scope.windowMaxMs, safeDurationMs);
        scope.lastPayload = clonePayload(payload);
        if (safeDurationMs >= slowThresholdMs) {
            scope.slowCount += 1;
            scope.windowSlowCount += 1;
        }
        dirty = true;
        scheduleFlush();
        return safeDurationMs;
    }

    function begin(name, payload = null) {
        if (!enabled) {
            return () => 0;
        }
        const startedAt = now();
        return function finish(extraPayload = null) {
            const mergedPayload = payload && extraPayload
                ? { ...payload, ...extraPayload }
                : (extraPayload || payload);
            return recordDuration(name, now() - startedAt, mergedPayload);
        };
    }

    function measure(name, callback, payload = null) {
        const finish = begin(name, payload);
        try {
            const result = callback();
            if (result && typeof result.then === 'function') {
                return result.then((value) => {
                    finish();
                    return value;
                }).catch((error) => {
                    finish({ failed: true, message: error?.message || String(error) });
                    throw error;
                });
            }
            finish();
            return result;
        } catch (error) {
            finish({ failed: true, message: error?.message || String(error) });
            throw error;
        }
    }

    function count(name, amount = 1, payload = null) {
        if (!enabled) {
            return 0;
        }
        const delta = Math.max(0, Number(amount) || 0);
        const scope = ensureCounterScope(name);
        scope.count += delta;
        scope.windowCount += delta;
        scope.lastPayload = clonePayload(payload);
        dirty = true;
        scheduleFlush();
        return scope.windowCount;
    }

    function snapshot() {
        const windowMs = Math.max(1, Date.now() - windowStartedAt);
        return {
            namespace,
            enabled,
            windowMs,
            durations: Array.from(durationScopes.values())
                .filter((scope) => scope.count > 0)
                .sort((left, right) => right.totalMs - left.totalMs)
                .map((scope) => ({
                    name: scope.name,
                    count: scope.count,
                    totalMs: Number(scope.totalMs.toFixed(3)),
                    avgMs: Number((scope.totalMs / Math.max(1, scope.count)).toFixed(3)),
                    maxMs: Number(scope.maxMs.toFixed(3)),
                    slowCount: scope.slowCount,
                    lastMs: Number(scope.lastMs.toFixed(3)),
                    windowCount: scope.windowCount,
                    windowTotalMs: Number(scope.windowTotalMs.toFixed(3)),
                    windowMaxMs: Number(scope.windowMaxMs.toFixed(3)),
                    lastPayload: scope.lastPayload
                })),
            counters: Array.from(counterScopes.values())
                .filter((scope) => scope.count > 0)
                .sort((left, right) => right.count - left.count)
                .map((scope) => ({
                    name: scope.name,
                    count: scope.count,
                    windowCount: scope.windowCount,
                    ratePerSecond: Number((scope.windowCount / (windowMs / 1000)).toFixed(3)),
                    lastPayload: scope.lastPayload
                }))
        };
    }

    function flush(reason = 'manual') {
        clearFlushTimer();
        const windowMs = Math.max(1, Date.now() - windowStartedAt);
        const topDurations = Array.from(durationScopes.values())
            .filter((scope) => scope.windowCount > 0)
            .sort((left, right) => right.windowTotalMs - left.windowTotalMs)
            .slice(0, summaryLimit)
            .map((scope) => buildDurationSummary(scope, windowMs));
        const topCounters = Array.from(counterScopes.values())
            .filter((scope) => scope.windowCount > 0)
            .sort((left, right) => right.windowCount - left.windowCount)
            .slice(0, summaryLimit)
            .map((scope) => buildCounterSummary(scope, windowMs));
        if (!topDurations.length && !topCounters.length) {
            resetWindow();
            return null;
        }
        const summary = {
            reason: String(reason || 'manual'),
            windowMs,
            topDurations,
            topCounters
        };
        log(`${namespace}.summary ${JSON.stringify(summary)}`);
        resetWindow();
        return summary;
    }

    function reset() {
        clearFlushTimer();
        durationScopes.clear();
        counterScopes.clear();
        windowStartedAt = Date.now();
        dirty = false;
    }

    function setEnabled(value) {
        enabled = value !== false;
        if (!enabled) {
            clearFlushTimer();
        } else if (dirty) {
            scheduleFlush();
        }
        return enabled;
    }

    function isEnabled() {
        return enabled;
    }

    function dispose() {
        flush('dispose');
        clearFlushTimer();
    }

    return {
        begin,
        count,
        dispose,
        flush,
        isEnabled,
        measure,
        recordDuration,
        reset,
        setEnabled,
        snapshot
    };
};
