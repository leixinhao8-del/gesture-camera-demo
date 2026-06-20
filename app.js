const video = document.querySelector("#camera");
const paint = document.querySelector("#paint");
const fx = document.querySelector("#fx");
const videoCanvas = document.querySelector("#videoCanvas");
const paintCtx = paint.getContext("2d");
const fxCtx = fx.getContext("2d");
const vCtx = videoCanvas.getContext("2d");

const statusEl = document.querySelector("#status");
const fpsEl = document.querySelector("#fps");
const strokeCountEl = document.querySelector("#strokeCount");
const tipEl = document.querySelector("#tip");
const modeLabel = document.querySelector("#modeLabel");
const pointerMode = document.querySelector("#pointerMode");
const handMode = document.querySelector("#handMode");
const fireworkMode = document.querySelector("#fireworkMode");
const restartCamera = document.querySelector("#restartCamera");
const clearButton = document.querySelector("#clear");
const shotButton = document.querySelector("#shot");
const cameraNotice = document.querySelector("#cameraNotice");
const serverNotice = document.querySelector("#serverNotice");
const debugModeEl = document.querySelector("#debugMode");
const debugServerEl = document.querySelector("#debugServer");
const debugCameraEl = document.querySelector("#debugCamera");
const debugLandmarkerEl = document.querySelector("#debugLandmarker");
const debugHandsEl = document.querySelector("#debugHands");
const debugPhaseEl = document.querySelector("#debugPhase");
const debugFramesEl = document.querySelector("#debugFrames");
const debugCooldownEl = document.querySelector("#debugCooldown");
const debugLoopEl = document.querySelector("#debugLoop");
const debugDetectEl = document.querySelector("#debugDetect");
const debugVideoCanvasEl = document.querySelector("#debugVideoCanvas");
const debugFireworksCountEl = document.querySelector("#debugFireworksCount");
const debugErrorEl = document.querySelector("#debugError");

let latestGlobalError = "";

const rememberError = (error) => {
  latestGlobalError = error instanceof Error ? error.message : String(error || "unknown error");
};

window.onerror = (msg, src, line, col, err) => {
  rememberError(err || msg);
  console.error("[window.onerror]", msg, src, line, col, err);
};

window.addEventListener("unhandledrejection", (event) => {
  rememberError(event.reason);
  console.error("[unhandledrejection]", event.reason);
});

const createGeometryState = () => ({
  current: null,
  tracks: {
    left: null,
    right: null,
  },
});

const createFireworkState = () => ({
  track: null,
  phase: "idle",
  fistFrames: 0,
  openFrames: 0,
  cooldownUntil: 0,
  lastTriggerAt: 0,
  minOpenness: Infinity,
  openness: 0,
});

const state = {
  color: "#fff7c7",
  mode: "geometry",
  drawing: false,
  lastPoint: null,
  smoothedWidth: 6,
  strokes: [],
  currentStroke: null,
  strokeCount: 0,
  particles: [],
  fireworks: [],
  geometryState: createGeometryState(),
  fireworkState: createFireworkState(),
  lastGesture: null,
  gesturePhase: "idle",
  detectedHands: 0,
  handLandmarker: null,
  vision: null,
  handReady: false,
  handLoading: null,
  animationId: null,
  isLoopRunning: false,
  loopFrameCount: 0,
  detectFrameCount: 0,
  paused: false,
  detectionCount: 0,
  missedHands: 0,
  lastVideoTime: -1,
  lastDetectionAt: 0,
  detectionIntervalMs: 42,
  videoCanvasActive: false,
  lastError: "",
  frameCount: 0,
  lastFpsAt: performance.now(),
  cameraStream: null,
  cameraCheckTimer: null,
};

const setStatus = (message) => {
  statusEl.textContent = message;
};

const pageActive = () => !document.hidden && !state.paused;

const updateDebugReadout = () => {
  const firework = state.fireworkState;
  const remaining = Math.max(0, firework.cooldownUntil - performance.now());
  debugModeEl.textContent = state.mode;
  debugServerEl.textContent = "loaded";
  debugCameraEl.textContent = `${video.readyState}/${video.videoWidth || 0}x${video.videoHeight || 0}`;
  debugLandmarkerEl.textContent = state.handReady ? "ready" : state.handLoading ? "loading" : "no";
  debugHandsEl.textContent = String(state.detectedHands);
  debugLoopEl.textContent = String(state.loopFrameCount);
  debugDetectEl.textContent = String(state.detectFrameCount);
  debugPhaseEl.textContent = firework.phase;
  debugFramesEl.textContent = `${firework.fistFrames}/${firework.openFrames}`;
  debugCooldownEl.textContent = `${Math.ceil(remaining)}ms`;
  debugVideoCanvasEl.textContent = state.videoCanvasActive ? "yes" : "no";
  debugFireworksCountEl.textContent = String(state.fireworks.length);
  debugErrorEl.textContent = state.lastError || latestGlobalError || "none";
};

const setCameraNotice = (visible) => {
  cameraNotice.hidden = !visible;
};

const isLocalhost = () =>
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost" ||
  location.hostname === "[::1]";

const isHttpsProtocol = () => location.protocol === "https:";

