'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const media = require('../automation/mediaAssets');

const TRANSPARENT_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+7ShuAAAAAElFTkSuQmCC',
    'base64'
);

function orientedJpegFixture() {
    const app1 = Buffer.from([
        0xff, 0xe1, 0x00, 0x22,
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    ]);
    const sof = Buffer.from([
        0xff, 0xc0, 0x00, 0x0b,
        0x08, 0x00, 0x03, 0x00, 0x02,
        0x01, 0x01, 0x11, 0x00
    ]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
}

test('inspects alpha PNG and orientation-correct JPEG dimensions', () => {
    const png = media.inspectImageBuffer(TRANSPARENT_PNG);
    assert.deepStrictEqual([png.mimeType, png.width, png.height, png.hasAlpha], ['image/png', 1, 1, true]);

    const jpeg = media.inspectImageBuffer(orientedJpegFixture());
    assert.strictEqual(jpeg.mimeType, 'image/jpeg');
    assert.strictEqual(jpeg.orientation, 6);
    assert.deepStrictEqual([jpeg.width, jpeg.height], [3, 2]);
});

test('stages immutable content-addressed Board assets', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-studio-media-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourcePath = path.join(root, 'source.png');
    const boardDataDir = path.join(root, 'BoardStudioData');
    fs.writeFileSync(sourcePath, TRANSPARENT_PNG);

    const first = await media.stageBoardImage(sourcePath, { boardDataDir });
    const second = await media.stageBoardImage(sourcePath, { boardDataDir });
    assert.strictEqual(first.assetName, second.assetName);
    assert.strictEqual(first.created, true);
    assert.strictEqual(second.created, false);
    assert.strictEqual(fs.existsSync(first.destinationPath), true);
    assert.strictEqual(media.readImageInfoSync(first.destinationPath).sha256, first.sha256);
});

test('rejects staging without an explicit Board data directory', async () => {
    await assert.rejects(
        media.stageBoardImage(__filename, { boardDataDir: '' }),
        /Board Studio data directory is required/
    );
});
