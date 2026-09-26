'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    IMAGE_PROXY_RECIPE_VERSION,
    createImageProxyCache
} = require('../blocks/imageProxyCache');

function createFakeNativeImage() {
    let thumbnailCalls = 0;
    return {
        get thumbnailCalls() {
            return thumbnailCalls;
        },
        async createThumbnailFromPath(sourcePath, size) {
            thumbnailCalls += 1;
            const source = await fs.promises.readFile(sourcePath);
            return {
                isEmpty: () => false,
                getSize: () => ({ width: size.width, height: Math.max(1, Math.round(size.height / 2)) }),
                toPNG: () => Buffer.concat([Buffer.from('proxy:'), source])
            };
        }
    };
}

async function createFixture(t) {
    const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'board-image-proxy-'));
    const assetsDir = path.join(dataDir, 'assets', 'images');
    await fs.promises.mkdir(assetsDir, { recursive: true });
    t.after(() => fs.promises.rm(dataDir, { recursive: true, force: true }));
    return { dataDir, assetsDir };
}

function gifSource(loopCount) {
    const loopExtension = loopCount === undefined
        ? Buffer.alloc(0)
        : Buffer.from([
            0x21, 0xff, 0x0b,
            ...Buffer.from('NETSCAPE2.0', 'ascii'),
            0x03, 0x01, loopCount & 0xff, (loopCount >> 8) & 0xff, 0x00
        ]);
    return Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(7), loopExtension]);
}

function createFakeMediaTool(options = {}) {
    const calls = [];
    return {
        calls,
        async runMediaTool(args) {
            calls.push(args);
            const outputPath = args.at(-1);
            if (options.failPoster && outputPath.endsWith('.png')) {
                throw new Error('fake-media-tool-poster-failure');
            }
            await fs.promises.writeFile(outputPath, outputPath.endsWith('.gif') ? 'animated' : 'poster');
        }
    };
}

test('proxy cache generates once and reuses content-addressed output', async (t) => {
    const { dataDir, assetsDir } = await createFixture(t);
    const sourcePath = path.join(assetsDir, 'one.png');
    const duplicatePath = path.join(assetsDir, 'duplicate.png');
    await fs.promises.writeFile(sourcePath, 'same-pixels');
    await fs.promises.writeFile(duplicatePath, 'same-pixels');
    const nativeImage = createFakeNativeImage();
    const cache = createImageProxyCache({ nativeImage });

    const first = await cache.request({ dataDir, sourcePath, maxEdge: 768 });
    const second = await cache.request({ dataDir, sourcePath, maxEdge: 768 });
    const duplicate = await cache.request({ dataDir, sourcePath: duplicatePath, maxEdge: 768 });

    assert.equal(first.success, true);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(duplicate.cached, true);
    assert.equal(first.path, second.path);
    assert.equal(first.path, duplicate.path);
    assert.equal(nativeImage.thumbnailCalls, 1);
    assert.match(first.path, new RegExp(`image-proxies-${IMAGE_PROXY_RECIPE_VERSION}`));
    assert.equal(fs.existsSync(first.path), true);
});

test('proxy cache invalidates changed content and rejects paths outside assets', async (t) => {
    const { dataDir, assetsDir } = await createFixture(t);
    const sourcePath = path.join(assetsDir, 'changing.png');
    const outsidePath = path.join(dataDir, 'outside.png');
    await fs.promises.writeFile(sourcePath, 'version-one');
    await fs.promises.writeFile(outsidePath, 'outside');
    const nativeImage = createFakeNativeImage();
    const cache = createImageProxyCache({ nativeImage });

    const first = await cache.request({ dataDir, sourcePath });
    await fs.promises.writeFile(sourcePath, 'version-two');
    const changed = await cache.request({ dataDir, sourcePath });

    assert.notEqual(first.path, changed.path);
    assert.equal(nativeImage.thumbnailCalls, 2);
    await assert.rejects(
        cache.request({ dataDir, sourcePath: outsidePath }),
        /image-proxy-source-outside-assets/
    );
});