const isAllowedDomain = () => {
  const host = location.hostname;
  // pages.dev (Cloudflare Pages) or vercel.app
  if (host.endsWith(".pages.dev") || host.endsWith(".vercel.app")) return true;
  // Any HTTPS domain (catches future custom domains)
  return isHttpsProtocol();
};

const cameraAllowed = () =>
  isLocalhost() || isHttpsProtocol() || isAllowedDomain();

const needsLocalServer = () => location.protocol === "file:";

const isWeChat = () =>
  /MicroMessenger|WeChat/i.test(navigator.userAgent);

const isMobile = () =>
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const cameraHasFrame = () =>
  video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
  video.videoWidth > 0 &&
  video.videoHeight > 0 &&
  !video.paused;

const markCameraFrame = () => {
  if (cameraHasFrame()) {
    setCameraNotice(false);
    if (statusEl.textContent === "camera has no frame") {
      setStatus(state.mode === "pointer" ? "camera ready" : "tracking ready");
    }
  }
};

const fitCanvas = () => {
  const ratio = window.devicePixelRatio || 1;
  for (const canvas of [paint, fx, videoCanvas]) {
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
};

const eventPoint = (event) => {
  const rect = paint.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const computeStrokeWidth = (from, to) => {
  if (!from || !to) return state.smoothedWidth;
  const speed = distance(from, to);
  // Slow movement = thick (10px), fast movement = thin (4px)
  const target = Math.min(10, Math.max(4, 9 - speed * 0.13));
  state.smoothedWidth += (target - state.smoothedWidth) * 0.18;
  return state.smoothedWidth;
};

// Interpolate missing points to keep ~4px spacing
const interpolateGap = (p1, p2, maxStep = 4) => {
  const d = distance(p1, p2);
  if (d <= maxStep) return [];
  const count = Math.floor(d / maxStep);
  const pts = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    pts.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
  }
  return pts;
};

const drawSegment = (from, to, color = state.color) => {
  if (!from || !to) return;
  const width = computeStrokeWidth(from, to);

  // Draw immediately — single line segment, 4px interpolation makes it seamless
  paintCtx.save();
  paintCtx.lineCap = "round";
  paintCtx.lineJoin = "round";
  paintCtx.shadowColor = color;
  paintCtx.shadowBlur = 12;
  paintCtx.strokeStyle = color;
  paintCtx.lineWidth = width;
  paintCtx.beginPath();
  paintCtx.moveTo(from.x, from.y);
  paintCtx.lineTo(to.x, to.y);
  paintCtx.stroke();
  paintCtx.restore();

  // Capture point with gap interpolation
  if (state.currentStroke) {
    const gap = interpolateGap(from, to);
    for (const p of gap) {
      state.currentStroke.points.push(p);
      state.currentStroke.widths.push(width);
    }
    state.currentStroke.points.push({ x: to.x, y: to.y });
    state.currentStroke.widths.push(width);
  }

  // Emit glow particles (capped at 200)
  if (state.particles.length < 200) {
    for (let i = 0; i < 2; i += 1) {
      state.particles.push({
        x: to.x + (Math.random() - 0.5) * 6,
        y: to.y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        life: 0.7 + Math.random() * 0.2,
        decay: 0.03 + Math.random() * 0.01,
        size: 1.5 + Math.random() * 2,
        color,
      });
    }
  }
};

const drawPointerHalo = (point) => {
  if (!point) return;
  fxCtx.save();
  fxCtx.strokeStyle = state.color;
  fxCtx.lineWidth = 1.4;
  fxCtx.shadowColor = state.color;
  fxCtx.shadowBlur = 24;
  fxCtx.beginPath();
  fxCtx.arc(point.x, point.y, 18, 0, Math.PI * 2);
  fxCtx.stroke();
  fxCtx.restore();
};

const polygonCenter = (points) => ({
  x: points.reduce((total, point) => total + point.x, 0) / points.length,
  y: points.reduce((total, point) => total + point.y, 0) / points.length,
});

const randomBetween = (min, max) => min + Math.random() * (max - min);

const goldenSparkColor = (ratio, highlight = false) => {
  if (highlight) return "rgb(255,250,220)";
  if (ratio > 0.78) return "rgb(255,140,40)";
  if (ratio < 0.18) return "rgb(255,245,205)";
  return "rgb(255,200,90)";
};

const createSpark = (origin, angle, speed, options = {}) => {
  const life = Math.round(randomBetween(options.minLife || 45, options.maxLife || 75));
  const highlight = Math.random() < (options.highlightChance || 0.06);
  const ratio = options.ratio ?? Math.random();
  return {
    x: origin.x,
    y: origin.y,
    prevX: origin.x,
    prevY: origin.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    life,
    gravity: randomBetween(0.035, 0.06),
    drag: randomBetween(0.975, 0.988),
    wind: randomBetween(-0.015, 0.015),
    width: randomBetween(options.minWidth || 0.7, options.maxWidth || 1.8),
    color: goldenSparkColor(ratio, highlight),
    glow: highlight,
  };
};

const createBurst = (origin, options = {}) => {
  const mainCount = Math.round(randomBetween(options.minCount || 70, options.maxCount || 90));
  const crackleCount = Math.round(randomBetween(15, 25));
  const sparks = [];
  const crackle = [];

  for (let i = 0; i < mainCount; i += 1) {
    const ring = Math.random();
    const angle = (Math.PI * 2 * i) / mainCount + randomBetween(-0.12, 0.12);
    const speed = randomBetween(2.5, 7) * (0.72 + ring * 0.42);

    sparks.push(createSpark(origin, angle, speed, {
      ratio: ring,
      highlightChance: 0.05,
      minLife: 48,
      maxLife: 75,
      minWidth: 0.8,
      maxWidth: 1.8,
    }));
  }

  for (let i = 0; i < crackleCount; i += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    crackle.push(createSpark(origin, angle, randomBetween(1.2, 3.8), {
      ratio: 0.1,
      highlightChance: 0.55,
      minLife: 16,
      maxLife: 32,
      minWidth: 0.55,
      maxWidth: 1.1,
    }));
  }

  return {
    x: origin.x,
    y: origin.y,
    age: 0,
    delay: 2,
    coreLife: 5,
    exploded: false,
    crackle,
    crackleDelay: Math.round(randomBetween(8, 18)),
    crackleReleased: false,
    smokeLife: 42,
    sparks,
  };
};

const spawnFirework = (origin) => {
  if (state.fireworks.length >= 4) {
    state.fireworks.splice(0, state.fireworks.length - 3);
  }
  state.fireworks.push(createBurst(origin));
};

const drawGeometry = () => {
  if (!state.geometryState.current) return;

  const { points, openness, fingerStates } = state.geometryState.current;
  const pulse = 0.55 + Math.sin(performance.now() / 120) * 0.18;
  const alpha = Math.min(0.38, 0.2 + openness * 0.055);

  fxCtx.save();
  fxCtx.lineCap = "round";
  fxCtx.lineJoin = "round";
  fxCtx.shadowColor = state.color;
  fxCtx.shadowBlur = 18;

  fxCtx.globalAlpha = alpha;
  fxCtx.fillStyle = state.color;
  fxCtx.strokeStyle = state.color;
  fxCtx.lineWidth = 2.2;
  fxCtx.setLineDash([6, 5]);
  fxCtx.beginPath();
  fxCtx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) fxCtx.lineTo(point.x, point.y);
  fxCtx.closePath();
  fxCtx.fill();
  fxCtx.globalAlpha = 0.82;
  fxCtx.stroke();

  fxCtx.setLineDash([]);
  fxCtx.globalAlpha = 1;
  for (const [index, point] of points.entries()) {
    fxCtx.beginPath();
    fxCtx.fillStyle = fingerStates[index] ? "#fffdf0" : state.color;
    fxCtx.arc(point.x, point.y, 7 + pulse * 2, 0, Math.PI * 2);
    fxCtx.fill();
  }

  fxCtx.restore();
};

