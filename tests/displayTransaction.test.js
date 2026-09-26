'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareDisplayCommit } = require('../automation/displayTransaction');
const { computeBoardRevision } = require('../automation/agentOperations');

function fixture() {
    const live = { boards: {
        root: { id: 'root', blocks: [{ id: 'existing', x: 12 }] },
        storage: { id: 'storage', blocks: [] },
        library: { id: 'library', blocks: [{ id: 'private' }] }
    }, activeBoardId: 'root', settings: { untouched: true } };
    const payload = {
        expectedRevisions: Object.fromEntries(['root', 'storage'].map((id) =>
            [id, computeBoardRevision(live.boards[id])])),
        boards: { root: { id: 'root', blocks: [{ id: 'new' }] },
            storage: { id: 'storage', blocks: [{ id: 'archived' }] } }
    };
    return { live, payload };
}

test('display commit preserves unrelated edits and does not mutate its input', () => {
    const { live, payload } = fixture();
    live.boards.library.blocks.push({ id: 'new-manual-edit' });
    const result = prepareDisplayCommit(live, payload);
    assert.deepEqual(result.boards.library, live.boards.library);
    assert.deepEqual(result.settings, live.settings);
    assert.equal(result.boards.root.blocks[0].id, 'new');
    assert.equal(live.boards.root.blocks[0].id, 'existing');
});

test('manual root or storage changes reject stale display commits', () => {
    for (const id of ['root', 'storage']) {
        const { live, payload } = fixture();
        live.boards[id].blocks.push({ id: 'manual' });
        assert.throws(() => prepareDisplayCommit(live, payload), /stale-display-revision/);
    }
});

test('append leaves concurrent storage work alone', () => {
    const { live, payload } = fixture();
    payload.append = true;
    live.boards.storage.blocks.push({ id: 'manual' });
    const result = prepareDisplayCommit(live, payload);
    assert.deepEqual(result.boards.storage, live.boards.storage);
});
