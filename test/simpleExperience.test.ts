import assert from 'node:assert/strict';
import test from 'node:test';

import {
  distancePointToSegment,
  findHitPathIds,
  getGuideOpacity,
  isEditorMode,
  screenPixelsToLogical,
} from '../src/simpleExperience.ts';

test('recognizes only editor=1 as editor mode among URL query parameters', () => {
  assert.equal(isEditorMode('?theme=ink&editor=1&view=full'), true);
  assert.equal(isEditorMode('?editor=true'), false);
  assert.equal(isEditorMode('?editor=01'), false);
  assert.equal(isEditorMode('?theme=ink'), false);
});

test('converts fixed screen pixels to logical pixels using view scale', () => {
  assert.equal(screenPixelsToLogical(24, 0.5), 48);
  assert.equal(screenPixelsToLogical(24, 0), 24);
  assert.equal(screenPixelsToLogical(24, -1), 24);
});

test('fades a released guide line from full opacity to zero over two seconds', () => {
  assert.equal(getGuideOpacity(undefined, 5000), 1);
  assert.equal(getGuideOpacity(5000, 5000), 1);
  assert.equal(getGuideOpacity(5000, 6000), 0.5);
  assert.equal(getGuideOpacity(5000, 7000), 0);
  assert.equal(getGuideOpacity(5000, 9000), 0);
  assert.equal(getGuideOpacity(5000, 4000), 1);
});

test('measures distance to a degenerate line segment as a point', () => {
  assert.equal(
    distancePointToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }),
    5,
  );
});

test('hits a path through a non-first segment without returning its id twice', () => {
  const paths = [{
    id: 'zigzag',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }],
  }];

  assert.deepEqual(findHitPathIds(paths, { x: 15, y: 5 }, 1), ['zigzag']);
});

test('returns each hit path once and excludes paths already erased in a drag', () => {
  const paths = [
    { id: 'first', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    { id: 'second', points: [{ x: 0, y: 10 }, { x: 20, y: 10 }] },
    { id: 'miss', points: [{ x: 0, y: 40 }, { x: 20, y: 40 }] },
  ];

  assert.deepEqual(findHitPathIds(paths, { x: 10, y: 5 }, 6), ['first', 'second']);
  assert.deepEqual(
    findHitPathIds(paths, { x: 10, y: 5 }, 6, new Set(['first'])),
    ['second'],
  );
});

test('supports numeric path ids and excludes numeric ids already erased', () => {
  const paths = [
    { id: 7, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    { id: 8, points: [{ x: 0, y: 10 }, { x: 20, y: 10 }] },
  ];

  assert.deepEqual(findHitPathIds(paths, { x: 10, y: 5 }, 6), [7, 8]);
  assert.deepEqual(
    findHitPathIds(paths, { x: 10, y: 5 }, 6, new Set([7])),
    [8],
  );
});

test('returns a duplicate path id only once across separate path objects', () => {
  const paths = [
    { id: 'duplicate', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] },
    { id: 'duplicate', points: [{ x: 0, y: 10 }, { x: 20, y: 10 }] },
  ];

  assert.deepEqual(findHitPathIds(paths, { x: 10, y: 5 }, 6), ['duplicate']);
});