const drawCoreFlash = (burst) => {
  const flashLife = Math.max(0, 1 - burst.age / burst.coreLife);
  if (flashLife <= 0) return;
  fxCtx.save();
  fxCtx.globalCompositeOperation = "lighter";
  fxCtx.globalAlpha = flashLife * 0.9;
  fxCtx.shadowBlur = 25;
  fxCtx.shadowColor = "#ffd27a";
  fxCtx.fillStyle = "rgba(255,235,170,0.85)";
  fxCtx.beginPath();
  fxCtx.arc(burst.x, burst.y, 6 + (1 - flashLife) * 14, 0, Math.PI * 2);
  fxCtx.fill();
  fxCtx.restore();
};

const drawBurstSmoke = (burst) => {
  if (!burst.exploded || burst.age > burst.smokeLife) return;
  const life = 1 - burst.age / burst.smokeLife;
  fxCtx.save();
  fxCtx.globalAlpha = Math.max(0, life) * 0.08;
  fxCtx.fillStyle = "rgba(255,180,100,0.05)";
  fxCtx.beginPath();
  fxCtx.arc(burst.x, burst.y, 18 + burst.age * 0.85, 0, Math.PI * 2);
  fxCtx.fill();
  fxCtx.restore();
};

const drawSpark = (spark) => {
  spark.age += 1;
  spark.prevX = spark.x;
  spark.prevY = spark.y;
  spark.vx += spark.wind;
  spark.vx *= spark.drag;
  spark.vy = spark.vy * spark.drag + spark.gravity;
  spark.x += spark.vx;
  spark.y += spark.vy;

  const alpha = Math.pow(Math.max(0, 1 - spark.age / spark.life), 1.6);

  fxCtx.save();
  fxCtx.globalAlpha = alpha;
  fxCtx.lineCap = "round";
  fxCtx.lineWidth = spark.width;
  fxCtx.strokeStyle = spark.color;
  if (spark.glow && spark.age < 10) {
    fxCtx.shadowColor = "#ffd27a";
    fxCtx.shadowBlur = 10;
  }
  fxCtx.beginPath();
  fxCtx.moveTo(spark.prevX, spark.prevY);
  fxCtx.lineTo(spark.x, spark.y);
  fxCtx.stroke();
  fxCtx.restore();
};

