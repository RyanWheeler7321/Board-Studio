'use strict';

// Image sources are assigned by the visibility-aware viewport controller.
// The element itself stays cheap and source-less until it is near the viewport
// and the current pan/zoom gesture has settled.
function resolveImageLoadingPolicy() {
	return {
		loading: 'eager',
		fetchPriority: 'low',
		decoding: 'async',
		deferred: true
	};
}

module.exports = {
	resolveImageLoadingPolicy
};
