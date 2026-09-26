'use strict';

const { deepClone, computeBoardRevision } = require('./agentOperations');

// Only display-owned boards are replaced. Other boards, navigation and settings
// are always taken from the current renderer, not the importer's old snapshot.
function prepareDisplayCommit(liveData, payload) {
    const ids = payload.append ? ['root'] : ['root', 'storage'];
    for (const id of ids) {
        if (!payload.expectedRevisions?.[id]
            || payload.expectedRevisions[id] !== computeBoardRevision(liveData.boards[id])) {
            throw new Error(`stale-display-revision:${id}`);
        }
        if (payload.boards?.[id]?.id !== id || !Array.isArray(payload.boards[id].blocks)) {
            throw new Error(`invalid-display-board:${id}`);
        }
    }
    const working = deepClone(liveData);
    for (const id of ids) {
        working.boards[id].blocks = deepClone(payload.boards[id].blocks);
        working.boards[id].updatedAt = payload.boards[id].updatedAt;
    }
    working.updatedAt = new Date().toISOString();
    return working;
}

module.exports = { prepareDisplayCommit };
