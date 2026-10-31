import '@fontsource-variable/geist';
import './style.css';

import { UploadMinimalisticLinearIcon } from '@solar-icons/static/linear/upload-minimalistic';
import { VideoLibraryLinearIcon } from '@solar-icons/static/linear/video-library';
import { PlayLinearIcon } from '@solar-icons/static/linear/play';
import { PauseLinearIcon } from '@solar-icons/static/linear/pause';
import { DownloadMinimalisticLinearIcon } from '@solar-icons/static/linear/download-minimalistic';
import { ShieldCheckLinearIcon } from '@solar-icons/static/linear/shield-check';
import { CheckCircleLinearIcon } from '@solar-icons/static/linear/check-circle';

import { composeFrame } from './compose';
import { convert, probe, UnsupportedVideoError, type VideoInfo } from './convert';
import { checkBrowserSupport, hasHardwareEncoder } from './support';

const ICONS: Record<string, string> = {
  upload: UploadMinimalisticLinearIcon,
  video: VideoLibraryLinearIcon,
  play: PlayLinearIcon,
  pause: PauseLinearIcon,
  download: DownloadMinimalisticLinearIcon,
  shield: ShieldCheckLinearIcon,
  done: CheckCircleLinearIcon,
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function setIcon(el: Element, name: string): void {
  el.innerHTML = ICONS[name] ?? '';
}

document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon!));

const dropEl = $<HTMLLabelElement>('drop');
const fileInput = $<HTMLInputElement>('file');
const editorEl = $('editor');
const noticeEl = $('unsupported');
const previewEl = $<HTMLCanvasElement>('preview');
const toggleBtn = $<HTMLButtonElement>('toggle');
const fileNameEl = $('fileName');
const fileMetaEl = $('fileMeta');
const resetBtn = $<HTMLButtonElement>('reset');
const opacityEl = $<HTMLInputElement>('opacity');
const opacityOut = $('opacityOut');
const gpuEl = $<HTMLInputElement>('gpu');
const gpuState = $('gpuState');
const gpuHint = $('gpuHint');
const convertBtn = $<HTMLButtonElement>('convert');
const cancelBtn = $<HTMLButtonElement>('cancel');
const progressWrap = $('progressWrap');
const progressEl = $<HTMLProgressElement>('progress');
const progressLabel = $('progressLabel');
const progressValue = $('progressValue');
const errorEl = $('error');
const resultEl = $('result');
const resultName = $('resultName');
const resultMeta = $('resultMeta');
const downloadEl = $<HTMLAnchorElement>('download');

const PREVIEW_W = 360;
const PREVIEW_H = 640;
previewEl.width = PREVIEW_W;
previewEl.height = PREVIEW_H;
const previewCtx = previewEl.getContext('2d', { alpha: false })!;

let current: { file: File; info: VideoInfo } | null = null;
let video: HTMLVideoElement | null = null;
let videoUrl: string | null = null;
let downloadUrl: string | null = null;
let abort: AbortController | null = null;
let frameHandle = 0;
let hardwareAvailable = false;

// --- helpers -------------------------------------------------------------

function showNotice(message: string | null): void {
  noticeEl.hidden = message === null;
  noticeEl.textContent = message ?? '';
}

function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function selectedSize(): { width: number; height: number } {
  const value = document.querySelector<HTMLInputElement>('input[name="res"]:checked')!.value;
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}

function selectedQuality(): 'high' | 'medium' {
  return document.querySelector<HTMLInputElement>('input[name="quality"]:checked')!.value as
    | 'high'
    | 'medium';
}

// --- preview -------------------------------------------------------------

function drawPreview(): void {
  if (video && video.videoWidth > 0) {
    composeFrame(
      previewCtx,
      video,
      video.videoWidth,
      video.videoHeight,
      PREVIEW_W,
      PREVIEW_H,
      { opacity: Number(opacityEl.value) / 100 },
    );
  }
  frameHandle = requestAnimationFrame(drawPreview);
}

function setPlaying(playing: boolean): void {
  if (!video) return;
  if (playing) void video.play().catch(() => undefined);
  else video.pause();
  setIcon(toggleBtn.firstElementChild!, playing ? 'pause' : 'play');
  toggleBtn.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
}

function stopPreview(): void {
  cancelAnimationFrame(frameHandle);
  video?.pause();
  video?.removeAttribute('src');
  video?.load();
  video = null;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
}

// --- loading a file ------------------------------------------------------

