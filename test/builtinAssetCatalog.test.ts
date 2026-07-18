import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  LEGACY_STREAM_1_ASSET_SPECS,
  LEGACY_STREAM_2_ASSET_SPECS,
  initializeEmptyBuiltinStreams,
  loadBuiltinImageObjects,
  resolveBuiltinAssetSources,
} from '../src/builtinAssetCatalog.ts';

const expectedStream1 = ['造', '经', '木', '云', '法'];
const expectedStream2 = [
  '象形',
  '版本',
  '活版',
  '畢昇',
  '算术',
  '典籍',
  '版印',
  '星辰',
  '六善',
  '形察',
  '造微',
];

test('keeps the confirmed legacy stream order', () => {
  assert.deepEqual(
    LEGACY_STREAM_1_ASSET_SPECS.map(asset => asset.label),
    expectedStream1,
  );
  assert.deepEqual(
    LEGACY_STREAM_2_ASSET_SPECS.map(asset => asset.label),
    expectedStream2,
  );
});

test('uses unique stable ids and excludes blank placeholders', () => {
  const assets = [
    ...LEGACY_STREAM_1_ASSET_SPECS,
    ...LEGACY_STREAM_2_ASSET_SPECS,
  ];
  const ids = assets.map(asset => asset.id);

  assert.equal(new Set(ids).size, assets.length);
  assert.equal(assets.some(asset => asset.filename.includes('空白')), false);
});

test('resolves each asset to its inlined Vite source', () => {
  const modules = Object.fromEntries(
    LEGACY_STREAM_1_ASSET_SPECS.map(asset => [
      `./assets/mengxi/${asset.category}/${asset.filename}`,
      `data:image/png;base64,${asset.id}`,
    ]),
  );

  const resolved = resolveBuiltinAssetSources(
    LEGACY_STREAM_1_ASSET_SPECS,
    modules,
  );

  assert.deepEqual(
    resolved.map(asset => asset.src),
    LEGACY_STREAM_1_ASSET_SPECS.map(
      asset => `data:image/png;base64,${asset.id}`,
    ),
  );
});

test('ships every confirmed source file inside the app', () => {
  const assetRoot = fileURLToPath(
    new URL('../src/assets/mengxi/', import.meta.url),
  );
  const assets = [
    ...LEGACY_STREAM_1_ASSET_SPECS,
    ...LEGACY_STREAM_2_ASSET_SPECS,
  ];

  for (const asset of assets) {
    assert.equal(
      existsSync(path.join(assetRoot, asset.category, asset.filename)),
      true,
      `missing bundled asset: ${asset.category}/${asset.filename}`,
    );
  }
});

test('loads builtin images in catalog order with stable ids', async () => {
  class FakeImage {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    private value = '';

    get src() {
      return this.value;
    }

    set src(value: string) {
      this.value = value;
      queueMicrotask(() => this.onload?.());
    }
  }

  const sources = LEGACY_STREAM_1_ASSET_SPECS.map(asset => ({
    ...asset,
    src: `data:image/png;base64,${asset.id}`,
  }));
  const images = await loadBuiltinImageObjects(sources, () => new FakeImage());

  assert.deepEqual(
    images.map(image => image.id),
    LEGACY_STREAM_1_ASSET_SPECS.map(asset => asset.id),
  );
  assert.deepEqual(
    images.map(image => image.img.src),
    sources.map(asset => asset.src),
  );
});

test('reports which builtin image failed to load', async () => {
  class BrokenImage {
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onerror?.());
    }
  }

  const source = {
    ...LEGACY_STREAM_1_ASSET_SPECS[0],
    src: 'data:image/png;base64,broken',
  };

  await assert.rejects(
    loadBuiltinImageObjects([source], () => new BrokenImage()),
    /造/,
  );
});

test('initializes only empty streams and preserves user images', () => {
  const userImage = { id: 'user-image' };
  const builtinStream1 = [{ id: 'builtin-stream-1' }];
  const builtinStream2 = [{ id: 'builtin-stream-2' }];
  const preset = {
    name: 'default',
    stream1: { text: 'one', images: [userImage] },
    stream2: { text: 'two', images: [] as { id: string }[] },
  };

  const initialized = initializeEmptyBuiltinStreams(preset, {
    stream1: builtinStream1,
    stream2: builtinStream2,
  });

  assert.deepEqual(initialized.stream1.images, [userImage]);
  assert.deepEqual(initialized.stream2.images, builtinStream2);
  assert.notEqual(initialized.stream2.images, builtinStream2);
  assert.equal(initialized.name, 'default');
});
