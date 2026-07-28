import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Palette, Gauge, Waves, Type, ArrowLeftRight, ImagePlus, XCircle, Video, Square, Shuffle, Image as ImageIcon, Sparkles, Settings2, ChevronDown, ChevronUp, Library, Plus, CheckCircle2, Copy, Terminal, Activity, Download, Upload, Eye, EyeOff, Undo2, Redo2, MousePointer2, Droplets, Check, Grid, Contrast, Pause, Play, Dices, Eraser, RefreshCcw, Target, Scissors } from 'lucide-react';

import { loadLegacyBuiltinStreams } from './builtinAssets.ts';
import {
  initializeEmptyBuiltinStreams,
  type BuiltinStreams,
} from './builtinAssetCatalog.ts';
import builtinProjectUrl from './assets/projects/0422复活-戚测-01.json?url';
import {
  hydrateProjectData,
  type SerializedProjectData,
} from './projectData.ts';
import { SimpleExperienceControls } from './SimpleExperienceControls.tsx';
import {
  findHitPathIdsAlongSegment,
  getGuideOpacity,
  isEditorMode,
  screenPixelsToLogical,
  type ExperienceTool,
} from './simpleExperience.ts';

type Point = { x: number; y: number };

type FunctionalControlPoint = {
  id: string;
  cx: number; // Static center X
  cy: number; // Static center Y
  amplitude: number; // Ai
  frequency: number; // omega
  phase: number; // phi
  segmentLength: number; // Li
};

type CustomImage = {
  id: string;
  img: HTMLImageElement;
};

type StreamConfig = {
  text: string;
  images: CustomImage[];
  scale: number;
  rotation: number;
};

type EditorConfig = {
  stream1: StreamConfig;
  stream2: StreamConfig;
  textSpacing: number;
  spacingRandomness: number;
  useRandomRangeSpacing: boolean;
  randomSpacingMin: number;
  randomSpacingMax: number;
  textureRandomness: number;
  scatter: number;
  speed: number;
  collisionVolume: number;
  entryTransition: number;
  entryScale: number;
  exitScale: number;
  useSizeGradient: boolean;
  useOpacityGradient: boolean;
  minOpacity: number;
  isFunctional: boolean;
  isFixed: boolean;
  omega: number;
  functionalControlPoints: FunctionalControlPoint[];
  baselineStart?: Point;
  baselineEnd?: Point;
};

type PresetConfig = EditorConfig & {
  id: string;
  name: string;
  targetLines?: string;
};

type PathConfig = EditorConfig & {
  id: number;
  points: Point[];
  bezierPoints?: Point[]; // Control points for Bezier curve
  lengths: number[];
  totalLength: number;
  color: string;
  spawnAccumulator: number;
  currentSpacingTarget: number;
  nextStream1Index: number;
  nextStream2Index: number;
  nextTurn: 1 | 2;
  fixedParticlesSpawned: boolean;
  hidden: boolean;
  
  // Cached textures
  s1Textures: HTMLCanvasElement[];
  s2Textures: HTMLCanvasElement[];
};

type ShimmerBox = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type SpeedSelectionArea = {
  id: string;
  cells: string[];
  speedMultiplier: number;
};

type Particle = {
  id: number;
  pathId: number;
  distance: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  baseSize: number;
  offsetPhase: number;
  color: string;
  stream: 1 | 2 | 0; // 0 for normal dots
  textureIndex: number;
  pathAngle: number;
  isFixed: boolean;
};

const COLORS = [
  '#000000', // Black
  '#0088ff', // Blue
  '#ff0055', // Red
];

const DEFAULT_LOGICAL_WIDTH = 4096;
const DEFAULT_LOGICAL_HEIGHT = 2867;
const GRID_UNIT = 102;
const GRID_UNIT_X = 102;
const GRID_UNIT_Y = 102;
const SNAP_STEP = 102; // Snap to full grid units

const getBezierPoint = (points: Point[], t: number): Point => {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  
  let tempPoints = [...points];
  while (tempPoints.length > 1) {
    const nextPoints: Point[] = [];
    for (let i = 0; i < tempPoints.length - 1; i++) {
      nextPoints.push({
        x: (1 - t) * tempPoints[i].x + t * tempPoints[i + 1].x,
        y: (1 - t) * tempPoints[i].y + t * tempPoints[i + 1].y,
      });
    }
    tempPoints = nextPoints;
  }
  return tempPoints[0];
};

const smoothPath = (points: Point[], iterations = 2): Point[] => {
  if (points.length < 3) return points;
  let smoothed = [...points];
  for (let iter = 0; iter < iterations; iter++) {
    const next = [smoothed[0]];
    for (let i = 1; i < smoothed.length - 1; i++) {
      next.push({
        x: (smoothed[i - 1].x + smoothed[i].x + smoothed[i + 1].x) / 3,
        y: (smoothed[i - 1].y + smoothed[i].y + smoothed[i + 1].y) / 3,
      });
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }
  return smoothed;
};

const rebuildBezierPath = (p: PathConfig): PathConfig => {
  if (!p.bezierPoints) return p;
  
  const steps = 150; // Increased resolution
  const newPoints: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    newPoints.push(getBezierPoint(p.bezierPoints, i / steps));
  }
  
  const lengths = [0];
  let totalLength = 0;
  for (let i = 1; i < newPoints.length; i++) {
    const dx = newPoints[i].x - newPoints[i - 1].x;
    const dy = newPoints[i].y - newPoints[i - 1].y;
    totalLength += Math.sqrt(dx * dx + dy * dy);
    lengths.push(totalLength);
  }
  
  return { 
    ...p, 
    points: newPoints, 
    lengths: lengths, 
    totalLength: totalLength,
    fixedParticlesSpawned: false 
  };
};

// --- Math Utilities for Functional Paths ---

const linearRegression = (points: Point[]) => {
  const n = points.length;
  if (n < 2) return { m: 0, b: 0, isVertical: false, avgX: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }

  const denom = (n * sumXX - sumX * sumX);
  if (Math.abs(denom) < 0.001) {
    return { m: 0, b: 0, isVertical: true, avgX: sumX / n };
  }

  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return { m, b, isVertical: false, avgX: sumX / n };
};

// Cubic Spline Interpolation (Natural)
class CubicSpline {
  private x: number[] = [];
  private y: number[] = [];
  private a: number[] = [];
  private b: number[] = [];
  private c: number[] = [];
  private d: number[] = [];

  constructor(x: number[], y: number[]) {
    this.x = x;
    this.y = y;
    const n = x.length - 1;
    if (n < 1) return;

    const h = new Array(n);
    for (let i = 0; i < n; i++) h[i] = x[i + 1] - x[i];

    const alpha = new Array(n);
    for (let i = 1; i < n; i++) {
      alpha[i] = (3 / h[i]) * (y[i + 1] - y[i]) - (3 / h[i - 1]) * (y[i] - y[i - 1]);
    }

    const l = new Array(n + 1);
    const mu = new Array(n + 1);
    const z = new Array(n + 1);
    l[0] = 1; mu[0] = 0; z[0] = 0;

    for (let i = 1; i < n; i++) {
      l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
    }

    l[n] = 1; z[n] = 0; this.c = new Array(n + 1); this.c[n] = 0;
    this.b = new Array(n); this.a = [...y]; this.d = new Array(n);

    for (let j = n - 1; j >= 0; j--) {
      this.c[j] = z[j] - mu[j] * this.c[j + 1];
      this.b[j] = (y[j + 1] - y[j]) / h[j] - h[j] * (this.c[j + 1] + 2 * this.c[j]) / 3;
      this.d[j] = (this.c[j + 1] - this.c[j]) / (3 * h[j]);
    }
  }

  interpolate(val: number): number {
    let i = 0;
    let j = this.x.length - 1;
    while (j - i > 1) {
      const k = Math.floor((i + j) / 2);
      if (this.x[k] > val) j = k;
      else i = k;
    }
    const dx = val - this.x[i];
    return this.a[i] + this.b[i] * dx + this.c[i] * dx * dx + this.d[i] * dx * dx * dx;
  }
}


const generateTextImages = (text: string, color: string): HTMLCanvasElement[] => {
  const chars = Array.from(text).filter(c => c.trim() !== '');
  if (chars.length === 0) return [];
  
  return chars.map(char => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = 'bold 90px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000000';
      ctx.fillText(char, 60, 60);
    }
    return canvas;
  });
};

const imageToCanvas = (img: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0);
  }
  return canvas;
};

const getSafeTexture = (textures: HTMLCanvasElement[], index: number) => {
  if (!textures || textures.length === 0) return null;
  const len = textures.length;
  let i = Math.floor(index) % len;
  if (i < 0) i += len;
  const tex = textures[i];
  if (tex && (tex instanceof HTMLImageElement || tex instanceof HTMLCanvasElement)) {
    return tex;
  }
  return null;
};

