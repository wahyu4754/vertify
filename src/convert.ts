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
import type { EncoderMode } from './support';

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
  const { file, outWidth, outHeight, opacity, quality, onProgress, signal } = options;

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
          return canvas;
        },
        processedWidth: outWidth,
        processedHeight: outHeight,
      },
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
