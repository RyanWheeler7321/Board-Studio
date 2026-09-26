'use strict';

const assert = require('assert');
const ops = require('../automation/agentOperations');

function image(id, x, y, width, height, batchId, caption = '') {
    return {
        id,
        type: 'image',
        x,
        y,
        width,
        height,
        assetName: `${id}.png`,
        caption: caption ? { text: caption, enabled: true, placement: 'below', visibility: 'always', extendBorder: false } : null,
        boardDisplay: { batchId, displayedAt: batchId === 'new' ? '2026-07-21T12:00:00Z' : '2026-07-20T12:00:00Z' }
    };
}

const board = {
    id: 'root',
    title: 'Root',
    blocks: [
        image('a', 320, 64, 240, 180, 'new', 'A'),
        image('b', 64, 64, 120, 220, 'new', 'B'),
        image('c', 64, 420, 300, 140, 'old', 'C')
    ]
};

const firstInspection = ops.inspectBoard(board);
assert.strictEqual(firstInspection.blockCount, 3);
assert.deepStrictEqual(firstInspection.blocks.map((block) => block.ref), ['image:1', 'image:2', 'image:3']);
assert.deepStrictEqual(ops.resolveSelection(board, { batchId: 'new', type: 'image' }).map((block) => block.id), ['b', 'a']);
assert.throws(() => ops.resolveSelection(board, { blockIds: ['missing'] }), /Unknown block id/);

const revisionBefore = ops.computeBoardRevision(board);
const arranged = ops.arrangeBlocks(ops.resolveSelection(board, { batchId: 'new', type: 'image' }), {
    layout: 'grid',
    columns: 2,
    gap: 32,
    x: 64,
    y: 64
});
assert.deepStrictEqual(arranged.map((block) => [block.id, block.x, block.y]), [
    ['b', 64, 64],
    ['a', 216, 64]
]);
assert.strictEqual(board.blocks.find((block) => block.id === 'a').width, 240);
assert.notStrictEqual(ops.computeBoardRevision(board), revisionBefore);

ops.applyCaption(board.blocks.find((block) => block.id === 'a'), { text: 'Primary ref', placement: 'below' });
assert.strictEqual(board.blocks.find((block) => block.id === 'a').caption.text, 'Primary ref');
assert.strictEqual(ops.sanitizeCaptionText(' one \n two \n three \n four '), 'one\ntwo\nthree');

const [arrow] = ops.createConnections(board, [{ fromBlockId: 'b', toBlockId: 'a' }], {
    createId: () => 'arrow-1'
});
assert.strictEqual(arrow.agentConnection.fromBlockId, 'b');
assert.strictEqual(arrow.agentConnection.toBlockId, 'a');
const pointsBefore = JSON.stringify(arrow.points);
ops.shiftBlock(board.blocks.find((block) => block.id === 'a'), 200, 0);
ops.refreshConnectionArrows(board, ['a']);
assert.notStrictEqual(JSON.stringify(arrow.points), pointsBefore);
assert.strictEqual(ops.createConnections(board, [{ fromBlockId: 'b', toBlockId: 'a' }]).length, 1);

const orderedBoard = {
    id: 'ordered',
    blocks: [
        image('one', 0, 0, 100, 100, 'ordered'),
        image('two', 200, 0, 100, 100, 'ordered'),
        image('three', 400, 0, 100, 100, 'ordered')
    ]
};
const explicitlyArranged = ops.arrangeBlocks(orderedBoard.blocks, {
    layout: 'row',
    gap: 10,
    x: 0,
    y: 0,
    order: ['three', 'one', 'two']
});
assert.deepStrictEqual(explicitlyArranged.map((block) => [block.id, block.x]), [
    ['three', 0],
    ['one', 110],
    ['two', 220]
]);
assert.throws(() => ops.explicitOrder(orderedBoard.blocks, ['one', 'one', 'two']), /duplicate/);
assert.throws(() => ops.explicitOrder(orderedBoard.blocks, ['one', 'two']), /exact permutation/);

assert.strictEqual(ops.boardFilingMode('root', 'concepting'), 'copy');
assert.strictEqual(ops.boardFilingMode('root', 'library'), 'copy');
assert.strictEqual(ops.boardFilingMode('concepting', 'library'), 'move');
assert.strictEqual(ops.boardFilingMode('root', 'storage'), 'move');
const copyArrow = ops.createConnectionArrow(orderedBoard.blocks[0], orderedBoard.blocks[1], { id: 'copy-arrow' });
let copiedId = 0;
const copiedGroup = ops.cloneBlocksForBoardCopy([
    orderedBoard.blocks[0],
    orderedBoard.blocks[1],
    copyArrow
], {
    createId: (type) => `copied-${type}-${++copiedId}`,
    updatedAt: '2026-07-22T00:00:00Z'
});
assert.deepStrictEqual(copiedGroup.map((block) => block.id).length, 3);
assert.strictEqual(new Set(copiedGroup.map((block) => block.id)).size, 3);
assert.strictEqual(copiedGroup[2].agentConnection.fromBlockId, copiedGroup[0].id);
assert.strictEqual(copiedGroup[2].agentConnection.toBlockId, copiedGroup[1].id);

const replacementTarget = image('replace', 50, 75, 320, 180, 'replace', 'Keep me');
replacementTarget.agentConnection = { fromBlockId: 'replace', toBlockId: 'other' };
const replacementBefore = JSON.parse(JSON.stringify(replacementTarget));
const exactResult = ops.replaceBlockMedia(replacementTarget, {
    assetName: 'images/new.png',
    width: 640,
    height: 360,
    oldAspect: 16 / 9
}, { arPolicy: 'exact' });
assert.strictEqual(exactResult.previousAssetName, 'replace.png');
assert.strictEqual(replacementTarget.assetName, 'images/new.png');
assert.deepStrictEqual({ ...replacementTarget, assetName: replacementBefore.assetName }, replacementBefore);
assert.throws(() => ops.replaceBlockMedia(replacementTarget, {
    assetName: 'images/tall.png',
    width: 320,
    height: 640,
    oldAspect: 16 / 9
}, { arPolicy: 'exact' }), /aspect mismatch/);

const naturalTarget = image('natural', 100, 100, 320, 180, 'replace');
const naturalResult = ops.replaceBlockMedia(naturalTarget, {
    assetName: 'images/tall.png',
    width: 320,
    height: 640,
    oldAspect: 16 / 9
}, { arPolicy: 'natural' });
assert.strictEqual(naturalResult.frameChanged, true);
assert.strictEqual(naturalTarget.width, 320);
assert.strictEqual(naturalTarget.height, 640);
assert.strictEqual(naturalTarget.y, -130);

console.log('agentOperations: ok');
