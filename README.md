# Gesture Camera Demo

A real-time camera-based gesture recognition demo. Uses MediaPipe Hands to detect hand gestures for interactive modes: Geometry and Firework.

## Features

- **Geometry Mode** — Use both hands to control a quadrilateral shape. Pinch and stretch with thumb + index fingers.
- **Firework Mode** — Make a fist, then open your hand to launch a firework burst. Trigger repeatedly for layered effects.
- **Pointer Mode** — Draw with mouse/touch. Click-drag to leave glowing trails.
- All rendering is done client-side via Canvas API. No backend required.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://127.0.0.1:5180/](http://127.0.0.1:5180/)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server on `127.0.0.1:5180` |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Preview production build on `127.0.0.1:5180` |

## Deploy

The project is a static site built with Vite. Deploy to any static host:

### Vercel / Netlify / Cloudflare Pages

1. Push this directory to a GitHub repository
2. Import the repo in Vercel/Netlify/Cloudflare Pages
3. Build command: `npm run build`
4. Output directory: `dist`
5. No additional config needed

### Requirements

- Camera permission is required
- Must be served over **HTTPS** or **localhost** (browser security requirement for `getUserMedia`)

## Structure

```
├── index.html               # Entry point
├── app.js                   # Application logic
├── styles.css               # Styles
├── vendor/
│   └── mediapipe/
│       └── vision_bundle.mjs  # MediaPipe SDK (Vite-processed module)
├── public/
│   └── vendor/
│       └── mediapipe/
│           ├── wasm/           # MediaPipe WASM binaries
│           └── hand_landmarker.task  # Hand model
├── vite.config.js           # Vite configuration
├── package.json             # Dependencies & scripts
└── README.md                # This file
```
