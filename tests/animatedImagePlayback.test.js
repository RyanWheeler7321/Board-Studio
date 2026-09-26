'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initialMode = 'background', response = null) {
    let activity;
    let mode = initialMode;
    const calls = [];
    const decoded = [];
    const box = { left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500 };
    const env = {
        path, state: {},
        dom: { boardContainer: { getBoundingClientRect: () => box, classList: { toggle() {} } } },
        utils: { toFileUrl: value => `file://${value}` },
        electron: { ipcRenderer: { invoke: async (_, request) => {
            calls.push(request);
            return response || { success: true, path: '/proxy.gif', posterPath: '/poster.png', cached: true };
        } } },
        windowActivity: { getMode: () => mode, subscribe: fn => { activity = fn; } }
    };
    const module = { exports: {} };
    const controllerPath = path.join(__dirname, '../blocks/imageViewportController.js');
    const context = {
        module, console: { debug() {}, warn() {}, error() {} }, setTimeout, clearTimeout,
        performance, Map, Set,
        window: { devicePixelRatio: 1, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout },
        Image: class { naturalWidth = 768; naturalHeight = 768; src = ''; async decode() { decoded.push(this.src); } },
        require: name => name === '../core/state' ? env : require(path.resolve(path.dirname(controllerPath), name))
    };
    vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), context, { filename: controllerPath });
    const img = { src: '', dataset: {}, isConnected: true, naturalWidth: 768, naturalHeight: 768,
        closest: () => ({ dataset: { id: 'animation' } }), getBoundingClientRect: () => box };
    const controller = module.exports;
    const record = controller.bindImage(img, { assetName: 'images/test.gif', sourcePath: '/assets/test.gif', sourceUrl: 'file:///assets/test.gif' });
    return { controller, record, img, calls, decoded, activity(next) { mode = next; activity({ mode: next }); } };
}

async function settled(f) {
    for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 2));
        if (!f.record.pending && f.calls.length) return;
    }
    throw new Error('image request did not settle');
}

test('cold unfocused GIF uses a still and resumes only while visible and active', async () => {
    const f = fixture();
    await settled(f);
    assert.equal(f.img.src, 'file:///poster.png');
    assert.equal(f.calls[0].animation, true);
    assert.deepEqual(f.decoded, ['file:///poster.png']);
    f.activity('active');
    assert.equal(f.img.src, 'file:///proxy.gif');
    assert.equal(f.img.dataset.animationPlaying, '1');
    f.activity('background');
    assert.equal(f.img.src, 'file:///poster.png');
    f.activity('hidden');
    assert.equal(f.img.dataset.animationPlaying, '0');
    f.activity('active');
    f.record.strictlyVisible = false;
    assert.equal(f.controller.resolveAnimationPlaybackUrl(f.record, 'active'), 'file:///poster.png');
    f.controller.resetBindings();
});

test('active GIF validates only its still; never decodes a detached animated preload', async () => {
    const f = fixture('active');
    await settled(f);
    assert.equal(f.img.src, 'file:///proxy.gif');
    assert.deepEqual(f.decoded, ['file:///poster.png']);
    f.controller.resetBindings();
});

test('failed animated preview never falls back to an unbudgeted original animation', async () => {
    const f = fixture('background', { success: false, error: 'media-tool-unavailable' });
    await settled(f);
    assert.equal(f.img.src, '');
    assert.equal(f.record.proxyUnavailable, true);
    assert.equal(f.record.loadingError, 'media-tool-unavailable');
    assert.deepEqual(f.decoded, []);
    f.controller.resetBindings();
});
