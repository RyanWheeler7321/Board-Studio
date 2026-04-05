'use strict';

const env = require('../../core/state');
const libraryView = require('./libraryView');

env.twoDTools = {
    render(root) {
        libraryView.render(root);
    }
};

if (env.state?.sublists?.activeView === 'tool-2d' && env.toolShell?.renderActiveTool) {
    env.toolShell.renderActiveTool();
}

module.exports = env.twoDTools;
