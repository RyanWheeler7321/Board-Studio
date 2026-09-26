'use strict';

function createSingleActiveRuntimeLifecycle(options = {}) {
    let activeRuntime = null;

    function getActive() {
        return activeRuntime;
    }

    function isActive(runtime) {
        return !!runtime && activeRuntime === runtime;
    }

    function release(runtime) {
        if (!isActive(runtime)) {
            return false;
        }
        activeRuntime = null;
        return true;
    }

    function disposeActive(reason = 'dispose') {
        const runtime = activeRuntime;
        if (!runtime) {
            return false;
        }
        activeRuntime = null;
        try {
            runtime.dispose?.(reason);
        } finally {
            options.onDisposed?.(runtime, reason);
        }
        return true;
    }

    function activate(runtime, reason = 'activate') {
        if (!runtime) {
            return null;
        }
        if (activeRuntime === runtime) {
            return runtime;
        }
        disposeActive('superseded');
        activeRuntime = runtime;
        options.onActivated?.(runtime, reason);
        return runtime;
    }

    return {
        getActive,
        isActive,
        release,
        disposeActive,
        activate
    };
}

module.exports = { createSingleActiveRuntimeLifecycle };
