'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '..');

function menuFixture(block) {
    const saves = [];
    const buttons = [];
    let click;
    let renders = 0;
    const menu = {
        set innerHTML(value) { buttons.length = 0; },
        appendChild(button) { buttons.push(button); },
        addEventListener(type, listener) { if (type === 'click') click = listener; }
    };
    const env = {
        dom: { contextMenuEl: menu },
        state: { contextMenuTargetBlockId: block.id },
        management: {
            getBlockById: id => id === block.id ? block : null,
            renderBoard: () => renders++,
            hideContextMenu() {}
        },
        blocks: {}, menus: {},
        data: { queueSave: reason => saves.push(reason) }
    };
    const context = vm.createContext({
        require: name => { assert.equal(name, '../core/state'); return env; },
        module: { exports: {} }, console,
        document: { createElement: () => ({
            dataset: {}, classList: { add() {} },
            setAttribute(name, value) { this[name] = value; }
        }) }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'menus/menus.js'), 'utf8'), context);
    return {
        env, buttons, saves,
        get renders() { return renders; },
        async toggle() {
            click({ target: { closest: () => ({ dataset: { action: 'toggle-image-background' } }) }, preventDefault() {} });
            await new Promise(resolve => setImmediate(resolve));
        }
    };
}

test('legacy image defaults transparent; actual context-menu click toggles and saves both ways', async () => {
    const block = { id: 'image-test', type: 'image', showBorder: false, caption: { enabled: true, extendBorder: true } };
    const fixture = menuFixture(block);
    fixture.env.menus.populateMenu(block.id);
    const toggle = () => fixture.buttons.find(button => button.dataset.action === 'toggle-image-background');
    assert.equal(toggle().textContent, 'Opaque Background');
    assert.equal(toggle()['aria-pressed'], 'false');
    await fixture.toggle();
    assert.equal(block.opaqueBackground, true);
    assert.equal(toggle()['aria-pressed'], 'true');
    assert.equal(JSON.parse(JSON.stringify(block)).opaqueBackground, true);
    assert.equal(block.showBorder, false);
    assert.deepEqual(block.caption, { enabled: true, extendBorder: true });
    await fixture.toggle();
    assert.equal(block.opaqueBackground, false);
    assert.equal(toggle()['aria-pressed'], 'false');
    assert.deepEqual(fixture.saves, ['image-background-toggle', 'image-background-toggle']);
    assert.equal(fixture.renders, 2);
});

test('non-image blocks never offer or mutate an image background', async () => {
    const block = { id: 'audio-test', type: 'audio' };
    const fixture = menuFixture(block);
    assert.equal(fixture.env.menus.buildBlockMenu(block.id).some(item => item.id === 'toggle-image-background'), false);
    await fixture.toggle();
    assert.equal(block.opaqueBackground, undefined);
    assert.equal(fixture.saves.length, 0);
});

test('rendering and normalization require explicit true; both card shapes use the same themed background', () => {
    const image = fs.readFileSync(path.join(root, 'blocks/imageBlock.js'), 'utf8');
    const store = fs.readFileSync(path.join(root, 'data/dataStore.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'styles/blocks.css'), 'utf8');
    assert.match(image, /opaqueBackground: false/);
    assert.match(image, /classList\.toggle\('image-background-opaque', block\.opaqueBackground === true\)/);
    assert.match(store, /block\.opaqueBackground = block\.opaqueBackground === true;/);
    assert.match(css, /\.board-block\.type-image \{\s*--image-card-background: transparent;/);
    assert.match(css, /\.board-block\.type-image\.image-background-opaque \{\s*--image-card-background: var\(--bg-card\);/);
    assert.match(css, /\.image-block-media \{[^}]*background: var\(--image-card-background, transparent\);/);
    assert.match(css, /\.board-block\.type-image\.image-caption-extend-border \{[^}]*background: var\(--image-card-background, transparent\);/);
});