const drawFireworks = () => {
  state.fireworks = state.fireworks.filter((burst) => {
    burst.age += 1;
    drawCoreFlash(burst);
    drawBurstSmoke(burst);

    if (!burst.exploded && burst.age >= burst.delay) {
      burst.exploded = true;
    }

    if (!burst.crackleReleased && burst.age >= burst.crackleDelay) {
      burst.crackleReleased = true;
      burst.sparks.push(...burst.crackle);
      burst.crackle = [];
    }

    if (burst.exploded) {
      burst.sparks = burst.sparks.filter((spark) => spark.age < spark.life);
      for (const spark of burst.sparks) drawSpark(spark);
    }

    return burst.age < 85 || burst.sparks.length > 0;
  });
};

const drawVideoFrame = () => {
  if (!cameraHasFrame()) {
    state.videoCanvasActive = false;
    return;
  }
  const rect = videoCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) {
    state.videoCanvasActive = false;
    return;
  }

  // object-fit: cover scaling + horizontal mirror (same as CSS transform: scaleX(-1))
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  vCtx.save();
  vCtx.translate(w, 0);
  vCtx.scale(-1, 1);
  vCtx.drawImage(video, dx, dy, dw, dh);
  vCtx.restore();
  state.videoCanvasActive = true;
};

const renderFrame = () => {
  const { width, height } = fx.getBoundingClientRect();

  // 1. Draw camera to videoCanvas every frame
  drawVideoFrame();

  // 2. fx canvas: trail fade or clear
  if (state.fireworks.length > 0) {
    // destination-out erosion: gradually fade old firework content
    // This keeps the canvas transparent where nothing is drawn,
    // so the videoCanvas behind it stays visible
    fxCtx.save();
    fxCtx.globalCompositeOperation = "destination-out";
    fxCtx.globalAlpha = 0.18;
    fxCtx.fillStyle = "white";
    fxCtx.fillRect(0, 0, width, height);
    fxCtx.restore();
  } else {
    fxCtx.clearRect(0, 0, width, height);
  }

  // 3. Geometry overlay (clear each frame, drawn on fx canvas since it's transient)
  if (state.mode === "geometry") {
    drawGeometry();
  }

  // 4. Fireworks
  drawFireworks();

  // 5. Particles
  state.particles = state.particles.filter((p) => p.life > 0.02);
  for (const particle of state.particles) {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.vy += particle.gravity || 0;
    particle.life -= particle.decay || 0.025;
    fxCtx.save();
    fxCtx.globalAlpha = particle.life;
    fxCtx.fillStyle = particle.color;
    fxCtx.shadowColor = particle.color;
    fxCtx.shadowBlur = 18;
    fxCtx.beginPath();
    fxCtx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.restore();
  }

  // 6. Fade paint canvas (destination-out erosion — one fillRect, no per-stroke loop)
  paintCtx.save();
  paintCtx.globalCompositeOperation = "destination-out";
  paintCtx.globalAlpha = 0.007;
  paintCtx.fillStyle = "white";
  paintCtx.fillRect(0, 0, width, height);
  paintCtx.restore();

  // Clean up old stroke tracking data periodically (every ~2s at 60fps)
  if (state.frameCount % 120 === 0) {
    state.strokes = state.strokes.filter((s) => performance.now() - s.birth < 5500);
  }

  state.frameCount += 1;
  if (now - state.lastFpsAt > 600) {
    fpsEl.textContent = String(Math.round((state.frameCount * 1000) / (now - state.lastFpsAt)));
    state.frameCount = 0;
    state.lastFpsAt = now;
  }
  updateDebugReadout();
};

const startCamera = async () => {
  try {
    if (needsLocalServer()) {
      setStatus("open localhost url");
      tipEl.textContent = "use 127.0.0.1:5180";
      serverNotice.hidden = false;
      return;
    }
    if (!cameraAllowed()) {
      setStatus("Camera requires secure context");
      tipEl.textContent = "请用 HTTPS 或 localhost 打开此页面";
      serverNotice.querySelector("strong").textContent = "Camera requires secure context";
      serverNotice.querySelector("span").textContent =
        "Camera access requires HTTPS or localhost. " +
        "The current URL does not provide a secure context.";
      serverNotice.hidden = false;
      return;
    }
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    setCameraNotice(false);
    setStatus("starting camera");
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false,
    });
    state.cameraStream = stream;
    video.srcObject = stream;
    // Mobile-safe play — ensure playsinline is set
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    await video.play();
    state.lastError = "";
    setStatus("camera ready");
    markCameraFrame();
    window.clearTimeout(state.cameraCheckTimer);
    state.cameraCheckTimer = window.setTimeout(() => {
      if (!cameraHasFrame()) {
        setStatus("camera has no frame");
        setCameraNotice(true);
      } else {
        markCameraFrame();
      }
    }, 3000);
  } catch (error) {
    rememberError(error);
    state.lastError = `camera: ${error.message || error}`;
    setStatus("camera blocked");
    // Show actionable error message based on context
    if (isWeChat()) {
      tipEl.textContent = "微信内置浏览器不支持摄像头 — 请用 Safari/Chrome 打开";
    } else if (isMobile()) {
      tipEl.textContent = "请允许摄像头权限，或关闭其他占用摄像头的标签页";
    } else {
      tipEl.textContent = "请允许摄像头权限，或关闭其他占用摄像头的标签页";
    }
    setCameraNotice(true);
    console.error(error);
  }
};