async function loadFile(file: File): Promise<void> {
  showNotice(null);
  let info: VideoInfo;
  try {
    info = await probe(file);
  } catch (error) {
    showNotice(
      error instanceof UnsupportedVideoError
        ? error.message
        : 'This file could not be read as a video.',
    );
    return;
  }

  resetResult();
  stopPreview();
  current = { file, info };

  videoUrl = URL.createObjectURL(file);
  video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.src = videoUrl;
  cancelAnimationFrame(frameHandle);
  frameHandle = requestAnimationFrame(drawPreview);
  setPlaying(true);

  fileNameEl.textContent = file.name;
  fileMetaEl.textContent = `${info.width} × ${info.height} · ${formatTime(info.duration)} · ${formatSize(file.size)}`;

  dropEl.hidden = true;
  editorEl.hidden = false;
}

function resetResult(): void {
  resultEl.hidden = true;
  errorEl.hidden = true;
  progressWrap.hidden = true;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
}

function backToStart(): void {
  abort?.abort();
  resetResult();
  stopPreview();
  current = null;
  fileInput.value = '';
  editorEl.hidden = true;
  dropEl.hidden = false;
}

// --- encoder availability ------------------------------------------------

async function detectGpu(): Promise<void> {
  hardwareAvailable = await hasHardwareEncoder(1080, 1920);
  if (hardwareAvailable) {
    gpuState.textContent = 'Available';
    gpuHint.textContent = 'Faster on supported graphics cards. Falls back to CPU if it fails.';
  } else {
    gpuEl.checked = false;
    gpuEl.disabled = true;
    gpuState.textContent = 'Not detected';
    gpuHint.textContent = 'No hardware H.264 encoder found. The CPU will be used.';
  }
}

// --- converting ----------------------------------------------------------

function setBusy(busy: boolean): void {
  convertBtn.hidden = busy;
  cancelBtn.hidden = !busy;
  resetBtn.disabled = busy;
  document
    .querySelectorAll<HTMLInputElement>('.panel input')
    .forEach((el) => {
      if (el !== gpuEl || hardwareAvailable) el.disabled = busy;
    });
}

async function startConversion(): Promise<void> {
  if (!current) return;
  resetResult();
  setBusy(true);
  setPlaying(false);

  progressWrap.hidden = false;
  progressEl.value = 0;
  progressLabel.textContent = 'Encoding';
  progressValue.textContent = '0%';

  const { width, height } = selectedSize();
  const started = performance.now();
  abort = new AbortController();

  try {
    const { blob, mode } = await convert({
      file: current.file,
      outWidth: width,
      outHeight: height,
      opacity: Number(opacityEl.value) / 100,
      quality: selectedQuality(),
      gpu: gpuEl.checked,
      signal: abort.signal,
      onProgress: (p) => {
        const pct = Math.min(100, Math.round(p * 100));
        progressEl.value = pct;
        progressValue.textContent = `${pct}%`;
        const elapsed = (performance.now() - started) / 1000;
        progressLabel.textContent =
          p > 0.03 ? `Encoding · ${formatTime((elapsed / p) * (1 - p))} left` : 'Encoding';
      },
    });

    downloadUrl = URL.createObjectURL(blob);
    const base = current.file.name.replace(/\.[^.]+$/, '') || 'video';
    downloadEl.href = downloadUrl;
    downloadEl.download = `${base}-vertical.mp4`;
    resultName.textContent = downloadEl.download;
    resultMeta.textContent = `${formatSize(blob.size)} · ${width} × ${height} · ${
      mode === 'gpu' ? 'GPU' : 'CPU'
    } encoding · ${formatTime((performance.now() - started) / 1000)}`;
    progressWrap.hidden = true;
    resultEl.hidden = false;
  } catch (error) {
    progressWrap.hidden = true;
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      errorEl.textContent =
        error instanceof Error && error.message
          ? error.message
          : 'The conversion failed. Try another video or browser.';
      errorEl.hidden = false;
    }
  } finally {
    abort = null;
    setBusy(false);
    setPlaying(true);
  }
}

// --- wiring --------------------------------------------------------------

const unsupported = checkBrowserSupport();
if (unsupported) {
  showNotice(unsupported);
  fileInput.disabled = true;
  dropEl.style.opacity = '0.5';
} else {
  void detectGpu();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});

dropEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropEl.classList.add('over');
});
dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
dropEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dropEl.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file && !unsupported) void loadFile(file);
});
dropEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

opacityEl.addEventListener('input', () => {
  opacityOut.textContent = `${opacityEl.value}%`;
});
toggleBtn.addEventListener('click', () => setPlaying(video?.paused ?? false));
resetBtn.addEventListener('click', backToStart);
convertBtn.addEventListener('click', () => void startConversion());
cancelBtn.addEventListener('click', () => abort?.abort());
