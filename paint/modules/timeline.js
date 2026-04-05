'use strict';

const createPaintTimelineStateModule = require('./timelineState');
const createPaintTimelineViewModule = require('./timelineView');

// MARK: MODULE
module.exports = function createPaintTimelineModule(deps) {
    const api = {};
    let viewModule = null;
    const stateModule = createPaintTimelineStateModule({
        ...deps,
        primeTimelineFrameStates: (...args) => viewModule?.primeTimelineFrameStates?.(...args) || Promise.resolve(false)
    });
    viewModule = createPaintTimelineViewModule({
        ...deps,
        ...stateModule
    });
    Object.assign(api, stateModule, viewModule);
    return api;
};
