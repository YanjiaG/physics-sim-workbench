import type { Bounds, Pt, Primitive, SceneFrame } from '@psw/core';

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  padX: number;
  padY: number;
  bounds: Bounds;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export function createViewport(width: number, height: number, bounds: Bounds, pad = 20): Viewport {
  const spanX = Math.max(1e-3, bounds.maxX - bounds.minX);
  const spanY = Math.max(1e-3, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const usedW = spanX * scale;
  const usedH = spanY * scale;
  return {
    width,
    height,
    scale,
    padX: (width - usedW) / 2,
    padY: (height - usedH) / 2,
    bounds,
  };
}

export function toScreen(view: Viewport, point: Pt): Pt {
  return {
    x: view.padX + (point.x - view.bounds.minX) * view.scale,
    y: view.height - view.padY - (point.y - view.bounds.minY) * view.scale,
  };
}

function fontSize(size: number | undefined, scale: number): number {
  if (!size) return 13;
  const px = size <= 4 ? size * scale : size;
  return Math.max(9.5, Math.min(20, px));
}

function setupStroke(ctx: CanvasRenderingContext2D, primitive: { color?: string; width?: number; dash?: boolean }): void {
  ctx.strokeStyle = primitive.color ?? '#1f2328';
  ctx.lineWidth = primitive.width ?? 1.6;
  ctx.setLineDash(primitive.dash ? [6, 5] : []);
}

function drawArrow(ctx: CanvasRenderingContext2D, view: Viewport, primitive: Extract<Primitive, { type: 'arrow' }>): void {
  const from = toScreen(view, primitive.from);
  const to = toScreen(view, primitive.to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const width = primitive.width ?? 2;
  const head = Math.min(11, Math.max(6, length * 0.28));
  const ux = dx / length;
  const uy = dy / length;
  const baseX = to.x - ux * head;
  const baseY = to.y - uy * head;

  ctx.save();
  ctx.strokeStyle = primitive.color;
  ctx.fillStyle = primitive.color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(baseX - uy * head * 0.42, baseY + ux * head * 0.42);
  ctx.lineTo(baseX + uy * head * 0.42, baseY - ux * head * 0.42);
  ctx.closePath();
  ctx.fill();

  if (primitive.label) {
    const side = primitive.labelSide === 'below' ? 1 : -1;
    const mx = from.x + dx * 0.58 + -uy * side * 10;
    const my = from.y + dy * 0.58 + ux * side * 10;
    ctx.font = `600 ${Math.min(13, Math.max(10, 11 + width))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 253, 250, 0.9)';
    ctx.strokeText(primitive.label, mx, my);
    ctx.fillStyle = primitive.color;
    ctx.fillText(primitive.label, mx, my);
  }
  ctx.restore();
}

function drawSpring(ctx: CanvasRenderingContext2D, view: Viewport, primitive: Extract<Primitive, { type: 'spring' }>): void {
  const a = toScreen(view, primitive.a);
  const b = toScreen(view, primitive.b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const coils = Math.max(2, primitive.coils);
  const amplitude = Math.max(1.5, primitive.amplitude * view.scale);
  const segments = coils * 2;
  ctx.save();
  ctx.strokeStyle = primitive.color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const sign = i % 2 === 0 ? -1 : 1;
    ctx.lineTo(a.x + dx * t + nx * amplitude * sign, a.y + dy * t + ny * amplitude * sign);
  }
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawArc(ctx: CanvasRenderingContext2D, view: Viewport, primitive: Extract<Primitive, { type: 'arc' }>): void {
  const center = toScreen(view, primitive.center);
  const radius = primitive.r * view.scale;
  const steps = Math.max(6, Math.ceil(Math.abs(primitive.to - primitive.from) / 0.12));
  ctx.save();
  setupStroke(ctx, primitive);
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const angle = primitive.from + ((primitive.to - primitive.from) * i) / steps;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y - Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPrimitive(ctx: CanvasRenderingContext2D, view: Viewport, primitive: Primitive): void {
  switch (primitive.type) {
    case 'line': {
      const a = toScreen(view, primitive.a);
      const b = toScreen(view, primitive.b);
      ctx.save();
      setupStroke(ctx, primitive);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'rect': {
      const center = toScreen(view, primitive.center);
      const w = primitive.w * view.scale;
      const h = primitive.h * view.scale;
      ctx.save();
      ctx.translate(center.x, center.y);
      if (primitive.angle) ctx.rotate(-primitive.angle);
      ctx.beginPath();
      const rx = Math.min(primitive.rx ?? 0, Math.min(w, h) / 2);
      if (rx > 0) ctx.roundRect(-w / 2, -h / 2, w, h, rx);
      else ctx.rect(-w / 2, -h / 2, w, h);
      if (primitive.fill) {
        ctx.fillStyle = primitive.fill;
        ctx.fill();
      }
      if (primitive.stroke) {
        ctx.strokeStyle = primitive.stroke;
        ctx.lineWidth = primitive.lineWidth ?? 1.2;
        ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'circle': {
      const center = toScreen(view, primitive.center);
      const radius = Math.max(0.6, primitive.r * view.scale);
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      if (primitive.fill) {
        ctx.fillStyle = primitive.fill;
        ctx.fill();
      }
      if (primitive.stroke) {
        ctx.strokeStyle = primitive.stroke;
        ctx.lineWidth = primitive.lineWidth ?? 1.2;
        ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'polyline': {
      ctx.save();
      setupStroke(ctx, primitive);
      ctx.beginPath();
      primitive.pts.forEach((point, index) => {
        const screen = toScreen(view, point);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      ctx.stroke();
      ctx.restore();
      return;
    }
    case 'polygon': {
      ctx.save();
      ctx.beginPath();
      primitive.pts.forEach((point, index) => {
        const screen = toScreen(view, point);
        if (index === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      ctx.closePath();
      if (primitive.fill) {
        ctx.fillStyle = primitive.fill;
        ctx.fill();
      }
      if (primitive.stroke) {
        ctx.strokeStyle = primitive.stroke;
        ctx.lineWidth = primitive.lineWidth ?? 1.2;
        ctx.setLineDash([]);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'arrow':
      drawArrow(ctx, view, primitive);
      return;
    case 'text': {
      const at = toScreen(view, primitive.at);
      ctx.save();
      ctx.fillStyle = primitive.color ?? '#1f2328';
      ctx.font = `${primitive.weight ?? 500} ${fontSize(primitive.size, view.scale)}px ${FONT}`;
      ctx.textAlign = primitive.align ?? 'center';
      ctx.textBaseline = primitive.baseline ?? 'middle';
      ctx.fillText(primitive.text, at.x, at.y);
      ctx.restore();
      return;
    }
    case 'spring':
      drawSpring(ctx, view, primitive);
      return;
    case 'arc':
      drawArc(ctx, view, primitive);
      return;
    default:
      return;
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, frame: SceneFrame, view: Viewport): void {
  for (const primitive of frame.primitives) drawPrimitive(ctx, view, primitive);
}

export function drawEmptyState(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  ctx.save();
  ctx.fillStyle = '#8a8577';
  ctx.font = `500 14px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  ctx.restore();
}
