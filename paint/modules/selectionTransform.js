'use strict';

const createPaintSelectionCoreModule = require('./selectionCore');
const createPaintSelectionClipboardCropModule = require('./selectionClipboardCrop');

// MARK: MODULE
module.exports = function createPaintSelectionTransformModule(deps) {
    const coreModule = createPaintSelectionCoreModule(deps);
    return {
        ...coreModule,
        ...createPaintSelectionClipboardCropModule({
            ...deps,
            ...coreModule
        })
    };
};