const startStroke = (point) => {
  state.drawing = true;
  state.lastPoint = point;
  state.currentStroke = {
    points: [{ x: point.x, y: point.y }],
    widths: [],
    color: state.color,
    birth: performance.now(),
    life: 2800,
  };
  state.strokes.push(state.currentStroke);
};

const moveStroke = (point) => {
  if (!state.drawing) return;
  const next = point;
  // Skip very close points to avoid oversampling
  if (distance(state.lastPoint, next) < 3) return;
  drawSegment(state.lastPoint, next);
  drawPointerHalo(next);
  state.lastPoint = next;

  // Limit points per stroke to prevent memory buildup
  if (state.currentStroke && state.currentStroke.points.length > 100) {
    const excess = state.currentStroke.points.length - 80;
    if (excess > 10) {
      state.currentStroke.points.splice(0, excess);
      state.currentStroke.widths.splice(0, excess);
    }
  }
};

const endStroke = () => {
  if (!state.drawing) return;
  state.drawing = false;
  state.lastPoint = null;
  state.currentStroke = null;
  state.strokeCount += 1;
  strokeCountEl.textContent = String(state.strokeCount);

  // Limit total strokes to 80 — remove oldest if over limit
  if (state.strokes.length > 80) {
    state.strokes.splice(0, state.strokes.length - 80);
  }
};

// Pointer (mouse/stylus) handlers
const startPointerStroke = (event) => {
  if (state.mode !== "pointer") return;
  startStroke(eventPoint(event));
  paint.setPointerCapture(event.pointerId);
};

const movePointerStroke = (event) => {
  if (state.mode !== "pointer") return;
  moveStroke(eventPoint(event));
};

const endPointerStroke = () => {
  if (state.mode !== "pointer") return;
  endStroke();
};

// Touch (mobile finger) handlers
const touchPoint = (touch) => {
  const rect = paint.getBoundingClientRect();
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  };
};

const startTouchStroke = (event) => {
  if (state.mode !== "pointer") return;
  event.preventDefault();
  const touch = event.changedTouches[0];
  startStroke(touchPoint(touch));
};

const moveTouchStroke = (event) => {
  if (state.mode !== "pointer") return;
  event.preventDefault();
  const touch = event.changedTouches[0];
  moveStroke(touchPoint(touch));
};

const endTouchStroke = (event) => {
  if (state.mode !== "pointer") return;
  event.preventDefault();
  endStroke();
};

const resetInteractionState = () => {
  state.geometryState = createGeometryState();
  state.fireworkState = createFireworkState();
  state.particles = [];
  state.fireworks = [];
  state.strokes = [];
  state.currentStroke = null;
  state.lastGesture = null;
  state.gesturePhase = "idle";
  state.detectedHands = 0;
  state.missedHands = 0;
  state.lastPoint = null;
  state.drawing = false;
  state.lastVideoTime = -1;
  state.lastDetectionAt = 0;
};

const setMode = async (mode) => {
  state.mode = mode;
  resetInteractionState();
  modeLabel.textContent =
    mode === "geometry" ? "Geometry" : mode === "firework" ? "Firework" : "Pointer";
  pointerMode.classList.toggle("active", mode === "pointer");
  handMode.classList.toggle("active", mode === "geometry");
  fireworkMode.classList.toggle("active", mode === "firework");
  tipEl.textContent =
    mode === "geometry" ? "use both hands" : mode === "firework" ? "fist then open" : isMobile() ? "touch to draw" : "drag to draw";

  if (mode === "geometry" || mode === "firework") {
    await ensureHandTracking();
  } else {
    setStatus("pointer mode");
  }
};

