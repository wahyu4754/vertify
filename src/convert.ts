import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
} from 'mediabunny';
import { composeFrame } from './compose';
import { drawPopup, loadPopupFont, POPUP_SECONDS, type PopupPosition } from './overlay';
import type { EncoderMode } from './support';

export interface TrailerOptions {
  /** Where the trailer starts in the source video, in seconds. */
  start: number;
  /** Trailer length in seconds. */
  length: number;
  /** Text shown in the popup during the last seconds. */
  text: string;
  /** Where the popup sits in the frame. */
  position: PopupPosition;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
}

export interface ConvertOptions {
  file: File;
  outWidth: number;
  outHeight: number;
  /** Background opacity, 0..1. */
  opacity: number;
  quality: 'high' | 'medium';
  gpu: boolean;
  /** When set, only a short section is exported, with a text popup at its end. */
  trailer?: TrailerOptions;
  /** 0..1 */
  onProgress: (progress: number) => void;
  signal: AbortSignal;
}

export interface ConvertResult {
  blob: Blob;
  mode: EncoderMode;
}

export class UnsupportedVideoError extends Error {}

function openInput(file: File): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export async function probe(file: File): Promise<VideoInfo> {
  const input = openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new UnsupportedVideoError('This file has no video track.');
    if (!(await track.canDecode())) {
      throw new UnsupportedVideoError(
        'This browser cannot decode the video codec in this file. Try another file or browser.',
      );
    }
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration: await input.computeDuration(),
    };
  } finally {
    input.dispose();
  }
}

async function runOnce(options: ConvertOptions, hardware: boolean): Promise<Blob> {
  const { file, outWidth, outHeight, opacity, quality, trailer, onProgress, signal } = options;

  if (trailer) await loadPopupFont(trailer.text);
  const popupStart = trailer ? trailer.length - Math.min(POPUP_SECONDS, trailer.length) : 0;
  // Timestamps seen by `process` are either source time or trim-relative; settle on the first frame.
  let clock: number | null = null;

  const canvas = new OffscreenCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a drawing surface.');

  const input = openInput(file);
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: 'avc',
        quality: quality === 'high' ? QUALITY_HIGH : QUALITY_MEDIUM,
        hardwareAcceleration: hardware ? 'prefer-hardware' : 'prefer-software',
        keyFrameInterval: 2,
        process: (sample) => {
          composeFrame(
            ctx,
            sample.toCanvasImageSource(),
            sample.displayWidth,
            sample.displayHeight,
            outWidth,
            outHeight,
            { opacity },
          );
          if (trailer) {
            clock ??= sample.timestamp >= trailer.start - 0.5 ? trailer.start : 0;
            drawPopup(
              ctx,
              trailer.text,
              outWidth,
              outHeight,
              sample.timestamp - clock - popupStart,
              trailer.position,
            );
          }
          return canvas;
        },
        processedWidth: outWidth,
        processedHeight: outHeight,
      },
      trim: trailer ? { start: trailer.start, end: trailer.start + trailer.length } : undefined,
      // Drop the source file's tags (device, location, creation time) from the result.
      tags: {},
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reason = conversion.discardedTracks[0]?.reason;
      throw new UnsupportedVideoError(
        reason === 'undecodable_source_codec'
          ? 'This browser cannot decode the video codec in this file.'
          : 'This video cannot be converted in this browser.',
      );
    }

    conversion.onProgress = onProgress;
    const onAbort = () => void conversion.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('The encoder produced no output.');
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

/** Converts to a vertical MP4. Tries the GPU encoder first and falls back to software. */
export async function convert(options: ConvertOptions): Promise<ConvertResult> {
  try {
    if (options.gpu) {
      try {
        return { blob: await runOnce(options, true), mode: 'gpu' };
      } catch (error) {
        if (error instanceof ConversionCanceledError || options.signal.aborted) throw error;
        // Hardware encoder missing or failed: retry on the CPU.
        options.onProgress(0);
      }
    }
    return { blob: await runOnce(options, false), mode: 'cpu' };
  } catch (error) {
    if (error instanceof ConversionCanceledError || options.signal.aborted) {
      throw new DOMException('Canceled', 'AbortError');
    }
    throw error;
  }
}
