import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SimpleExperienceControls } from '../src/SimpleExperienceControls.tsx';

const renderControls = (overrides: Partial<ComponentProps<typeof SimpleExperienceControls>> = {}) =>
  renderToStaticMarkup(
    createElement(SimpleExperienceControls, {
      tool: 'draw',
      canUndo: false,
      hasPaths: false,
      onToolChange: () => undefined,
      onUndo: () => undefined,
      onReset: () => undefined,
      ...overrides,
    }),
  );

test('renders the four simple-experience controls and draw guidance', () => {
  const markup = renderControls();

  for (const label of ['画线', '橡皮', '撤销', '重置']) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /按住鼠标左键绘制路径，文字将沿路径流动/);
});

test('renders erase guidance and exposes the active tool with aria-pressed', () => {
  const markup = renderControls({ tool: 'erase' });

  assert.match(markup, /按住鼠标左键划过路径即可擦除/);
  assert.match(markup, /aria-label="画线"[^>]*aria-pressed="false"/);
  assert.match(markup, /aria-label="橡皮"[^>]*aria-pressed="true"/);
});

test('disables undo and reset until their corresponding history is available', () => {
  const unavailable = renderControls();
  const available = renderControls({ canUndo: true, hasPaths: true });

  assert.match(unavailable, /aria-label="撤销"[^>]*disabled=""/);
  assert.match(unavailable, /aria-label="重置"[^>]*disabled=""/);
  assert.doesNotMatch(available, /aria-label="撤销"[^>]*disabled=""/);
  assert.doesNotMatch(available, /aria-label="重置"[^>]*disabled=""/);
});