const ensureHandTracking = async () => {
  if (state.handReady) {
    setStatus("hand tracking");
    return;
  }
  if (state.handLoading) {
    await state.handLoading;
    return;
  }

  state.handLoading = (async () => {
    setStatus("loading hand model");
    const visionModule = await import("./vendor/mediapipe/vision_bundle.mjs");
    const { FilesetResolver, HandLandmarker } = visionModule;
    state.vision = await FilesetResolver.forVisionTasks(
      "/vendor/mediapipe/wasm"
    );
    state.handLandmarker = await HandLandmarker.createFromOptions(state.vision, {
      baseOptions: {
        modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.08,
      minHandPresenceConfidence: 0.1,
      minTrackingConfidence: 0.12,
    });
    state.handReady = true;
    state.lastError = "";
    setStatus("tracking ready");
  })();

  try {
    await state.handLoading;
  } catch (error) {
    rememberError(error);
    state.lastError = `landmarker: ${error.message || error}`;
    console.warn("hand model loading failed:", error);
    state.mode = "pointer";
    modeLabel.textContent = "Pointer";
    pointerMode.classList.add("active");
    handMode.classList.remove("active");
    setStatus("hand model unavailable");
    tipEl.textContent =
      "模型文件较大 (7.5MB+32MB)，请确保网络通畅后刷新重试。" +
      " 如果反复失败，尝试切换网络或使用 Chrome/Safari。";
  } finally {
    state.handLoading = null;
  }
};

const mirroredPointFromLandmark = (landmark) => {
  const rect = paint.getBoundingClientRect();
  const videoWidth = video.videoWidth || rect.width;
  const videoHeight = video.videoHeight || rect.height;
  const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  const offsetX = (rect.width - drawnWidth) / 2;
  const offsetY = (rect.height - drawnHeight) / 2;

  return {
    x: rect.width - (offsetX + landmark.x * drawnWidth),
    y: offsetY + landmark.y * drawnHeight,
  };
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const smoothPoint = (previous, next, alpha = 0.42) => {
  if (!previous) return next;
  return {
    x: previous.x + (next.x - previous.x) * alpha,
    y: previous.y + (next.y - previous.y) * alpha,
  };
};

const smoothBoolean = (_previous, next) => next;

const adaptiveAlpha = (track, observation, base = 0.56, fast = 0.88) => {
  if (!track?.center) return fast;
  const travel = distance(track.center, observation.center);
  return clamp(base + travel / 220, base, fast);
};

const fingerExtended = (tip, pip, wrist, palm, margin = 1.04) =>
  distance(tip, wrist) > distance(pip, wrist) * margin ||
  distance(tip, palm) > distance(pip, palm) * 1.08;

const getFingerStates = (hand) => {
  const wrist = mirroredPointFromLandmark(hand[0]);
  const palm = getPalm(hand);
  return [
    fingerExtended(mirroredPointFromLandmark(hand[8]), mirroredPointFromLandmark(hand[6]), wrist, palm),
    fingerExtended(mirroredPointFromLandmark(hand[12]), mirroredPointFromLandmark(hand[10]), wrist, palm),
    fingerExtended(mirroredPointFromLandmark(hand[16]), mirroredPointFromLandmark(hand[14]), wrist, palm),
    fingerExtended(mirroredPointFromLandmark(hand[20]), mirroredPointFromLandmark(hand[18]), wrist, palm),
  ];
};

const getPalm = (hand) => {
  const wrist = mirroredPointFromLandmark(hand[0]);
  return polygonCenter([
    wrist,
    mirroredPointFromLandmark(hand[5]),
    mirroredPointFromLandmark(hand[9]),
    mirroredPointFromLandmark(hand[17]),
  ]);
};

const getTwoHandGeometry = (hands, handednesses = []) => {
  const observations = hands.slice(0, 2).map((hand, index) =>
    getHandObservation(hand, handednesses[index]?.[0]?.categoryName || handednesses[index]?.[0]?.displayName || "")
  );
  updateGeometryTracks(observations);

  const tracks = state.geometryState.tracks;
  if (!trackUsable(tracks.left) || !trackUsable(tracks.right)) {
    return null;
  }

  const left = tracks.left;
  const right = tracks.right;
  const points = [left.thumb, left.index, right.index, right.thumb];
  const center = polygonCenter(points);
  const openness = Math.min(3, distance(left.center, right.center) / 260);
  return { points, center, openness, fingerStates: [true, true, true, true] };
};

const getHandObservation = (hand, label = "") => {
  const thumb = mirroredPointFromLandmark(hand[4]);
  const index = mirroredPointFromLandmark(hand[8]);
  const palm = getPalm(hand);
  const wrist = mirroredPointFromLandmark(hand[0]);
  const fingerStates = getFingerStates(hand);
  return {
    hand,
    label,
    thumb,
    index,
    palm,
    wrist,
    center: polygonCenter([thumb, index, palm]),
    fingerStates,
  };
};

const updateTrack = (track, observation, alpha = 0.42) => ({
  thumb: smoothPoint(track?.thumb, observation.thumb, alpha),
  index: smoothPoint(track?.index, observation.index, alpha),
  palm: smoothPoint(track?.palm, observation.palm, alpha),
  wrist: smoothPoint(track?.wrist, observation.wrist, alpha),
  center: smoothPoint(track?.center, observation.center, alpha),
  fingerStates: observation.fingerStates.map((value, index) =>
    smoothBoolean(track?.fingerStates?.[index], value)
  ),
  missing: 0,
});

const trackUsable = (track) => Boolean(track && track.missing <= 8 && track.thumb && track.index);

const ageGeometryTracks = () => {
  const tracks = state.geometryState.tracks;
  for (const side of ["left", "right"]) {
    if (tracks[side]) {
      tracks[side].missing += 1;
    }
  }
};

const updateGeometryTracks = (observations) => {
  const tracks = state.geometryState.tracks;
  ageGeometryTracks();
  if (observations.length === 0) return;

  const labeledLeft = observations.find((observation) => /right/i.test(observation.label));
  const labeledRight = observations.find((observation) => /left/i.test(observation.label));
  if (labeledLeft && labeledRight && labeledLeft !== labeledRight) {
    tracks.left = updateTrack(tracks.left, labeledLeft, adaptiveAlpha(tracks.left, labeledLeft, 0.62, 0.92));
    tracks.right = updateTrack(tracks.right, labeledRight, adaptiveAlpha(tracks.right, labeledRight, 0.62, 0.92));
    return;
  }

  const sorted = observations.slice().sort((a, b) => a.center.x - b.center.x);
  if (sorted.length >= 2) {
    tracks.left = updateTrack(tracks.left, sorted[0], adaptiveAlpha(tracks.left, sorted[0], 0.62, 0.92));
    tracks.right = updateTrack(tracks.right, sorted[1], adaptiveAlpha(tracks.right, sorted[1], 0.62, 0.92));
    return;
  }

  const observation = sorted[0];
  const leftDistance = tracks.left
    ? distance(observation.center, tracks.left.center)
    : Number.POSITIVE_INFINITY;
  const rightDistance = tracks.right
    ? distance(observation.center, tracks.right.center)
    : Number.POSITIVE_INFINITY;
  const side = leftDistance < rightDistance ? "left" : rightDistance < leftDistance ? "right" : observation.center.x < paint.getBoundingClientRect().width / 2 ? "left" : "right";
  tracks[side] = updateTrack(tracks[side], observation, adaptiveAlpha(tracks[side], observation, 0.66, 0.94));
};

const updateFireworkTrack = (hand) => {
  const observation = getHandObservation(hand);
  const firework = state.fireworkState;
  firework.track = updateTrack(firework.track, observation, adaptiveAlpha(firework.track, observation, 0.6, 0.9));
  return firework.track;
};

const getFireworkGesture = (hand, track) => {
  const palm = track.palm;
  const wrist = mirroredPointFromLandmark(hand[0]);
  const palmScale = Math.max(32, distance(wrist, mirroredPointFromLandmark(hand[9])));
  const tipIndexes = [8, 12, 16, 20];
  const pipIndexes = [6, 10, 14, 18];
  const tipRatios = tipIndexes.map((index) => distance(mirroredPointFromLandmark(hand[index]), palm) / palmScale);
  const pipRatios = pipIndexes.map((index) => distance(mirroredPointFromLandmark(hand[index]), palm) / palmScale);
  const openness = tipRatios.reduce((total, value) => total + value, 0) / tipRatios.length;
  const closedFingers = tipRatios.filter((value, index) => value < 1.18 || value < pipRatios[index] * 1.08).length;
  const openFingers = tipRatios.filter((value, index) => value > 1.36 && value > pipRatios[index] * 1.12).length;
  const baseline = Number.isFinite(state.fireworkState.minOpenness) ? state.fireworkState.minOpenness : openness;
  const expandedFromFist = openness > Math.max(1.34, baseline * 1.22);
  return {
    palm,
    openness,
    closedFingers,
    openFingers,
    isClosed: closedFingers >= 3 || openness < 1.18,
    isOpen: openFingers >= 3 || expandedFromFist,
  };
};

const updateFireworkState = (hand) => {
  const firework = state.fireworkState;
  const now = performance.now();

  if (firework.phase === "opened" && now - firework.lastTriggerAt >= 90) {
    firework.phase = "cooldown";
  }

  if (firework.phase === "cooldown" && now >= firework.cooldownUntil) {
    firework.phase = "idle";
    firework.fistFrames = 0;
    firework.openFrames = 0;
    firework.cooldownUntil = 0;
    firework.minOpenness = Infinity;
  }

  if (!hand) {
    firework.fistFrames = 0;
    firework.openFrames = 0;
    firework.track = null;
    firework.minOpenness = Infinity;
    if (firework.phase !== "cooldown") firework.phase = "idle";
    setStatus(state.missedHands > 20 ? "show one hand" : "looking for hand");
    return;
  }

  const track = updateFireworkTrack(hand);
  const gesture = getFireworkGesture(hand, track);
  firework.openness = gesture.openness;
  firework.minOpenness = Math.min(firework.minOpenness, gesture.openness);

  if (firework.phase === "idle") {
    if (gesture.isClosed) {
      firework.fistFrames += 1;
      if (firework.fistFrames >= 3) {
        firework.phase = "fistReady";
        firework.openFrames = 0;
      }
    } else {
      firework.fistFrames = 0;
      firework.openFrames = 0;
      firework.minOpenness = Math.min(firework.minOpenness, gesture.openness);
    }
  }

  if (firework.phase === "fistReady") {
    if (gesture.isOpen) {
      firework.openFrames += 1;
      if (firework.openFrames >= 2) {
        spawnFirework(gesture.palm);
        firework.phase = "opened";
        firework.cooldownUntil = now + 700;
        firework.lastTriggerAt = now;
        firework.fistFrames = 0;
        firework.openFrames = 0;
        firework.minOpenness = Infinity;
        state.strokeCount += 1;
        strokeCountEl.textContent = String(state.strokeCount);
      }
    } else if (gesture.isClosed) {
      firework.openFrames = 0;
      firework.fistFrames = Math.min(firework.fistFrames + 1, 6);
    } else {
      firework.openFrames = Math.max(0, firework.openFrames - 1);
      firework.fistFrames = Math.max(0, firework.fistFrames - 1);
      if (firework.fistFrames === 0) {
        firework.phase = "idle";
        firework.minOpenness = Infinity;
      }
    }
  }

  const phaseLabel = firework.phase === "fistReady" ? "fist ready" : firework.phase;
  setStatus(`${phaseLabel} ${gesture.openness.toFixed(2)}`);
};

const detectAndRender = () => {
  if (!pageActive()) return;
  if (!state.handReady || !state.handLandmarker) return;
  if (state.mode !== "geometry" && state.mode !== "firework") return;
  markCameraFrame();
  if (!cameraHasFrame()) {
    state.detectedHands = 0;
    return;
  }

  const nowForDetection = performance.now();
  if (nowForDetection - state.lastDetectionAt < state.detectionIntervalMs) {
    return;
  }

  if (video.currentTime === state.lastVideoTime) return;

  state.lastDetectionAt = nowForDetection;
  state.lastVideoTime = video.currentTime;
  state.detectFrameCount += 1;

  let results;
  try {
    results = state.handLandmarker.detectForVideo(video, performance.now());
  } catch (error) {
    rememberError(error);
    state.lastError = `detect: ${error.message || error}`;
    console.warn("hand detection skipped", error);
    state.detectedHands = 0;
    state.lastVideoTime = -1;
    return;
  }

  const hands = results.landmarks || [];
  const handednesses = results.handednesses || [];
  state.detectedHands = hands.length;

  if (state.mode === "geometry") {
    state.detectionCount += 1;
    const geometry = getTwoHandGeometry(hands, handednesses);
    state.geometryState.current = geometry;
    if (geometry) {
      state.missedHands = 0;
      setStatus(hands.length >= 2 ? "vertices 4/4" : "holding last hand");
    } else {
      state.missedHands += 1;
      setStatus(hands.length === 1 ? "need both hands" : "show both hands");
    }
  } else if (state.mode === "firework") {
    state.detectionCount += 1;
    state.geometryState.current = null;
    if (hands.length >= 1) {
      state.missedHands = 0;
      updateFireworkState(hands[0]);
    } else {
      state.missedHands += 1;
      updateFireworkState(null);
    }
  }
};

const startLoop = () => {
  if (state.isLoopRunning) return;
  state.isLoopRunning = true;

  const loop = () => {
    state.animationId = requestAnimationFrame(loop);
    state.loopFrameCount += 1;
    renderFrame();
    detectAndRender();
  };

  loop();
};

document.querySelectorAll(".swatch").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".swatch.active")?.classList.remove("active");
    button.classList.add("active");
    state.color = button.dataset.color;
    document.querySelector(".spark").style.background = state.color;
    document.querySelector(".spark").style.boxShadow = `0 0 18px ${state.color}`;
  });
});

