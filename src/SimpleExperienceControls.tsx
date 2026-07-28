import { Eraser, Palette, Trash2, Undo2 } from 'lucide-react';

import type { ExperienceTool } from './simpleExperience.ts';

export type SimpleExperienceControlsProps = {
  tool: ExperienceTool;
  canUndo: boolean;
  hasPaths: boolean;
  isReady?: boolean;
  onToolChange: (tool: ExperienceTool) => void;
  onUndo: () => void;
  onReset: () => void;
};

const baseButtonClassName = [
  'flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3',
  'text-sm transition-colors focus-visible:outline-none focus-visible:ring-2',
  'focus-visible:ring-stone-700/40 disabled:cursor-not-allowed disabled:opacity-35',
].join(' ');

export function SimpleExperienceControls({
  tool,
  canUndo,
  hasPaths,
  isReady = true,
  onToolChange,
  onUndo,
  onReset,
}: SimpleExperienceControlsProps) {
  const isDrawing = tool === 'draw';
  const prompt = !isReady
    ? '正在载入素材，请稍候'
    : isDrawing
    ? '按住鼠标左键绘制路径，文字将沿路径流动'
    : '按住鼠标左键划过路径即可擦除';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex flex-col items-center gap-3 px-4 text-stone-800">
      <p className="rounded-full border border-stone-300/70 bg-white/75 px-4 py-2 text-center text-sm tracking-wide shadow-sm backdrop-blur-sm">
        {prompt}
      </p>
      <div
        aria-busy={!isReady}
        aria-label="绘制工具"
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-stone-400/35 bg-white/80 p-1.5 shadow-[0_8px_24px_rgba(61,49,36,0.14)] backdrop-blur-sm"
        role="toolbar"
      >
        <button
          aria-label="画线"
          aria-pressed={isDrawing}
          className={`${baseButtonClassName} ${isDrawing ? 'bg-stone-800 text-stone-50 shadow-sm' : 'hover:bg-stone-200/70'}`}
          disabled={!isReady}
          onClick={() => onToolChange('draw')}
          type="button"
        >
          <Palette aria-hidden="true" size={18} strokeWidth={1.6} />
          <span>画线</span>
        </button>
        <button
          aria-label="橡皮"
          aria-pressed={!isDrawing}
          className={`${baseButtonClassName} ${!isDrawing ? 'bg-[#9f4a3c] text-stone-50 shadow-sm' : 'hover:bg-stone-200/70'}`}
          disabled={!isReady}
          onClick={() => onToolChange('erase')}
          type="button"
        >
          <Eraser aria-hidden="true" size={18} strokeWidth={1.6} />
          <span>橡皮</span>
        </button>
        <span aria-hidden="true" className="h-6 w-px bg-stone-300/80" />
        <button
          aria-label="撤销"
          className={`${baseButtonClassName} hover:bg-stone-200/70`}
          disabled={!isReady || !canUndo}
          onClick={onUndo}
          type="button"
        >
          <Undo2 aria-hidden="true" size={18} strokeWidth={1.6} />
          <span>撤销</span>
        </button>
        <button
          aria-label="重置"
          className={`${baseButtonClassName} hover:bg-stone-200/70`}
          disabled={!isReady || !hasPaths}
          onClick={onReset}
          type="button"
        >
          <Trash2 aria-hidden="true" size={18} strokeWidth={1.6} />
          <span>重置</span>
        </button>
      </div>
    </div>
  );
}
