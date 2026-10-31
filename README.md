# Vertify

Turn a horizontal video into a vertical 9:16 one. The black bars are filled with the same video, zoomed to cover the frame and faded to 20% opacity, so the background is never flat black. That is the whole idea.

Everything runs in your browser. Your video is never uploaded.

## How to use

1. Open the app and drop in a horizontal video (or click to choose one).
2. Check the live preview. Drag **Background opacity** to taste (default 20%).
3. Pick the output size (1080 × 1920 or 720 × 1280) and quality.
4. Leave **GPU encoding** on if it says Available. Click **Convert**.
5. When it finishes, click **Download** to save the vertical MP4.

## How it looks

| Layer | What it is |
| --- | --- |
| Base | Solid black, 1080 × 1920 (or 720 × 1280) |
| Background | Your video, scaled to cover the whole frame, 20% opacity (adjustable) |
| Foreground | Your video, scaled to the frame width and centered |

Audio is kept. Metadata from the source file (device, location) is not copied to the result.

## GPU encoding

Encoding uses the browser's [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) `VideoEncoder` with `hardwareAcceleration: "prefer-hardware"`, which uses the GPU's H.264 encoder (NVENC, Quick Sync, AMF, VideoToolbox) when the browser and drivers expose one. If the hardware encoder is missing or fails, it falls back to software encoding automatically. Muxing and decoding are handled by [Mediabunny](https://mediabunny.dev).

Browser support: current desktop Chrome and Edge (primary), Firefox and Safari where WebCodecs video encoding is available.

## Develop

```bash
npm install
npm run dev
```

```bash
npm run build
```

The build output in `dist/` is a static site. Deploy it anywhere, for example on Vercel (framework preset: Vite).

## Limits

- The encoded file is held in memory before download, so very large videos (several GB) can exhaust a tab's memory.
- The source codec must be decodable by the browser (HEVC is not decodable in every browser).

## Privacy

- No backend, no analytics, no third-party requests: the font and icons are bundled.
- Do not commit `.env` files or the `.vercel/` folder. Both are in `.gitignore`.

## License

MIT. Icons by [Solar Icon Set](https://github.com/saoudi-h/solar-icons) (see its license), typeface Geist (SIL OFL).