// Pointer events (desktop mouse / stylus)
paint.addEventListener("pointerdown", startPointerStroke);
paint.addEventListener("pointermove", movePointerStroke);
paint.addEventListener("pointerup", endPointerStroke);
paint.addEventListener("pointercancel", endPointerStroke);

// Touch events (mobile finger drawing)
paint.addEventListener("touchstart", startTouchStroke, { passive: false });
paint.addEventListener("touchmove", moveTouchStroke, { passive: false });
paint.addEventListener("touchend", endTouchStroke, { passive: false });
paint.addEventListener("touchcancel", endTouchStroke, { passive: false });
pointerMode.addEventListener("click", () => setMode("pointer"));
handMode.addEventListener("click", () => setMode("geometry"));
fireworkMode.addEventListener("click", () => setMode("firework"));
restartCamera.addEventListener("click", () => startCamera());

video.addEventListener("loadeddata", markCameraFrame);
video.addEventListener("playing", markCameraFrame);
video.addEventListener("timeupdate", markCameraFrame);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    state.geometryState.current = null;
    state.particles = [];
    state.fireworks = [];
    // Keep strokes — they continue to fade while hidden
  } else {
    setStatus(state.mode === "pointer" ? "camera ready" : "tracking ready");
  }
});

clearButton.addEventListener("click", () => {
  const { width, height } = paint.getBoundingClientRect();
  paintCtx.clearRect(0, 0, width, height);
  state.strokes = [];
  state.currentStroke = null;
  resetInteractionState();
  state.strokeCount = 0;
  strokeCountEl.textContent = "0";
  setStatus(`${state.mode} mode`);
});

