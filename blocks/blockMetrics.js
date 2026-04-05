'use strict';

// MARK: BLOCK METRICS
const env = require('../core/state');
const { constants } = env;

const metrics = {
    TITLE_BASE_WIDTH: constants.GRID_SIZE * 14,
    TITLE_BASE_HEIGHT: constants.GRID_SIZE * 5,
    TITLE_BASE_FONT: 56,
    TEXT_BASE_WIDTH: constants.GRID_SIZE * 18,
    TEXT_BASE_HEIGHT: constants.GRID_SIZE * 4,
    TEXT_BASE_FONT: 24
};

env.blockMetrics = metrics;

module.exports = env;
