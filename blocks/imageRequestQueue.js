'use strict';

function createImageRequestControl() {
    let resolveCancellation = null;
    const cancellation = new Promise((resolve) => {
        resolveCancellation = resolve;
    });
    return {
        canceled: false,
        cancellation,
        cancel() {
            if (this.canceled) {
                return;
            }
            this.canceled = true;
            resolveCancellation({ status: 'canceled' });
        }
    };
}

function createSerialImageRequestQueue(options = {}) {
    const canStart = typeof options.canStart === 'function' ? options.canStart : () => true;
    const run = typeof options.run === 'function' ? options.run : async () => {};
    const onSettled = typeof options.onSettled === 'function' ? options.onSettled : () => {};
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    const pending = [];
    const idleWaiters = new Set();
    let active = null;
    let running = false;
    let pumpScheduled = false;

    function resolveIdleWaiters() {
        if (running || pending.length > 0) {
            return;
        }
        idleWaiters.forEach((resolve) => resolve());
        idleWaiters.clear();
    }

    function schedulePump() {
        if (pumpScheduled || running || pending.length === 0 || !canStart()) {
            return;
        }
        pumpScheduled = true;
        queueMicrotask(() => {
            pumpScheduled = false;
            void pump();
        });
    }

    async function pump() {
        if (running || pending.length === 0 || !canStart()) {
            resolveIdleWaiters();
            return;
        }
        running = true;
        try {
            while (pending.length > 0 && canStart()) {
                const job = pending.shift();
                active = job;
                try {
                    await run(job);
                } catch (error) {
                    onError(error, job);
                } finally {
                    active = null;
                    onSettled(job);
                }
            }
        } finally {
            running = false;
            resolveIdleWaiters();
            schedulePump();
        }
    }

    function enqueue(job) {
        if (!job || job.key === undefined || job.key === null) {
            throw new Error('image-request-queue-key-required');
        }
        if (pending.some((candidate) => candidate.key === job.key)) {
            return false;
        }
        pending.push(job);
        schedulePump();
        return true;
    }

    function removeWhere(predicate) {
        if (typeof predicate !== 'function' || pending.length === 0) {
            return [];
        }
        const removed = [];
        for (let index = pending.length - 1; index >= 0; index -= 1) {
            if (!predicate(pending[index])) {
                continue;
            }
            removed.unshift(...pending.splice(index, 1));
        }
        resolveIdleWaiters();
        return removed;
    }

    function clear() {
        const removed = pending.splice(0, pending.length);
        resolveIdleWaiters();
        return removed;
    }

    function cancelActive() {
        const job = active;
        if (!job || typeof job.cancel !== 'function') {
            return job || null;
        }
        try {
            job.cancel();
        } catch (error) {
            onError(error, job);
        }
        return job;
    }

    function resume() {
        schedulePump();
    }

    function whenIdle() {
        if (!running && pending.length === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => idleWaiters.add(resolve));
    }

    function getState() {
        return {
            queuedCount: pending.length,
            active: active || null,
            running
        };
    }

    return {
        enqueue,
        removeWhere,
        clear,
        cancelActive,
        resume,
        whenIdle,
        getState
    };
}

module.exports = {
    createSerialImageRequestQueue,
    createImageRequestControl
};
