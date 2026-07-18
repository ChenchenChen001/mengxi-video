import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { hydrateProjectData } from '../src/projectData.ts';

type FakeImage = {
  id: string;
  src: string;
};

const fakeImageLoader = (calls: string[]) => async (
  id: string,
  src: string,
): Promise<FakeImage> => {
  calls.push(id);
  return { id, src };
};

test('hydrates optimized project image ids from one registry', async () => {
  const calls: string[] = [];
  const project = {
    version: '1.1',
    imageRegistry: {
      one: 'data:image/png;base64,one',
      two: 'data:image/png;base64,two',
    },
    presets: [{
      stream1: { images: ['one', 'missing'] },
      stream2: { images: ['two'] },
    }],
    paths: [{
      stream1: { images: ['one'] },
      stream2: { images: ['two'] },
    }],
  };

  const hydrated = await hydrateProjectData(
    project,
    fakeImageLoader(calls),
  );

  assert.deepEqual(calls.sort(), ['one', 'two']);
  assert.deepEqual(
    hydrated.presets[0].stream1.images.map((image: FakeImage) => image.id),
    ['one'],
  );
  assert.deepEqual(
    hydrated.paths[0].stream2.images.map((image: FakeImage) => image.id),
    ['two'],
  );
  assert.equal(hydrated.paths[0].hidden, false);
  assert.deepEqual(hydrated.paths[0].s1Textures, []);
  assert.deepEqual(hydrated.paths[0].s2Textures, []);
});

test('deduplicates repeated legacy image objects before loading', async () => {
  const calls: string[] = [];
  const repeatedImage = {
    id: 'legacy-one',
    src: 'data:image/png;base64,legacy-one',
  };
  const project = {
    version: '1.0',
    presets: [{
      stream1: { images: [repeatedImage] },
      stream2: { images: [] },
    }],
    paths: [{
      stream1: { images: [repeatedImage] },
      stream2: { images: [] },
    }],
  };

  const hydrated = await hydrateProjectData(
    project,
    fakeImageLoader(calls),
  );

  assert.deepEqual(calls, ['legacy-one']);
  assert.equal(
    hydrated.presets[0].stream1.images[0],
    hydrated.paths[0].stream1.images[0],
  );
});

test('ships the optimized 0422 project with every image reference resolved', () => {
  const projectPath = fileURLToPath(new URL(
    '../src/assets/projects/0422复活-戚测-01.json',
    import.meta.url,
  ));

  assert.equal(existsSync(projectPath), true);
  assert.ok(statSync(projectPath).size < 12 * 1024 * 1024);

  const project = JSON.parse(readFileSync(projectPath, 'utf8'));
  const registryIds = new Set(Object.keys(project.imageRegistry ?? {}));
  const streams = [
    ...project.presets.flatMap((preset: any) => [
      preset.stream1,
      preset.stream2,
    ]),
    ...project.paths.flatMap((path: any) => [
      path.stream1,
      path.stream2,
    ]),
  ];
  const imageRefs = streams.flatMap((stream: any) => stream.images);

  assert.equal(project.version, '1.1');
  assert.equal(project.paths.length, 89);
  assert.equal(project.presets.length, 1);
  assert.equal(registryIds.size, 33);
  assert.equal(imageRefs.length, 2970);
  assert.equal(imageRefs.every((id: unknown) => typeof id === 'string'), true);
  assert.equal(imageRefs.every((id: string) => registryIds.has(id)), true);
  assert.equal(project.bgImageSrc.startsWith('data:image/'), true);
});
