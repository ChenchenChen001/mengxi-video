export type ExperienceTool = 'draw' | 'erase';

export type PointLike = {
  x: number;
  y: number;
};

export type PathLike = {
  id: string;
  points: PointLike[];
};

export function isEditorMode(search: string): boolean {
  return new URLSearchParams(search).get('editor') === '1';
}

export function screenPixelsToLogical(pixels: number, viewScale: number): number {
  return viewScale > 0 ? pixels / viewScale : pixels;
}

export function getGuideOpacity(
  releasedAtMs: number | undefined,
  nowMs: number,
  fadeDurationMs = 2000,
): number {
  if (releasedAtMs === undefined) return 1;
  if (fadeDurationMs <= 0) return nowMs <= releasedAtMs ? 1 : 0;

  const elapsed = nowMs - releasedAtMs;
  return Math.max(0, Math.min(1, 1 - elapsed / fadeDurationMs));
}

export function distancePointToSegment(
  point: PointLike,
  start: PointLike,
  end: PointLike,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = (
    (point.x - start.x) * deltaX + (point.y - start.y) * deltaY
  ) / lengthSquared;
  const position = Math.max(0, Math.min(1, projection));
  const nearestX = start.x + position * deltaX;
  const nearestY = start.y + position * deltaY;

  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

export function findHitPathIds(
  paths: PathLike[],
  point: PointLike,
  radius: number,
  excludedIds: ReadonlySet<string> = new Set(),
): string[] {
  const hitIds: string[] = [];

  for (const path of paths) {
    if (excludedIds.has(path.id)) continue;

    for (let index = 1; index < path.points.length; index += 1) {
      if (distancePointToSegment(point, path.points[index - 1], path.points[index]) <= radius) {
        hitIds.push(path.id);
        break;
      }
    }
  }

  return hitIds;
}
