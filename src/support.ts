/** Returns a human-readable reason if the browser cannot run the converter, else null. */
export function checkBrowserSupport(): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    return 'This browser does not support WebCodecs. Please use a recent desktop version of Chrome, Edge, or Firefox.';
  }
  return null;
}

export type EncoderMode = 'gpu' | 'cpu';

/** Whether a hardware-accelerated H.264 encoder is available for the given size. */
export async function hasHardwareEncoder(width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640034',
      width,
      height,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    });
    return result.supported === true;
  } catch {
    return false;
  }
}
