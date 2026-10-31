export type Drawable = CanvasImageSource;

export interface ComposeOptions {
  /** Background opacity, 0..1. */
  opacity: number;
}

/**
 * Draws one vertical frame: a black base, the source zoomed to cover the whole
 * canvas at reduced opacity, then the source fitted to the canvas width on top.
 */
export function composeFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: Drawable,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  { opacity }: ComposeOptions,
): void {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);

  // Background: scale to cover, centered (crops the sides).
  const cover = Math.max(outW / srcW, outH / srcH);
  const bgW = srcW * cover;
  const bgH = srcH * cover;
  ctx.globalAlpha = opacity;
  ctx.drawImage(source, (outW - bgW) / 2, (outH - bgH) / 2, bgW, bgH);

  // Foreground: scale to fit inside the canvas, centered.
  const contain = Math.min(outW / srcW, outH / srcH);
  const fgW = srcW * contain;
  const fgH = srcH * contain;
  ctx.globalAlpha = 1;
  ctx.drawImage(source, (outW - fgW) / 2, (outH - fgH) / 2, fgW, fgH);
}
