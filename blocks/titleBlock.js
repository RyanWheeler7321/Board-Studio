'use strict';

// MARK: TITLE BLOCK ADAPTER
const env = require('../core/state');
const textBlock = require('./textBlock');

function renderTitleBlock(block, element) {
	textBlock.renderElement(block, element, { isTitle: true });
}

const titleApi = {
	render: renderTitleBlock
};

env.blocks.title = titleApi;

module.exports = titleApi;