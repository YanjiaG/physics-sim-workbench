import type { Scene } from '@psw/core';
import { sceneFileName, sceneToJSON } from '@psw/core';

let canvasRef: HTMLCanvasElement | null = null;

export function registerCanvas(canvas: HTMLCanvasElement | null): void {
  canvasRef = canvas;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSceneJSON(scene: Scene): void {
  downloadBlob(sceneFileName(scene), new Blob([sceneToJSON(scene)], { type: 'application/json' }));
}

export function exportStagePNG(name: string): boolean {
  if (!canvasRef) return false;
  const dataUrl = canvasRef.toDataURL('image/png');
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = `${name || 'scene'}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}
