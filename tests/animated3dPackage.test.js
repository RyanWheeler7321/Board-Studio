'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    CAMERA_VIEWS,
    getAnimated3dPackageReferences,
    normalizeAnimated3dPreferences,
    sanitizeAnimated3dBlockData,
    stageAnimated3dPackage,
    resolveAnimated3dPackage,
    buildCapturedPosterSvg,
    isCapturedPosterSvg
} = require('../blocks/animated3dPackage');

function validGlb() {
    const buffer = Buffer.alloc(12);
    buffer.writeUInt32LE(0x46546c67, 0);
    buffer.writeUInt32LE(2, 4);
    buffer.writeUInt32LE(buffer.length, 8);
    return buffer;
}

test('stages one managed GLB package with manifest, model, and poster', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-studio-animated3d-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const assetsDir = path.join(root, 'assets');
    const sourcePath = path.join(root, 'walk.glb');
    const source = validGlb();
    fs.writeFileSync(sourcePath, source);

    const staged = await stageAnimated3dPackage({ path: sourcePath, name: 'Walk Cycle.glb' }, {
        assetsDir,
        createdAt: '2026-08-28T00:00:00.000Z'
    });
    const expectedHash = crypto.createHash('sha256').update(source).digest('hex');
    assert.equal(staged.packageRef, `models/animated3d-${expectedHash}.manifest.json`);
    assert.deepEqual(getAnimated3dPackageReferences(staged.packageRef), [
        staged.packageRef,
        `models/animated3d-${expectedHash}.glb`,
        `models/animated3d-${expectedHash}.poster.svg`
    ]);
    const resolved = resolveAnimated3dPackage(staged.packageRef, { assetsDir });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.manifest.sourceName, 'Walk Cycle');
    assert.equal(fs.existsSync(resolved.modelPath), true);
    assert.equal(fs.existsSync(resolved.posterPath), true);

    const repeated = await stageAnimated3dPackage(sourcePath, { assetsDir });
    assert.equal(repeated.packageRef, staged.packageRef);
    assert.equal(repeated.created, false);
});

test('rejects raw multi-file GLTF input before it can create a package', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-studio-animated3d-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await assert.rejects(
        stageAnimated3dPackage({ name: 'walk.gltf', arrayBuffer: async () => validGlb() }, { assetsDir: path.join(root, 'assets') }),
        /single-file \.glb/
    );
});

test('builds a real captured first-frame poster wrapper', () => {
    const poster = buildCapturedPosterSvg(
        `data:image/png;base64,${Buffer.from('captured-frame').toString('base64')}`,
        1280,
        720,
        'Nix & Run'
    );
    assert.equal(isCapturedPosterSvg(poster), true);
    assert.match(poster, /width="1280" height="720"/);
    assert.match(poster, /Nix &amp; Run first-frame preview/);
    assert.match(poster, /data:image\/png;base64,/);
    assert.equal(isCapturedPosterSvg('<svg></svg>'), false);
});

test('animated3d persisted data keeps only the package reference and compact preferences', () => {
    const packageRef = 'models/animated3d-0123456789abcdef0123456789abcdef.manifest.json';
    const block = {
        id: 'animated3d-test',
        type: 'animated3d',
        packageRef,
        preferences: { activeClip: 3, speed: 0.5, showBones: true, clay: true, rootMotionPreview: false, view: 'left-profile', transient: 'drop-me' },
        renderer: { cannot: 'serialize' },
        scene: { cannot: 'serialize' },
        sourcePath: 'C:/not-persisted.glb',
        title: 'not-persisted'
    };
    sanitizeAnimated3dBlockData(block);
    assert.deepEqual(block.preferences, normalizeAnimated3dPreferences({ activeClip: 3, speed: 0.5, showBones: true, clay: true, rootMotionPreview: false, view: 'left-profile' }));
    assert.equal(block.packageRef, packageRef);
    assert.equal('renderer' in block, false);
    assert.equal('scene' in block, false);
    assert.equal('sourcePath' in block, false);
    assert.equal('title' in block, false);
    assert.deepEqual(JSON.parse(JSON.stringify(block)), block);
});

test('camera views cover both character-relative profiles, rear, and below', () => {
    assert.deepEqual(CAMERA_VIEWS, [
        'front',
        'rear',
        'left-profile',
        'right-profile',
        'top',
        'below',
        'diagonal'
    ]);
    assert.equal(normalizeAnimated3dPreferences({ view: 'side' }).view, 'left-profile');
});

test('root motion preview is disabled by default and only enables explicitly', () => {
    assert.equal(normalizeAnimated3dPreferences({}).rootMotionPreview, false);
    assert.equal(normalizeAnimated3dPreferences({ rootMotionPreview: false }).rootMotionPreview, false);
    assert.equal(normalizeAnimated3dPreferences({ rootMotionPreview: true }).rootMotionPreview, true);
});
