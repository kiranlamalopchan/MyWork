export type CropEdges = { left: number; top: number; right: number; bottom: number };
export function cropRectangle(width: number, height: number, edges: CropEdges) {
  const originX = Math.round(width * edges.left), originY = Math.round(height * edges.top);
  return { originX, originY, width: Math.max(1, Math.floor(width * (1 - edges.right)) - originX), height: Math.max(1, Math.floor(height * (1 - edges.bottom)) - originY) };
}