test('animated GIF cache is distinct, preserves loop flags, and never upscales', async (t) => {
    const { dataDir, assetsDir } = await createFixture(t);
    const sourcePath = path.join(assetsDir, 'animated.gif');
    await fs.promises.writeFile(sourcePath, gifSource(4));
    const nativeImage = createFakeNativeImage();
    const mediaTool = createFakeMediaTool();
    const cache = createImageProxyCache({ nativeImage, runMediaTool: mediaTool.runMediaTool });

    const [staticResult, animatedResult] = await Promise.all([
        cache.request({ dataDir, sourcePath, maxEdge: 512 }),
        cache.request({ dataDir, sourcePath, maxEdge: 512, animation: true })
    ]);
    const cachedAnimatedResult = await cache.request({ dataDir, sourcePath, maxEdge: 512, animation: true });

    assert.match(staticResult.path, /\.png$/);
    assert.match(animatedResult.path, /-animated\.gif$/);
    assert.match(animatedResult.posterPath, /-animated-poster\.png$/);
    assert.notEqual(staticResult.path, animatedResult.path);
    assert.equal(cachedAnimatedResult.cached, true);
    assert.equal(nativeImage.thumbnailCalls, 1);
    assert.equal(mediaTool.calls.length, 2);
    assert.deepEqual(
        mediaTool.calls[0].slice(mediaTool.calls[0].indexOf('-loop'), mediaTool.calls[0].indexOf('-loop') + 2),
        ['-loop', '4']
    );
    assert.match(mediaTool.calls[0][mediaTool.calls[0].indexOf('-filter_complex') + 1], /min\(512,iw\).*min\(512,ih\)/);

    for (const [name, loopCount] of [['infinite.gif', 0], ['no-loop.gif', undefined]]) {
        const nextSourcePath = path.join(assetsDir, name);
        await fs.promises.writeFile(nextSourcePath, gifSource(loopCount));
        await cache.request({ dataDir, sourcePath: nextSourcePath, animation: true });
    }
    assert.deepEqual(
        mediaTool.calls
            .filter((args) => args.includes('-loop'))
            .map((args) => args[args.indexOf('-loop') + 1]),
        ['4', '0', '-1']
    );
});

test('animated GIF cache publishes both outputs and cleanup removes its GIF and PNG', async (t) => {
    const { dataDir, assetsDir } = await createFixture(t);
    const sourcePath = path.join(assetsDir, 'cleanup.gif');
    await fs.promises.writeFile(sourcePath, gifSource(0));
    const mediaTool = createFakeMediaTool();
    const cache = createImageProxyCache({
        nativeImage: createFakeNativeImage(),
        runMediaTool: mediaTool.runMediaTool
    });

    const result = await cache.request({ dataDir, sourcePath, animation: true });
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.existsSync(result.posterPath), true);
    const old = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
    await Promise.all([fs.promises.utimes(result.path, old, old), fs.promises.utimes(result.posterPath, old, old)]);
    const cleanup = await cache.cleanup(dataDir, { maxAgeMs: 24 * 60 * 60 * 1000 });

    assert.equal(cleanup.removed, 2);
    assert.equal(fs.existsSync(result.path), false);
    assert.equal(fs.existsSync(result.posterPath), false);
});

test('animated GIF cache removes both partial outputs when poster generation fails', async (t) => {
    const { dataDir, assetsDir } = await createFixture(t);
    const sourcePath = path.join(assetsDir, 'failure.gif');
    await fs.promises.writeFile(sourcePath, gifSource(0));
    const mediaTool = createFakeMediaTool({ failPoster: true });
    const cache = createImageProxyCache({
        nativeImage: createFakeNativeImage(),
        runMediaTool: mediaTool.runMediaTool
    });

    await assert.rejects(
        cache.request({ dataDir, sourcePath, animation: true }),
        /fake-media-tool-poster-failure/
    );
    const cacheDir = path.join(dataDir, 'cache', `image-proxies-${IMAGE_PROXY_RECIPE_VERSION}`);
    assert.deepEqual(await fs.promises.readdir(cacheDir), []);
});