const getPathPoint = (path: PathConfig, distance: number) => {
  if (path.lengths.length === 0) return { x: 0, y: 0, angle: 0 };
  if (distance <= 0) {
    const p0 = path.points[0];
    const p1 = path.points[1] || p0;
    return { x: p0.x, y: p0.y, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
  }
  if (distance >= path.totalLength) {
    const p1 = path.points[path.points.length - 1];
    const p0 = path.points[path.points.length - 2] || p1;
    return { x: p1.x, y: p1.y, angle: Math.atan2(p1.y - p0.y, p1.x - p0.x) };
  }
  
  let segmentIndex = 1;
  for (let j = 1; j < path.lengths.length; j++) {
    if (path.lengths[j] >= distance) {
      segmentIndex = j;
      break;
    }
  }
  const p0 = path.points[segmentIndex - 1];
  const p1 = path.points[segmentIndex];
  const l0 = path.lengths[segmentIndex - 1];
  const l1 = path.lengths[segmentIndex];
  const t = l1 === l0 ? 0 : (distance - l0) / (l1 - l0);
  
  const x = p0.x + (p1.x - p0.x) * t;
  const y = p0.y + (p1.y - p0.y) * t;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  
  return { x, y, angle };
};

const updateFunctionalPath = (path: PathConfig, time: number, isLiquifying: boolean) => {
  if (!path.isFunctional || path.functionalControlPoints.length < 2 || !path.baselineStart || !path.baselineEnd || isLiquifying) return;

  const controlPoints = path.functionalControlPoints.map(cp => {
    const mi = cp.amplitude * Math.sin(path.omega * time * cp.frequency + cp.phase);
    
    // Perpendicular direction to baseline
    const dx = path.baselineEnd!.x - path.baselineStart!.x;
    const dy = path.baselineEnd!.y - path.baselineStart!.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len;
    const ny = dx / len;
    
    const px = cp.cx + nx * mi;
    const py = cp.cy + ny * mi;

    // Parameter s along baseline
    const s = ((cp.cx - path.baselineStart!.x) * dx + (cp.cy - path.baselineStart!.y) * dy) / len;
    
    return { x: px, y: py, s };
  });

  // Sort by s to ensure monotonic parameter for spline
  controlPoints.sort((a, b) => a.s - b.s);

  const ss = controlPoints.map(p => p.s);
  const xs = controlPoints.map(p => p.x);
  const ys = controlPoints.map(p => p.y);

  try {
    const splineX = new CubicSpline(ss, xs);
    const splineY = new CubicSpline(ss, ys);

    const newPoints: Point[] = [];
    const steps = 100;
    const startS = ss[0];
    const endS = ss[ss.length - 1];
    for (let i = 0; i <= steps; i++) {
      const s = startS + (endS - startS) * (i / steps);
      newPoints.push({ x: splineX.interpolate(s), y: splineY.interpolate(s) });
    }

    path.points = newPoints;
    const lengths = [0];
    let totalLength = 0;
    for (let i = 1; i < newPoints.length; i++) {
      const dx = newPoints[i].x - newPoints[i - 1].x;
      const dy = newPoints[i].y - newPoints[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
      lengths.push(totalLength);
    }
    path.lengths = lengths;
    path.totalLength = totalLength;
  } catch (e) {
    // Fallback if spline fails (e.g. duplicate s values)
    console.error("Spline update failed", e);
  }
};

// Main application component for the interactive canvas app.
interface ParameterEditorProps {
  config: EditorConfig;
  updateStreamFn: (streamNum: 1 | 2, updates: Partial<StreamConfig>) => void;
  updateParamsFn: (updates: Partial<EditorConfig>) => void;
  handleImageUploadFn: (streamNum: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) => void;
  removeImageFn: (streamNum: 1 | 2, imageId: string) => void;
  restoreBuiltinImagesFn?: (streamNum: 1 | 2) => void;
  builtinImageCount?: Partial<Record<1 | 2, number>>;
  isPath?: boolean;
  showNotification: (text: string) => void;
  applyToAllFn?: (key: keyof EditorConfig, value: any) => void;
}

const ParameterEditor: React.FC<ParameterEditorProps> = ({
  config,
  updateStreamFn,
  updateParamsFn,
  handleImageUploadFn,
  removeImageFn,
  restoreBuiltinImagesFn,
  builtinImageCount,
  isPath = false,
  showNotification,
  applyToAllFn
}) => {
  const [allSelectedStream, setAllSelectedStream] = useState<1 | 2 | null>(null);

  const ApplyToAllButton = ({ keyName, value }: { keyName: keyof EditorConfig, value: any }) => {
    if (!applyToAllFn) return null;
    return (
      <button 
        onClick={() => applyToAllFn(keyName, value)}
        className="text-[10px] text-blue-500 hover:text-blue-700 bg-blue-50 px-1 py-0.5 rounded border border-blue-100 flex items-center gap-1 transition-colors ml-1"
        title="应用此参数到所有线条"
      >
        <Copy size={10} /> 全域
      </button>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent, streamNum: 1 | 2) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setAllSelectedStream(streamNum);
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && allSelectedStream === streamNum) {
      updateStreamFn(streamNum, { images: [] });
      setAllSelectedStream(null);
      showNotification(`已清空窗口 ${streamNum} 的所有贴图`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Stream 1 */}
      <div className="flex flex-col gap-2 p-3 rounded-xl border border-black/10 bg-black/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-black/50">窗口 1</span>
            <ApplyToAllButton keyName="stream1" value={config.stream1} />
          </div>
          <div className="flex items-center gap-1">
            {restoreBuiltinImagesFn && (builtinImageCount?.[1] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  restoreBuiltinImagesFn(1);
                  showNotification(`已恢复窗口 1 的 ${builtinImageCount?.[1]} 张内置素材`);
                }}
                className="text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1 text-[10px] font-medium bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100"
                title="恢复旧工程对应的内置单字素材"
              >
                <RefreshCcw size={12}/> 内置 {builtinImageCount?.[1]}
              </button>
            )}
            {config.stream1.images.length > 0 && (
              <button 
                onClick={() => {
                  updateStreamFn(1, { images: [] });
                  showNotification('已清空窗口 1 的所有贴图');
                }}
                className="text-red-500 hover:text-red-700 p-1 rounded-md transition-colors flex items-center gap-1 text-[10px] bg-red-50 px-1.5 py-0.5 border border-red-100"
                title="一键删除所有贴图"
              >
                <Trash2 size={12}/> 清空
              </button>
            )}
            <label className="text-blue-500 hover:text-blue-600 transition-colors flex items-center gap-1 text-xs font-medium bg-blue-50 px-2 py-1 rounded border border-blue-100 cursor-pointer">
              <ImagePlus size={14}/> 上传贴图
              <input type="file" multiple onChange={e => handleImageUploadFn(1, e)} accept="image/*" className="hidden" />
            </label>
          </div>
        </div>
        
        {config.stream1.images.length > 0 ? (
          <div 
            className={`flex flex-wrap gap-2 bg-white p-2 rounded border max-h-24 overflow-y-auto outline-none transition-all ${allSelectedStream === 1 ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-black/10'}`}
            tabIndex={0}
            onKeyDown={e => handleKeyDown(e, 1)}
            onFocus={() => setAllSelectedStream(null)}
            onClick={() => setAllSelectedStream(null)}
          >
            {config.stream1.images.map(imgObj => (
              <div key={imgObj.id} className={`relative group p-0.5 rounded ${allSelectedStream === 1 ? 'bg-blue-100' : ''}`}>
                <img src={imgObj.img.src} className="h-8 w-auto object-contain rounded border border-black/10 transition-transform group-hover:scale-105" alt="S1" />
                <button onClick={(e) => { e.stopPropagation(); removeImageFn(1, imgObj.id); }} className="absolute -top-2 -right-2 text-red-500 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-sm transition-opacity z-10"><XCircle size={14}/></button>
              </div>
            ))}
            <div className="w-full text-[8px] text-black/20 text-center mt-1">
              点击此处可 Cmd+A 全选
            </div>
          </div>
        ) : (
          <input 
            type="text" 
            value={config.stream1.text} 
            onChange={e => updateStreamFn(1, { text: e.target.value })} 
            className="bg-transparent outline-none w-full text-sm font-medium border-b border-black/10 focus:border-blue-500 pb-1" 
            placeholder="输入文字..." 
          />
        )}

        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between items-center text-xs text-black/60">
            <span>大小 (Scale)</span>
            <div className="flex items-center gap-2">
              <input type="range" min="0.5" max="1.5" step="0.01" value={config.stream1.scale || 1} onChange={e => updateStreamFn(1, { scale: Number(e.target.value) })} className="w-20 accent-blue-500" />
              <input 
                type="number" 
                step="0.01" 
                value={config.stream1.scale || 1} 
                onChange={e => updateStreamFn(1, { scale: Number(e.target.value) })} 
                onFocus={e => e.target.select()}
                className="w-12 bg-white border border-black/10 rounded px-1 text-[10px] outline-none" 
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-xs text-black/60">
            <span>旋转 (Rot°)</span>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="360" step="1" value={config.stream1.rotation || 0} onChange={e => updateStreamFn(1, { rotation: Number(e.target.value) })} className="w-20 accent-blue-500" />
              <input 
                type="number" 
                value={config.stream1.rotation || 0} 
                onChange={e => updateStreamFn(1, { rotation: Number(e.target.value) })} 
                onFocus={e => e.target.select()}
                className="w-12 bg-white border border-black/10 rounded px-1 text-[10px] outline-none" 
              />
            </div>
          </div>
        </div>
      </div>

      {/* Stream 2 */}
      <div className="flex flex-col gap-2 p-3 rounded-xl border border-black/10 bg-black/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-black/50">窗口 2</span>
            <ApplyToAllButton keyName="stream2" value={config.stream2} />
          </div>
          <div className="flex items-center gap-1">
            {restoreBuiltinImagesFn && (builtinImageCount?.[2] ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  restoreBuiltinImagesFn(2);
                  showNotification(`已恢复窗口 2 的 ${builtinImageCount?.[2]} 张内置素材`);
                }}
                className="text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1 text-[10px] font-medium bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100"
                title="恢复旧工程对应的内置双字素材"
              >
                <RefreshCcw size={12}/> 内置 {builtinImageCount?.[2]}
              </button>
            )}
            {config.stream2.images.length > 0 && (
              <button 
                onClick={() => {
                  updateStreamFn(2, { images: [] });
                  showNotification('已清空窗口 2 的所有贴图');
                }}
                className="text-red-500 hover:text-red-700 p-1 rounded-md transition-colors flex items-center gap-1 text-[10px] bg-red-50 px-1.5 py-0.5 border border-red-100"
                title="一键删除所有贴图"
              >
                <Trash2 size={12}/> 清空
              </button>
            )}
            <label className="text-blue-500 hover:text-blue-600 transition-colors flex items-center gap-1 text-xs font-medium bg-blue-50 px-2 py-1 rounded border border-blue-100 cursor-pointer">
              <ImagePlus size={14}/> 上传贴图
              <input type="file" multiple onChange={e => handleImageUploadFn(2, e)} accept="image/*" className="hidden" />
            </label>
          </div>
        </div>
        
        {config.stream2.images.length > 0 ? (
          <div 
            className={`flex flex-wrap gap-2 bg-white p-2 rounded border max-h-24 overflow-y-auto outline-none transition-all ${allSelectedStream === 2 ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-black/10'}`}
            tabIndex={0}
            onKeyDown={e => handleKeyDown(e, 2)}
            onFocus={() => setAllSelectedStream(null)}
            onClick={() => setAllSelectedStream(null)}
          >
            {config.stream2.images.map(imgObj => (
              <div key={imgObj.id} className={`relative group p-0.5 rounded ${allSelectedStream === 2 ? 'bg-blue-100' : ''}`}>
                <img src={imgObj.img.src} className="h-8 w-auto object-contain rounded border border-black/10 transition-transform group-hover:scale-105" alt="S2" />
                <button onClick={(e) => { e.stopPropagation(); removeImageFn(2, imgObj.id); }} className="absolute -top-2 -right-2 text-red-500 bg-white rounded-full opacity-0 group-hover:opacity-100 shadow-sm transition-opacity z-10"><XCircle size={14}/></button>
              </div>
            ))}
            <div className="w-full text-[8px] text-black/20 text-center mt-1">
              点击此处可 Cmd+A 全选
            </div>
          </div>
        ) : (
          <input 
            type="text" 
            value={config.stream2.text} 
            onChange={e => updateStreamFn(2, { text: e.target.value })} 
            className="bg-transparent outline-none w-full text-sm font-medium border-b border-black/10 focus:border-blue-500 pb-1" 
            placeholder="输入文字..." 
          />
        )}

        <div className="flex flex-col gap-1 mt-1">
          <div className="flex justify-between items-center text-xs text-black/60">
            <span>大小 (Scale)</span>
            <div className="flex items-center gap-2">
              <input type="range" min="0.5" max="1.5" step="0.01" value={config.stream2.scale || 1} onChange={e => updateStreamFn(2, { scale: Number(e.target.value) })} className="w-20 accent-blue-500" />
              <input 
                type="number" 
                step="0.01" 
                value={config.stream2.scale || 1} 
                onChange={e => updateStreamFn(2, { scale: Number(e.target.value) })} 
                onFocus={e => e.target.select()}
                className="w-12 bg-white border border-black/10 rounded px-1 text-[10px] outline-none" 
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-xs text-black/60">
            <span>旋转 (Rot°)</span>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="360" step="1" value={config.stream2.rotation || 0} onChange={e => updateStreamFn(2, { rotation: Number(e.target.value) })} className="w-20 accent-blue-500" />
              <input 
                type="number" 
                value={config.stream2.rotation || 0} 
                onChange={e => updateStreamFn(2, { rotation: Number(e.target.value) })} 
                onFocus={e => e.target.select()}
                className="w-12 bg-white border border-black/10 rounded px-1 text-[10px] outline-none" 
              />
            </div>
          </div>
        </div>
      </div>

      <div className="w-full h-px bg-black/10 my-1" />

      {/* Path Adjustments */}
      <div className="flex flex-col gap-3 text-sm text-black/70 px-1">
        <div className="flex justify-between items-center" title="文字之间的基础距离 (px)">
          <div className="flex items-center gap-2"><ArrowLeftRight size={16}/> 间距 (px) <ApplyToAllButton keyName="textSpacing" value={config.textSpacing} /></div>
          <div className="flex items-center gap-2">
            <input type="range" min="20" max="100" value={config.textSpacing || 100} onChange={e => updateParamsFn({textSpacing: Number(e.target.value)})} className="w-24 accent-blue-500" />
            <input 
              type="number" 
              value={config.textSpacing || 100} 
              onChange={e => updateParamsFn({textSpacing: Number(e.target.value)})} 
              onFocus={e => e.target.select()}
              className="w-14 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-2 bg-black/5 rounded group">
          <div className="flex justify-between items-center" title="开启后字符间距将在自定义范围之间随机产生">
            <div className="flex items-center gap-2"><Shuffle size={16}/> 间距随机范围 <ApplyToAllButton keyName="useRandomRangeSpacing" value={config.useRandomRangeSpacing} /></div>
            <button 
              onClick={() => updateParamsFn({useRandomRangeSpacing: !config.useRandomRangeSpacing})}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.useRandomRangeSpacing ? 'bg-blue-500' : 'bg-black/10'}`}
            >
              <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${config.useRandomRangeSpacing ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          
          {config.useRandomRangeSpacing && (
            <div className="flex items-center gap-2 pl-6">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-black/50">Min:</span>
                <input 
                  type="number" 
                  value={config.randomSpacingMin || 35} 
                  onChange={(e) => updateParamsFn({randomSpacingMin: Number(e.target.value)})} 
                  onFocus={e => e.target.select()}
                  className="w-12 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-black/50">Max:</span>
                <input 
                  type="number" 
                  value={config.randomSpacingMax || 50} 
                  onChange={(e) => updateParamsFn({randomSpacingMax: Number(e.target.value)})} 
                  onFocus={e => e.target.select()}
                  className="w-12 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
                />
              </div>
              <div className="flex gap-1 ml-auto">
                <ApplyToAllButton keyName="randomSpacingMin" value={config.randomSpacingMin} />
                <ApplyToAllButton keyName="randomSpacingMax" value={config.randomSpacingMax} />
              </div>
            </div>
          )}
        </div>

        {isPath && (
          <div className="flex justify-between items-center" title="贴图出现的随机程度 (0-100%)">
            <div className="flex items-center gap-2"><Dices size={16}/> 贴图随机 (%) <ApplyToAllButton keyName="textureRandomness" value={config.textureRandomness} /></div>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" step="1" value={(config.textureRandomness || 0) * 100} onChange={(e) => updateParamsFn({textureRandomness: Number(e.target.value) / 100} as any)} className="w-24 accent-blue-500" />
              <input 
                type="number" 
                value={Math.round((config.textureRandomness || 0) * 100)} 
                onChange={(e) => updateParamsFn({textureRandomness: Number(e.target.value) / 100} as any)} 
                onFocus={e => e.target.select()}
                className="w-14 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
              />
            </div>
          </div>
        )}

        <div className="flex justify-between items-center" title="文字的上下波动幅度 (px)">
          <div className="flex items-center gap-2"><Waves size={16}/> 脱位 (px) <ApplyToAllButton keyName="scatter" value={config.scatter} /></div>
          <div className="flex items-center gap-2">
            <input type="range" min="0" max="500" step="1" value={config.scatter || 0} onChange={(e) => updateParamsFn({scatter: Number(e.target.value)})} className="w-24 accent-blue-500" />
            <input 
              type="number" 
              value={config.scatter || 0} 
              onChange={(e) => updateParamsFn({scatter: Number(e.target.value)})} 
              onFocus={e => e.target.select()}
              className="w-14 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
            />
          </div>
        </div>
        <div className="flex justify-between items-center" title="流线的基础流速 (px/s，假设60fps)">
          <div className="flex items-center gap-2">
            <Gauge size={16}/> 
            <div className="flex flex-col">
              <span className="text-xs">流速 (Speed)</span>
              <span className="text-[10px] text-blue-500/70 font-mono">当前: {Math.round((config.speed || 0) * 60)} px/s</span>
            </div>
            <ApplyToAllButton keyName="speed" value={config.speed} />
          </div>
          <div className="flex items-center gap-2">
            <input type="range" min="50" max="150" value={Math.round((config.speed || 0) * 60)} onChange={(e) => updateParamsFn({speed: Number(e.target.value) / 60})} className="w-24 accent-blue-500" />
            <input 
              type="number" 
              value={Math.round((config.speed || 0) * 60)} 
              onChange={(e) => updateParamsFn({speed: Number(e.target.value) / 60})} 
              onFocus={e => e.target.select()}
              className="w-14 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
            />
          </div>
        </div>
        <div className="flex justify-between items-center" title="粒子的碰撞体积倍率">
          <div className="flex items-center gap-2"><Activity size={16}/> 碰撞体积 <ApplyToAllButton keyName="collisionVolume" value={config.collisionVolume} /></div>
          <div className="flex items-center gap-2">
            <input type="range" min="0.1" max="5" step="0.1" value={config.collisionVolume || 1} onChange={(e) => updateParamsFn({collisionVolume: Number(e.target.value)})} className="w-24 accent-blue-500" />
            <input 
              type="number" 
              step="0.1" 
              value={config.collisionVolume || 1} 
              onChange={(e) => updateParamsFn({collisionVolume: Number(e.target.value)})} 
              onFocus={e => e.target.select()}
              className="w-14 bg-white border border-black/10 rounded px-1 text-xs outline-none" 
            />
          </div>
        </div>
        <div className="flex justify-between items-center" title="固定文本模式">
          <div className="flex items-center gap-2"><Square size={16}/> 固定文本 <ApplyToAllButton keyName="isFixed" value={config.isFixed} /></div>
          <button
            onClick={() => updateParamsFn({ isFixed: !config.isFixed })}
            className={`w-10 h-5 rounded-full transition-colors relative ${config.isFixed ? 'bg-blue-500' : 'bg-black/10'}`}
          >
            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${config.isFixed ? 'left-6' : 'left-1'}`} />
          </button>
        </div>

        <div className="w-full h-px bg-black/10 my-1" />

        <div className="flex flex-col gap-2 p-2 bg-black/5 rounded group">
          <div className="flex justify-between items-center" title="字符尺寸渐入渐出">
            <div className="flex items-center gap-2"><Contrast size={16} className="text-blue-500"/> 尺寸渐变 <ApplyToAllButton keyName="useSizeGradient" value={config.useSizeGradient} /></div>
            <button 
              onClick={() => updateParamsFn({useSizeGradient: !config.useSizeGradient})}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.useSizeGradient ? 'bg-blue-500' : 'bg-black/10'}`}
            >
              <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${config.useSizeGradient ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className="flex justify-between items-center" title="字符透明度渐入渐出">
            <div className="flex items-center gap-2"><Eye size={16} className="text-blue-500"/> 透明度渐变 <ApplyToAllButton keyName="useOpacityGradient" value={config.useOpacityGradient} /></div>
            <button 
              onClick={() => updateParamsFn({useOpacityGradient: !config.useOpacityGradient})}
              className={`w-10 h-5 rounded-full transition-colors relative ${config.useOpacityGradient ? 'bg-blue-500' : 'bg-black/10'}`}
            >
              <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${config.useOpacityGradient ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const editorMode = isEditorMode(window.location.search);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputBgRef = useRef<HTMLInputElement>(null);
  const projectImportStartedRef = useRef(false);
  const manualProjectImportStartedRef = useRef(false);
  
  const [drawingMode, setDrawingMode] = useState<'path' | 'lasso' | 'invert' | 'grid' | 'inspect' | 'speed_select' | 'scissors' | 'edit' | 'bezier'>('path');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);
  const [liquifyMode, setLiquifyMode] = useState(false);
  const [liquifyPathId, setLiquifyPathId] = useState<number | null>(null);
  const [liquifyConfig, setLiquifyConfig] = useState({
    brushSize: 100,
    mode: 'push' as 'push' | 'pinch' | 'expand',
    pressure: 0.5
  });
  const [selectedParticleId, setSelectedParticleId] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDraggingPath, setIsDraggingPath] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  const [logicalWidth, setLogicalWidth] = useState(DEFAULT_LOGICAL_WIDTH);
  const [logicalHeight, setLogicalHeight] = useState(DEFAULT_LOGICAL_HEIGHT);
  const logicalWidthRef = useRef(DEFAULT_LOGICAL_WIDTH);
  const logicalHeightRef = useRef(DEFAULT_LOGICAL_HEIGHT);
  const [colorIndex, setColorIndex] = useState(0);
  const [showPaths, setShowPaths] = useState(editorMode);
  const [showGrid, setShowGrid] = useState(editorMode);
  const [simpleTool, setSimpleTool] = useState<ExperienceTool>('draw');
  const [simpleExperienceReady, setSimpleExperienceReady] = useState(editorMode);
  const [shimmerBrushSize, setShimmerBrushSize] = useState(1);
  const [invertBrushSize, setInvertBrushSize] = useState(1);
  const [snapStep, setSnapStep] = useState(0.5);
  const [viewScale, setViewScale] = useState(1);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [uiVisible, setUiVisible] = useState(true);
  const [isInverted, setIsInverted] = useState(false);
  const [shimmerCells, setShimmerCells] = useState<Set<string>>(new Set());
  const [invertCells, setInvertCells] = useState<Set<string>>(new Set());
  const [gridPoints, setGridPoints] = useState<{x: number, y: number, id: string}[]>([]);
  const [gridBoxes, setGridBoxes] = useState<{x1: number, y1: number, x2: number, y2: number, id: string}[]>([]);
  const [gridSelectionStart, setGridSelectionStart] = useState<Point | null>(null);
  const [activeBezierPoint, setActiveBezierPoint] = useState<{ pathId: number; index: number } | null>(null);

  // Speed Selection States
  const [speedSelectionAreas, setSpeedSelectionAreas] = useState<SpeedSelectionArea[]>([]);
  const [currentSpeedSelectionCells, setCurrentSpeedSelectionCells] = useState<Set<string>>(new Set());
  const [isSpeedEraser, setIsSpeedEraser] = useState(false);
  const [selectedSpeedAreaId, setSelectedSpeedAreaId] = useState<string | null>(null);
  
  const [isPaused, setIsPaused] = useState(false);

  const [notification, setNotification] = useState<{ text: string; visible: boolean }>({ text: '', visible: false });
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Undo/Redo State
  const [undoStack, setUndoStack] = useState<any[]>([]);
  const [redoStack, setRedoStack] = useState<any[]>([]);

  const showNotification = (text: string) => {
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    setNotification({ text, visible: true });
    notificationTimerRef.current = setTimeout(() => {
      setNotification(prev => ({ ...prev, visible: false }));
    }, 3000);
  };

  const saveStateToUndo = () => {
    const state = {
      paths: paths.map(p => ({ ...p, s1Textures: [], s2Textures: [] })),
      presets: [...presets],
      bgScale,
      bgRotation,
      showBgImage,
      speedMultiplier,
      shimmerSpeed,
      shimmerCells: new Set(shimmerCells),
      invertCells: new Set(invertCells),
      invertBrushSize,
      speedSelectionAreas: [...speedSelectionAreas],
      gridPoints: [...gridPoints],
      gridBoxes: [...gridBoxes],
    };
    setUndoStack(prev => [...prev, state].slice(-30));
    setRedoStack([]);
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    
    const currentState = {
      paths: paths.map(p => ({ ...p, s1Textures: [], s2Textures: [] })),
      presets: [...presets],
      bgScale,
      bgRotation,
      showBgImage,
      speedMultiplier,
      shimmerSpeed,
      shimmerCells: new Set(shimmerCells),
      invertCells: new Set(invertCells),
      invertBrushSize,
      speedSelectionAreas: [...speedSelectionAreas],
      gridPoints: [...gridPoints],
      gridBoxes: [...gridBoxes],
    };
    setRedoStack(prev => [...prev, currentState].slice(-30));

    const prevState = undoStack[undoStack.length - 1];
    
    setPaths(prevState.paths);
    setPresets(prevState.presets);
    setBgScale(prevState.bgScale);
    setBgRotation(prevState.bgRotation);
    setShowBgImage(prevState.showBgImage ?? true);
    setSpeedMultiplier(prevState.speedMultiplier);
    setShimmerSpeed(prevState.shimmerSpeed);
    setShimmerCells(new Set(prevState.shimmerCells));
    setInvertCells(new Set(prevState.invertCells ?? []));
    setInvertBrushSize(prevState.invertBrushSize ?? 1);
    setSpeedSelectionAreas(prevState.speedSelectionAreas ?? []);
    setGridPoints(prevState.gridPoints);
    setGridBoxes(prevState.gridBoxes);
    
    setUndoStack(prev => prev.slice(0, -1));
    showNotification('撤回一步');
  };

  const redo = () => {
    if (redoStack.length === 0) return;

    const currentState = {
      paths: paths.map(p => ({ ...p, s1Textures: [], s2Textures: [] })),
      presets: [...presets],
      bgScale,
      bgRotation,
      showBgImage,
      speedMultiplier,
      shimmerSpeed,
      shimmerCells: new Set(shimmerCells),
      invertCells: new Set(invertCells),
      invertBrushSize,
      speedSelectionAreas: [...speedSelectionAreas],
      gridPoints: [...gridPoints],
      gridBoxes: [...gridBoxes],
    };
    setUndoStack(prev => [...prev, currentState].slice(-30));

    const nextState = redoStack[redoStack.length - 1];

    setPaths(nextState.paths);
    setPresets(nextState.presets);
    setBgScale(nextState.bgScale);
    setBgRotation(nextState.bgRotation);
    setShowBgImage(nextState.showBgImage ?? true);
    setSpeedMultiplier(nextState.speedMultiplier);
    setShimmerSpeed(nextState.shimmerSpeed);
    setShimmerCells(new Set(nextState.shimmerCells));
    setInvertCells(new Set(nextState.invertCells ?? []));
    setInvertBrushSize(nextState.invertBrushSize ?? 1);
    setSpeedSelectionAreas(nextState.speedSelectionAreas ?? []);
    setGridPoints(nextState.gridPoints);
    setGridBoxes(nextState.gridBoxes);

    setRedoStack(prev => prev.slice(0, -1));
    showNotification('重做一步');
  };
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Background Image
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgScale, setBgScale] = useState(1.0);
  const [bgRotation, setBgRotation] = useState(0);
  const [showBgImage, setShowBgImage] = useState(true);

  // Global Controls
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  
  // Shimmer Controls
  const [shimmerSpeed, setShimmerSpeed] = useState(5); // Hz

  // Presets State
  const defaultPreset: PresetConfig = {
    id: 'default-preset',
    name: '默认预设',
    targetLines: '',
    stream1: { text: "良版印之六善", images: [], scale: 1.5, rotation: 0 },
    stream2: { text: "本有良势造微", images: [], scale: 1.5, rotation: 0 },
    textSpacing: 102,
    spacingRandomness: 0,
    useRandomRangeSpacing: false,
    randomSpacingMin: 35,
    randomSpacingMax: 50,
    textureRandomness: 0.5 + Math.random() * 0.49,
    scatter: 0,
    speed: 2,
    collisionVolume: 1.0,
    entryTransition: 150,
    entryScale: 0.3, // New paths use 30%
    exitScale: 0.3,  // New paths use 30%
    useSizeGradient: true,
    useOpacityGradient: true,
    minOpacity: 0.5,
    isFunctional: false,
    isFixed: false,
    functionalControlPoints: [],
    omega: 1.0,
  };
  const [presets, setPresets] = useState<PresetConfig[]>([defaultPreset]);
  const [activePresetId, setActivePresetId] = useState<string>('default-preset');
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null);
  const [builtinStreams, setBuiltinStreams] = useState<BuiltinStreams<CustomImage>>({
    stream1: [],
    stream2: [],
  });

  useEffect(() => {
    let cancelled = false;

    loadLegacyBuiltinStreams()
      .then(streams => {
        if (cancelled) return;

        setBuiltinStreams(streams);
        if (projectImportStartedRef.current) return;

        setPresets(previousPresets => previousPresets.map(preset => (
          preset.id === 'default-preset'
            ? initializeEmptyBuiltinStreams(preset, streams)
            : preset
        )));
      })
      .catch(error => {
        console.error('Failed to initialize builtin assets', error);
        showNotification('内置素材加载失败，请刷新页面重试');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Paths State
  const [paths, setPaths] = useState<PathConfig[]>([]);
  const [expandedPathId, setExpandedPathId] = useState<number | null>(null);
  
  const pathsRef = useRef<PathConfig[]>([]);
  const shimmerCellsRef = useRef<Set<string>>(new Set());
  const invertCellsRef = useRef<Set<string>>(new Set());
  const currentSpeedSelectionCellsRef = useRef<Set<string>>(new Set());
  const speedSelectionAreasRef = useRef<SpeedSelectionArea[]>([]);
  const selectedSpeedAreaIdRef = useRef<string | null>(null);
  const isPausedRef = useRef(false);
  const snapStepRef = useRef(0.5);
  const currentPathRef = useRef<Point[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  
  // Refs for real-time animation loop
  const colorIndexRef = useRef(0);
  const speedMultiplierRef = useRef(1);
  const isRecordingRef = useRef(false);
  
  const shimmerSpeedRef = useRef(5);

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const bgScaleRef = useRef(1.0);
  const bgRotationRef = useRef(0);
  const showBgImageRef = useRef(true);

  const viewScaleRef = useRef(1);
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const showPathsRef = useRef(editorMode);
  const showGridRef = useRef(editorMode);
  const simpleToolRef = useRef<ExperienceTool>('draw');
  const simpleReleasedAtRef = useRef<Map<number, number>>(new Map());
  const simpleErasePointerActiveRef = useRef(false);
  const simpleEraseUndoSavedRef = useRef(false);
  const simpleErasedPathIdsRef = useRef<Set<string | number>>(new Set());
  const simpleEraseLastPointRef = useRef<Point | null>(null);
  const drawingModeRef = useRef<'path' | 'lasso' | 'invert' | 'grid' | 'inspect' | 'speed_select' | 'scissors' | 'edit' | 'bezier'>('path');
  const selectedParticleIdRef = useRef<number | null>(null);
  const expandedPathIdRef = useRef<number | null>(null);
  const gridPointsRef = useRef<{x: number, y: number, id: string}[]>([]);
  const gridBoxesRef = useRef<{x1: number, y1: number, x2: number, y2: number, id: string}[]>([]);
  const gridSelectionStartRef = useRef<Point | null>(null);

  const selectionModeRef = useRef(false);
  const selectedPathIdRef = useRef<number | null>(null);
  const liquifyModeRef = useRef(false);
  const liquifyPathIdRef = useRef<number | null>(null);
  const liquifyConfigRef = useRef({ brushSize: 100, mode: 'push' as 'push' | 'pinch' | 'expand', pressure: 0.5 });

  const pointerDownPosRef = useRef<Point>({ x: 0, y: 0 });
  const mousePosRef = useRef<Point>({ x: 0, y: 0 });

  const resetUI = () => {
    setSelectedPathId(null);
    setSelectionMode(false);
    setLiquifyMode(false);
    setDrawingMode('path');
    setSelectedParticleId(null);
    setGridSelectionStart(null);
  };

  // Sync state to refs for real-time updates
  useEffect(() => { colorIndexRef.current = colorIndex; }, [colorIndex]);
  useEffect(() => { speedMultiplierRef.current = speedMultiplier; }, [speedMultiplier]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { drawingModeRef.current = drawingMode; }, [drawingMode]);
  useEffect(() => { showPathsRef.current = showPaths; }, [showPaths]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { simpleToolRef.current = simpleTool; }, [simpleTool]);
  useEffect(() => { logicalWidthRef.current = logicalWidth; }, [logicalWidth]);
  useEffect(() => { logicalHeightRef.current = logicalHeight; }, [logicalHeight]);
  useEffect(() => { selectedParticleIdRef.current = selectedParticleId; }, [selectedParticleId]);
  useEffect(() => { expandedPathIdRef.current = expandedPathId; }, [expandedPathId]);
  useEffect(() => { selectionModeRef.current = selectionMode; }, [selectionMode]);
  useEffect(() => { selectedPathIdRef.current = selectedPathId; }, [selectedPathId]);
  useEffect(() => { liquifyModeRef.current = liquifyMode; }, [liquifyMode]);
  useEffect(() => { liquifyPathIdRef.current = liquifyPathId; }, [liquifyPathId]);
  useEffect(() => { liquifyConfigRef.current = liquifyConfig; }, [liquifyConfig]);
  
  // Force update for console in inspect mode
  const [, setTick] = useState(0);
  useEffect(() => {
    if (drawingMode === 'inspect' && selectedParticleId) {
      const interval = setInterval(() => setTick(t => t + 1), 50); // 20fps update
      return () => clearInterval(interval);
    }
  }, [drawingMode, selectedParticleId]);

  useEffect(() => { shimmerCellsRef.current = shimmerCells; }, [shimmerCells]);
  useEffect(() => { invertCellsRef.current = invertCells; }, [invertCells]);
  useEffect(() => { currentSpeedSelectionCellsRef.current = currentSpeedSelectionCells; }, [currentSpeedSelectionCells]);
  useEffect(() => { speedSelectionAreasRef.current = speedSelectionAreas; }, [speedSelectionAreas]);
  useEffect(() => { selectedSpeedAreaIdRef.current = selectedSpeedAreaId; }, [selectedSpeedAreaId]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { snapStepRef.current = snapStep; }, [snapStep]);
  useEffect(() => { gridPointsRef.current = gridPoints; }, [gridPoints]);
  useEffect(() => { gridBoxesRef.current = gridBoxes; }, [gridBoxes]);
  useEffect(() => { gridSelectionStartRef.current = gridSelectionStart; }, [gridSelectionStart]);
  
  useEffect(() => { shimmerSpeedRef.current = shimmerSpeed; }, [shimmerSpeed]);

  useEffect(() => { bgImageRef.current = bgImage; }, [bgImage]);
  useEffect(() => { bgScaleRef.current = bgScale; }, [bgScale]);
  useEffect(() => { bgRotationRef.current = bgRotation; }, [bgRotation]);
  useEffect(() => { showBgImageRef.current = showBgImage; }, [showBgImage]);

  useEffect(() => { 
    viewScaleRef.current = viewScale; 
    viewOffsetRef.current = viewOffset;
  }, [viewScale, viewOffset]);

  // Sync paths state to ref and update textures
  useEffect(() => {
    pathsRef.current = paths.map(p => {
      // Generate textures for this path
      const s1Tex = p.stream1.images.length > 0 
        ? p.stream1.images.map(img => imageToCanvas(img.img))
        : generateTextImages(p.stream1.text, p.color);
        
      const s2Tex = p.stream2.images.length > 0 
        ? p.stream2.images.map(img => imageToCanvas(img.img))
        : generateTextImages(p.stream2.text, p.color);

      // Preserve existing state from ref if it exists
      const existingPath = pathsRef.current.find(ep => ep.id === p.id);
      
      return {
        ...p,
        s1Textures: s1Tex,
        s2Textures: s2Tex,
        spawnAccumulator: existingPath ? existingPath.spawnAccumulator : p.spawnAccumulator,
        currentSpacingTarget: existingPath ? existingPath.currentSpacingTarget : p.currentSpacingTarget,
        nextStream1Index: existingPath ? existingPath.nextStream1Index : p.nextStream1Index,
        nextStream2Index: existingPath ? existingPath.nextStream2Index : p.nextStream2Index,
        nextTurn: existingPath ? existingPath.nextTurn : p.nextTurn,
      };
    });
  }, [paths]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const resize = () => {
      const container = canvas.parentElement;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = w;
      canvas.height = h;
      
      let safeW = w;
      let safeH = h;
      let safeOffsetX = 0;
      let safeOffsetY = 0;

      if (editorMode && uiVisible) {
        const sideWidth = 340; // 320px panel + 20px gap
        const topHeight = 100; // Toolbar height
        
        // If screen is wide enough to show sidebars and still have space
        if (w > sideWidth * 2.5) {
          safeW = w - sideWidth * 2;
          safeOffsetX = sideWidth;
        }
        
        // Always avoid top bar
        safeH = h - topHeight;
        safeOffsetY = topHeight;
      }

      // Calculate scale to fit logical canvas into safe area
      const scaleX = safeW / logicalWidthRef.current;
      const scaleY = safeH / logicalHeightRef.current;
      const scale = Math.min(scaleX, scaleY) * 0.98; 
      setViewScale(scale);
      
      const offsetX = editorMode
        ? GRID_UNIT
        : (safeW - logicalWidthRef.current * scale) / 2;
      const offsetY = safeOffsetY + (safeH - logicalHeightRef.current * scale) / 2;
      setViewOffset({ x: offsetX, y: offsetY });

      ctx.fillStyle = '#f3f4f6'; // bg-gray-100
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const time = Date.now() * 0.001; // Smooth seconds

      const hasAnyTextPaths = pathsRef.current.some(p => p.s1Textures.length > 0 || p.s2Textures.length > 0);
      
      // Main Canvas Render
      // Desk background
      ctx.fillStyle = '#f3f4f6'; // bg-gray-100
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Recording Canvas Render (if active)
      let rCtx: CanvasRenderingContext2D | null = null;
      if (isRecordingRef.current && recordingCanvasRef.current) {
        rCtx = recordingCanvasRef.current.getContext('2d', { alpha: false });
        if (rCtx) {
          // 4K Quality: Scale logical content to 3840x2160
          const targetW = 3840;
          const targetH = 2160;
          const scaleX = targetW / logicalWidthRef.current;
          const scaleY = targetH / logicalHeightRef.current;
          const scale = Math.min(scaleX, scaleY); // Maintain aspect ratio
          
          rCtx.fillStyle = '#ffffff';
          rCtx.fillRect(0, 0, targetW, targetH);
          rCtx.save();
          // Center the logical canvas on the 4K output
          rCtx.translate((targetW - logicalWidthRef.current * scale) / 2, (targetH - logicalHeightRef.current * scale) / 2);
          rCtx.scale(scale, scale);
        }
      }

      ctx.save();
      ctx.translate(viewOffsetRef.current.x, viewOffsetRef.current.y);
      ctx.scale(viewScaleRef.current, viewScaleRef.current);

      // Paper background
      ctx.fillStyle = hasAnyTextPaths ? 'transparent' : '#ffffff';
      ctx.fillRect(0, 0, logicalWidthRef.current, logicalHeightRef.current);

      // Draw Logical Canvas Border (Main only)
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.lineWidth = 1 / viewScaleRef.current;
      ctx.strokeRect(0, 0, logicalWidthRef.current, logicalHeightRef.current);

      // Draw Background Image
      const drawBg = (c: CanvasRenderingContext2D) => {
        const bgImg = bgImageRef.current;
        const isDrawable = bgImg && (bgImg instanceof HTMLImageElement || bgImg instanceof HTMLCanvasElement);
        if (isDrawable && showBgImageRef.current) {
          const img = bgImg as CanvasImageSource;
          const scale = bgScaleRef.current;
          const rot = bgRotationRef.current * (Math.PI / 180);
          c.save();
          c.translate(logicalWidthRef.current / 2, logicalHeightRef.current / 2);
          c.rotate(rot);
          c.scale(scale, scale);
          c.drawImage(img, -(img as any).width / 2, -(img as any).height / 2);
          c.restore();
        }
      };
      drawBg(ctx);
      if (rCtx) drawBg(rCtx);

      // Draw Grid (On top of background)
      if (showGridRef.current) {
        const drawGrid = (c: CanvasRenderingContext2D, s: number) => {
          c.beginPath();
          c.strokeStyle = 'rgba(0, 0, 0, 0.3)';
          c.lineWidth = 1 / s;
          for (let x = 0; x <= logicalWidthRef.current; x += GRID_UNIT) {
            c.moveTo(x, 0); c.lineTo(x, logicalHeightRef.current);
          }
          for (let y = 0; y <= logicalHeightRef.current; y += GRID_UNIT) {
            c.moveTo(0, y); c.lineTo(logicalWidthRef.current, y);
          }
          c.stroke();
        };
        drawGrid(ctx, viewScaleRef.current);
        if (rCtx) drawGrid(rCtx, 1);
      }

      // Draw Shimmer Boxes (Drawn in drawGridContent)

      // Draw current path
      const currentPath = currentPathRef.current;
      if (currentPath.length > 1) {
        const drawCurrent = (c: CanvasRenderingContext2D, s: number) => {
          c.beginPath();
          c.moveTo(currentPath[0].x, currentPath[0].y);
          for (let i = 1; i < currentPath.length; i++) {
            c.lineTo(currentPath[i].x, currentPath[i].y);
          }
          if (drawingModeRef.current === 'lasso') {
            c.strokeStyle = 'rgba(0, 136, 255, 0.5)';
            c.setLineDash([5 / s, 5 / s]);
            c.lineWidth = 2 / s;
            c.stroke();
            c.setLineDash([]);
          } else {
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.strokeStyle = COLORS[colorIndexRef.current];
            c.lineWidth = 2 / s;
            c.stroke();
          }
        };
        drawCurrent(ctx, viewScaleRef.current);
        if (rCtx) drawCurrent(rCtx, 1);
      }

      if (!editorMode) {
        const drawSimpleGuides = (c: CanvasRenderingContext2D, s: number) => {
          pathsRef.current.forEach(path => {
            if (path.hidden || path.points.length < 2) return;

            const opacity = simpleToolRef.current === 'erase'
              ? 1
              : getGuideOpacity(
                  simpleReleasedAtRef.current.get(path.id),
                  Date.now(),
                );
            if (opacity <= 0) return;

            c.save();
            c.beginPath();
            c.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) {
              c.lineTo(path.points[i].x, path.points[i].y);
            }
            c.lineCap = 'round';
            c.lineJoin = 'round';
            c.strokeStyle = simpleToolRef.current === 'erase'
              ? 'rgba(159, 74, 60, 0.42)'
              : 'rgba(75, 64, 52, 0.32)';
            c.globalAlpha = opacity;
            c.lineWidth = (simpleToolRef.current === 'erase' ? 3 : 2) / s;
            c.stroke();
            c.restore();
          });
        };
        drawSimpleGuides(ctx, viewScaleRef.current);
      }

      // Draw saved paths
      if (showPathsRef.current) {
        const drawSaved = (c: CanvasRenderingContext2D, s: number) => {
          pathsRef.current.forEach((path, idx) => {
            if (path.hidden) return;
            if (path.points.length < 2) return;
            c.beginPath();
            c.moveTo(path.points[0].x, path.points[0].y);
            for (let i = 1; i < path.points.length; i++) {
              c.lineTo(path.points[i].x, path.points[i].y);
            }
            
            // Highlight selected path
            if (path.id === selectedPathIdRef.current || (liquifyModeRef.current && path.id === liquifyPathIdRef.current)) {
              c.strokeStyle = '#10b981'; // Green
              c.lineWidth = 4 / s;
              c.stroke();
              c.strokeStyle = '#ffffff';
              c.lineWidth = 1 / s;
              c.stroke();

              // Draw path number at the start
              const start = path.points[0];
              const label = `${idx + 1}`;
              c.font = `bold ${12/s}px sans-serif`;
              const metrics = c.measureText(label);
              const padding = 4 / s;
              const boxWidth = metrics.width + padding * 2;
              const boxHeight = 16 / s;
              
              c.fillStyle = '#10b981';
              c.beginPath();
              c.roundRect(start.x - boxWidth/2, start.y - boxHeight - 10/s, boxWidth, boxHeight, 4/s);
              c.fill();
              
              c.fillStyle = '#ffffff';
              c.textAlign = 'center';
              c.textBaseline = 'middle';
              c.fillText(label, start.x, start.y - boxHeight/2 - 10/s);
              c.textAlign = 'start';
              c.textBaseline = 'alphabetic';
            } else {
              c.strokeStyle = path.color + '20';
              c.lineWidth = 1.5 / s;
              c.stroke();
            }
          });
        };
        drawSaved(ctx, viewScaleRef.current);
        if (rCtx) drawSaved(rCtx, 1);
      } else {
        // Even if paths are hidden, draw the selected path outline in blue
        const drawSelectedOutline = (c: CanvasRenderingContext2D, s: number) => {
          pathsRef.current.forEach((path, idx) => {
            if (path.hidden) return;
            if (path.id === selectedPathIdRef.current || (liquifyModeRef.current && path.id === liquifyPathIdRef.current)) {
              if (path.points.length < 2) return;
              c.beginPath();
              c.moveTo(path.points[0].x, path.points[0].y);
              for (let i = 1; i < path.points.length; i++) {
                c.lineTo(path.points[i].x, path.points[i].y);
              }
              c.strokeStyle = '#10b981'; // Green
              c.lineWidth = 4 / s;
              c.stroke();
              c.strokeStyle = '#ffffff';
              c.lineWidth = 1 / s;
              c.stroke();

              // Draw path number at the start
              const start = path.points[0];
              const label = `${idx + 1}`;
              c.font = `bold ${12/s}px sans-serif`;
              const metrics = c.measureText(label);
              const padding = 4 / s;
              const boxWidth = metrics.width + padding * 2;
              const boxHeight = 16 / s;
              
              c.fillStyle = '#10b981';
              c.beginPath();
              c.roundRect(start.x - boxWidth/2, start.y - boxHeight - 10/s, boxWidth, boxHeight, 4/s);
              c.fill();
              
              c.fillStyle = '#ffffff';
              c.textAlign = 'center';
              c.textBaseline = 'middle';
              c.fillText(label, start.x, start.y - boxHeight/2 - 10/s);
              c.textAlign = 'start';
              c.textBaseline = 'alphabetic';
            }
          });
        };
        drawSelectedOutline(ctx, viewScaleRef.current);
      }

      // Draw Grid Points and Boxes
      if (drawingModeRef.current === 'grid' || drawingModeRef.current === 'lasso' || drawingModeRef.current === 'invert' || drawingModeRef.current === 'speed_select' || selectionModeRef.current) {
        const drawGridContent = (c: CanvasRenderingContext2D, s: number) => {
          // Draw Grid Boxes
          gridBoxesRef.current.forEach(box => {
            const x = Math.min(box.x1, box.x2);
            const y = Math.min(box.y1, box.y2);
            const w = Math.abs(box.x1 - box.x2);
            const h = Math.abs(box.y1 - box.y2);
            
            c.fillStyle = 'rgba(59, 130, 246, 0.1)';
            c.fillRect(x, y, w, h);
            c.strokeStyle = '#3b82f6';
            c.lineWidth = 2 / s;
            c.strokeRect(x, y, w, h);
            
            // Draw side info
            const fontSize = 10 / s;
            c.font = `${fontSize}px sans-serif`;
            c.fillStyle = '#000000';
            c.fillText(`L:${x} T:${y} R:${x+w} B:${y+h}`, x, y - 5 / s);
          });

          // Draw Shimmer Cells (only if in lasso mode or selection mode)
          if (drawingModeRef.current === 'lasso' || selectionModeRef.current) {
            const currentSnapStep = snapStepRef.current;
            const stepX = currentSnapStep * GRID_UNIT_X;
            const stepY = currentSnapStep * GRID_UNIT_Y;
            
            c.fillStyle = 'rgba(255, 136, 0, 0.2)';
            shimmerCellsRef.current.forEach(cellKey => {
              const [cx, cy] = cellKey.split(',').map(Number);
              c.fillRect(cx, cy, stepX, stepY);
            });
          }

          // Draw Invert Cells (only if in invert mode or selection mode)
          if (drawingModeRef.current === 'invert' || selectionModeRef.current) {
            const currentSnapStep = snapStepRef.current;
            const stepX = currentSnapStep * GRID_UNIT_X;
            const stepY = currentSnapStep * GRID_UNIT_Y;
            
            c.fillStyle = 'rgba(0, 0, 0, 0.2)';
            invertCellsRef.current.forEach(cellKey => {
              const [cx, cy] = cellKey.split(',').map(Number);
              c.fillRect(cx, cy, stepX, stepY);
            });
          }

          // Draw Speed Selection Areas (only if in speed_select mode or selection mode)
          if (drawingModeRef.current === 'speed_select' || selectionModeRef.current) {
            const currentSnapStep = snapStepRef.current;
            const stepX = currentSnapStep * GRID_UNIT_X;
            const stepY = currentSnapStep * GRID_UNIT_Y;
            
            // Draw confirmed areas
            speedSelectionAreasRef.current.forEach(area => {
              const isSelected = area.id === selectedSpeedAreaIdRef.current;
              c.fillStyle = isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)';
              
              // Draw cells
              area.cells.forEach(cellKey => {
                const [cx, cy] = cellKey.split(',').map(Number);
                c.fillRect(cx, cy, stepX, stepY);
              });
              
              c.strokeStyle = '#3b82f6';
              c.lineWidth = isSelected ? 2 / s : 1 / s;
              area.cells.forEach(cellKey => {
                const [cx, cy] = cellKey.split(',').map(Number);
                const neighbors = [
                  `${(cx - stepX).toFixed(1)},${cy.toFixed(1)}`,
                  `${(cx + stepX).toFixed(1)},${cy.toFixed(1)}`,
                  `${cx.toFixed(1)},${(cy - stepY).toFixed(1)}`,
                  `${cx.toFixed(1)},${(cy + stepY).toFixed(1)}`
                ];
                const areaCells = new Set(area.cells);
                if (!areaCells.has(neighbors[0])) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy + stepY); c.stroke(); }
                if (!areaCells.has(neighbors[1])) { c.beginPath(); c.moveTo(cx + stepX, cy); c.lineTo(cx + stepX, cy + stepY); c.stroke(); }
                if (!areaCells.has(neighbors[2])) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + stepX, cy); c.stroke(); }
                if (!areaCells.has(neighbors[3])) { c.beginPath(); c.moveTo(cx, cy + stepY); c.lineTo(cx + stepX, cy + stepY); c.stroke(); }
              });
            });

            // Draw current drawing cells
            if (drawingModeRef.current === 'speed_select') {
              c.fillStyle = 'rgba(59, 130, 246, 0.4)';
              currentSpeedSelectionCellsRef.current.forEach(cellKey => {
                const [cx, cy] = cellKey.split(',').map(Number);
                c.fillRect(cx, cy, stepX, stepY);
              });
            }
          }

          // Draw Selection Box
          if (gridSelectionStartRef.current) {
            const start = gridSelectionStartRef.current;
            c.beginPath();
            c.arc(start.x, start.y, 8 / s, 0, Math.PI * 2);
            c.fillStyle = 'rgba(239, 68, 68, 0.5)';
            c.fill();
          }

          // Draw Grid Points
          gridPointsRef.current.forEach(p => {
            c.beginPath();
            c.arc(p.x, p.y, 6 / s, 0, Math.PI * 2);
            c.fillStyle = '#3b82f6';
            c.fill();
            c.strokeStyle = '#ffffff';
            c.lineWidth = 2 / s;
            c.stroke();

            const label = `(${p.x}, ${p.y})`;
            const fontSize = 12 / s;
            c.font = `bold ${fontSize}px sans-serif`;
            const textWidth = c.measureText(label).width;
            c.fillStyle = 'rgba(255, 255, 255, 0.8)';
            c.fillRect(p.x + 10 / s, p.y - 25 / s, textWidth + 10 / s, 20 / s);
            c.fillStyle = '#000000';
            c.fillText(label, p.x + 15 / s, p.y - 10 / s);
          });
        };
        drawGridContent(ctx, viewScaleRef.current);
        if (rCtx) drawGridContent(rCtx, 1);
      }

      // Draw Bezier Control Points
      if (drawingModeRef.current === 'bezier' || drawingModeRef.current === 'edit') {
        const drawBezierControls = (c: CanvasRenderingContext2D, s: number) => {
          pathsRef.current.forEach(path => {
            if (path.hidden) return;
            if (path.bezierPoints) {
              // Draw lines between control points
              c.beginPath();
              c.setLineDash([5 / s, 5 / s]);
              c.strokeStyle = 'rgba(0, 0, 0, 0.2)';
              c.lineWidth = 1 / s;
              c.moveTo(path.bezierPoints[0].x, path.bezierPoints[0].y);
              for (let i = 1; i < path.bezierPoints.length; i++) {
                c.lineTo(path.bezierPoints[i].x, path.bezierPoints[i].y);
              }
              c.stroke();
              c.setLineDash([]);

              // Draw control points
              path.bezierPoints.forEach((bp, idx) => {
                c.beginPath();
                c.arc(bp.x, bp.y, 8 / s, 0, Math.PI * 2);
                c.fillStyle = idx === 0 || idx === path.bezierPoints.length - 1 ? '#3b82f6' : '#ffffff';
                c.fill();
                c.strokeStyle = '#3b82f6';
                c.lineWidth = 2 / s;
                c.stroke();
                
                // Highlight active point
                if (activeBezierPoint && activeBezierPoint.pathId === path.id && activeBezierPoint.index === idx) {
                  c.beginPath();
                  c.arc(bp.x, bp.y, 12 / s, 0, Math.PI * 2);
                  c.strokeStyle = '#ef4444';
                  c.lineWidth = 2 / s;
                  c.stroke();
                }
              });
            }
          });
        };
        drawBezierControls(ctx, viewScaleRef.current);

      }

      // Physics & Particle Drawing
      
      // Update functional paths
      pathsRef.current.forEach(path => {
        if (path.hidden) return;
        if (path.isFunctional) {
          const isLiquifyingThis = liquifyModeRef.current && path.id === liquifyPathIdRef.current;
          updateFunctionalPath(path, time, isLiquifyingThis);
        }
      });

      // Spawn particles
      pathsRef.current.forEach((path) => {
        if (path.hidden) return;
        const hasS1 = path.s1Textures.length > 0;
        const hasS2 = path.s2Textures.length > 0;
        
        if (path.isFixed) {
          if (!path.fixedParticlesSpawned && (hasS1 || hasS2)) {
            // Clear existing particles for this path first
            particlesRef.current = particlesRef.current.filter(p => p.pathId !== path.id);
            
            let currentDist = 0;
            while (currentDist < path.totalLength) {
              let stream: 1 | 2 = 1;
              let texIndex = 0;
              
              if (hasS1 && hasS2) {
                if (path.nextTurn === 1) {
                  stream = 1;
                  if (Math.random() < path.textureRandomness) {
                    texIndex = Math.floor(Math.random() * path.s1Textures.length);
                  } else {
                    texIndex = path.nextStream1Index;
                  }
                  path.nextStream1Index = (path.nextStream1Index + 1) % path.s1Textures.length;
                  path.nextTurn = 2;
                } else {
                  stream = 2;
                  if (Math.random() < path.textureRandomness) {
                    texIndex = Math.floor(Math.random() * path.s2Textures.length);
                  } else {
                    texIndex = path.nextStream2Index;
                  }
                  path.nextStream2Index = (path.nextStream2Index + 1) % path.s2Textures.length;
                  path.nextTurn = 1;
                }
              } else if (hasS1) {
                stream = 1;
                if (Math.random() < path.textureRandomness) {
                  texIndex = Math.floor(Math.random() * path.s1Textures.length);
                } else {
                  texIndex = path.nextStream1Index;
                }
                path.nextStream1Index = (path.nextStream1Index + 1) % path.s1Textures.length;
              } else if (hasS2) {
                stream = 2;
                if (Math.random() < path.textureRandomness) {
                  texIndex = Math.floor(Math.random() * path.s2Textures.length);
                } else {
                  texIndex = path.nextStream2Index;
                }
                path.nextStream2Index = (path.nextStream2Index + 1) % path.s2Textures.length;
              }
              
              const pt = getPathPoint(path, currentDist);
              const offset = (Math.random() - 0.5) * 2 * path.scatter;
              const nx = -Math.sin(pt.angle);
              const ny = Math.cos(pt.angle);
              
              particlesRef.current.push({
                id: Math.random(),
                pathId: path.id,
                distance: currentDist,
                x: pt.x + nx * offset,
                y: pt.y + ny * offset,
                vx: 0,
                vy: 0,
                radius: 10,
                speed: path.speed,
                baseSize: 3,
                offsetPhase: Math.random() * Math.PI * 2,
                color: path.color,
                stream: stream,
                textureIndex: texIndex,
                pathAngle: pt.angle,
                isFixed: true
              });
              
              // Calculate spacing
              let effectiveSpacing;
              if (path.useRandomRangeSpacing) {
                const min = path.randomSpacingMin || 35;
                const max = path.randomSpacingMax || 50;
                effectiveSpacing = min + Math.random() * (max - min);
              } else {
                const rand = (Math.random() - 0.5) * 2;
                effectiveSpacing = Math.max(10, path.textSpacing + rand * path.spacingRandomness);
              }
              currentDist += effectiveSpacing;
            }
            path.fixedParticlesSpawned = true;
          }
          return; // Skip normal spawning for fixed paths
        } else {
          // If it was fixed but now isn't, reset the flag and particles
          if (path.fixedParticlesSpawned) {
            path.fixedParticlesSpawned = false;
            particlesRef.current.forEach(p => {
              if (p.pathId === path.id) p.isFixed = false;
            });
          }
        }

        if (hasS1 || hasS2) {
          const pathSpeed = path.speed;
          
          path.spawnAccumulator += pathSpeed * speedMultiplierRef.current;
          
          while (path.spawnAccumulator >= path.currentSpacingTarget) {
            let stream: 1 | 2 = 1;
            let texIndex = 0;
            
            // Interleave logic
            if (hasS1 && hasS2) {
              if (path.nextTurn === 1) {
                stream = 1;
                if (Math.random() < path.textureRandomness) {
                  texIndex = Math.floor(Math.random() * path.s1Textures.length);
                } else {
                  texIndex = path.nextStream1Index;
                }
                path.nextStream1Index = (path.nextStream1Index + 1) % path.s1Textures.length;
                path.nextTurn = 2;
              } else {
                stream = 2;
                if (Math.random() < path.textureRandomness) {
                  texIndex = Math.floor(Math.random() * path.s2Textures.length);
                } else {
                  texIndex = path.nextStream2Index;
                }
                path.nextStream2Index = (path.nextStream2Index + 1) % path.s2Textures.length;
                path.nextTurn = 1;
              }
            } else if (hasS1) {
              stream = 1;
              if (Math.random() < path.textureRandomness) {
                texIndex = Math.floor(Math.random() * path.s1Textures.length);
              } else {
                texIndex = path.nextStream1Index;
              }
              path.nextStream1Index = (path.nextStream1Index + 1) % path.s1Textures.length;
            } else if (hasS2) {
              stream = 2;
              if (Math.random() < path.textureRandomness) {
                texIndex = Math.floor(Math.random() * path.s2Textures.length);
              } else {
                texIndex = path.nextStream2Index;
              }
              path.nextStream2Index = (path.nextStream2Index + 1) % path.s2Textures.length;
            }
            
            const startDist = path.spawnAccumulator - path.currentSpacingTarget;
            const pt = getPathPoint(path, startDist);
            
            // Scatter is now absolute pixels
            const offset = (Math.random() - 0.5) * 2 * path.scatter;
            const nx = -Math.sin(pt.angle);
            const ny = Math.cos(pt.angle);
            
            const initialX = pt.x + nx * offset;
            const initialY = pt.y + ny * offset;

            particlesRef.current.push({
              id: Math.random(),
              pathId: path.id,
              distance: startDist,
              x: initialX,
              y: initialY,
              vx: 0,
              vy: 0,
              radius: 10, // Will be updated dynamically in physics loop
              speed: path.speed,
              baseSize: 3,
              offsetPhase: Math.random() * Math.PI * 2,
              color: path.color,
              stream: stream,
              textureIndex: texIndex,
              pathAngle: pt.angle,
              isFixed: false
            });
            
            path.spawnAccumulator -= path.currentSpacingTarget;
            
            // Calculate next spacing target
            if (path.useRandomRangeSpacing) {
              const min = path.randomSpacingMin || 35;
              const max = path.randomSpacingMax || 50;
              path.currentSpacingTarget = min + Math.random() * (max - min);
            } else {
              const rand = (Math.random() - 0.5) * 2; // -1 to 1
              path.currentSpacingTarget = Math.max(10, path.textSpacing + rand * path.spacingRandomness);
            }
          }
        } else {
          // Normal chaotic flow mode
          const spawnChance = Math.min(path.totalLength / 1000, 0.8) * speedMultiplierRef.current;
          if (Math.random() < spawnChance) {
            const pt = getPathPoint(path, 0);
            particlesRef.current.push({
              id: Math.random(),
              pathId: path.id,
              distance: 0,
              x: pt.x,
              y: pt.y,
              vx: 0,
              vy: 0,
              radius: 5,
              speed: (2 + Math.random() * 4) * (path.speed || 1),
              baseSize: 1.5 + Math.random() * 2.5,
              offsetPhase: Math.random() * Math.PI * 2,
              color: path.color,
              stream: 0,
              textureIndex: 0,
              pathAngle: pt.angle,
              isFixed: false
            });
          }
        }
      });

      // Physics Update: Target tracking & Dynamic Properties
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        const path = pathsRef.current.find(pt => pt.id === p.pathId);
        
        if (!path) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        const isLiquifyingThisPath = liquifyModeRef.current && path.id === liquifyPathIdRef.current;

        if (!isLiquifyingThisPath && !p.isFixed && !isPausedRef.current) {
          let currentSpeedMultiplier = speedMultiplierRef.current;
          
          // Apply multipliers from speed selection areas
          for (const area of speedSelectionAreasRef.current) {
            const currentSnapStep = snapStepRef.current;
            const stepX = currentSnapStep * GRID_UNIT_X;
            const stepY = currentSnapStep * GRID_UNIT_Y;
            
            const snappedX = Math.floor(p.x / stepX) * stepX;
            const snappedY = Math.floor(p.y / stepY) * stepY;
            const key = `${snappedX.toFixed(1)},${snappedY.toFixed(1)}`;
            
            if (area.cells.includes(key)) {
              currentSpeedMultiplier *= area.speedMultiplier;
              break; // Only apply the first matching area's multiplier
            }
          }

          p.distance += p.speed * currentSpeedMultiplier;
        }
        
        if (!p.isFixed && p.distance > path.totalLength) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        
        // Update dynamic radius based on real-time scale and texture
        let currentScale = 1;
        let tex: HTMLCanvasElement | null = null;

        if (p.stream === 1) {
          currentScale = path.stream1.scale;
          const textures = path.s1Textures;
          if (textures.length > 0) tex = textures[p.textureIndex % textures.length];
        } else if (p.stream === 2) {
          currentScale = path.stream2.scale;
          const textures = path.s2Textures;
          if (textures.length > 0) tex = textures[p.textureIndex % textures.length];
        }

        // Apply transition scale (fade in/out)
        const transitionDist = 150;
        let transitionScale = 1;
        if (p.distance < transitionDist) {
          // Entry: 50% -> 100%
          transitionScale = 0.5 + 0.5 * (p.distance / transitionDist);
        } else if (p.distance > path.totalLength - transitionDist) {
          // Exit: 100% -> 40%
          transitionScale = 0.4 + 0.6 * ((path.totalLength - p.distance) / transitionDist);
        }
        transitionScale = Math.max(0.4, Math.min(1, transitionScale));
        currentScale *= transitionScale;

        if (p.stream !== 0 && tex) {
          const aspectRatio = tex.width / tex.height;
          const drawSize = 3 * currentScale * 12;
          p.radius = Math.max(drawSize * aspectRatio, drawSize) * 0.4 * (path.collisionVolume || 1.0); // Collision radius
        } else {
          p.radius = p.baseSize * 2.5 * (path.collisionVolume || 1.0) * transitionScale;
        }

        // Target tracking
        const pt = getPathPoint(path, p.distance);
        let targetX = pt.x;
        let targetY = pt.y;
        
        const scatterMult = path.scatter / 15;
        const offset = Math.sin(p.offsetPhase + p.distance * 0.04) * (15 * scatterMult);
        const nx = -Math.sin(pt.angle);
        const ny = Math.cos(pt.angle);
        
        targetX += nx * offset;
        targetY += ny * offset;
        p.pathAngle = pt.angle;
        
        if (!isLiquifyingThisPath) {
          // Spring force towards target
          const springK = 0.1;
          p.vx += (targetX - p.x) * springK;
          p.vy += (targetY - p.y) * springK;
        } else {
          // Keep particle at its target position during liquify
          p.x = targetX;
          p.y = targetY;
          p.vx = 0;
          p.vy = 0;
        }
      }

      // Physics Update: Collisions
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i];
          const p2 = particles[j];
          
          let dx = p2.x - p1.x;
          let dy = p2.y - p1.y;
          const distSq = dx * dx + dy * dy;
          const minDist = p1.radius + p2.radius;
          
          if (distSq < minDist * minDist) {
            let dist = Math.sqrt(distSq);
            if (dist === 0) {
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              dist = 0.1;
            }
            
            const overlap = minDist - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            
            // Soft collision force
            const force = overlap * 0.15;
            
            p1.vx -= nx * force;
            p1.vy -= ny * force;
            p2.vx += nx * force;
            p2.vy += ny * force;
          }
        }
      }

      // Apply velocity and Draw
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const path = pathsRef.current.find(pt => pt.id === p.pathId);
        if (!path || path.hidden) continue;
        
        // Damping
        p.vx *= 0.8;
        p.vy *= 0.8;
        
        p.x += p.vx;
        p.y += p.vy;

        let currentScale = 1;
        let currentRot = 0;
        let tex: HTMLCanvasElement | null = null;

        if (p.stream === 1) {
          currentScale = path.stream1.scale;
          currentRot = path.stream1.rotation;
          tex = getSafeTexture(path.s1Textures, p.textureIndex);
        } else if (p.stream === 2) {
          currentScale = path.stream2.scale;
          currentRot = path.stream2.rotation;
          tex = getSafeTexture(path.s2Textures, p.textureIndex);
        }

        // Apply transition scale (fade in/out)
        const transitionDistDraw = path.entryTransition || 150;
        const useSize = path.useSizeGradient ?? true;
        const useOpacity = path.useOpacityGradient ?? true;
        const entryScale = path.entryScale ?? 0.3; 
        const exitScale = path.exitScale ?? 0.3;  
        const minOpa = path.minOpacity ?? 0.5;   
        
        let transitionScale = 1;
        let alpha = 1;

        // Smooth easing function (easeInOutQuad equivalent for smoother look)
        const ease = (t: number) => t * t * (3 - 2 * t);

        if (p.distance < transitionDistDraw) {
          // Entry
          const progress = ease(p.distance / transitionDistDraw);
          if (useSize) {
            transitionScale = entryScale + (1 - entryScale) * progress;
          }
          if (useOpacity && !path.isFixed) {
            alpha = minOpa + (1 - minOpa) * progress;
          }
        } else if (p.distance > path.totalLength - transitionDistDraw) {
          // Exit
          const progress = ease((path.totalLength - p.distance) / transitionDistDraw);
          if (useSize) {
            transitionScale = exitScale + (1 - exitScale) * progress;
          }
          if (useOpacity && !path.isFixed) {
            alpha = minOpa + (1 - minOpa) * progress;
          }
        }
        
        transitionScale = Math.max(0, Math.min(1, transitionScale));
        if (!path.isFixed && useOpacity) {
          alpha = Math.max(minOpa, Math.min(1, alpha));
        } else {
          alpha = 1;
        }
        
        currentScale *= transitionScale;

        // --- SHIMMER LOGIC ---
        const sSpeed = shimmerSpeedRef.current;
        
        // Check if inside any shimmer cell
        const currentSnapStep = snapStepRef.current;
        const stepX = currentSnapStep * GRID_UNIT_X;
        const stepY = currentSnapStep * GRID_UNIT_Y;
        
        const cellX = Math.floor(p.x / stepX) * stepX;
        const cellY = Math.floor(p.y / stepY) * stepY;
        const cellKey = `${cellX.toFixed(1)},${cellY.toFixed(1)}`;
        const isInsideShimmer = shimmerCellsRef.current.has(cellKey);

        let sX = 1;
        let offX = 0;
        let offY = 0;
        let rotJitter = 0;
        // alpha is already set above, but shimmer might override it if we want
        
        if (isInsideShimmer) {
          const pSeed = p.id * 1000;
          
          // Randomly change texture index over time
          const shimmerTexIndex = Math.floor((time * sSpeed) + pSeed);
          
          if (p.stream === 1) {
            tex = getSafeTexture(path.s1Textures, shimmerTexIndex);
          } else if (p.stream === 2) {
            tex = getSafeTexture(path.s2Textures, shimmerTexIndex);
          }
          
          // Reset other effects as requested
          sX = 1;
          alpha = 1;
          offX = 0;
          offY = 0;
          rotJitter = 0;
        }

        // Highlight selected particle
        if (p.id === selectedParticleIdRef.current) {
          const drawHighlight = (c: CanvasRenderingContext2D) => {
            c.save();
            c.translate(p.x + offX, p.y + offY);
            c.beginPath();
            c.arc(0, 0, p.radius * 1.5 + 5, 0, Math.PI * 2);
            c.strokeStyle = '#ef4444'; // Red
            c.lineWidth = 2 / viewScaleRef.current;
            c.setLineDash([4 / viewScaleRef.current, 4 / viewScaleRef.current]);
            c.stroke();
            
            // Draw ID label
            c.font = `bold ${10 / viewScaleRef.current}px sans-serif`;
            c.fillStyle = '#000000';
            c.fillText(`ID: ${p.id.toString().slice(2, 8)}`, p.radius * 1.5 + 8, 0);
            
            c.restore();
          };
          drawHighlight(ctx);
          if (rCtx) drawHighlight(rCtx);
        }

        if (p.stream !== 0 && tex) {
          const drawHeight = 3 * currentScale * 12;
          const drawWidth = drawHeight * (tex.width / tex.height);
          
          const drawTex = (c: CanvasRenderingContext2D) => {
            c.save();
            c.translate(p.x + offX, p.y + offY);
            
            let angle = currentRot * (Math.PI / 180);
            angle += p.pathAngle + rotJitter;
            c.rotate(angle);
            
            c.scale(sX, 1);
            c.globalAlpha = Math.min(1.0, alpha);
            
            c.drawImage(tex, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            c.restore();
          };
          drawTex(ctx);
          if (rCtx) drawTex(rCtx);
        } else {
          const drawDot = (c: CanvasRenderingContext2D) => {
            c.save();
            c.translate(p.x + offX, p.y + offY);
            c.scale(sX, 1);
            c.globalAlpha = Math.min(1.0, alpha);
            
            c.beginPath();
            c.arc(0, 0, p.baseSize * 2.5, 0, Math.PI * 2);
            c.fillStyle = p.color + '40';
            c.fill();

            c.beginPath();
            c.arc(0, 0, p.baseSize * 0.8, 0, Math.PI * 2);
            c.fillStyle = p.color;
            c.fill();
            
            c.restore();
          };
          drawDot(ctx);
          if (rCtx) drawDot(rCtx);
        }
      }

      // Apply Local Invert Mask
      if (invertCellsRef.current.size > 0) {
        const drawInvert = (c: CanvasRenderingContext2D) => {
          c.save();
          c.globalCompositeOperation = 'difference';
          c.fillStyle = 'white';
          const currentSnapStep = snapStepRef.current;
          const stepX = currentSnapStep * GRID_UNIT_X;
          const stepY = currentSnapStep * GRID_UNIT_Y;
          
          invertCellsRef.current.forEach(cellKey => {
            const [cx, cy] = cellKey.split(',').map(Number);
            c.fillRect(cx, cy, stepX, stepY);
          });
          c.restore();
        };
        drawInvert(ctx);
        if (rCtx) drawInvert(rCtx);
      }

      ctx.restore(); // Restore from logical canvas transform

      // Draw Liquify Brush
      if (liquifyModeRef.current) {
        ctx.save();
        ctx.translate(viewOffsetRef.current.x, viewOffsetRef.current.y);
        ctx.scale(viewScaleRef.current, viewScaleRef.current);
        
        ctx.beginPath();
        ctx.arc(mousePosRef.current.x, mousePosRef.current.y, liquifyConfigRef.current.brushSize, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
        ctx.lineWidth = 2 / viewScaleRef.current;
        ctx.stroke();
        
        ctx.restore();
      }

      if (rCtx) rCtx.restore(); // Restore from recording canvas save

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [drawingMode, uiVisible, logicalWidth, logicalHeight]);

  const eraseSimplePathsAlongSegment = (start: Point, end: Point) => {
    const hitIds = findHitPathIdsAlongSegment(
      pathsRef.current,
      start,
      end,
      screenPixelsToLogical(24, viewScaleRef.current),
      simpleErasedPathIdsRef.current,
    );
    if (hitIds.length === 0) return;

    if (!simpleEraseUndoSavedRef.current) {
      saveStateToUndo();
      simpleEraseUndoSavedRef.current = true;
    }

    hitIds.forEach(id => simpleErasedPathIdsRef.current.add(id));
    const erasedIds = new Set(hitIds);
    setPaths(previousPaths => (
      previousPaths.filter(path => !erasedIds.has(path.id))
    ));
    particlesRef.current = particlesRef.current.filter(
      particle => !erasedIds.has(particle.pathId),
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

    if (!editorMode) {
      if (!simpleExperienceReady || e.button !== 0) return;

      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      const logicalPoint = {
        x: (e.clientX - rect.left - viewOffset.x) / viewScale,
        y: (e.clientY - rect.top - viewOffset.y) / viewScale,
      };

      if (simpleToolRef.current === 'erase') {
        simpleErasePointerActiveRef.current = true;
        simpleEraseUndoSavedRef.current = false;
        simpleErasedPathIdsRef.current = new Set();
        simpleEraseLastPointRef.current = logicalPoint;
        eraseSimplePathsAlongSegment(logicalPoint, logicalPoint);
        return;
      }

      setIsDrawing(true);
      currentPathRef.current = [logicalPoint];
      return;
    }

    if (e.button === 1) {
      setIsPanning(true);
      setLastPanPos({ x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const rect = canvasRef.current!.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Convert to logical coordinates
    const logicalX = (screenX - viewOffset.x) / viewScale;
    const logicalY = (screenY - viewOffset.y) / viewScale;

    if (drawingMode === 'edit') {
      let foundPoint: { pathId: number; index: number } | null = null;
      let minDist = 20 / viewScale; // Slightly larger hit area

      // Prioritize currently selected path if any
      const searchPaths = selectedPathId !== null ? 
        [...paths.filter(p => p.id === selectedPathId), ...paths.filter(p => p.id !== selectedPathId)] : 
        paths;

      for (const path of searchPaths) {
        if (path.hidden || !path.bezierPoints) continue;
        for (let i = 0; i < path.bezierPoints.length; i++) {
          const bp = path.bezierPoints[i];
          const d = Math.sqrt((bp.x - logicalX)**2 + (bp.y - logicalY)**2);
          if (d < minDist) {
            minDist = d;
            foundPoint = { pathId: path.id, index: i };
          }
        }
        if (foundPoint) break;
      }

      if (foundPoint) {
        if (e.altKey) {
          // Delete node
          const { pathId, index } = foundPoint;
          setPaths(prev => prev.map(p => {
            if (p.id === pathId && p.bezierPoints && p.bezierPoints.length > 2) {
              const newBPs = [...p.bezierPoints];
              newBPs.splice(index, 1);
              return rebuildBezierPath({ ...p, bezierPoints: newBPs });
            }
            return p;
          }));
          setIsDrawing(false);
          saveStateToUndo();
          showNotification('节点已删除');
          return;
        }
        setActiveBezierPoint(foundPoint);
        setSelectedPathId(foundPoint.pathId);
        setIsDrawing(true);
        return;
      } else if (selectedPathId !== null) {
        // Add node at the end
        const path = paths.find(p => p.id === selectedPathId);
        if (path && path.bezierPoints) {
           setPaths(prev => prev.map(p => {
             if (p.id === selectedPathId && p.bezierPoints) {
               const newBPs = [...p.bezierPoints, { x: logicalX, y: logicalY }];
               return rebuildBezierPath({ ...p, bezierPoints: newBPs });
             }
             return p;
           }));
           saveStateToUndo();
           setIsDrawing(false);
           return;
        }
      }
    }

    if (drawingMode === 'scissors') {
      let closestPath: PathConfig | null = null;
      let closestIdx = -1;
      let splitPoint = { x: logicalX, y: logicalY };
      let minDist = 30 / viewScale;

      paths.forEach(path => {
        if (path.hidden) return;
        for (let i = 0; i < path.points.length - 1; i++) {
          const p1 = path.points[i];
          const p2 = path.points[i + 1];
          const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
          if (l2 === 0) continue;
          let t = ((logicalX - p1.x) * (p2.x - p1.x) + (logicalY - p1.y) * (p2.y - p1.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          const proj = {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
          };
          const d = Math.sqrt((logicalX - proj.x) ** 2 + (logicalY - proj.y) ** 2);
          if (d < minDist) {
            minDist = d;
            closestPath = path;
            closestIdx = i;
            splitPoint = proj;
          }
        }
      });

      if (closestPath && closestIdx !== -1) {
        const pointsA = [...closestPath.points.slice(0, closestIdx + 1), splitPoint];
        const pointsB = [splitPoint, ...closestPath.points.slice(closestIdx + 1)];

        if (pointsA.length > 1 && pointsB.length > 1) {
          const getMetadata = (pts: Point[]) => {
            const ls = [0];
            let tl = 0;
            for (let i = 1; i < pts.length; i++) {
              tl += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2);
              ls.push(tl);
            }
            return { ls, tl };
          };

          const metaA = getMetadata(pointsA);
          const metaB = getMetadata(pointsB);

          const splitDist = metaA.tl;
          const originalId = closestPath.id;
          
          const pathA_id = (metaA.tl >= metaB.tl) ? originalId : Math.random();
          const pathB_id = (metaB.tl > metaA.tl) ? originalId : Math.random();

          const createSplitPath = (pts: Point[], meta: { ls: number[], tl: number }, id: number) => ({
            ...closestPath!,
            id,
            points: pts,
            lengths: meta.ls,
            totalLength: meta.tl,
            fixedParticlesSpawned: false,
            spawnAccumulator: closestPath!.textSpacing,
            s1Textures: [],
            s2Textures: [],
            bezierPoints: undefined,
          });

          const pathA = createSplitPath(pointsA, metaA, pathA_id);
          const pathB = createSplitPath(pointsB, metaB, pathB_id);

          setPaths(prev => prev.filter(p => p.id !== originalId).concat([pathA, pathB]));

          // Reassign particles
          particlesRef.current = particlesRef.current.map(p => {
            if (p.pathId === originalId) {
              if (p.distance <= splitDist) {
                return { ...p, pathId: pathA_id };
              } else {
                return { ...p, pathId: pathB_id, distance: p.distance - splitDist };
              }
            }
            return p;
          });

          saveStateToUndo();
          showNotification('线条已断开');
        }
      }
      setIsDrawing(false);
      return;
    }

    if (selectionMode) {
      // Find closest path
      let closestPathId: number | null = null;
      let minDist = 50 / viewScale;
      
      paths.forEach(path => {
        path.points.forEach(p => {
          const dx = p.x - logicalX;
          const dy = p.y - logicalY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minDist) {
            minDist = d;
            closestPathId = path.id;
          }
        });
      });
      
      setSelectedPathId(closestPathId);
      if (closestPathId !== null) {
        setIsDraggingPath(true);
        setDragStartPos({ x: logicalX, y: logicalY });
      }
      setIsDrawing(false);
      return;
    }

    if (liquifyMode && liquifyPathId !== null) {
      setIsDrawing(true);
      setLastPanPos({ x: logicalX, y: logicalY }); // Use lastPanPos to store previous logical mouse pos for "push"
      return;
    }

    if (drawingMode === 'inspect') {
      // Find closest particle
      let closestId: number | null = null;
      let minDist = 50 / viewScale; // 50px radius for selection
      
      particlesRef.current.forEach(p => {
        const dx = p.x - logicalX;
        const dy = p.y - logicalY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) {
          minDist = d;
          closestId = p.id;
        }
      });
      
      setSelectedParticleId(closestId);
      setIsDrawing(false);
      return;
    }

    if (drawingMode === 'lasso' || drawingMode === 'invert' || drawingMode === 'speed_select') {
      const currentSnapStep = snapStepRef.current;
      const stepX = currentSnapStep * GRID_UNIT_X;
      const stepY = currentSnapStep * GRID_UNIT_Y;
      
      const snappedX = Math.floor(logicalX / stepX) * stepX;
      const snappedY = Math.floor(logicalY / stepY) * stepY;
      
      let targetCells: Set<string>;
      if (drawingMode === 'lasso') targetCells = shimmerCellsRef.current;
      else if (drawingMode === 'invert') targetCells = invertCellsRef.current;
      else targetCells = currentSpeedSelectionCellsRef.current;

      const newCells = new Set(targetCells);
      let radius = shimmerBrushSize - 1;
      if (drawingMode === 'invert') radius = invertBrushSize - 1;
      
      for (let ox = -radius; ox <= radius; ox++) {
        for (let oy = -radius; oy <= radius; oy++) {
          const cx = snappedX + ox * stepX;
          const cy = snappedY + oy * stepY;
          if (cx >= 0 && cx < logicalWidthRef.current && cy >= 0 && cy < logicalHeightRef.current) {
            const key = `${cx.toFixed(1)},${cy.toFixed(1)}`;
            if (drawingMode === 'speed_select' && isSpeedEraser) {
              newCells.delete(key);
            } else {
              newCells.add(key);
            }
          }
        }
      }
      
      if (drawingMode === 'lasso') {
        setShimmerCells(newCells);
        shimmerCellsRef.current = newCells;
      } else if (drawingMode === 'invert') {
        setInvertCells(newCells);
        invertCellsRef.current = newCells;
      } else {
        setCurrentSpeedSelectionCells(newCells);
        currentSpeedSelectionCellsRef.current = newCells;
      }
      return;
    }

    if (drawingMode === 'grid') {
      const currentSnapStep = snapStepRef.current;
      const stepX = currentSnapStep * GRID_UNIT_X;
      const stepY = currentSnapStep * GRID_UNIT_Y;
      
      const snappedX = Math.round(logicalX / stepX) * stepX;
      const snappedY = Math.round(logicalY / stepY) * stepY;
      
      // Only add if within bounds
      if (snappedX >= 0 && snappedX <= logicalWidthRef.current && snappedY >= 0 && snappedY <= logicalHeightRef.current) {
        if (!gridSelectionStart) {
          setGridSelectionStart({ x: snappedX, y: snappedY });
        } else {
          // Create box
          const newBox = {
            x1: gridSelectionStart.x,
            y1: gridSelectionStart.y,
            x2: snappedX,
            y2: snappedY,
            id: Math.random().toString()
          };
          setGridBoxes(prev => [...prev, newBox]);
          setGridSelectionStart(null);
        }
        setGridPoints(prev => [...prev, { x: snappedX, y: snappedY, id: Math.random().toString() }]);
      }
      return;
    }

    currentPathRef.current = [{ x: logicalX, y: logicalY }];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Convert to logical coordinates
    const logicalX = (screenX - viewOffset.x) / viewScale;
    const logicalY = (screenY - viewOffset.y) / viewScale;
    mousePosRef.current = { x: logicalX, y: logicalY };

    if (!editorMode && simpleToolRef.current === 'erase') {
      if (simpleErasePointerActiveRef.current) {
        const logicalPoint = { x: logicalX, y: logicalY };
        const previousPoint = simpleEraseLastPointRef.current ?? logicalPoint;
        eraseSimplePathsAlongSegment(previousPoint, logicalPoint);
        simpleEraseLastPointRef.current = logicalPoint;
      }
      return;
    }

    if (activeBezierPoint && isDrawing) {
      const { pathId, index } = activeBezierPoint;
      setPaths(prev => prev.map(p => {
        if (p.id === pathId && p.bezierPoints) {
          const newBPs = [...p.bezierPoints];
          newBPs[index] = { x: logicalX, y: logicalY };
          return rebuildBezierPath({ ...p, bezierPoints: newBPs });
        }
        return p;
      }));
      return;
    }

    if (isPanning) {
      const dx = e.clientX - lastPanPos.x;
      const dy = e.clientY - lastPanPos.y;
      setViewOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPos({ x: e.clientX, y: e.clientY });
      return;
    }

    if (isDraggingPath && selectedPathId !== null && dragStartPos) {
      const dx = logicalX - dragStartPos.x;
      const dy = logicalY - dragStartPos.y;

      setPaths(prev => prev.map(p => {
        if (p.id === selectedPathId) {
          const newPoints = p.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
          const newBezierPoints = p.bezierPoints?.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
          const newFunctionalControlPoints = p.functionalControlPoints.map(cp => ({
            ...cp,
            cx: cp.cx + dx,
            cy: cp.cy + dy
          }));
          const newBaselineStart = p.baselineStart ? { x: p.baselineStart.x + dx, y: p.baselineStart.y + dy } : undefined;
          const newBaselineEnd = p.baselineEnd ? { x: p.baselineEnd.x + dx, y: p.baselineEnd.y + dy } : undefined;

          return { 
            ...p, 
            points: newPoints, 
            bezierPoints: newBezierPoints, 
            functionalControlPoints: newFunctionalControlPoints,
            baselineStart: newBaselineStart,
            baselineEnd: newBaselineEnd
          };
        }
        return p;
      }));

      setDragStartPos({ x: logicalX, y: logicalY });
      return;
    }

    if (liquifyMode && liquifyPathId !== null && isDrawing) {
      const dx = logicalX - lastPanPos.x;
      const dy = logicalY - lastPanPos.y;
      
      setPaths(prev => prev.map(p => {
        if (p.id === liquifyPathId) {
          const newPoints = p.points.map(pt => {
            const distDx = pt.x - logicalX;
            const distDy = pt.y - logicalY;
            const distSq = distDx * distDx + distDy * distDy;
            const brushRadius = liquifyConfig.brushSize;
            
            if (distSq < brushRadius * brushRadius) {
              const dist = Math.sqrt(distSq);
              const influence = (1 - dist / brushRadius) * liquifyConfig.pressure;
              
              if (liquifyConfig.mode === 'push') {
                return {
                  x: pt.x + dx * influence,
                  y: pt.y + dy * influence
                };
              } else if (liquifyConfig.mode === 'pinch') {
                return {
                  x: pt.x + (logicalX - pt.x) * influence * 0.1,
                  y: pt.y + (logicalY - pt.y) * influence * 0.1
                };
              } else if (liquifyConfig.mode === 'expand') {
                return {
                  x: pt.x - (logicalX - pt.x) * influence * 0.1,
                  y: pt.y - (logicalY - pt.y) * influence * 0.1
                };
              }
            }
            return pt;
          });
          return { ...p, points: newPoints };
        }
        return p;
      }));
      setLastPanPos({ x: logicalX, y: logicalY });
      return;
    }

    if ((drawingMode === 'lasso' || drawingMode === 'invert' || drawingMode === 'speed_select') && isDrawing) {
      const currentSnapStep = snapStepRef.current;
      const stepX = currentSnapStep * GRID_UNIT_X;
      const stepY = currentSnapStep * GRID_UNIT_Y;
      
      const snappedX = Math.floor(logicalX / stepX) * stepX;
      const snappedY = Math.floor(logicalY / stepY) * stepY;
      
      let targetCells: Set<string>;
      if (drawingMode === 'lasso') targetCells = shimmerCellsRef.current;
      else if (drawingMode === 'invert') targetCells = invertCellsRef.current;
      else targetCells = currentSpeedSelectionCellsRef.current;

      const newCells = new Set(targetCells);
      let radius = shimmerBrushSize - 1;
      if (drawingMode === 'invert') radius = invertBrushSize - 1;
      
      let changed = false;
      for (let ox = -radius; ox <= radius; ox++) {
        for (let oy = -radius; oy <= radius; oy++) {
          const cx = snappedX + ox * stepX;
          const cy = snappedY + oy * stepY;
          if (cx >= 0 && cx < logicalWidthRef.current && cy >= 0 && cy < logicalHeightRef.current) {
            const key = `${cx.toFixed(1)},${cy.toFixed(1)}`;
            if (drawingMode === 'speed_select' && isSpeedEraser) {
              if (newCells.has(key)) {
                newCells.delete(key);
                changed = true;
              }
            } else {
              if (!newCells.has(key)) {
                newCells.add(key);
                changed = true;
              }
            }
          }
        }
      }
      
      if (changed) {
        if (drawingMode === 'lasso') {
          setShimmerCells(newCells);
          shimmerCellsRef.current = newCells;
        } else if (drawingMode === 'invert') {
          setInvertCells(newCells);
          invertCellsRef.current = newCells;
        } else {
          setCurrentSpeedSelectionCells(newCells);
          currentSpeedSelectionCellsRef.current = newCells;
        }
      }
      return;
    }

    if (!isDrawing) return;

    const lastPoint = currentPathRef.current[currentPathRef.current.length - 1];
    if (!lastPoint) return;
    
    const dx = logicalX - lastPoint.x;
    const dy = logicalY - lastPoint.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5 / viewScale) {
      currentPathRef.current.push({ x: logicalX, y: logicalY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editorMode && e.type === 'pointercancel') {
      simpleErasePointerActiveRef.current = false;
      simpleEraseUndoSavedRef.current = false;
      simpleErasedPathIdsRef.current = new Set();
      simpleEraseLastPointRef.current = null;
      setIsDrawing(false);
      currentPathRef.current = [];
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    if (!editorMode && simpleToolRef.current === 'erase') {
      simpleErasePointerActiveRef.current = false;
      simpleEraseUndoSavedRef.current = false;
      simpleErasedPathIdsRef.current = new Set();
      simpleEraseLastPointRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const dist = Math.hypot(e.clientX - pointerDownPosRef.current.x, e.clientY - pointerDownPosRef.current.y);
    const isClick = dist < 5;

    if (isPanning) {
      setIsPanning(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
      // Even if panning, if it was just a click, maybe reset? No, panning is usually drag.
      return;
    }

    if (isDraggingPath) {
      setIsDraggingPath(false);
      setDragStartPos(null);
      saveStateToUndo();
      e.currentTarget.releasePointerCapture(e.pointerId);
      
      // Special case: If it was just a click in selection mode, user might want to "deselect"
      // But usually they click once TO select. So we only reset if it was already selected?
      // "在画面任意区域点击一次，均可反选目前功能" 
      // If we are in selectionMode, and it's a click, maybe toggle it off if they click away.
      return;
    }

    if (activeBezierPoint) {
      setActiveBezierPoint(null);
      return;
    }

    // "Anti-select" / Reset logic for click
    if (isClick) {
      const hasActiveTool = selectionMode || liquifyMode || drawingMode !== 'path' || selectedPathId !== null;
      if (hasActiveTool) {
        resetUI();
        setIsDrawing(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
        return;
      }
    }

    if (!isDrawing) return;
    setIsDrawing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    if (drawingMode === 'grid' || drawingMode === 'lasso' || drawingMode === 'invert' || drawingMode === 'speed_select') {
      saveStateToUndo();
      return;
    }

    if (liquifyMode) {
      // Don't save yet, wait for "Apply"
      return;
    }

    let points = currentPathRef.current;
    let bezierPoints: Point[] | undefined = undefined;

    if (drawingMode === 'bezier' && points.length > 10) {
      // Simplify to 4 control points
      const p0 = points[0];
      const p3 = points[points.length - 1];
      const p1 = points[Math.floor(points.length / 3)];
      const p2 = points[Math.floor(2 * points.length / 3)];
      
      bezierPoints = [p0, p1, p2, p3];
      
      // Generate the actual points for the path
      const newPoints: Point[] = [];
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        newPoints.push(getBezierPoint(bezierPoints, i / steps));
      }
      points = newPoints;
    } else if (points.length > 2) {
      points = smoothPath(points, 3);
    }
      
    if (points.length > 1) {
      const lengths = [0];
      let totalLength = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        totalLength += dist;
        lengths.push(totalLength);
      }
      
      const color = COLORS[colorIndexRef.current];
      
      const activePreset = presets.find(p => p.id === activePresetId) || presets[0];
      const initialSpacingTarget = Math.max(10, activePreset.textSpacing);

      // --- Functional Path Fitting ---
      const reg = linearRegression(points);
      let baselineStart = points[0];
      let baselineEnd = points[points.length - 1];
      
      if (!reg.isVertical) {
        const xMin = Math.min(...points.map(p => p.x));
        const xMax = Math.max(...points.map(p => p.x));
        baselineStart = { x: xMin, y: reg.m * xMin + reg.b };
        baselineEnd = { x: xMax, y: reg.m * xMax + reg.b };
      } else {
        const yMin = Math.min(...points.map(p => p.y));
        const yMax = Math.max(...points.map(p => p.y));
        baselineStart = { x: reg.avgX, y: yMin };
        baselineEnd = { x: reg.avgX, y: yMax };
      }

      // Pick control points (every ~200px or at least 5 points)
      const numControlPoints = Math.max(5, Math.ceil(totalLength / 200));
      const functionalControlPoints: FunctionalControlPoint[] = [];
      for (let i = 0; i < numControlPoints; i++) {
        const d = (i / (numControlPoints - 1)) * totalLength;
        const pt = getPathPoint({ points, lengths, totalLength } as any, d);
        functionalControlPoints.push({
          id: Math.random().toString(),
          cx: pt.x,
          cy: pt.y,
          amplitude: 20 + Math.random() * 30,
          frequency: 0.5 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2,
          segmentLength: 50
        });
      }

      const isBlueLine = colorIndexRef.current === 1;
      
      const newPath: PathConfig = {
        id: Math.random(),
        points,
        bezierPoints,
        lengths,
        totalLength,
        color: color,
        speed: activePreset.speed,
        currentSpacingTarget: initialSpacingTarget,
        spawnAccumulator: initialSpacingTarget, // Spawn immediately
        nextStream1Index: 0,
        nextStream2Index: 0,
        nextTurn: 1,
        fixedParticlesSpawned: false,
        hidden: false,
        
        // Apply preset config - Override if it's a blue line
        stream1: { 
          ...activePreset.stream1, 
          scale: isBlueLine ? 1.0 : activePreset.stream1.scale,
          images: [...activePreset.stream1.images] 
        },
        stream2: { 
          ...activePreset.stream2, 
          scale: isBlueLine ? 1.0 : activePreset.stream2.scale,
          images: [...activePreset.stream2.images] 
        },
        textSpacing: activePreset.textSpacing,
        spacingRandomness: activePreset.spacingRandomness,
        useRandomRangeSpacing: activePreset.useRandomRangeSpacing || false,
        randomSpacingMin: activePreset.randomSpacingMin || 35,
        randomSpacingMax: activePreset.randomSpacingMax || 50,
        textureRandomness: 0.5 + Math.random() * 0.49, // Independent setting, randomized
        scatter: activePreset.scatter,
        collisionVolume: activePreset.collisionVolume || 1.0,
        entryTransition: isBlueLine ? 0 : (activePreset.entryTransition ?? 150),
        entryScale: isBlueLine ? 1.0 : (activePreset.entryScale ?? 0.3),
        exitScale: isBlueLine ? 1.0 : (activePreset.exitScale ?? 0.3),
        useSizeGradient: isBlueLine ? false : (activePreset.useSizeGradient ?? true),
        useOpacityGradient: isBlueLine ? false : (activePreset.useOpacityGradient ?? true),
        minOpacity: activePreset.minOpacity ?? 0.5,
        
        isFunctional: false, // Default to false, can be toggled
        isFixed: activePreset.isFixed || false,
        baselineStart,
        baselineEnd,
        functionalControlPoints,
        omega: 1.0,

        s1Textures: [],
        s2Textures: []
      };

      if (!editorMode) {
        simpleReleasedAtRef.current.set(newPath.id, Date.now());
      }
      setPaths(prev => [...prev, newPath]);
      setExpandedPathId(editorMode ? newPath.id : null);
      setSelectedPathId(editorMode ? newPath.id : null);
      saveStateToUndo();
    }
    currentPathRef.current = [];
  };

  const clearCanvas = () => {
    setPaths([]);
    setGridPoints([]);
    setGridBoxes([]);
    setGridSelectionStart(null);
    setShimmerCells(new Set());
    shimmerCellsRef.current = new Set();
    particlesRef.current = [];
    setExpandedPathId(null);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  };

  const applyLiquify = () => {
    if (liquifyPathId === null) return;
    
    setPaths(prev => prev.map(p => {
      if (p.id === liquifyPathId) {
        const points = p.points;
        const lengths = [0];
        let totalLength = 0;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          totalLength += Math.sqrt(dx * dx + dy * dy);
          lengths.push(totalLength);
        }

        // Re-calculate functional control points based on new shape
        const numControlPoints = Math.max(5, Math.ceil(totalLength / 200));
        const functionalControlPoints: FunctionalControlPoint[] = [];
        for (let i = 0; i < numControlPoints; i++) {
          const d = (i / (numControlPoints - 1)) * totalLength;
          const pt = getPathPoint({ points, lengths, totalLength } as any, d);
          functionalControlPoints.push({
            id: Math.random().toString(),
            cx: pt.x,
            cy: pt.y,
            amplitude: 20 + Math.random() * 30,
            frequency: 0.5 + Math.random() * 1.5,
            phase: Math.random() * Math.PI * 2,
            segmentLength: 50
          });
        }

        return { ...p, lengths, totalLength, functionalControlPoints };
      }
      return p;
    }));
    
    setLiquifyMode(false);
    setLiquifyPathId(null);
    saveStateToUndo();
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setBgImage(img);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const exportProject = () => {
    try {
      const imageRegistry: Record<string, string> = {};

      const collectImages = (images: CustomImage[]) => {
        images.forEach(img => {
          if (!imageRegistry[img.id]) {
            imageRegistry[img.id] = img.img.src;
          }
        });
      };

      // 1. First Pass: Collect all unique images
      presets.forEach(p => {
        collectImages(p.stream1.images);
        collectImages(p.stream2.images);
      });
      paths.forEach(p => {
        collectImages(p.stream1.images);
        collectImages(p.stream2.images);
      });

      // 2. Define slim serialization (only IDs for images)
      const serializeStream = (stream: StreamConfig) => ({
        ...stream,
        images: stream.images.map(img => img.id)
      });

      const serializePath = (path: PathConfig) => ({
        ...path,
        stream1: serializeStream(path.stream1),
        stream2: serializeStream(path.stream2),
        s1Textures: [], 
        s2Textures: []
      });

      const serializePreset = (preset: PresetConfig) => ({
        ...preset,
        stream1: serializeStream(preset.stream1),
        stream2: serializeStream(preset.stream2)
      });

      const projectData = {
        version: '1.1',
        timestamp: new Date().toISOString(),
        imageRegistry, // Optimized: Actual image data stored here once
        paths: paths.map(serializePath),
        presets: presets.map(serializePreset),
        activePresetId,
        gridPoints,
        gridBoxes,
        shimmerSpeed,
        shimmerCells: Array.from(shimmerCells),
        invertCells: Array.from(invertCells),
        invertBrushSize,
        speedSelectionAreas,
        snapStep,
        speedMultiplier,
        bgScale,
        bgRotation,
        showBgImage,
        bgImageSrc: bgImage?.src || null,
        drawingMode
      };

      const jsonString = JSON.stringify(projectData);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project_${new Date().getTime()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showNotification('项目导出成功');
    } catch (err) {
      console.error('Export error:', err);
      showNotification('导出失败: 项目数据过大或存在异常');
    }
  };

  const loadCustomImage = (
    id: string,
    src: string,
  ): Promise<CustomImage> => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ id, img });
    img.onerror = () => reject(new Error(`Failed to load project image: ${id}`));
    img.src = src;
  });

  const applyProjectData = async (
    data: SerializedProjectData,
    successMessage?: string,
    simpleExperience = false,
  ) => {
    const backgroundSource = typeof data.bgImageSrc === 'string'
      ? data.bgImageSrc
      : null;
    const hydrationData = simpleExperience
      ? { ...data, paths: [] }
      : data;
    const [hydratedProject, hydratedBackground] = await Promise.all([
      hydrateProjectData<CustomImage>(hydrationData, loadCustomImage),
      backgroundSource
        ? loadCustomImage('project-background', backgroundSource)
        : Promise.resolve(null),
    ]);

    setBgImage(hydratedBackground?.img ?? null);
    setBgScale(typeof data.bgScale === 'number' ? data.bgScale : 1);
    setBgRotation(typeof data.bgRotation === 'number' ? data.bgRotation : 0);
    setShowBgImage(typeof data.showBgImage === 'boolean' ? data.showBgImage : true);
    setSnapStep(typeof data.snapStep === 'number' ? data.snapStep : 0.5);
    setSpeedMultiplier(
      simpleExperience
        ? 0.4
        : (typeof data.speedMultiplier === 'number' ? data.speedMultiplier : 1),
    );
    setShimmerSpeed(typeof data.shimmerSpeed === 'number' ? data.shimmerSpeed : 5);
    setDrawingMode('path');
    setSelectionMode(false);
    const nextGridPoints = simpleExperience
      ? []
      : (Array.isArray(data.gridPoints) ? data.gridPoints : []);
    const nextGridBoxes = simpleExperience
      ? []
      : (Array.isArray(data.gridBoxes) ? data.gridBoxes : []);
    const nextShimmerCells = new Set<string>(
      simpleExperience || !Array.isArray(data.shimmerCells)
        ? []
        : data.shimmerCells,
    );
    const nextInvertCells = new Set<string>(
      simpleExperience || !Array.isArray(data.invertCells)
        ? []
        : data.invertCells,
    );
    setGridPoints(nextGridPoints);
    setGridBoxes(nextGridBoxes);
    gridPointsRef.current = nextGridPoints;
    gridBoxesRef.current = nextGridBoxes;
    setGridSelectionStart(null);
    setShimmerCells(nextShimmerCells);
    shimmerCellsRef.current = nextShimmerCells;
    setInvertCells(nextInvertCells);
    invertCellsRef.current = nextInvertCells;
    setInvertBrushSize(typeof data.invertBrushSize === 'number' ? data.invertBrushSize : 1);
    setSpeedSelectionAreas(
      simpleExperience || !Array.isArray(data.speedSelectionAreas)
        ? []
        : data.speedSelectionAreas,
    );
    setPresets(hydratedProject.presets as PresetConfig[]);
    setPaths(simpleExperience ? [] : hydratedProject.paths as PathConfig[]);
    setActivePresetId(
      typeof data.activePresetId === 'string'
        ? data.activePresetId
        : 'default-preset',
    );
    if (simpleExperience) {
      setCurrentSpeedSelectionCells(new Set());
      particlesRef.current = [];
      setSelectedPathId(null);
      setExpandedPathId(null);
      setShowGrid(false);
      setShowPaths(false);
      simpleReleasedAtRef.current.clear();
    }
    if (successMessage) showNotification(successMessage);
  };

  const importProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    projectImportStartedRef.current = true;
    manualProjectImportStartedRef.current = true;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(
          event.target?.result as string,
        ) as SerializedProjectData;
        await applyProjectData(data, '项目导入成功！');
      } catch (err) {
        console.error('Import error:', err);
        showNotification('导入失败，请检查文件格式。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  useEffect(() => {
    let cancelled = false;

    fetch(builtinProjectUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch builtin project: ${response.status}`);
        }
        return response.json() as Promise<SerializedProjectData>;
      })
      .then(async data => {
        if (cancelled || manualProjectImportStartedRef.current) return;
        projectImportStartedRef.current = true;
        await applyProjectData(
          data,
          editorMode ? '内置项目已载入' : undefined,
          !editorMode,
        );
        if (!editorMode && !cancelled) {
          setUndoStack([]);
          setRedoStack([]);
          setSimpleExperienceReady(true);
        }
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Builtin project import error:', error);
        showNotification('内置项目加载失败，请刷新页面重试');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearShimmer = () => {
    saveStateToUndo();
    setShimmerCells(new Set());
  };

  const clearCurrentEffects = () => {
    saveStateToUndo();
    // Clear Shimmer
    setShimmerCells(new Set());
    shimmerCellsRef.current = new Set();
    // Clear Invert
    setInvertCells(new Set());
    invertCellsRef.current = new Set();
    // Clear Grid
    setGridPoints([]);
    setGridBoxes([]);
    gridPointsRef.current = [];
    gridBoxesRef.current = [];
    // Clear Speed Areas
    setSpeedSelectionAreas([]);
    setCurrentSpeedSelectionCells(new Set());
    
    showNotification('当前所有效果已清空');
  };

  const toggleUIVisibility = () => {
    setUiVisible(!uiVisible);
  };

  const saveAsJPG = () => {
    if (!canvasRef.current) return;
    
    // Create high-res offscreen canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 8192;
    exportCanvas.height = 5734;
    const eCtx = exportCanvas.getContext('2d', { alpha: false });
    if (!eCtx) return;

    const exportScaleX = 8192 / logicalWidthRef.current;
    const exportScaleY = 5734 / logicalHeightRef.current;
    eCtx.scale(exportScaleX, exportScaleY);

    // 1. Draw Background (White)
    eCtx.fillStyle = '#ffffff';
    eCtx.fillRect(0, 0, logicalWidthRef.current, logicalHeightRef.current);

    // 2. Draw Background Image
    const bgImg = bgImageRef.current;
    const isBgDrawable = bgImg && (bgImg instanceof HTMLImageElement || bgImg instanceof HTMLCanvasElement);
    if (isBgDrawable) {
      const img = bgImg as CanvasImageSource;
      const scale = bgScaleRef.current;
      const rot = bgRotationRef.current * (Math.PI / 180);
      eCtx.save();
      eCtx.translate(logicalWidthRef.current / 2, logicalHeightRef.current / 2);
      eCtx.rotate(rot);
      eCtx.scale(scale, scale);
      eCtx.drawImage(img, -(img as any).width / 2, -(img as any).height / 2);
      eCtx.restore();
    }

    // 3. Draw Particles
    const time = Date.now() * 0.001;
    const particles = particlesRef.current;
    const sSpeed = shimmerSpeedRef.current;
    const currentSnapStep = snapStepRef.current;
    const stepX = currentSnapStep * GRID_UNIT_X;
    const stepY = currentSnapStep * GRID_UNIT_Y;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const path = pathsRef.current.find(pt => pt.id === p.pathId);
      if (!path) continue;
      
      let currentScale = 1;
      let currentRot = 0;
      let tex: HTMLCanvasElement | null = null;

      if (p.stream === 1) {
        currentScale = path.stream1.scale;
        currentRot = path.stream1.rotation;
        tex = getSafeTexture(path.s1Textures, p.textureIndex);
      } else if (p.stream === 2) {
        currentScale = path.stream2.scale;
        currentRot = path.stream2.rotation;
        tex = getSafeTexture(path.s2Textures, p.textureIndex);
      }

      // Apply transition scale (fade in/out)
      const transitionDist = path.entryTransition || 150;
      const entryScale = path.entryScale ?? 0.7;
      const exitScale = path.exitScale ?? 0.6;
      
      let transitionScale = 1;
      let alpha = 1;
      
      if (p.distance < transitionDist) {
        // Entry
        const progress = p.distance / transitionDist;
        transitionScale = entryScale + (1 - entryScale) * progress;
      } else if (p.distance > path.totalLength - transitionDist) {
        // Exit
        const progress = (path.totalLength - p.distance) / transitionDist;
        transitionScale = exitScale + (1 - exitScale) * progress;
      }
      
      transitionScale = Math.max(0.1, Math.min(1, transitionScale));
      alpha = Math.max(0, Math.min(1, alpha));
      
      currentScale *= transitionScale;

      const cellX = Math.floor(p.x / stepX) * stepX;
      const cellY = Math.floor(p.y / stepY) * stepY;
      const cellKey = `${cellX.toFixed(1)},${cellY.toFixed(1)}`;
      const isInsideShimmer = shimmerCellsRef.current.has(cellKey);

      let sX = 1;
      // alpha is already set above, but shimmer might override it if we want
      
      if (isInsideShimmer) {
        const pSeed = p.id * 1000;
        const shimmerTexIndex = Math.floor((time * sSpeed) + pSeed);
        if (p.stream === 1) {
          tex = getSafeTexture(path.s1Textures, shimmerTexIndex);
        } else if (p.stream === 2) {
          tex = getSafeTexture(path.s2Textures, shimmerTexIndex);
        }
        sX = 1;
        alpha = 1;
      }

      if (p.stream !== 0 && tex) {
        const drawHeight = 3 * currentScale * 12;
        const drawWidth = drawHeight * (tex.width / tex.height);
        eCtx.save();
        eCtx.translate(p.x, p.y);
        let angle = currentRot * (Math.PI / 180);
        angle += p.pathAngle;
        eCtx.rotate(angle);
        eCtx.scale(sX, 1);
        eCtx.globalAlpha = Math.min(1.0, alpha);
        eCtx.drawImage(tex, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        eCtx.restore();
      } else {
        eCtx.save();
        eCtx.translate(p.x, p.y);
        eCtx.scale(sX, 1);
        eCtx.globalAlpha = Math.min(1.0, alpha);
        eCtx.beginPath();
        eCtx.arc(0, 0, p.baseSize * 2.5, 0, Math.PI * 2);
        eCtx.fillStyle = p.color + '40';
        eCtx.fill();
        eCtx.beginPath();
        eCtx.arc(0, 0, p.baseSize * 0.8, 0, Math.PI * 2);
        eCtx.fillStyle = p.color;
        eCtx.fill();
        eCtx.restore();
      }
    }

    // 4. Draw Invert Mask
    if (invertCellsRef.current.size > 0) {
      eCtx.save();
      eCtx.globalCompositeOperation = 'difference';
      eCtx.fillStyle = 'white';
      invertCellsRef.current.forEach(cellKey => {
        const [cx, cy] = cellKey.split(',').map(Number);
        eCtx.fillRect(cx, cy, stepX, stepY);
      });
      eCtx.restore();
    }

    // Convert to Blob as JPEG with 100% quality (1.0)
    exportCanvas.toBlob(async (blob) => {
      if (!blob) return;
      
      // Inject 300 DPI metadata into JFIF APP0 segment
      const dpi = 300;
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const view = new DataView(arrayBuffer);
        
        // JPEG SOI marker (0xFFD8)
        if (view.getUint16(0) !== 0xFFD8) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `particle-art-${Date.now()}.jpg`;
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        const bytes = new Uint8Array(arrayBuffer);
        let offset = 2;
        let found = false;
        
        // Search for APP0 segment (0xFFE0)
        while (offset < bytes.length - 1) {
          if (bytes[offset] === 0xFF && bytes[offset + 1] === 0xE0) {
            // Found APP0 (JFIF)
            if (offset + 11 < bytes.length) {
              bytes[offset + 7] = 1; 
              bytes[offset + 8] = (dpi >> 8) & 0xFF;
              bytes[offset + 9] = dpi & 0xFF;
              bytes[offset + 10] = (dpi >> 8) & 0xFF;
              bytes[offset + 11] = dpi & 0xFF;
              found = true;
            }
            break;
          }
          if (offset + 3 < bytes.length) {
            const length = view.getUint16(offset + 2);
            offset += length + 2;
          } else {
            break;
          }
        }
        
        const finalBlob = found ? new Blob([bytes], { type: 'image/jpeg' }) : blob;
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `particle-art-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('高清图片已保存 (300 DPI, 100% 质量)');
      };
      reader.readAsArrayBuffer(blob);
    }, 'image/jpeg', 1.0);
  };



  const toggleRecording = () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      // Create offscreen recording canvas for 4K quality
      const rCanvas = document.createElement('canvas');
      // 4K Resolution: 3840x2160
      rCanvas.width = 3840;
      rCanvas.height = 2160;
      recordingCanvasRef.current = rCanvas;

      const stream = rCanvas.captureStream(60); // 60 FPS
      
      // Try to find the best supported mime type
      const mimeTypes = [
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=h264',
        'video/webm'
      ];
      
      let selectedMimeType = 'video/webm';
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          selectedMimeType = type;
          break;
        }
      }
      
      const options = { 
        mimeType: selectedMimeType,
        videoBitsPerSecond: 50000000 // 50 Mbps for 4K quality
      };
      
      try {
        const recorder = new MediaRecorder(stream, options);
        recordedChunksRef.current = [];
        
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };
        
        recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: selectedMimeType });
          setRecordedBlob(blob);
          setRecordedMimeType(selectedMimeType);
          setShowExportModal(true);
          recordingCanvasRef.current = null;
        };
        
        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch (err) {
        console.error("Failed to start recording", err);
        showNotification("您的浏览器不支持录制此画布。");
      }
    }
  };

  const downloadVideo = (format: 'mp4' | 'webm') => {
    if (!recordedBlob) return;
    
    // Create a new blob with the desired extension if possible, 
    // or just use the recorded one with the new extension.
    // Note: This doesn't re-encode, it just changes the container extension.
    // Modern players are usually fine with this if the codecs are compatible.
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-record-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Path Configuration Handlers ---
  const updatePath = (id: number, updater: (path: PathConfig) => PathConfig) => {
    setPaths(prev => prev.map(p => p.id === id ? { ...updater(p), fixedParticlesSpawned: false } : p));
  };

  const updateStream = (pathId: number, streamNum: 1 | 2, updates: Partial<StreamConfig>) => {
    updatePath(pathId, p => ({
      ...p,
      [streamNum === 1 ? 'stream1' : 'stream2']: {
        ...(streamNum === 1 ? p.stream1 : p.stream2),
        ...updates
      }
    }));
  };

  const handlePathImageUpload = (pathId: number, streamNum: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          updatePath(pathId, p => {
            const stream = streamNum === 1 ? p.stream1 : p.stream2;
            return {
              ...p,
              [streamNum === 1 ? 'stream1' : 'stream2']: {
                ...stream,
                images: [...stream.images, { id: Math.random().toString(), img }]
              }
            };
          });
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePathImage = (pathId: number, streamNum: 1 | 2, imageId: string) => {
    updatePath(pathId, p => {
      const stream = streamNum === 1 ? p.stream1 : p.stream2;
      return {
        ...p,
        [streamNum === 1 ? 'stream1' : 'stream2']: {
          ...stream,
          images: stream.images.filter(img => img.id !== imageId)
        }
      };
    });
  };

  const convertToBezier = (pathId: number) => {
    updatePath(pathId, p => {
      if (p.bezierPoints) return p;
      
      // Sample nodes evenly along total length
      // User requested "平均分布" (average distribution)
      // Number of points depends on length, but typically 6-10 is good for control
      const numPoints = Math.max(4, Math.min(12, Math.floor(p.totalLength / 200))); 
      const sampledPoints: Point[] = [];
      
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const dist = t * p.totalLength;
        sampledPoints.push(getPathPoint(p, dist));
      }
      
      const newPath = { ...p, bezierPoints: sampledPoints };
      return rebuildBezierPath(newPath); // This will update p.points to follow the sampled Bezier shape
    });
    setDrawingMode('edit');
    setSelectedPathId(pathId);
    showNotification('已转换为贝塞尔曲线并进入编辑模式');
  };

  const deletePath = (id: number) => {
    setPaths(prev => prev.filter(p => p.id !== id));
    // Also remove particles belonging to this path
    particlesRef.current = particlesRef.current.filter(p => p.pathId !== id);
    setExpandedPathId(prev => prev === id ? null : prev);
    setSelectedPathId(prev => prev === id ? null : prev);
  };

  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const deletePathRef = useRef(deletePath);
  const toggleUIVisibilityRef = useRef(toggleUIVisibility);
  const setIsInvertedRef = useRef(setIsInverted);
  const setShowGridRef = useRef(setShowGrid);
  const setIsPausedRef = useRef(setIsPaused);

  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
    deletePathRef.current = deletePath;
    toggleUIVisibilityRef.current = toggleUIVisibility;
    setIsInvertedRef.current = setIsInverted;
    setShowGridRef.current = setShowGrid;
    setIsPausedRef.current = setIsPaused;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || 
                      target.tagName === 'TEXTAREA' || 
                      target.isContentEditable;

      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoRef.current();
        return;
      }

      if (!editorMode) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        redoRef.current();
      } else if (e.key === 'h' || e.key === 'H') {
        toggleUIVisibilityRef.current();
      } else if (e.key === 'i' || e.key === 'I') {
        setIsInvertedRef.current(prev => !prev);
      } else if (e.key === 'g' || e.key === 'G') {
        setShowGridRef.current(prev => !prev);
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPausedRef.current(prev => !prev);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedPathIdRef.current !== null) {
          e.preventDefault();
          deletePathRef.current(selectedPathIdRef.current);
          showNotification('已删除选中线条');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Stable listener

  // --- Preset Management Handlers ---
  const updatePreset = (id: string, updater: (p: PresetConfig) => PresetConfig) => {
    setPresets(prev => prev.map(p => p.id === id ? updater(p) : p));
  };

  const updatePresetStream = (presetId: string, streamNum: 1 | 2, updates: Partial<StreamConfig>) => {
    updatePreset(presetId, p => ({
      ...p,
      [streamNum === 1 ? 'stream1' : 'stream2']: {
        ...(streamNum === 1 ? p.stream1 : p.stream2),
        ...updates
      }
    }));
  };

  const handlePresetImageUpload = (presetId: string, streamNum: 1 | 2, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          updatePreset(presetId, p => {
            const stream = streamNum === 1 ? p.stream1 : p.stream2;
            return {
              ...p,
              [streamNum === 1 ? 'stream1' : 'stream2']: {
                ...stream,
                images: [...stream.images, { id: Math.random().toString(), img }]
              }
            };
          });
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePresetImage = (presetId: string, streamNum: 1 | 2, imageId: string) => {
    updatePreset(presetId, p => {
      const stream = streamNum === 1 ? p.stream1 : p.stream2;
      return {
        ...p,
        [streamNum === 1 ? 'stream1' : 'stream2']: {
          ...stream,
          images: stream.images.filter(img => img.id !== imageId)
        }
      };
    });
  };

  const addPreset = () => {
    const newPreset: PresetConfig = {
      id: Math.random().toString(),
      name: `预设 ${presets.length + 1}`,
      targetLines: '',
      stream1: { text: "新文字1", images: [], scale: 1.5, rotation: 0 },
      stream2: { text: "新文字2", images: [], scale: 1.5, rotation: 0 },
      textSpacing: 60,
      spacingRandomness: 0,
      useRandomRangeSpacing: false,
      randomSpacingMin: 35,
      randomSpacingMax: 50,
      textureRandomness: 0.5 + Math.random() * 0.49,
      scatter: 0,
      speed: 2,
      collisionVolume: 1.0,
      entryTransition: 150,
      entryScale: 0.3,
      exitScale: 0.3,
      useSizeGradient: true,
      useOpacityGradient: true,
      minOpacity: 0.5,
      isFunctional: false,
      isFixed: false,
      functionalControlPoints: [],
      omega: 1.0,
    };
    setPresets(prev => [...prev, newPreset]);
    setExpandedPresetId(newPreset.id);
  };

  const deletePreset = (id: string) => {
    if (presets.length <= 1) return;
    setPresets(prev => prev.filter(p => p.id !== id));
    if (activePresetId === id) setActivePresetId(presets[0].id);
    if (expandedPresetId === id) setExpandedPresetId(null);
  };

  const applyPresetToPath = (pathId: number, presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    updatePath(pathId, p => ({
      ...p,
      stream1: { ...preset.stream1, images: [...preset.stream1.images] },
      stream2: { ...preset.stream2, images: [...preset.stream2.images] },
      textSpacing: preset.textSpacing,
      spacingRandomness: preset.spacingRandomness,
      useRandomRangeSpacing: preset.useRandomRangeSpacing || false,
      randomSpacingMin: preset.randomSpacingMin || 35,
      randomSpacingMax: preset.randomSpacingMax || 50,
      scatter: preset.scatter,
      speed: preset.speed,
      collisionVolume: preset.collisionVolume || 1.0,
      entryTransition: preset.entryTransition,
      entryScale: preset.entryScale || 0.3,
      exitScale: preset.exitScale || 0.3,
      useSizeGradient: preset.useSizeGradient ?? true,
      useOpacityGradient: preset.useOpacityGradient ?? true,
      minOpacity: preset.minOpacity ?? 0.5,
      isFixed: preset.isFixed || false,
    }));
  };

  const applyPresetToAllPaths = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    saveStateToUndo();
    setPaths(prev => prev.map(p => ({
      ...p,
      stream1: { ...preset.stream1, images: [...preset.stream1.images] },
      stream2: { ...preset.stream2, images: [...preset.stream2.images] },
      textSpacing: preset.textSpacing,
      spacingRandomness: preset.spacingRandomness,
      useRandomRangeSpacing: preset.useRandomRangeSpacing || false,
      randomSpacingMin: preset.randomSpacingMin || 35,
      randomSpacingMax: preset.randomSpacingMax || 50,
      scatter: preset.scatter,
      speed: preset.speed,
      collisionVolume: preset.collisionVolume || 1.0,
      entryTransition: preset.entryTransition,
      entryScale: preset.entryScale || 0.3,
      exitScale: preset.exitScale || 0.3,
      useSizeGradient: preset.useSizeGradient ?? true,
      useOpacityGradient: preset.useOpacityGradient ?? true,
      minOpacity: preset.minOpacity ?? 0.5,
      isFixed: preset.isFixed || false,
      fixedParticlesSpawned: false
    })));
    showNotification('预设已应用到所有线条');
  };

  const applyIndividualParamToAllPaths = (key: keyof EditorConfig, value: any) => {
    saveStateToUndo();
    setPaths(prev => prev.map(p => {
      const updated = { ...p, [key]: value, fixedParticlesSpawned: false };
      if (key === 'stream1') updated.stream1 = { ...value, images: [...value.images] };
      if (key === 'stream2') updated.stream2 = { ...value, images: [...value.images] };
      return updated;
    }));
    showNotification(`参数已全域应用`);
  };

  const applyPresetToSpecificPaths = (presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset || !preset.targetLines) return;

    const targetIndices = new Set<number>();
    const parts = preset.targetLines.split(',');
    parts.forEach(part => {
      const trimmed = part.trim();
      if (!trimmed) return;
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr);
        const end = parseInt(endStr);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            targetIndices.add(i - 1);
          }
        }
      } else {
        const num = parseInt(trimmed);
        if (!isNaN(num)) {
          targetIndices.add(num - 1);
        }
      }
    });

    if (targetIndices.size === 0) return;

    setPaths(prev => prev.map((p, index) => {
      if (targetIndices.has(index)) {
        return {
          ...p,
          stream1: { ...preset.stream1, images: [...preset.stream1.images] },
          stream2: { ...preset.stream2, images: [...preset.stream2.images] },
          textSpacing: preset.textSpacing,
          spacingRandomness: preset.spacingRandomness,
          useRandomRangeSpacing: preset.useRandomRangeSpacing,
          randomSpacingMin: preset.randomSpacingMin || 35,
          randomSpacingMax: preset.randomSpacingMax || 50,
          scatter: preset.scatter,
          speed: preset.speed,
          collisionVolume: preset.collisionVolume || 1.0,
          entryTransition: preset.entryTransition,
          entryScale: preset.entryScale || 0.3,
          exitScale: preset.exitScale || 0.3,
          isFixed: preset.isFixed || false,
        };
      }
      return p;
    }));
  };

  const handleSimpleToolChange = (tool: ExperienceTool) => {
    simpleToolRef.current = tool;
    setSimpleTool(tool);
    simpleErasePointerActiveRef.current = false;
    simpleEraseUndoSavedRef.current = false;
    simpleErasedPathIdsRef.current = new Set();
    simpleEraseLastPointRef.current = null;
    currentPathRef.current = [];
    setIsDrawing(false);
  };

  const resetSimpleExperience = () => {
    if (paths.length === 0) return;

    saveStateToUndo();
    setPaths([]);
    particlesRef.current = [];
    currentPathRef.current = [];
    setIsDrawing(false);
    setSelectedPathId(null);
    setExpandedPathId(null);
  };

  // --- Reusable Parameter Editor UI ---
  // ParameterEditor is now a separate component to comply with Rules of Hooks


  return (
    <div className="relative w-full h-screen bg-white overflow-hidden touch-none font-sans">
      <style>{`
        .cursor-red {
          cursor: crosshair; /* Fallback */
          cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>') 12 12, crosshair;
        }
        .cursor-none {
          cursor: none;
        }
      `}</style>
      <canvas
        ref={canvasRef}
        aria-hidden={editorMode ? undefined : true}
        aria-label={editorMode ? '动画编辑画布' : undefined}
        tabIndex={editorMode ? 0 : undefined}
        className={`absolute inset-0 w-full h-full ${editorMode ? 'outline-none' : ''} ${
          !editorMode
            ? (simpleTool === 'erase' ? 'cursor-red' : 'cursor-crosshair')
            : isPanning ? 'cursor-grabbing'
            : isDraggingPath ? 'cursor-move'
            : liquifyMode ? 'cursor-none'
            : drawingMode === 'scissors' ? 'cursor-crosshair'
            : selectionMode ? 'cursor-pointer'
            : drawingMode === 'lasso' ? 'cursor-cell'
            : 'cursor-crosshair'
        }`}
        onContextMenu={editorMode ? undefined : event => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      
      {/* Notification Overlay */}
      {notification.visible && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-black/80 text-white px-6 py-2 rounded-full text-sm font-medium animate-in fade-in zoom-in duration-300">
          {notification.text}
        </div>
      )}

      {editorMode && (
        <>
      {/* Liquify Top Bar */}
      {liquifyMode && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-white/90 backdrop-blur-md p-3 rounded-2xl border border-blue-200 shadow-lg animate-in slide-in-from-top-4">
          <div className="flex items-center gap-2 border-r border-black/10 pr-4">
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">液化模式</span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-bold text-black/40">
                <span>笔刷大小</span>
                <span>{liquifyConfig.brushSize || 100}px</span>
              </div>
              <input 
                type="range" min="10" max="1000" step="10"
                value={liquifyConfig.brushSize || 100}
                onChange={e => setLiquifyConfig(prev => ({ ...prev, brushSize: Number(e.target.value) }))}
                className="w-32 accent-blue-500"
              />
            </div>

            <div className="flex bg-black/5 rounded-lg p-1">
              <button 
                onClick={() => setLiquifyConfig(prev => ({ ...prev, mode: 'push' }))}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${liquifyConfig.mode === 'push' ? 'bg-white shadow-sm text-blue-600' : 'text-black/40 hover:text-black'}`}
              >
                推 (Push)
              </button>
              <button 
                onClick={() => setLiquifyConfig(prev => ({ ...prev, mode: 'pinch' }))}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${liquifyConfig.mode === 'pinch' ? 'bg-white shadow-sm text-blue-600' : 'text-black/40 hover:text-black'}`}
              >
                捏 (Pinch)
              </button>
              <button 
                onClick={() => setLiquifyConfig(prev => ({ ...prev, mode: 'expand' }))}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${liquifyConfig.mode === 'expand' ? 'bg-white shadow-sm text-blue-600' : 'text-black/40 hover:text-black'}`}
              >
                扩 (Expand)
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px] font-bold text-black/40">
                <span>压力</span>
                <span>{Math.round((liquifyConfig.pressure || 0.5) * 100)}%</span>
              </div>
              <input 
                type="range" min="0.01" max="1" step="0.01"
                value={liquifyConfig.pressure || 0.5}
                onChange={e => setLiquifyConfig(prev => ({ ...prev, pressure: Number(e.target.value) }))}
                className="w-24 accent-blue-500"
              />
            </div>
          </div>

          <button 
            onClick={applyLiquify}
            className="ml-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <Check size={16} /> 应用 (Apply)
          </button>
        </div>
      )}

      {/* Top Left: Main Controls */}
      <div className={`absolute top-6 left-6 flex flex-col gap-3 z-10 transition-all duration-500 ${uiVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-10 pointer-events-none'}`}>
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md p-3 rounded-2xl border border-black/10 shadow-sm">
          
          {/* Undo / Redo */}
          <div className="flex items-center gap-1 border-r border-black/10 pr-3">
            <button
              onClick={undo}
              className="p-2 text-black/50 hover:text-black hover:bg-black/5 rounded-xl transition-colors"
              title="撤回 (Ctrl+Z)"
            >
              <Undo2 size={20} />
            </button>
            <button
              onClick={redo}
              className="p-2 text-black/50 hover:text-black hover:bg-black/5 rounded-xl transition-colors"
              title="重做 (Ctrl+Y)"
            >
              <Redo2 size={20} />
            </button>
          </div>

          {/* Drawing Mode Toggle */}
          <div className="flex bg-black/5 rounded-lg p-1">
            <button
              onClick={() => {
                setDrawingMode('path');
                setSelectionMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'path' && !selectionMode ? 'bg-white shadow-sm text-black' : 'text-black/50 hover:text-black'}`}
              title="画线模式"
            >
              <Palette size={16} /> 画线
            </button>
            <button
              onClick={() => {
                setSelectionMode(true);
                setDrawingMode('path');
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${selectionMode && drawingMode !== 'scissors' ? 'bg-red-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="选中模式"
            >
              <MousePointer2 size={16} /> 选中
            </button>
            <button
              onClick={() => {
                setDrawingMode('scissors');
                setSelectionMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'scissors' ? 'bg-red-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="剪刀模式 (点击线条断开)"
            >
              <Scissors size={16} /> 剪刀
            </button>
            <button
              onClick={() => {
                setDrawingMode('lasso');
                setSelectionMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'lasso' ? 'bg-orange-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="波光选区模式 (网格选区)"
            >
              <Sparkles size={16} /> 波光选区
            </button>
            <button
              onClick={() => {
                setDrawingMode('invert');
                setSelectionMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'invert' ? 'bg-black shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="反色画笔模式"
            >
              <Contrast size={16} /> 反色画笔
            </button>
            <button
              onClick={() => {
                setDrawingMode('speed_select');
                setSelectionMode(false);
                // When switching to speed_select, if an area is selected, load its cells
                if (selectedSpeedAreaId) {
                  const area = speedSelectionAreas.find(a => a.id === selectedSpeedAreaId);
                  if (area) setCurrentSpeedSelectionCells(new Set(area.cells));
                }
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'speed_select' ? 'bg-blue-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="速度选区模式"
            >
              <Gauge size={16} /> 速度选区
            </button>
            <button
              onClick={() => {
                setDrawingMode('inspect');
                setSelectionMode(false);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'inspect' ? 'bg-orange-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="控制台模式 (选中粒子查看参数)"
            >
              <Terminal size={16} /> 控制台
            </button>
            <button
              onClick={() => {
                setShowGrid(!showGrid);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${showGrid ? 'bg-indigo-500 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="显示/隐藏网格 (G)"
            >
              <Grid size={16} /> 网格
            </button>
            <button
              onClick={() => {
                setDrawingMode('grid');
                setSelectionMode(false);
                if (!showGrid) setShowGrid(true);
              }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${drawingMode === 'grid' ? 'bg-indigo-600 shadow-sm text-white' : 'text-black/50 hover:text-black'}`}
              title="坐标找点模式"
            >
              <Target size={16} /> 坐标找点
            </button>
          </div>

          <div className="w-px h-8 bg-black/10 mx-1" />
          
          {/* Speed */}
          <div className="flex items-center gap-2" title="全局流速倍率 (Global Speed Multiplier)">
            <Gauge size={18} className="text-black/50" />
            <div className="flex flex-col">
              <span className="text-[10px] font-bold text-black/40 uppercase tracking-tighter">全局倍率</span>
              <span className="text-[10px] font-mono text-blue-600">{(speedMultiplier * 100).toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="range" min="0" max="1" step="0.01" 
                value={speedMultiplier} 
                onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
                className="w-16 accent-black/70"
              />
              <input 
                type="number" min="0" max="1" step="0.01" 
                value={speedMultiplier} 
                onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value) || 0)} 
                onFocus={(e) => e.target.select()}
                className="w-10 bg-white/50 border border-black/10 rounded px-1 text-[10px] outline-none font-mono text-black" 
              />
            </div>
          </div>

          <div className="w-px h-8 bg-black/10 mx-1" />
          
          {/* Record */}
          <button
            onClick={toggleRecording}
            className={`p-2 rounded-xl transition-colors flex items-center gap-1 ${isRecording ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'text-black/50 hover:text-black hover:bg-black/5'}`}
            title={isRecording ? "停止录制并保存 (Stop)" : "录制视频 (Record MP4/WebM)"}
          >
            {isRecording ? <Square size={18} fill="currentColor" /> : <Video size={20} />}
            {isRecording && <span className="text-xs font-bold pr-1 animate-pulse">录制中</span>}
          </button>

          <div className="w-px h-8 bg-black/10 mx-1" />

          {/* Export / Import */}
          <div className="flex items-center gap-1">
            <button
              onClick={exportProject}
              className="p-2 text-black/50 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors flex items-center gap-1"
              title="导出项目文件 (.json)"
            >
              <Download size={18} />
              <span className="text-[10px] font-bold">导出</span>
            </button>
            <label className="p-2 text-black/50 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors cursor-pointer flex items-center gap-1" title="导入项目文件 (.json)">
              <Upload size={18} />
              <span className="text-[10px] font-bold">导入</span>
              <input type="file" accept=".json" className="hidden" onChange={importProject} />
            </label>
          </div>

          <div className="w-px h-8 bg-black/10 mx-1" />

          {/* Hide UI */}
          <button
            onClick={toggleUIVisibility}
            className="p-2 text-black/50 hover:text-black hover:bg-black/5 rounded-xl transition-colors flex items-center gap-1"
            title="隐藏所有面板 (H)"
          >
            <EyeOff size={18} />
            <span className="text-[10px] font-bold">隐藏</span>
          </button>

          <div className="w-px h-8 bg-black/10 mx-1" />

          {/* Controls */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-2 rounded-xl transition-colors flex items-center gap-1 ${isPaused ? 'bg-orange-50 text-orange-500 hover:bg-orange-100' : 'text-black/50 hover:text-black hover:bg-black/5'}`}
            title={isPaused ? "继续动画 (Space)" : "暂停动画 (Space)"}
          >
            {isPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
            <span className="text-[10px] font-bold">{isPaused ? "继续" : "暂停"}</span>
          </button>

          <button
            onClick={saveAsJPG}
            className="p-2 text-black/50 hover:text-green-600 hover:bg-green-50 rounded-xl transition-colors flex items-center gap-1"
            title="保存为 JPG 格式 (300 DPI)"
          >
            <Download size={18} />
            <span className="text-[10px] font-bold">保存 JPG</span>
          </button>

          <button
            onClick={clearCurrentEffects}
            className="p-2 text-black/50 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors flex items-center gap-1"
            title="清空当前所有效果"
          >
            <Eraser size={18} />
            <span className="text-[10px] font-bold">清空效果</span>
          </button>

          <div className="w-px h-8 bg-black/10 mx-1" />

          {/* Clear */}
          <div className="flex items-center gap-1 border-l border-black/10 pl-3">
            <button
              onClick={clearCanvas}
              className="p-2 text-black/50 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
              title="清空所有 (Clear All)"
            >
              <Trash2 size={20} />
            </button>
            <button
              onClick={() => {
                setShimmerCells(new Set());
                shimmerCellsRef.current = new Set();
              }}
              className="p-2 text-black/50 hover:text-orange-500 hover:bg-orange-50 rounded-xl transition-colors"
              title="清空波光选区"
            >
              <XCircle size={20} />
            </button>
            <button
              onClick={() => {
                setGridPoints([]);
                setGridBoxes([]);
                gridPointsRef.current = [];
                gridBoxesRef.current = [];
              }}
              className="p-2 text-black/50 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition-colors"
              title="清空网格点位"
            >
              <Square size={20} />
            </button>
            <button
              onClick={() => {
                setInvertCells(new Set());
                invertCellsRef.current = new Set();
              }}
              className="p-2 text-black/50 hover:text-black hover:bg-black/5 rounded-xl transition-colors"
              title="清空反色画笔"
            >
              <Contrast size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Console UI */}
      {drawingMode === 'inspect' && selectedParticleId && uiVisible && (
        <div className="absolute bottom-6 left-6 w-80 bg-black/90 backdrop-blur-md p-4 rounded-2xl border border-orange-500/30 shadow-2xl z-20 text-white font-mono text-[10px] animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
            <div className="flex items-center gap-2 text-orange-400">
              <Activity size={14} />
              <span className="font-bold uppercase tracking-wider">Particle Inspector</span>
            </div>
            <button onClick={() => setSelectedParticleId(null)} className="text-white/40 hover:text-white"><XCircle size={14}/></button>
          </div>
          
          {(() => {
            const p = particlesRef.current.find(p => p.id === selectedParticleId);
            if (!p) return <div className="text-white/40 italic">Particle lost...</div>;
            
            return (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">ID</span>
                  <span className="text-orange-300 truncate">{p.id}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Path ID</span>
                  <span className="text-blue-300">{p.pathId.toString().slice(0, 8)}</span>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Position X</span>
                  <span className="text-green-300">{p.x.toFixed(2)} px</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Position Y</span>
                  <span className="text-green-300">{(logicalHeight - p.y).toFixed(2)} px</span>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Velocity X</span>
                  <span className="text-yellow-300">{p.vx.toFixed(3)} px/f</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Velocity Y</span>
                  <span className="text-yellow-300">{(-p.vy).toFixed(3)} px/f</span>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Distance</span>
                  <span className="text-purple-300">{p.distance.toFixed(1)} px</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Angle</span>
                  <span className="text-purple-300">{(p.pathAngle * 180 / Math.PI).toFixed(1)}°</span>
                </div>
                
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Stream</span>
                  <span className="text-pink-300">{p.stream === 0 ? 'Dots' : `Stream ${p.stream}`}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-white/40 uppercase text-[8px]">Tex Index</span>
                  <span className="text-pink-300">{p.textureIndex}</span>
                </div>
                
                <div className="flex flex-col col-span-2 mt-2 pt-2 border-t border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-white/40 uppercase text-[8px]">Radius</span>
                    <span className="text-white/80">{p.radius.toFixed(1)} px</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/40 uppercase text-[8px]">Base Speed</span>
                    <span className="text-white/80">{p.speed.toFixed(2)} px/f ({(p.speed * 60).toFixed(0)} px/s)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/40 uppercase text-[8px]">Master Multiplier</span>
                    <span className="text-blue-400">{(speedMultiplierRef.current * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
      <div className={`absolute top-32 right-6 bottom-8 w-80 z-10 pointer-events-none transition-all duration-500 ${uiVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10'}`}>
        <style>{`
          .hide-scrollbar::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        <div className="flex flex-col gap-3 max-h-[90vh] overflow-y-auto pointer-events-auto pb-8 hide-scrollbar" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        
        {/* Global Effects Panel */}
        <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-black/10 shadow-sm shrink-0">
          <div className="flex items-center gap-2 mb-2 text-black/70">
            <Sparkles size={18} />
            <h3 className="font-bold text-sm">全局效果 (Global Effects)</h3>
          </div>
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-black/10 bg-black/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Contrast size={14} className="text-black/50" />
                <span className="text-xs font-bold text-black/50">全屏反色 (Global Invert)</span>
              </div>
              <button 
                onClick={() => setIsInverted(!isInverted)}
                className={`w-10 h-5 rounded-full transition-colors relative ${isInverted ? 'bg-blue-500' : 'bg-black/20'}`}
                title="快捷键: I"
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isInverted ? 'left-6' : 'left-1'}`} />
              </button>
            </div>

            {(invertCells.size > 0 || drawingMode === 'invert') && (
              <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-black/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplets size={14} className="text-black/50" />
                    <span className="text-xs font-bold text-black/50">反色画笔 (Invert Brush)</span>
                  </div>
                  <button 
                    onClick={() => {
                      saveStateToUndo();
                      setInvertCells(new Set());
                    }}
                    className="text-[10px] font-bold text-red-500 hover:text-red-600 transition-colors bg-red-50 px-2 py-1 rounded border border-red-100"
                  >
                    清空反色
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-black/40 italic">
                  <span>使用反色画笔在画布上涂抹以创建局部反色区域</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Background Image Panel */}
        <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-black/10 shadow-sm shrink-0">
          <div className="flex items-center gap-2 mb-2 text-black/70">
            <ImageIcon size={18} />
            <h3 className="font-bold text-sm">背景设置 (Background)</h3>
          </div>
          <div className="flex flex-col gap-2 p-3 rounded-xl border border-black/10 bg-black/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-black/50">背景图</span>
              <input type="file" ref={fileInputBgRef} onChange={handleBgUpload} accept="image/*" className="hidden" />
              <button onClick={() => fileInputBgRef.current?.click()} className="text-blue-500 hover:text-blue-600 transition-colors flex items-center gap-1 text-xs font-medium bg-blue-50 px-2 py-1 rounded border border-blue-100" title="上传背景图">
                <ImagePlus size={14}/> 上传背景
              </button>
            </div>
            
            {bgImage && (
              <>
                <div className="flex items-center justify-between bg-white p-1 rounded border border-black/10">
                  <div className="flex items-center gap-2">
                    <img src={bgImage.src} className={`h-8 w-auto object-contain rounded ${!showBgImage ? 'opacity-30 grayscale' : ''}`} alt="BG" />
                    <button 
                      onClick={() => setShowBgImage(!showBgImage)}
                      className={`p-1 rounded transition-colors ${showBgImage ? 'text-blue-500 hover:bg-blue-50' : 'text-black/30 hover:bg-black/5'}`}
                      title={showBgImage ? "隐藏背景" : "显示背景"}
                    >
                      {showBgImage ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </div>
                  <button onClick={() => {
                    setBgImage(null);
                  }} className="text-red-400 hover:text-red-600 p-1"><XCircle size={16}/></button>
                </div>
                <div className="flex flex-col gap-1 mt-1">
                  <div className="flex justify-between items-center text-xs text-black/60">
                    <span>大小 (Scale)</span>
                    <input type="range" min="0.1" max="5" step="0.1" value={bgScale || 1} onChange={e => setBgScale(Number(e.target.value))} className="w-24 accent-blue-500" />
                  </div>
                  <div className="flex justify-between items-center text-xs text-black/60">
                    <span>旋转 (Rot)</span>
                    <input type="range" min="0" max="360" step="1" value={bgRotation || 0} onChange={e => setBgRotation(Number(e.target.value))} className="w-24 accent-blue-500" />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Draw Line Panel */}
        {drawingMode === 'path' && !selectionMode && (
          <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-blue-200 shadow-sm shrink-0 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-blue-600">
                <Palette size={18} />
                <h3 className="font-bold text-sm">画线设置 (Line Settings)</h3>
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              {/* Color Selection */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-black/40 uppercase tracking-wider">线条颜色 (Line Color)</span>
                <div className="flex gap-3">
                  {COLORS.map((color, i) => (
                    <button
                      key={color}
                      onClick={() => setColorIndex(i)}
                      className={`w-8 h-8 rounded-full transition-all duration-300 ${colorIndex === i ? 'scale-125 ring-2 ring-black/30 ring-offset-2 ring-offset-white' : 'hover:scale-110 opacity-70 hover:opacity-100'}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Select color ${i + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Path Visibility Toggle */}
              <div className="flex items-center justify-between bg-black/5 p-3 rounded-xl">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-black/70">路径显示 (Path Visibility)</span>
                  <span className="text-[10px] text-black/40">显示或隐藏线条路径</span>
                </div>
                <button 
                  onClick={() => setShowPaths(!showPaths)}
                  className={`w-10 h-5 rounded-full transition-colors relative ${showPaths ? 'bg-blue-500' : 'bg-black/20'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${showPaths ? 'left-6' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grid Points Panel */}
        {drawingMode === 'grid' && (
          <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-indigo-200 shadow-sm shrink-0 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-indigo-600">
                <Settings2 size={18} />
                <h3 className="font-bold text-sm">坐标找点 (Grid Points)</h3>
              </div>
              <button 
                onClick={() => setGridPoints([])}
                className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                title="清空所有点位"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1 text-xs">
              {gridPoints.length === 0 ? (
                <p className="text-black/40 italic text-center py-4">点击网格生成点位 (102px吸附)</p>
              ) : (
                gridPoints.map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between bg-indigo-50/50 p-2 rounded-lg border border-indigo-100">
                    <span className="font-mono text-indigo-700">P{i+1}: ({p.x}, {p.y})</span>
                    <button 
                      onClick={() => setGridPoints(prev => prev.filter(gp => gp.id !== p.id))}
                      className="text-red-400 hover:text-red-600"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {gridPoints.length > 0 && (
              <button 
                onClick={() => {
                  const text = gridPoints.map((p, i) => `P${i+1}: (${p.x}, ${p.y})`).join('\n');
                  navigator.clipboard.writeText(text);
                }}
                className="w-full mt-3 bg-indigo-500 hover:bg-indigo-600 text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Copy size={14} /> 复制所有点位坐标
              </button>
            )}

            <div className="w-full h-px bg-indigo-100 my-4" />

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-blue-600">
                <Square size={18} />
                <h3 className="font-bold text-sm">方块面积 (Grid Boxes)</h3>
              </div>
              <button 
                onClick={() => setGridBoxes([])}
                className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                title="清空所有方块"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1 text-[10px]">
              {gridBoxes.length === 0 ? (
                <p className="text-black/40 italic text-center py-4">选择两个点生成方块</p>
              ) : (
                gridBoxes.map((box, i) => {
                  const x = Math.min(box.x1, box.x2);
                  const y = Math.min(box.y1, box.y2);
                  const w = Math.abs(box.x1 - box.x2);
                  const h = Math.abs(box.y1 - box.y2);
                  const info = `L:${x} T:${y} R:${x+w} B:${y+h}`;
                  return (
                    <div key={box.id} className="flex items-center justify-between bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                      <span className="font-mono text-blue-700">B{i+1}: {info}</span>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => navigator.clipboard.writeText(info)}
                          className="text-blue-400 hover:text-blue-600 p-1"
                          title="复制此方块信息"
                        >
                          <Copy size={12} />
                        </button>
                        <button 
                          onClick={() => setGridBoxes(prev => prev.filter(gb => gb.id !== box.id))}
                          className="text-red-400 hover:text-red-600 p-1"
                        >
                          <XCircle size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {gridBoxes.length > 0 && (
              <button 
                onClick={() => {
                  const text = gridBoxes.map((box, i) => {
                    const x = Math.min(box.x1, box.x2);
                    const y = Math.min(box.y1, box.y2);
                    const w = Math.abs(box.x1 - box.x2);
                    const h = Math.abs(box.y1 - box.y2);
                    return `B${i+1}: L:${x} T:${y} R:${x+w} B:${y+h}`;
                  }).join('\n');
                  navigator.clipboard.writeText(text);
                }}
                className="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
              >
                <Copy size={14} /> 复制所有方块信息
              </button>
            )}

            <div className="w-full h-px bg-indigo-100 my-4" />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Activity size={18} />
                  <h3 className="font-bold text-sm">吸附精度 (Snap Step)</h3>
                </div>
                <span className="text-xs font-mono bg-indigo-50 px-2 py-0.5 rounded text-indigo-600">
                  {snapStep.toFixed(2)}
                </span>
              </div>
              
              <div className="flex items-center gap-4">
                <input 
                  type="range" 
                  min="0.05" 
                  max="1" 
                  step="0.05" 
                  value={snapStep || 0.5} 
                  onChange={(e) => setSnapStep(Number(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <input 
                  type="number" 
                  min="0.05" 
                  max="1" 
                  step="0.05" 
                  value={snapStep || 0.5} 
                  onChange={(e) => setSnapStep(Number(e.target.value))}
                  className="w-16 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 text-xs font-mono text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                />
              </div>
              <p className="text-[10px] text-black/40 italic">
                调整网格吸附的精细程度 (当前: {(snapStep * GRID_UNIT).toFixed(1)}px)
              </p>
            </div>
          </div>
        )}

        {/* Invert Controls (Show if cells exist or in invert mode) */}
        {(invertCells.size > 0 || drawingMode === 'invert') && (
          <div className="flex flex-col gap-3 bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-black/20 shadow-sm shrink-0 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-black">
                <Contrast size={18} />
                <h3 className="font-bold text-sm">反色遮罩效果 (笔刷涂抹)</h3>
              </div>
              <button 
                onClick={() => {
                  setInvertCells(new Set());
                  invertCellsRef.current = new Set();
                }}
                className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                title="清空所有反色选区"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 text-sm text-black/70 px-1">
              <div className="flex justify-between items-center" title="笔刷大小 (1-10个网格单位)">
                <span>笔刷大小 (Brush Size)</span>
                <div className="flex items-center gap-2">
                  <input type="range" min="1" max="10" step="1" value={invertBrushSize || 1} onChange={e => setInvertBrushSize(Number(e.target.value))} className="w-24 accent-black" />
                  <span className="w-4 text-center">{invertBrushSize || 1}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Shimmer Controls (Show if cells exist or in lasso mode) */}
        {(shimmerCells.size > 0 || drawingMode === 'lasso') && (
          <div className="flex flex-col gap-3 bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-blue-200 shadow-sm shrink-0 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-blue-600">
                <Sparkles size={18} />
                <h3 className="font-bold text-sm">波光变化效果 (笔刷涂抹)</h3>
              </div>
              <button 
                onClick={clearShimmer}
                className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                title="清空所有波光选区"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="flex flex-col gap-3 text-sm text-black/70 px-1">
              <div className="flex justify-between items-center" title="笔刷大小 (1-5个网格单位)">
                <span>笔刷大小 (Brush Size)</span>
                <div className="flex items-center gap-2">
                  <input type="range" min="1" max="5" step="1" value={shimmerBrushSize || 1} onChange={e => setShimmerBrushSize(Number(e.target.value))} className="w-24 accent-blue-500" />
                  <span className="text-center w-4">{shimmerBrushSize || 1}</span>
                </div>
              </div>
              <div className="h-px bg-black/5 my-1" />
              <div className="flex justify-between items-center" title="文字变化的速度">
                <span>变化速度 (Speed)</span>
                <div className="flex items-center gap-2">
                  <input type="range" min="0" max="20" step="0.5" value={shimmerSpeed || 5} onChange={e => setShimmerSpeed(Number(e.target.value))} className="w-24 accent-blue-500" />
                  <input type="number" step="0.5" value={shimmerSpeed || 5} onChange={e => setShimmerSpeed(Number(e.target.value))} className="w-12 bg-white border border-black/10 rounded px-1 text-xs outline-none" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Speed Selection Panel */}
        {(speedSelectionAreas.length > 0 || drawingMode === 'speed_select') && (
          <div className="bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-black/10 shadow-sm shrink-0 animate-in fade-in slide-in-from-right-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-blue-600">
                <Gauge size={18} />
                <h3 className="font-bold text-sm">速度选区 (Speed Selection)</h3>
              </div>
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => {
                    setSelectedSpeedAreaId(null);
                    setCurrentSpeedSelectionCells(new Set());
                    setDrawingMode('speed_select');
                    setSelectionMode(false);
                    showNotification('准备绘制新选区');
                  }}
                  className="text-blue-500 hover:text-blue-600 p-1 rounded-md transition-colors"
                  title="新增选区"
                >
                  <Plus size={16} />
                </button>
                <button 
                  onClick={() => {
                    saveStateToUndo();
                    setSpeedSelectionAreas([]);
                    setCurrentSpeedSelectionCells(new Set());
                    setSelectedSpeedAreaId(null);
                  }}
                  className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                  title="清空所有速度选区"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 p-3 rounded-xl border border-black/10 bg-black/5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-black/50">笔刷大小</span>
                <div className="flex items-center gap-2">
                  <input 
                    type="range" 
                    min="1" 
                    max="10" 
                    step="1" 
                    value={shimmerBrushSize} 
                    onChange={(e) => setShimmerBrushSize(Number(e.target.value))}
                    className="w-24 accent-blue-500"
                  />
                  <span className="text-[10px] font-mono w-4 text-center">{shimmerBrushSize}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsSpeedEraser(false)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${!isSpeedEraser ? 'bg-blue-500 text-white border-blue-600 shadow-sm' : 'bg-white text-black/60 border-black/10 hover:bg-black/5'}`}
                >
                  画笔
                </button>
                <button
                  onClick={() => setIsSpeedEraser(true)}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${isSpeedEraser ? 'bg-red-500 text-white border-red-600 shadow-sm' : 'bg-white text-black/60 border-black/10 hover:bg-black/5'}`}
                >
                  橡皮擦
                </button>
              </div>

              {drawingMode === 'speed_select' && (
                <button
                  onClick={() => {
                    if (currentSpeedSelectionCells.size === 0) return;
                    saveStateToUndo();
                    
                    // If we are editing an existing area, update it instead of creating a new one
                    if (selectedSpeedAreaId) {
                      setSpeedSelectionAreas(prev => prev.map(a => 
                        a.id === selectedSpeedAreaId 
                        ? { ...a, cells: Array.from(currentSpeedSelectionCells) } 
                        : a
                      ));
                      showNotification('速度选区已更新');
                    } else {
                      const newArea: SpeedSelectionArea = {
                        id: Math.random().toString(36).substr(2, 9),
                        cells: Array.from(currentSpeedSelectionCells),
                        speedMultiplier: 1.0
                      };
                      setSpeedSelectionAreas(prev => [...prev, newArea]);
                      setSelectedSpeedAreaId(newArea.id);
                      showNotification('速度选区已确认');
                    }
                    setCurrentSpeedSelectionCells(new Set());
                  }}
                  className="w-full py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={14} /> {selectedSpeedAreaId ? '更新区域' : '确认区域'}
                </button>
              )}
            </div>

            {speedSelectionAreas.length > 0 && (
              <div className="flex flex-col gap-2 mt-3 max-h-40 overflow-y-auto pr-1">
                {speedSelectionAreas.map((area, idx) => (
                  <div 
                    key={area.id} 
                    className={`p-2 rounded-xl border transition-all cursor-pointer ${selectedSpeedAreaId === area.id ? 'bg-blue-50 border-blue-200 ring-1 ring-blue-200' : 'bg-white border-black/5 hover:border-black/10'}`}
                    onClick={() => {
                      setSelectedSpeedAreaId(area.id);
                      if (drawingMode === 'speed_select') {
                        setCurrentSpeedSelectionCells(new Set(area.cells));
                      }
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-black/70">选区 {idx + 1}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          saveStateToUndo();
                          setSpeedSelectionAreas(prev => prev.filter(a => a.id !== area.id));
                          if (selectedSpeedAreaId === area.id) {
                            setSelectedSpeedAreaId(null);
                            setCurrentSpeedSelectionCells(new Set());
                          }
                        }}
                        className="text-red-400 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[10px] text-black/50">
                        <span>倍率 (Mult)</span>
                        <div className="flex items-center gap-2">
                          <input 
                            type="range" 
                            min="0.2" 
                            max="2.0" 
                            step="0.01" 
                            value={area.speedMultiplier || 1} 
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setSpeedSelectionAreas(prev => prev.map(a => a.id === area.id ? { ...a, speedMultiplier: val } : a));
                            }}
                            className="w-20 accent-blue-500"
                          />
                          <input 
                            type="number" 
                            min="0.2" 
                            max="2.0" 
                            step="0.01" 
                            value={area.speedMultiplier || 1} 
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => {
                              let val = parseFloat(e.target.value);
                              if (isNaN(val)) val = 1;
                              setSpeedSelectionAreas(prev => prev.map(a => a.id === area.id ? { ...a, speedMultiplier: val } : a));
                            }}
                            onFocus={e => e.target.select()}
                            className="w-10 bg-white border border-black/10 rounded px-1 text-[10px] outline-none font-mono text-black" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Presets Manager Panel */}
        <div className="bg-white/90 backdrop-blur-md rounded-2xl border border-black/10 shadow-sm shrink-0 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-black/10 bg-blue-50/50">
            <div className="flex items-center gap-2 text-blue-600">
              <Library size={18} />
              <h3 className="font-bold text-sm">参数预设 (Presets)</h3>
            </div>
            <button onClick={addPreset} className="text-blue-500 hover:text-blue-700 p-1 rounded-md transition-colors" title="添加新预设">
              <Plus size={18} />
            </button>
          </div>
          
          <div className="p-2 flex flex-col gap-2">
            {presets.map((preset) => (
              <div key={preset.id} className={`border rounded-xl overflow-hidden transition-colors ${activePresetId === preset.id ? 'border-blue-400 bg-blue-50/30' : 'border-black/10'}`}>
                <div 
                  className="flex items-center justify-between p-2 cursor-pointer hover:bg-black/5"
                  onClick={() => {
                    setActivePresetId(preset.id);
                    if (expandedPresetId !== preset.id) setExpandedPresetId(preset.id);
                  }}
                >
                  <div className="flex items-center gap-2">
                    {activePresetId === preset.id ? <CheckCircle2 size={16} className="text-blue-500" /> : <div className="w-4 h-4 rounded-full border border-black/20" />}
                    <input 
                      type="text" 
                      value={preset.name}
                      onChange={(e) => updatePreset(preset.id, p => ({ ...p, name: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-transparent outline-none text-sm font-bold text-black/70 w-24"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => { e.stopPropagation(); applyPresetToAllPaths(preset.id); }}
                      className="text-black/40 hover:text-blue-500 p-1 rounded transition-colors"
                      title="应用到所有线条"
                    >
                      <Copy size={14} />
                    </button>
                    {presets.length > 1 && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); deletePreset(preset.id); }}
                        className="text-black/30 hover:text-red-500 p-1 rounded transition-colors"
                        title="删除预设"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button 
                      onClick={(e) => { e.stopPropagation(); setExpandedPresetId(expandedPresetId === preset.id ? null : preset.id); }}
                      className="text-black/50 p-1"
                    >
                      {expandedPresetId === preset.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>
                
                {expandedPresetId === preset.id && (
                  <div className="p-3 pt-0 border-t border-black/5 mt-2">
                    <div className="flex items-center gap-2 mb-3 bg-blue-50/50 p-2 rounded-lg border border-blue-100/50 mt-2">
                      <span className="text-xs font-bold text-blue-700 whitespace-nowrap">指定线条:</span>
                      <input
                        type="text"
                        value={preset.targetLines || ''}
                        onChange={(e) => updatePreset(preset.id, p => ({ ...p, targetLines: e.target.value }))}
                        placeholder="如 1,3,4-6"
                        className="flex-1 bg-white border border-blue-200 rounded px-2 py-1 text-xs outline-none focus:border-blue-500 text-black/70"
                      />
                      <button
                        onClick={() => applyPresetToSpecificPaths(preset.id)}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shadow-sm"
                      >
                        赋予
                      </button>
                    </div>
                    <ParameterEditor
                      config={preset}
                      updateStreamFn={(streamNum, updates) => updatePresetStream(preset.id, streamNum, updates)}
                      updateParamsFn={(updates) => updatePreset(preset.id, p => ({ ...p, ...updates }))}
                      handleImageUploadFn={(streamNum, e) => handlePresetImageUpload(preset.id, streamNum, e)}
                      removeImageFn={(streamNum, imageId) => removePresetImage(preset.id, streamNum, imageId)}
                      restoreBuiltinImagesFn={(streamNum) => updatePresetStream(
                        preset.id,
                        streamNum,
                        {
                          images: [...(
                            streamNum === 1
                              ? builtinStreams.stream1
                              : builtinStreams.stream2
                          )],
                        },
                      )}
                      builtinImageCount={{
                        1: builtinStreams.stream1.length,
                        2: builtinStreams.stream2.length,
                      }}
                      showNotification={showNotification}
                      isPath={false}
                      applyToAllFn={applyIndividualParamToAllPaths}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Paths List */}
        {paths.map((path, index) => (
          <div key={path.id} className={`bg-white/90 backdrop-blur-md rounded-2xl border shadow-sm shrink-0 overflow-hidden transition-all duration-300 ${selectedPathId === path.id ? 'border-green-500 ring-4 ring-green-500/20 bg-green-50/50' : 'border-black/10'}`}>
            {/* Header / Toggle */}
            <div 
              className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${selectedPathId === path.id ? 'bg-green-100/50 hover:bg-green-100/80' : 'hover:bg-black/5'}`}
              onClick={() => setSelectedPathId(selectedPathId === path.id ? null : path.id)}
            >
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: path.color }} />
                <span className="font-bold text-sm text-black/70">线条 {index + 1}</span>
                {path.isFunctional && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full uppercase font-bold tracking-tighter">函数拟合</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLiquifyPathId(path.id);
                    setLiquifyMode(true);
                    setSelectedPathId(path.id);
                  }}
                  className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                  title="液化模式"
                >
                  <Droplets size={16} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); applyPresetToPath(path.id, activePresetId); }}
                  className="text-blue-500 hover:text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded text-xs font-medium transition-colors"
                  title="应用当前选中的预设"
                >
                  应用预设
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); deletePath(path.id); }}
                  className="text-black/30 hover:text-red-500 p-1 rounded-md transition-colors"
                  title="删除此线条"
                >
                  <Trash2 size={16} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); updatePath(path.id, p => ({ ...p, hidden: !p.hidden })); }}
                  className={`${path.hidden ? 'text-orange-500' : 'text-black/30 hover:text-blue-500'} p-1 rounded-md transition-colors`}
                  title={path.hidden ? "显示此线条" : "隐藏此线条"}
                >
                  {path.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedPathId(expandedPathId === path.id ? null : path.id); }}
                  className="p-1 text-black/50 hover:bg-black/5 rounded"
                >
                  {expandedPathId === path.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {/* Expanded Content */}
            {expandedPathId === path.id && (
              <div className="p-4 pt-0 border-t border-black/10 flex flex-col gap-3 mt-3">
                <div className="flex items-center justify-between bg-indigo-50 p-2 rounded-xl border border-indigo-100 mb-2">
                  <div className="flex items-center gap-2 text-indigo-700">
                    <Activity size={16} />
                    <span className="text-xs font-bold">函数拟合模式 (Functional Mode)</span>
                  </div>
                  <button 
                    onClick={() => updatePath(path.id, p => ({ ...p, isFunctional: !p.isFunctional }))}
                    className={`w-10 h-5 rounded-full transition-colors relative ${path.isFunctional ? 'bg-indigo-500' : 'bg-black/20'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${path.isFunctional ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between bg-blue-50 p-2 rounded-xl border border-blue-100 mb-2">
                  <div className="flex items-center gap-2 text-blue-700">
                    <Square size={16} />
                    <span className="text-xs font-bold">固定文本模式 (Fixed Text Mode)</span>
                  </div>
                  <button 
                    onClick={() => updatePath(path.id, p => ({ ...p, isFixed: !p.isFixed }))}
                    className={`w-10 h-5 rounded-full transition-colors relative ${path.isFixed ? 'bg-blue-500' : 'bg-black/20'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${path.isFixed ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex flex-col gap-2 p-2 bg-black/5 rounded mb-2 group">
                  <div className="flex justify-between items-center" title="字符尺寸渐入渐出">
                    <div className="flex items-center gap-2 text-black/70 font-bold text-xs"><Contrast size={14} className="text-blue-500"/> 尺寸渐变</div>
                    <button 
                      onClick={() => updatePath(path.id, p => ({ ...p, useSizeGradient: !p.useSizeGradient }))}
                      className={`w-10 h-5 rounded-full transition-colors relative ${path.useSizeGradient ? 'bg-blue-500' : 'bg-black/20'}`}
                    >
                      <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${path.useSizeGradient ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 p-2 bg-black/5 rounded mb-2 group">
                  <div className="flex justify-between items-center" title="字符透明度渐入渐出">
                    <div className="flex items-center gap-2 text-black/70 font-bold text-xs"><Eye size={14} className="text-blue-500"/> 透明度渐变</div>
                    <button 
                      onClick={() => updatePath(path.id, p => ({ ...p, useOpacityGradient: !p.useOpacityGradient }))}
                      className={`w-10 h-5 rounded-full transition-colors relative ${path.useOpacityGradient ? 'bg-blue-500' : 'bg-black/20'}`}
                    >
                      <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${path.useOpacityGradient ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                </div>

                {path.isFunctional && (
                  <div className="flex flex-col gap-3 bg-indigo-50/30 p-3 rounded-xl border border-indigo-100/50 mb-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[10px] text-indigo-600 font-bold mb-1">
                        <span>全局频率 (Global Omega)</span>
                        <div className="flex items-center gap-2">
                           <input 
                            type="number" step="0.01" 
                            value={path.omega} 
                            onChange={e => updatePath(path.id, p => ({ ...p, omega: Number(e.target.value) || 0.01 }))}
                            onFocus={e => e.target.select()}
                            className="w-12 bg-white border border-indigo-100 rounded px-1 text-[10px] outline-none" 
                          />
                        </div>
                      </div>
                      <input 
                        type="range" min="0.01" max="0.5" step="0.01" 
                        value={path.omega} 
                        onChange={e => updatePath(path.id, p => ({ ...p, omega: Number(e.target.value) }))}
                        className="w-full accent-indigo-500" 
                      />
                    </div>

                    <div className="h-px bg-indigo-100 my-1" />
                    
                    <div className="text-[10px] font-bold text-indigo-600 mb-1 flex items-center gap-1">
                      <Waves size={12} /> 控制点参数 (Control Points)
                    </div>
                    
                    <div className="max-h-40 overflow-y-auto pr-1 flex flex-col gap-3">
                      {path.functionalControlPoints.map((cp, cpIndex) => (
                        <div key={cpIndex} className="bg-white p-2 rounded-lg border border-indigo-100 shadow-sm">
                          <div className="text-[9px] text-indigo-400 mb-2 border-b border-indigo-50 pb-1 flex justify-between">
                            <span>节点 {cpIndex + 1}</span>
                            <span>Pos: {cp.cx.toFixed(0)}, {cp.cy.toFixed(0)}</span>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between items-center text-[8px] text-black/50">
                                <span>振幅 (Amplitude)</span>
                                <input 
                                  type="number" step="1" 
                                  value={cp.amplitude} 
                                  onChange={e => {
                                    const newCPs = [...path.functionalControlPoints];
                                    newCPs[cpIndex] = { ...cp, amplitude: Number(e.target.value) || 0 };
                                    updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                  }}
                                  onFocus={e => e.target.select()}
                                  className="w-8 bg-white border border-black/5 rounded text-[8px] px-0.5"
                                />
                              </div>
                              <input 
                                type="range" min="0" max="50" step="1" 
                                value={cp.amplitude} 
                                onChange={e => {
                                  const newCPs = [...path.functionalControlPoints];
                                  newCPs[cpIndex] = { ...cp, amplitude: Number(e.target.value) };
                                  updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                }}
                                className="w-full accent-indigo-400 h-1" 
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between items-center text-[8px] text-black/50">
                                <span>频率 (Frequency)</span>
                                <input 
                                  type="number" step="0.1" 
                                  value={cp.frequency} 
                                  onChange={e => {
                                    const newCPs = [...path.functionalControlPoints];
                                    newCPs[cpIndex] = { ...cp, frequency: Number(e.target.value) || 0.1 };
                                    updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                  }}
                                  onFocus={e => e.target.select()}
                                  className="w-8 bg-white border border-black/5 rounded text-[8px] px-0.5"
                                />
                              </div>
                              <input 
                                type="range" min="0.1" max="5" step="0.1" 
                                value={cp.frequency} 
                                onChange={e => {
                                  const newCPs = [...path.functionalControlPoints];
                                  newCPs[cpIndex] = { ...cp, frequency: Number(e.target.value) };
                                  updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                }}
                                className="w-full accent-indigo-400 h-1" 
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <div className="flex justify-between items-center text-[8px] text-black/50">
                                <span>相位 (Phase)</span>
                                <input 
                                  type="number" step="0.1" 
                                  value={parseFloat((cp.phase / Math.PI).toFixed(2))} 
                                  onChange={e => {
                                    const newCPs = [...path.functionalControlPoints];
                                    newCPs[cpIndex] = { ...cp, phase: Number(e.target.value) * Math.PI };
                                    updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                  }}
                                  onFocus={e => e.target.select()}
                                  className="w-8 bg-white border border-black/5 rounded text-[8px] px-0.5"
                                />
                              </div>
                              <input 
                                type="range" min={-Math.PI} max={Math.PI} step={0.1} 
                                value={cp.phase} 
                                onChange={e => {
                                  const newCPs = [...path.functionalControlPoints];
                                  newCPs[cpIndex] = { ...cp, phase: Number(e.target.value) };
                                  updatePath(path.id, p => ({ ...p, functionalControlPoints: newCPs }));
                                }}
                                className="w-full accent-indigo-400 h-1" 
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!path.isFunctional && (
                  <button 
                    onClick={() => {
                      if (!path.bezierPoints) {
                        convertToBezier(path.id);
                      } else {
                        setDrawingMode(drawingMode === 'edit' ? 'path' : 'edit');
                        setSelectedPathId(path.id);
                      }
                    }}
                    className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 mb-2 ${path.bezierPoints ? (drawingMode === 'edit' ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg' : 'bg-blue-100 hover:bg-blue-200 text-blue-600') : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
                  >
                    <Waves size={14} /> 
                    {!path.bezierPoints ? "转换为贝塞尔曲线 (可编辑节点)" : (drawingMode === 'edit' ? "退出编辑模式" : "进入编辑节点模式")}
                  </button>
                )}
                {path.bezierPoints && drawingMode === 'edit' && (
                   <div className="bg-green-50 p-2 rounded-lg border border-green-100 text-[10px] text-green-700 mb-2">
                     <p className="font-bold">编辑提示:</p>
                     <p>• 点击空白处: 在末尾添加节点</p>
                     <p>• 拖动节点: 调整曲线形状</p>
                     <p>• Alt + 点击节点: 删除该节点</p>
                   </div>
                )}
                <ParameterEditor
                  config={path}
                  updateStreamFn={(streamNum, updates) => updateStream(path.id, streamNum, updates)}
                  updateParamsFn={(updates) => updatePath(path.id, p => ({ ...p, ...updates }))}
                  handleImageUploadFn={(streamNum, e) => handlePathImageUpload(path.id, streamNum, e)}
                  removeImageFn={(streamNum, imageId) => removePathImage(path.id, streamNum, imageId)}
                  restoreBuiltinImagesFn={(streamNum) => updateStream(
                    path.id,
                    streamNum,
                    {
                      images: [...(
                        streamNum === 1
                          ? builtinStreams.stream1
                          : builtinStreams.stream2
                      )],
                    },
                  )}
                  builtinImageCount={{
                    1: builtinStreams.stream1.length,
                    2: builtinStreams.stream2.length,
                  }}
                  showNotification={showNotification}
                  isPath={true}
                  applyToAllFn={applyIndividualParamToAllPaths}
                />
              </div>
            )}
          </div>
        ))}
        </div>
      </div>

      {/* Show UI button when hidden */}
      {!uiVisible && (
        <div className="absolute top-6 right-6 z-50">
          <button
            onClick={toggleUIVisibility}
            className="p-3 bg-white/90 backdrop-blur-md rounded-full border border-black/10 shadow-lg text-black/50 hover:text-black hover:scale-110 transition-all flex items-center gap-2"
            title="显示面板 (H)"
          >
            <Eye size={24} />
            <span className="text-sm font-bold pr-1">显示面板</span>
          </button>
        </div>
      )}
      {/* Empty State */}
      {paths.length === 0 && shimmerCells.size === 0 && !isDrawing && !bgImage && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-black/30 flex flex-col items-center gap-4 pointer-events-none transition-opacity duration-500">
          <Palette size={48} className="opacity-40" />
          <p className="text-lg font-medium tracking-wide text-center">
            在屏幕上画一条线<br/>
            <span className="text-sm opacity-70">现在每条线都有独立的控制面板了</span>
          </p>
        </div>
      )}

      {/* Inversion Overlay (Full Screen) */}
      <div 
        className={`fixed inset-0 pointer-events-none z-[5] bg-white mix-blend-difference transition-opacity duration-500 ${isInverted ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Export Video Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-[400px] border border-black/5 animate-in zoom-in-95 duration-300">
            <div className="flex flex-col items-center text-center gap-6">
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">
                <Video size={32} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-black">录制完成</h3>
                <p className="text-sm text-black/50">
                  视频已以 4K (3840x2160) 品质录制完成。<br />
                  请选择您想要导出的文件格式：
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 w-full">
                <button
                  onClick={() => {
                    downloadVideo('mp4');
                    setShowExportModal(false);
                  }}
                  className="flex flex-col items-center gap-3 p-4 rounded-2xl border border-black/5 hover:bg-blue-50 hover:border-blue-200 transition-all group"
                >
                  <div className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                    <Download size={20} />
                  </div>
                  <span className="font-bold text-sm">导出 MP4</span>
                </button>
                
                <button
                  onClick={() => {
                    downloadVideo('webm');
                    setShowExportModal(false);
                  }}
                  className="flex flex-col items-center gap-3 p-4 rounded-2xl border border-black/5 hover:bg-blue-50 hover:border-blue-200 transition-all group"
                >
                  <div className="w-10 h-10 bg-black/5 rounded-xl flex items-center justify-center group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                    <Download size={20} />
                  </div>
                  <span className="font-bold text-sm">导出 WebM</span>
                </button>
              </div>
              
              <button
                onClick={() => setShowExportModal(false)}
                className="text-xs text-black/30 hover:text-black/60 transition-colors"
              >
                取消并关闭
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {!editorMode && (
        <SimpleExperienceControls
          tool={simpleTool}
          canUndo={simpleExperienceReady && undoStack.length > 0}
          hasPaths={simpleExperienceReady && paths.length > 0}
          isReady={simpleExperienceReady}
          onToolChange={handleSimpleToolChange}
          onUndo={undo}
          onReset={resetSimpleExperience}
        />
      )}
    </div>
  );
}