shotButton.addEventListener("click", () => {
  const output = document.createElement("canvas");
  const rect = paint.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  output.width = Math.round(rect.width * ratio);
  output.height = Math.round(rect.height * ratio);
  const ctx = output.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.translate(rect.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, rect.width, rect.height);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.drawImage(paint, 0, 0, rect.width, rect.height);
  ctx.drawImage(fx, 0, 0, rect.width, rect.height);

  const link = document.createElement("a");
  link.download = `claude-cam-${Date.now()}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
});

window.addEventListener("resize", fitCanvas);

fitCanvas();
startLoop();

// Check environment and start camera
if (needsLocalServer()) {
  // file:// protocol — show localhost hint
  setStatus("open localhost url");
  tipEl.textContent = "use 127.0.0.1:5180";
  serverNotice.hidden = false;
} else if (!cameraAllowed()) {
  // HTTP (not localhost) — show HTTPS hint
  setStatus("Camera requires secure context");
  tipEl.textContent = isWeChat()
    ? "微信内置浏览器不支持 — 请用 Safari/Chrome 打开 https:// 地址"
    : "open via HTTPS or localhost";
  serverNotice.hidden = false;
} else {
  // localhost or HTTPS — good to go
  if (isMobile()) {
    // Mobile: default to touch draw, camera may work or not
    setMode("pointer");
    startCamera();
  } else {
    // Desktop: start with geometry mode
    startCamera().then(() => setMode("geometry"));
  }
}
