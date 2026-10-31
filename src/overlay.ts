type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const POPUP_FONT = '"Mouse Memoirs", system-ui, sans-serif';
export const POPUP_SECONDS = 5;
export const TRAILER_SECONDS = 30;

const ENTER_SECONDS = 0.3;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Waits until the popup font can be drawn on a canvas. */
export async function loadPopupFont(text: string): Promise<void> {
  try {
    await document.fonts.load(`64px ${POPUP_FONT}`, text || 'A');
  } catch {
    // Falls back to the system font.
  }
}

export interface PopupPosition {
  /** Card center as a fraction of the frame, 0..1. */
  x: number;
  y: number;
}

export const DEFAULT_POPUP_POSITION: PopupPosition = { x: 0.5, y: 0.8 };

/**
 * Draws the call-to-action card at `position` (the card is kept inside the frame).
 * `seconds` is the time since the popup appeared; the card pops in over 0.3 s.
 */
export function drawPopup(
  ctx: Ctx,
  text: string,
  w: number,
  h: number,
  seconds: number,
  position: PopupPosition = DEFAULT_POPUP_POSITION,
): void {
  const message = text.trim();
  if (!message || seconds < 0) return;

  const enter = Math.min(1, seconds / ENTER_SECONDS);
  const maxTextWidth = w * 0.74;

  let size = Math.round(w * 0.11);
  let lines: string[] = [];
  for (; size > 16; size -= 4) {
    ctx.font = `${size}px ${POPUP_FONT}`;
    lines = wrap(ctx, message, maxTextWidth);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxTextWidth)) break;
  }

  const lineHeight = size * 1.02;
  const padding = size * 0.42;
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = textWidth + padding * 2;
  const boxH = lines.length * lineHeight + padding * 2;

  ctx.save();
  ctx.globalAlpha = Math.min(1, enter * 1.6);
  const margin = w * 0.03;
  const cx = Math.min(Math.max(position.x * w, boxW / 2 + margin), w - boxW / 2 - margin);
  const cy = Math.min(Math.max(position.y * h, boxH / 2 + margin), h - boxH / 2 - margin);
  ctx.translate(cx, cy);
  const scale = easeOutBack(enter);
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, size * 0.4);
  ctx.fill();

  ctx.fillStyle = '#0a0a0a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${POPUP_FONT}`;
  const top = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, 0, top + i * lineHeight + size * 0.04));
  ctx.restore();
}
