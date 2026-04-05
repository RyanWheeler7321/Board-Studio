'use strict';

const createPaintInputPointerModule = require('./inputPointer');
const createPaintInputKeyboardModule = require('./inputKeyboard');

// MARK: MODULE
module.exports = function createPaintInputModule(deps) {
    return {
        ...createPaintInputPointerModule(deps),
        ...createPaintInputKeyboardModule(deps)
    };
};
