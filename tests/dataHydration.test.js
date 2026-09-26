'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function loadDataStore() {
    const env = { fs, path, paths: {}, constants: {}, state: {}, utils: {}, data: {} };
    const source = fs.readFileSync(path.join(root, 'data/dataStore.js'), 'utf8');
    const context = { module: { exports: {} }, console: { debug() {} }, require(name) {
        if (name === '../core/state') return env;
        return require(path.resolve(root, 'data', name));
    }};
    vm.createContext(context);
    vm.runInContext(source + '\nsanitizeViewport = x => x; sanitizeSettings = x => x;', context);
    // Keep the real hydration, skip the per-board rendering defaults.
    vm.runInContext('normalizeBoardIconState = () => {}; applyBlockDefaults = () => {};', context);
    return env;
}

test('data hydration drops old 2D project data', () => {
    const env = loadDataStore();
    const board = { id: 'root', blocks: [{ id: 'kept', assetName: 'images/source.png' }], childIds: [] };
    const data = { boards: { root: board }, artProjects2D: { projects: { old: {} } }, assetProjects2D: { assets: { old: {} } }, unrelated: 'keep' };
    env.data.hydrateLoadedData(data);
    assert.equal(data.artProjects2D, undefined);
    assert.equal(data.assetProjects2D, undefined);
    assert.equal(data.unrelated, 'keep');
    assert.equal(data.boards.root.blocks[0].assetName, 'images/source.png');
});

test('data hydration drops the old per-board side lists', () => {
    const env = loadDataStore();
    const board = { id: 'child', blocks: [], childIds: [], sublists: [{ title: 'Notes', lines: [''] }], useLocalSublists: true };
    const data = { boards: { child: board } };
    env.data.hydrateLoadedData(data);
    assert.equal('sublists' in data.boards.child, false);
    assert.equal('useLocalSublists' in data.boards.child, false);
});
