/* ============================================================
   Retro iPod PWA — app.js
   Full Offline Music Player + Full Screen Mobile + Touch Stickers
   ============================================================ */

(() => {
"use strict";

/* ---------------------------------------------------------
   0. IndexedDB (Meta, Audio, Art, and Stickers)
--------------------------------------------------------- */
const DB_NAME = "RetroIpodDB";
const DB_VERSION = 2;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      if (!db.objectStoreNames.contains("art")) db.createObjectStore("art", { keyPath: "id" });
      if (!db.objectStoreNames.contains("stickers")) db.createObjectStore("stickers", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "audio", "art"], "readwrite");
    tx.objectStore("meta").clear();
    tx.objectStore("audio").clear();
    tx.objectStore("art").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------------------------------------------------
   1. Small Utilities & Color Helpers
--------------------------------------------------------- */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return mb.toFixed(1) + " MB";
  return (mb / 1024).toFixed(2) + " GB";
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isVolumeSettable() {
  try {
    const testAudio = document.createElement("audio");
    testAudio.volume = 0.5;
    return Math.abs(testAudio.volume - 0.5) < 0.05;
  } catch (e) {
    return false;
  }
}

// iOS ignores JS volume control (hardware buttons only) even though it may
// echo back the value you set, so isVolumeSettable() alone can't be trusted.
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function hexToRgb(hex) {
  let c = hex.replace("#", "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  const num = parseInt(c, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

function getLuminance(hex) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b);
  } catch (e) {
    return 255;
  }
}

/* ---------------------------------------------------------
   2. Settings & Colors
--------------------------------------------------------- */
const settings = {
  get repeat() { return localStorage.getItem("ripod:repeat") || "off"; },
  set repeat(v) { localStorage.setItem("ripod:repeat", v); },

  get wheelSound() { return localStorage.getItem("ripod:wheelSound") !== "off"; },
  set wheelSound(v) { localStorage.setItem("ripod:wheelSound", v ? "on" : "off"); },

  get haptics() { return localStorage.getItem("ripod:haptics") !== "off"; },
  set haptics(v) { localStorage.setItem("ripod:haptics", v ? "on" : "off"); },

  get theme() { return localStorage.getItem("ripod:theme") || "silver"; },
  set theme(v) { 
    localStorage.setItem("ripod:theme", v);
    document.body.className = `theme-${v}`;
    if (v === "silver") {
      this.shellColor = "#dcdfe3";
      this.screenColor = "#ffffff";
    } else if (v === "black") {
      this.shellColor = "#1a1b1e";
      this.screenColor = "#ffffff";
    } else if (v === "u2") {
      this.shellColor = "#151618";
      this.screenColor = "#ffffff";
    }
  },

  get shellColor() { return localStorage.getItem("ripod:shellColor") || "#dcdfe3"; },
  set shellColor(v) {
    localStorage.setItem("ripod:shellColor", v);
    applyShellColor(v);
  },

  get screenColor() { return localStorage.getItem("ripod:screenColor") || "#ffffff"; },
  set screenColor(v) {
    localStorage.setItem("ripod:screenColor", v);
    applyScreenColor(v);
  },

  get wheelNowPlaying() {
    if (isIOS) return "tracks";
    const saved = localStorage.getItem("ripod:wheelNowPlaying");
    if (saved) return saved;
    return isVolumeSettable() ? "volume" : "tracks";
  },
  set wheelNowPlaying(v) { localStorage.setItem("ripod:wheelNowPlaying", v); },

  get nowPlayingStyle() { return localStorage.getItem("ripod:npStyle") || "coverflow"; },
  set nowPlayingStyle(v) { localStorage.setItem("ripod:npStyle", v); },
};

function applyShellColor(hex) {
  document.documentElement.style.setProperty("--shell-base-color", hex);
}

function applyScreenColor(hex) {
  document.documentElement.style.setProperty("--lcd-screen-bg", hex);
  const lum = getLuminance(hex);

  if (lum < 130) {
    document.documentElement.style.setProperty("--lcd-text", "#ffffff");
    document.documentElement.style.setProperty("--lcd-subtext", "#a8a8a8");
    document.documentElement.style.setProperty("--lcd-row-border", "rgba(255,255,255,0.12)");
    document.documentElement.style.setProperty("--lcd-header-bg", "linear-gradient(180deg, #303236 0%, #1e2023 50%, #151618 51%, #222428 100%)");
    document.documentElement.style.setProperty("--lcd-header-border", "#404349");
  } else {
    document.documentElement.style.setProperty("--lcd-text", "#000000");
    document.documentElement.style.setProperty("--lcd-subtext", "#555555");
    document.documentElement.style.setProperty("--lcd-row-border", "#e0e0e0");
    document.documentElement.style.setProperty("--lcd-header-bg", "linear-gradient(180deg, #e3e3e4 0%, #c4c6ca 50%, #aeb1b6 51%, #babdc2 100%)");
    document.documentElement.style.setProperty("--lcd-header-border", "#8b8e94");
  }
}

// Initial application
document.body.className = `theme-${settings.theme}`;
applyShellColor(settings.shellColor);
applyScreenColor(settings.screenColor);

/* ---------------------------------------------------------
   3. App State & DOM Refs
--------------------------------------------------------- */
const state = {
  library: [],
  navStack: [],
  queue: [],
  queueIndex: -1,
  currentTrackId: null,
  isPlaying: false,
  hold: false,
  importing: false,
  stickers: [],
  stickersEditing: false,
  selectedStickerId: null,
  audioObjectUrl: null,
  artObjectUrl: null,
  npCoverCache: new Map(),
  npBuiltTrackId: undefined,
  npBuiltStyle: null,
  npBuildToken: 0,
  cfSlots: null,
  shuffleOrigQueue: null,
};

const ipodShellEl = document.getElementById("ipodShell");
const screenTitleEl = document.getElementById("screenTitle");
const screenContentEl = document.getElementById("screenContent");
const statusPlayIconEl = document.getElementById("statusPlayIcon");
const holdBadgeEl = document.getElementById("holdBadge");
const holdSwitchEl = document.getElementById("holdSwitch");
const clickwheelEl = document.getElementById("clickwheel");
const wheelRingEl = document.getElementById("wheelRing");
const volumeOverlayEl = document.getElementById("volumeOverlay");
const volumeFillEl = document.getElementById("volumeFill");
const trackHudOverlayEl = document.getElementById("trackHudOverlay");
const trackHudIconEl = document.getElementById("trackHudIcon");
const trackHudTextEl = document.getElementById("trackHudText");

const stickersContainerEl = document.getElementById("stickersContainer");
const stickerEditBarEl = document.getElementById("stickerEditBar");
const sebAddBtn = document.getElementById("sebAddBtn");
const sebDoneBtn = document.getElementById("sebDoneBtn");

const fileInputEl = document.getElementById("fileInput");
const stickerFileInputEl = document.getElementById("stickerFileInput");
const audioEl = document.getElementById("audioEl");

/* Restore saved volume */
const savedVolume = parseFloat(localStorage.getItem("ripod:volume"));
if (!isNaN(savedVolume)) {
  audioEl.volume = Math.max(0, Math.min(1, savedVolume));
} else {
  audioEl.volume = 0.85;
}

/* ---------------------------------------------------------
   4. Sticker Engine: Full Touch & Drag/Resize/Rotate
--------------------------------------------------------- */
async function loadStickers() {
  state.stickers = await idbGetAll("stickers");
  renderStickers();
}

function renderStickers() {
  stickersContainerEl.innerHTML = "";
  state.stickers.forEach((s) => {
    const el = document.createElement("div");
    el.className = `ipod-sticker${s.id === state.selectedStickerId ? " selected" : ""}`;
    el.dataset.id = s.id;
    el.style.left = s.leftPct + "%";
    el.style.top = s.topPct + "%";
    el.style.width = (s.widthPx || 100) + "px";
    el.style.transform = `rotate(${s.rotationDeg || 0}deg)`;

    el.innerHTML = `
      <img src="${s.dataUrl}" alt="sticker" draggable="false" />
      <div class="sticker-controls">
        <button class="sticker-btn-del" title="Delete">×</button>
        <div class="sticker-btn-rot" title="Rotate">↻</div>
        <div class="sticker-btn-resize" title="Resize">⤡</div>
      </div>
    `;

    stickersContainerEl.appendChild(el);
  });
}

function setStickersEditingMode(enable) {
  state.stickersEditing = enable;
  stickersContainerEl.classList.toggle("editing", enable);
  stickersContainerEl.classList.toggle("locked", !enable);
  stickerEditBarEl.classList.toggle("show", enable);

  if (!enable) {
    state.selectedStickerId = null;
  }
  renderStickers();
}

// Global Touch / Pointer tracker for Stickers on Mobile & Laptop
let activeDrag = null;

stickersContainerEl.addEventListener("pointerdown", (e) => {
  if (!state.stickersEditing) return;

  const delBtn = e.target.closest(".sticker-btn-del");
  const rotBtn = e.target.closest(".sticker-btn-rot");
  const resizeBtn = e.target.closest(".sticker-btn-resize");
  const stickerEl = e.target.closest(".ipod-sticker");

  if (!stickerEl) {
    state.selectedStickerId = null;
    renderStickers();
    return;
  }

  const sId = stickerEl.dataset.id;
  const stickerData = state.stickers.find((s) => s.id === sId);
  if (!stickerData) return;

  if (delBtn) {
    e.stopPropagation();
    deleteSticker(sId);
    return;
  }

  // Select without a full renderStickers() rebuild: iOS Safari cancels the
  // in-progress touch sequence if the DOM node under the finger gets replaced.
  if (state.selectedStickerId !== sId) {
    state.selectedStickerId = sId;
    stickersContainerEl.querySelectorAll(".ipod-sticker.selected").forEach((el) => el.classList.remove("selected"));
    stickerEl.classList.add("selected");
  }

  const stickerRect = stickerEl.getBoundingClientRect();
  const centerX = stickerRect.left + stickerRect.width / 2;
  const centerY = stickerRect.top + stickerRect.height / 2;

  let mode = "move";
  if (resizeBtn) mode = "resize";
  else if (rotBtn) mode = "rotate";

  activeDrag = {
    mode,
    stickerData,
    stickerEl,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    centerX,
    centerY,
    origLeftPct: stickerData.leftPct,
    origTopPct: stickerData.topPct,
    origWidth: stickerData.widthPx || 100,
    origRot: stickerData.rotationDeg || 0,
    origDist: Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1,
    origAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI),
  };

  try {
    freshEl.setPointerCapture(e.pointerId);
  } catch (err) {}
  e.preventDefault();
});

window.addEventListener("pointermove", (e) => {
  if (!activeDrag) return;
  const { mode, stickerData, stickerEl, startX, startY, centerX, centerY, origLeftPct, origTopPct, origWidth, origRot, origDist, origAngle } = activeDrag;
  const shellRect = ipodShellEl.getBoundingClientRect();

  if (mode === "move") {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newLeft = origLeftPct + (dx / shellRect.width) * 100;
    const newTop = origTopPct + (dy / shellRect.height) * 100;

    stickerData.leftPct = Math.max(-15, Math.min(90, newLeft));
    stickerData.topPct = Math.max(-5, Math.min(92, newTop));

    stickerEl.style.left = stickerData.leftPct + "%";
    stickerEl.style.top = stickerData.topPct + "%";
  } else if (mode === "resize") {
    const curDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    const scaleRatio = curDist / origDist;
    const newWidth = Math.max(35, Math.min(shellRect.width * 0.9, origWidth * scaleRatio));

    stickerData.widthPx = Math.round(newWidth);
    stickerEl.style.width = stickerData.widthPx + "px";
  } else if (mode === "rotate") {
    const curAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
    const angleDelta = curAngle - origAngle;
    stickerData.rotationDeg = Math.round((origRot + angleDelta) % 360);

    stickerEl.style.transform = `rotate(${stickerData.rotationDeg}deg)`;
  }
});

const endStickerDrag = async (e) => {
  if (!activeDrag) return;
  const { stickerData, stickerEl, pointerId } = activeDrag;
  activeDrag = null;
  try { stickerEl.releasePointerCapture(pointerId); } catch (err) {}
  await idbPut("stickers", stickerData);
};

window.addEventListener("pointerup", endStickerDrag);
window.addEventListener("pointercancel", endStickerDrag);

async function addNewStickerFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const newSticker = {
      id: uid(),
      dataUrl: reader.result,
      leftPct: 25 + Math.random() * 20,
      topPct: 20 + Math.random() * 25,
      widthPx: 110,
      rotationDeg: Math.round((Math.random() - 0.5) * 20),
    };
    await idbPut("stickers", newSticker);
    state.stickers.push(newSticker);
    state.selectedStickerId = newSticker.id;
    setStickersEditingMode(true);
  };
  reader.readAsDataURL(file);
}

async function deleteSticker(id) {
  await idbDelete("stickers", id);
  state.stickers = state.stickers.filter((s) => s.id !== id);
  if (state.selectedStickerId === id) state.selectedStickerId = null;
  renderStickers();
}

async function clearAllStickers() {
  const db = await openDB();
  const tx = db.transaction("stickers", "readwrite");
  tx.objectStore("stickers").clear();
  state.stickers = [];
  state.selectedStickerId = null;
  renderStickers();
}

stickerFileInputEl.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) {
    addNewStickerFromFile(e.target.files[0]);
  }
  stickerFileInputEl.value = "";
});

sebAddBtn.addEventListener("click", () => stickerFileInputEl.click());
sebDoneBtn.addEventListener("click", () => setStickersEditingMode(false));

/* ---------------------------------------------------------
   6. Screen Builders & LCD RGB Tuner
--------------------------------------------------------- */
function sortedSongs() {
  return state.library.slice().sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}

function groupBy(tracks, key) {
  const map = new Map();
  tracks.forEach((t) => {
    const k = t[key] || (key === "artist" ? "Unknown Artist" : "Unknown Album");
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  });
  return map;
}

function buildTrackListScreen(title, tracks, opts = {}) {
  return {
    key: "tracklist-" + title + "-" + tracks.length,
    kind: "list",
    title,
    selected: 0,
    scrollOffset: 0,
    emptyMessage: opts.emptyMessage || "No songs yet.\nAdd music from the Main Menu.",
    trackIds: tracks.map((t) => t.id),
    items: tracks.map((t) => ({
      label: t.title,
      sub: formatDuration(t.duration),
      chevron: false,
    })),
  };
}

function buildArtistsScreen() {
  const groups = groupBy(state.library, "artist");
  const names = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return {
    key: "artists",
    kind: "list",
    title: "Artists",
    selected: 0,
    scrollOffset: 0,
    emptyMessage: "No artists yet.\nAdd music from the Main Menu.",
    items: names.map((name) => ({
      label: name,
      sub: String(groups.get(name).length),
      chevron: true,
      action: () => pushScreen(buildTrackListScreen(
        name,
        groups.get(name).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      )),
    })),
  };
}

function buildAlbumsScreen() {
  const groups = groupBy(state.library, "album");
  const names = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return {
    key: "albums",
    kind: "list",
    title: "Albums",
    selected: 0,
    scrollOffset: 0,
    emptyMessage: "No albums yet.\nAdd music from the Main Menu.",
    items: names.map((name) => ({
      label: name,
      sub: String(groups.get(name).length),
      chevron: true,
      action: () => pushScreen(buildTrackListScreen(
        name,
        groups.get(name).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }))
      )),
    })),
  };
}

/* In-Screen LCD RGB Tuner (Works 100% on phones without input bugs) */
function buildRgbTunerScreen(target) {
  const currentHex = target === "shell" ? settings.shellColor : settings.screenColor;
  const rgb = hexToRgb(currentHex);

  return {
    key: "rgb-tuner-" + target,
    kind: "rgb-tuner",
    title: target === "shell" ? "Shell Color Mixer" : "Screen Color Mixer",
    target,
    selected: 0, // 0: R, 1: G, 2: B, 3: Done
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
  };
}

function buildColorPaletteScreen(target) {
  const isShell = target === "shell";
  const presets = isShell ? [
    { label: "Classic Silver", hex: "#dcdfe3" },
    { label: "Stealth Black", hex: "#1a1b1e" },
    { label: "U2 Edition", hex: "#151618" },
    { label: "iPod Mini Blue", hex: "#3b88c3" },
    { label: "iPod Mini Pink", hex: "#e04b77" },
    { label: "iPod Mini Green", hex: "#48ad5b" },
    { label: "iPod Mini Gold", hex: "#d8a44b" },
    { label: "Special Purple", hex: "#6f42c1" },
    { label: "Product RED", hex: "#d91e2b" },
    { label: "Snow White", hex: "#f0f2f5" },
  ] : [
    { label: "Classic White", hex: "#ffffff" },
    { label: "OLED Pitch Black", hex: "#000000" },
    { label: "Retro Amber (1st Gen)", hex: "#f39c12" },
    { label: "Retro LCD Green", hex: "#8db38b" },
    { label: "Cool Ice Blue", hex: "#cde2f5" },
    { label: "Cyberpunk Cyan", hex: "#00ffff" },
  ];

  return {
    key: "palette-" + target,
    kind: "list",
    title: isShell ? "Shell Presets" : "LCD Presets",
    selected: 0,
    scrollOffset: 0,
    items: [
      {
        label: "Custom RGB...",
        sub: "Drag or Spin Wheel",
        chevron: true,
        action: () => pushScreen(buildRgbTunerScreen(target)),
      },
      ...presets.map((p) => ({
        label: p.label,
        sub: p.hex.toUpperCase(),
        chevron: false,
        action: () => {
          if (isShell) settings.shellColor = p.hex;
          else settings.screenColor = p.hex;
          popScreen();
        },
      })),
    ],
  };
}

function buildThemeColorScreen() {
  return {
    key: "theme-colors",
    kind: "list",
    title: "Colors & Shell",
    selected: 0,
    scrollOffset: 0,
    items: [
      {
        label: "Shell RGB Color",
        sub: settings.shellColor.toUpperCase(),
        chevron: true,
        action: () => pushScreen(buildColorPaletteScreen("shell")),
      },
      {
        label: "Screen RGB Color",
        sub: settings.screenColor.toUpperCase(),
        chevron: true,
        action: () => pushScreen(buildColorPaletteScreen("screen")),
      },
      {
        label: "Now Playing Style",
        sub: settings.nowPlayingStyle === "coverflow" ? "Cover Flow" : "Classic",
        chevron: false,
        action: () => {
          settings.nowPlayingStyle = settings.nowPlayingStyle === "coverflow" ? "classic" : "coverflow";
          replaceTop(buildThemeColorScreen());
        },
      },
      {
        label: "Preset: Classic Silver",
        chevron: false,
        action: () => {
          settings.theme = "silver";
          settings.shellColor = "#dcdfe3";
          settings.screenColor = "#ffffff";
          replaceTop(buildThemeColorScreen());
        },
      },
      {
        label: "Preset: Stealth Black",
        chevron: false,
        action: () => {
          settings.theme = "black";
          settings.shellColor = "#1a1b1e";
          settings.screenColor = "#ffffff";
          replaceTop(buildThemeColorScreen());
        },
      },
      {
        label: "Preset: U2 Edition",
        chevron: false,
        action: () => {
          settings.theme = "u2";
          settings.shellColor = "#151618";
          settings.screenColor = "#ffffff";
          replaceTop(buildThemeColorScreen());
        },
      },
    ],
  };
}

function buildStickersMenuScreen() {
  return {
    key: "stickers-menu",
    kind: "list",
    title: "Stickers",
    selected: 0,
    scrollOffset: 0,
    items: [
      {
        label: "Add Sticker...",
        sub: "PNG / JPG",
        chevron: false,
        action: () => stickerFileInputEl.click(),
      },
      {
        label: "Move & Edit Stickers",
        sub: state.stickers.length ? `${state.stickers.length} placed` : "0",
        chevron: false,
        action: () => setStickersEditingMode(true),
      },
      {
        label: "Clear All Stickers",
        sub: "",
        chevron: true,
        action: () => pushScreen(buildConfirmClearStickersScreen()),
      },
    ],
  };
}

function buildConfirmClearStickersScreen() {
  return {
    key: "confirm-clear-stickers",
    kind: "list",
    title: "Clear Stickers?",
    selected: 0,
    scrollOffset: 0,
    items: [
      { label: "Cancel", chevron: false, action: () => popScreen() },
      {
        label: "Remove All Stickers", chevron: false, action: async () => {
          await clearAllStickers();
          popScreen();
        },
      },
    ],
  };
}

function buildSettingsScreen() {
  const repeatLabels = { off: "Off", all: "All", one: "One" };
  const wheelNPLabel = settings.wheelNowPlaying === "tracks"
    ? "Next/Prev Song"
    : (isVolumeSettable() ? "Volume" : "Volume (iOS Locked)");

  return {
    key: "settings-" + settings.repeat + "-" + settings.wheelSound + "-" + settings.haptics + "-" + settings.wheelNowPlaying,
    kind: "list",
    title: "Settings",
    selected: 0,
    scrollOffset: 0,
    items: [
      {
        label: "Colors & Theme",
        sub: "RGB Shell & LCD",
        chevron: true,
        action: () => pushScreen(buildThemeColorScreen()),
      },
      {
        label: "Stickers",
        sub: String(state.stickers.length),
        chevron: true,
        action: () => pushScreen(buildStickersMenuScreen()),
      },
      ...(isIOS ? [] : [{
        label: "Wheel in Playback",
        sub: wheelNPLabel,
        chevron: false,
        action: () => {
          settings.wheelNowPlaying = settings.wheelNowPlaying === "tracks" ? "volume" : "tracks";
          replaceTop(buildSettingsScreen());
        },
      }]),
      {
        label: "Repeat",
        sub: repeatLabels[settings.repeat],
        chevron: false,
        action: () => {
          const order = ["off", "all", "one"];
          settings.repeat = order[(order.indexOf(settings.repeat) + 1) % order.length];
          replaceTop(buildSettingsScreen());
        },
      },
      {
        label: "Wheel Click Sound",
        sub: settings.wheelSound ? "On" : "Off",
        chevron: false,
        action: () => {
          settings.wheelSound = !settings.wheelSound;
          replaceTop(buildSettingsScreen());
        },
      },
      ...(hapticsSupported ? [{
        label: "Haptics",
        sub: settings.haptics ? "On" : "Off",
        chevron: false,
        action: () => {
          settings.haptics = !settings.haptics;
          replaceTop(buildSettingsScreen());
          haptic("press");
        },
      }] : []),
      {
        label: "Storage Used",
        sub: formatBytes(state.library.reduce((sum, t) => sum + (t.sizeBytes || 0), 0)),
        chevron: true,
        action: () => pushScreen(buildStorageScreen()),
      },
      {
        label: "Clear Library",
        sub: "",
        chevron: true,
        action: () => pushScreen(buildConfirmClearScreen()),
      },
    ],
  };
}

function buildStorageScreen() {
  const totalBytes = state.library.reduce((sum, t) => sum + (t.sizeBytes || 0), 0);
  return {
    key: "storage",
    kind: "list",
    title: "Storage",
    selected: 0,
    scrollOffset: 0,
    items: [
      { label: "Songs", sub: String(state.library.length), chevron: false },
      { label: "Stickers", sub: String(state.stickers.length), chevron: false },
      { label: "Library Size", sub: formatBytes(totalBytes), chevron: false },
      { label: "On-device only", sub: "", chevron: false },
    ],
  };
}

function buildConfirmClearScreen() {
  return {
    key: "confirm-clear",
    kind: "list",
    title: "Clear Library?",
    selected: 0,
    scrollOffset: 0,
    items: [
      { label: "Cancel", chevron: false, action: () => popScreen() },
      {
        label: "Erase All Songs", chevron: false, action: async () => {
          await clearLibrary();
          state.navStack = [buildMainMenu()];
          render();
        },
      },
    ],
  };
}

function buildEmptyNowPlayingScreen() {
  return {
    key: "nothing-playing",
    kind: "list",
    title: "Now Playing",
    selected: 0,
    scrollOffset: 0,
    emptyMessage: "Nothing is playing.\nSelect a song to begin.",
    items: [],
  };
}

const nowPlayingScreen = { key: "nowplaying", kind: "nowplaying", title: "Now Playing" };

function buildMainMenu() {
  return {
    key: "main",
    kind: "list",
    title: "iPod",
    selected: 0,
    scrollOffset: 0,
    items: [
      {
        label: "Now Playing", chevron: true, action: () => {
          if (state.currentTrackId) pushScreen(nowPlayingScreen);
          else pushScreen(buildEmptyNowPlayingScreen());
        },
      },
      { label: "Songs", sub: String(state.library.length), chevron: true, action: () => pushScreen(buildTrackListScreen("Songs", sortedSongs())) },
      { label: "Artists", chevron: true, action: () => pushScreen(buildArtistsScreen()) },
      { label: "Albums", chevron: true, action: () => pushScreen(buildAlbumsScreen()) },
      { label: "Shuffle Songs", chevron: false, action: () => shuffleAll() },
      { label: "Games", chevron: true, action: () => pushScreen(buildGamesScreen()) },
      { label: "Add Music...", chevron: false, action: () => triggerAddMusic() },
      { label: "Settings", chevron: true, action: () => pushScreen(buildSettingsScreen()) },
    ],
  };
}

/* ---------------------------------------------------------
   6b. Music Quiz (like the classic iPod game)
   Plays a short clip from a random song in the library and the player
   picks its title from a list before the timer runs out. Faster answers
   score more points. Uses its own audio element so the normal queue,
   Now Playing and lock-screen metadata are left alone.
--------------------------------------------------------- */
const QUIZ_ROUNDS = 10;
const QUIZ_CHOICES = 4;
const QUIZ_ROUND_SECONDS = 10;
const QUIZ_MAX_POINTS = 100;
const QUIZ_REVEAL_MS = 1800;

const quizAudio = new Audio();
quizAudio.preload = "auto";
quizAudio.setAttribute("playsinline", "");
let quizAudioUrl = null;

function quizBestScore() {
  return parseInt(localStorage.getItem("ripod:quizBest"), 10) || 0;
}

function buildGamesScreen() {
  return {
    key: "games",
    kind: "list",
    title: "Games",
    selected: 0,
    scrollOffset: 0,
    items: [
      { label: "Music Quiz", chevron: true, action: () => pushScreen(buildMusicQuizScreen()) },
    ],
  };
}

function buildMusicQuizScreen() {
  if (state.library.length < 2) {
    return {
      key: "quiz-empty",
      kind: "list",
      title: "Music Quiz",
      selected: 0,
      scrollOffset: 0,
      emptyMessage: "Add at least 2 songs\nto play Music Quiz.",
      items: [],
    };
  }
  // The quiz takes over the speaker, like on the real iPod.
  if (!audioEl.paused) audioEl.pause();

  const screen = {
    key: "quiz",
    kind: "quiz",
    title: "Music Quiz",
    phase: "intro",
    selected: 0,
    token: 0,
  };
  resetQuiz(screen);
  return screen;
}

function resetQuiz(screen) {
  screen.answers = shuffleArray(state.library.map((t) => t.id)).slice(0, QUIZ_ROUNDS);
  screen.round = 0;
  screen.score = 0;
  screen.correctCount = 0;
  screen.newBest = false;
  screen.preparing = prepareQuizRound(screen);
}

/* Picks the choices for the current round and loads its clip, seeked to a
   random point in the song, so it can start the instant the round begins. */
function prepareQuizRound(screen) {
  const token = ++screen.token;
  const answer = state.library.find((t) => t.id === screen.answers[screen.round]);
  const titleKey = (t) => t.title.trim().toLowerCase();
  const seen = new Set([titleKey(answer)]);
  const decoys = [];
  for (const t of shuffleArray(state.library.slice())) {
    if (decoys.length >= QUIZ_CHOICES - 1) break;
    if (seen.has(titleKey(t))) continue;
    seen.add(titleKey(t));
    decoys.push(t.id);
  }
  screen.answerId = answer.id;
  screen.choices = shuffleArray([answer.id, ...decoys]);
  screen.picked = null;
  screen.selected = 0;

  return (async () => {
    const rec = await idbGet("audio", answer.id);
    if (token !== screen.token) return;
    if (quizAudioUrl) URL.revokeObjectURL(quizAudioUrl);
    quizAudioUrl = rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    if (!quizAudioUrl) { quizAudio.removeAttribute("src"); return; }
    quizAudio.src = quizAudioUrl;

    await new Promise((resolve) => {
      if (quizAudio.readyState >= 1) return resolve();
      quizAudio.addEventListener("loadedmetadata", resolve, { once: true });
      quizAudio.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    if (token !== screen.token) return;
    const d = isFinite(quizAudio.duration) ? quizAudio.duration : (answer.duration || 0);
    if (d > QUIZ_ROUND_SECONDS * 3) {
      // Somewhere in the body of the song, not the intro or the fade out.
      const lo = d * 0.15;
      const hi = Math.max(lo, d * 0.75 - QUIZ_ROUND_SECONDS);
      try { quizAudio.currentTime = lo + Math.random() * (hi - lo); } catch (e) {}
    }
  })();
}

async function beginQuizRound(screen) {
  const token = screen.token;
  await screen.preparing;
  if (token !== screen.token || topScreen() !== screen) return;
  screen.phase = "playing";
  screen.roundStart = performance.now();
  quizAudio.play().catch((err) => console.warn("Quiz playback blocked:", err));
  render();
  clearInterval(screen.ticker);
  screen.ticker = setInterval(() => tickQuiz(screen), 100);
}

function quizRemaining(screen) {
  const elapsed = (performance.now() - screen.roundStart) / 1000;
  return Math.max(0, QUIZ_ROUND_SECONDS - elapsed);
}

function quizPointsNow(screen) {
  return Math.round((quizRemaining(screen) / QUIZ_ROUND_SECONDS) * QUIZ_MAX_POINTS);
}

/* Updates the timer in place instead of re-rendering, so a tap that lands
   mid-tick still hits the row it started on. */
function tickQuiz(screen) {
  if (screen.phase !== "playing") return;
  const remaining = quizRemaining(screen);
  const fill = screenContentEl.querySelector(".quiz-timer-fill");
  const pts = screenContentEl.querySelector(".quiz-points");
  if (fill) fill.style.width = (remaining / QUIZ_ROUND_SECONDS) * 100 + "%";
  if (pts) pts.textContent = String(quizPointsNow(screen));
  if (remaining <= 0) revealQuizAnswer(screen, null);
}

function revealQuizAnswer(screen, pickedId) {
  if (screen.phase !== "playing") return;
  clearInterval(screen.ticker);
  const correct = pickedId === screen.answerId;
  // Even a last-second right answer is worth something.
  screen.lastPoints = correct ? Math.max(10, quizPointsNow(screen)) : 0;
  screen.score += screen.lastPoints;
  if (correct) screen.correctCount++;
  screen.picked = pickedId;
  screen.phase = "reveal";
  render();

  // Keep the clip playing while the answer shows, then move on.
  const token = screen.token;
  screen.revealTimer = setTimeout(() => {
    if (token !== screen.token) return;
    quizAudio.pause();
    screen.round++;
    if (screen.round >= screen.answers.length) finishQuiz(screen);
    else {
      screen.preparing = prepareQuizRound(screen);
      beginQuizRound(screen);
    }
  }, QUIZ_REVEAL_MS);
}

function finishQuiz(screen) {
  screen.phase = "done";
  screen.selected = 0;
  if (screen.score > quizBestScore()) {
    screen.newBest = screen.score > 0;
    localStorage.setItem("ripod:quizBest", String(screen.score));
  }
  render();
}

function stopQuiz(screen) {
  screen.token++;
  clearInterval(screen.ticker);
  clearTimeout(screen.revealTimer);
  quizAudio.pause();
  quizAudio.removeAttribute("src");
  quizAudio.load();
  if (quizAudioUrl) { URL.revokeObjectURL(quizAudioUrl); quizAudioUrl = null; }
}

function quizRowCount(screen) {
  if (screen.phase === "playing") return screen.choices.length;
  if (screen.phase === "done") return 2;
  return 1;
}

function quizSelect(screen) {
  if (screen.phase === "intro") {
    // play() straight from the Start press so iOS treats it as user
    // initiated; later rounds reuse the same, now unlocked, element.
    quizAudio.play().catch(() => {});
    beginQuizRound(screen);
  }
  else if (screen.phase === "playing") revealQuizAnswer(screen, screen.choices[screen.selected]);
  else if (screen.phase === "done") {
    if (screen.selected === 0) {
      resetQuiz(screen);
      beginQuizRound(screen);
    } else {
      popScreen();
    }
  }
}

function renderQuiz(screen) {
  const row = (label, idx, sel, cls = "", mark = "") => `
    <div class="menu-row${sel ? " selected" : ""}${cls}" data-idx="${idx}">
      <span class="label">${esc(label)}</span>${mark ? `<span class="quiz-mark">${mark}</span>` : ""}
    </div>`;

  if (screen.phase === "intro" || screen.phase === "done") {
    const best = quizBestScore();
    const body = screen.phase === "intro"
      ? `<div class="quiz-card-title">Music Quiz</div>
         <div class="quiz-card-text">Name the song before<br>the timer runs out.</div>
         <div class="quiz-card-sub">${screen.answers.length} rounds · High Score ${best}</div>`
      : `<div class="quiz-card-title">${screen.newBest ? "New High Score!" : "Quiz Over"}</div>
         <div class="quiz-card-score">${screen.score}</div>
         <div class="quiz-card-sub">${screen.correctCount} of ${screen.answers.length} correct · Best ${best}</div>`;
    const rows = screen.phase === "intro"
      ? row("Start", 0, true)
      : row("Play Again", 0, screen.selected === 0) + row("Done", 1, screen.selected === 1);
    screenContentEl.innerHTML = `
      <div class="quiz-screen">
        <div class="quiz-card">${body}</div>
        <div class="menu-list quiz-actions">${rows}</div>
      </div>`;
    return;
  }

  const playing = screen.phase === "playing";
  const remaining = playing ? quizRemaining(screen) : 0;
  let status;
  if (playing) status = `<span class="quiz-points">${quizPointsNow(screen)}</span>`;
  else if (screen.picked === screen.answerId) status = `<span class="quiz-result good">+${screen.lastPoints}</span>`;
  else status = `<span class="quiz-result bad">${screen.picked ? "Wrong" : "Time's Up"}</span>`;

  let rows = "";
  screen.choices.forEach((id, idx) => {
    const t = state.library.find((x) => x.id === id);
    let cls = "", mark = "";
    if (!playing) {
      if (id === screen.answerId) { cls = " quiz-correct"; mark = "✓"; }
      else if (id === screen.picked) { cls = " quiz-wrong"; mark = "✗"; }
    }
    // During the reveal the colours carry the answer, not the selection.
    rows += row(t ? t.title : "Unknown", idx, playing && idx === screen.selected, cls, mark);
  });

  screenContentEl.innerHTML = `
    <div class="quiz-screen">
      <div class="quiz-head">
        <span>${screen.round + 1} of ${screen.answers.length}</span>
        ${status}
        <span>Score ${screen.score}</span>
      </div>
      <div class="quiz-timer"><div class="quiz-timer-fill" style="width:${(remaining / QUIZ_ROUND_SECONDS) * 100}%"></div></div>
      <div class="menu-list quiz-choices">${rows}</div>
    </div>`;
}

/* ---------------------------------------------------------
   7. Navigation Stack
--------------------------------------------------------- */
function topScreen() { return state.navStack[state.navStack.length - 1]; }
function pushScreen(screen) { state.navStack.push(screen); render(); }
function popScreen() {
  if (state.stickersEditing) setStickersEditingMode(false);
  if (state.navStack.length > 1) {
    const leaving = state.navStack.pop();
    if (leaving.kind === "quiz") stopQuiz(leaving);
  }
  render();
}
function replaceTop(screen) { state.navStack[state.navStack.length - 1] = screen; render(); }

function ensureNowPlayingOnTop() {
  if (topScreen() !== nowPlayingScreen) pushScreen(nowPlayingScreen);
  else render();
}

/* ---------------------------------------------------------
   8. Rendering
--------------------------------------------------------- */
const VISIBLE_ROWS = 5;

function render() {
  const screen = topScreen();
  screenTitleEl.textContent = screen.title;
  holdBadgeEl.classList.toggle("show", state.hold);

  const isCoverFlow = screen.kind === "nowplaying" && settings.nowPlayingStyle === "coverflow";
  if (!isCoverFlow) screenContentEl.style.backgroundColor = "";

  if (screen.kind === "list") renderList(screen);
  else if (screen.kind === "nowplaying") renderNowPlaying();
  else if (screen.kind === "progress") renderProgress(screen);
  else if (screen.kind === "rgb-tuner") renderRgbTuner(screen);
  else if (screen.kind === "quiz") renderQuiz(screen);
  updateCarPlay();
}

function renderList(screen) {
  if (!screen.items.length) {
    screenContentEl.innerHTML = `<div class="empty-state">${esc(screen.emptyMessage || "Nothing here yet.").replace(/\n/g, "<br>")}</div>`;
    return;
  }
  const total = screen.items.length;
  let start = Math.max(0, screen.selected - Math.floor(VISIBLE_ROWS / 2));
  start = Math.min(start, Math.max(0, total - VISIBLE_ROWS));
  const end = Math.min(total, start + VISIBLE_ROWS);

  let html = '<div class="menu-list">';
  for (let i = start; i < end; i++) {
    const item = screen.items[i];
    const isSel = i === screen.selected;
    html += `<div class="menu-row${isSel ? " selected" : ""}" data-idx="${i}">
      <span class="label">${esc(item.label)}</span>
      ${item.sub ? `<span class="sub">${esc(item.sub)}</span>` : ""}
      ${item.chevron ? '<span class="chevron">›</span>' : ""}
    </div>`;
  }
  html += "</div>";
  screenContentEl.innerHTML = html;
}

function renderRgbTuner(screen) {
  const hex = rgbToHex(screen.r, screen.g, screen.b);
  const rows = [
    { label: "Red", val: screen.r },
    { label: "Green", val: screen.g },
    { label: "Blue", val: screen.b },
    { label: "Save & Done", val: null },
  ];

  let html = `
    <div class="rgb-tuner-container">
      <div class="rgb-preview-box" style="background:${hex};">${hex.toUpperCase()}</div>
  `;

  rows.forEach((row, idx) => {
    const isSel = idx === screen.selected;
    if (row.val !== null) {
      const pct = Math.round((row.val / 255) * 100);
      html += `
        <div class="rgb-row${isSel ? " selected" : ""}" data-idx="${idx}">
          <span class="rgb-label">${row.label}</span>
          <div class="rgb-bar-track"><div class="rgb-bar-fill" style="width:${pct}%"></div></div>
          <span class="rgb-val">${row.val}</span>
        </div>
      `;
    } else {
      html += `
        <div class="rgb-row${isSel ? " selected" : ""}" data-idx="${idx}">
          <span class="rgb-label" style="width:100%; text-align:center;">${row.label}</span>
        </div>
      `;
    }
  });

  html += `<div class="rgb-hint">Rotate wheel to adjust • Center to switch</div></div>`;
  screenContentEl.innerHTML = html;
}

function renderProgress(screen) {
  const pct = screen.total ? Math.round((screen.done / screen.total) * 100) : 0;
  screenContentEl.innerHTML = `
    <div class="progress-screen">
      <div>Adding Songs…</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div>${screen.done} of ${screen.total}${screen.currentName ? "<br>" + esc(screen.currentName) : ""}</div>
    </div>`;
}

function renderNowPlaying() {
  if (settings.nowPlayingStyle === "coverflow") renderNowPlayingCoverFlow();
  else renderNowPlayingClassic();
}

/* Drag-to-seek on a progress bar track. Attached fresh to each newly built
   track element (classic and cover-flow both rebuild their bar on track
   change only, never on every timeupdate tick, so a capture set here always
   stays valid for the life of the gesture — see the iOS sticker/RGB fixes
   above for why that matters). */
function setupSeekBar(trackEl) {
  if (!trackEl) return;
  let dragging = false;
  const seekFromClientX = (clientX) => {
    const dur = audioEl.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audioEl.currentTime = pct * dur;
  };
  trackEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    try { trackEl.setPointerCapture(e.pointerId); } catch (err) {}
    seekFromClientX(e.clientX);
    e.preventDefault();
  });
  trackEl.addEventListener("pointermove", (e) => {
    if (dragging) seekFromClientX(e.clientX);
  });
  ["pointerup", "pointercancel"].forEach((evt) => {
    trackEl.addEventListener(evt, () => { dragging = false; });
  });
}

function renderNowPlayingClassic() {
  const alreadyBuilt = state.npBuiltStyle === "classic" &&
    state.npBuiltTrackId === state.currentTrackId &&
    screenContentEl.querySelector(".now-playing-container");
  if (!alreadyBuilt) {
    state.npBuiltStyle = "classic";
    state.npBuiltTrackId = state.currentTrackId;
    buildNowPlayingClassicDOM();
  }
  updateNowPlayingClassicProgress();
}

function buildNowPlayingClassicDOM() {
  const track = state.library.find((t) => t.id === state.currentTrackId);
  const currentIdx = state.queue.indexOf(state.currentTrackId);
  const trackCountText = currentIdx !== -1
    ? `${currentIdx + 1} of ${state.queue.length}`
    : `1 of ${state.library.length || 1}`;

  const artStyle = state.artObjectUrl ? `style="background-image:url('${state.artObjectUrl}')"` : "";
  const artInner = state.artObjectUrl ? "" : "♪";

  screenContentEl.innerHTML = `
    <div class="now-playing-container">
      <div class="np-track-count">${trackCountText}</div>

      <div class="np-body">
        <div class="np-art-wrapper">
          <div class="np-art" ${artStyle}>${artInner}</div>
          <div class="np-art-reflection" ${artStyle}></div>
        </div>
        <div class="np-meta">
          <div class="np-title">${track ? esc(track.title) : "Unknown Title"}</div>
          <div class="np-artist">${track ? esc(track.artist) : "Unknown Artist"}</div>
          <div class="np-album">${track ? esc(track.album) : "Unknown Album"}</div>
        </div>
      </div>

      <div class="np-progress-section">
        <div class="np-bar-track" id="npBarTrack">
          <div class="np-bar-fill" id="npBarFill">
            <span class="np-scrubber-thumb"></span>
          </div>
        </div>
        <div class="np-time-row">
          <span id="npTimeCur">0:00</span>
          <span id="npTimeRemaining">-0:00</span>
        </div>
      </div>
    </div>`;

  setupSeekBar(document.getElementById("npBarTrack"));
}

function updateNowPlayingClassicProgress() {
  const track = state.library.find((t) => t.id === state.currentTrackId);
  const dur = audioEl.duration || (track ? track.duration : 0) || 0;
  const cur = audioEl.currentTime || 0;
  const remaining = Math.max(0, dur - cur);
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

  const fill = document.getElementById("npBarFill");
  if (fill) fill.style.width = pct + "%";
  const curEl = document.getElementById("npTimeCur");
  if (curEl) curEl.textContent = formatDuration(cur);
  const remEl = document.getElementById("npTimeRemaining");
  if (remEl) remEl.textContent = "-" + formatDuration(remaining);
}

/* ---------------------------------------------------------
   8b. Now Playing — Cover Flow style
--------------------------------------------------------- */
const ART_CACHE_LIMIT = 15;

function neighborTrackIds() {
  const { queue, queueIndex } = state;
  if (!queue.length) return { prevId: null, nextId: null };
  const hasPrev = queueIndex - 1 >= 0;
  const hasNext = queueIndex + 1 < queue.length;
  const wrap = settings.repeat === "all" && queue.length > 1;
  return {
    prevId: hasPrev ? queue[queueIndex - 1] : (wrap ? queue[queue.length - 1] : null),
    nextId: hasNext ? queue[queueIndex + 1] : (wrap ? queue[0] : null),
  };
}

function getAverageColorFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 16; c.height = 16;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        resolve(rgbToHex(r / n, g / n, b / n));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function getArtForTrack(id) {
  if (!id) return null;
  if (state.npCoverCache.has(id)) return state.npCoverCache.get(id);
  const rec = await idbGet("art", id);
  const entry = { url: null, color: null };
  if (rec && rec.blob) {
    entry.url = URL.createObjectURL(rec.blob);
    entry.color = await getAverageColorFromUrl(entry.url).catch(() => null);
  }
  state.npCoverCache.set(id, entry);
  if (state.npCoverCache.size > ART_CACHE_LIMIT) {
    const oldestKey = state.npCoverCache.keys().next().value;
    if (oldestKey !== id) {
      const old = state.npCoverCache.get(oldestKey);
      if (old && old.url) URL.revokeObjectURL(old.url);
      state.npCoverCache.delete(oldestKey);
    }
  }
  return entry;
}

function pickCfTextColors(hex) {
  const dark = getLuminance(hex) < 130;
  return dark
    ? { text: "#ffffff", sub: "rgba(255,255,255,0.75)" }
    : { text: "#15161a", sub: "rgba(21,22,26,0.7)" };
}

function setSlotArt(el, art) {
  const artEl = el && el.querySelector(".cf-art");
  if (!artEl) return;
  if (art && art.url) {
    artEl.style.backgroundImage = `url('${art.url}')`;
    artEl.textContent = "";
  } else {
    artEl.style.backgroundImage = "";
    artEl.textContent = "♪";
  }
}

function updateCoverFlowMeta(track) {
  const titleEl = screenContentEl.querySelector(".cf-title");
  const artistEl = screenContentEl.querySelector(".cf-artist");
  const albumEl = screenContentEl.querySelector(".cf-album");
  if (titleEl) titleEl.textContent = track ? track.title : "Unknown Title";
  if (artistEl) artistEl.textContent = track ? track.artist : "Unknown Artist";
  if (albumEl) albumEl.textContent = track ? track.album : "Unknown Album";
}

/* Applies the background color/blurred-cover-image/text-color theming for
   the current track. The blurred image sits behind the content in a
   dedicated .cf-bg layer (filter: blur() applied to the whole element would
   also blur the foreground text/covers, so it needs its own layer rather
   than living directly on screenContentEl). */
function applyCoverFlowTheming(bgColor, artUrl) {
  screenContentEl.style.backgroundColor = bgColor;
  const bg = screenContentEl.querySelector(".cf-bg");
  if (bg) {
    if (artUrl) {
      bg.style.backgroundImage = `url('${artUrl}')`;
      bg.style.opacity = "1";
    } else {
      bg.style.backgroundImage = "";
      bg.style.opacity = "0";
    }
  }
  // A darkened, blurred cover reads best with light text regardless of the
  // art's original luminance; only fall back to the luminance check when
  // there's no image (flat color background).
  const colors = artUrl ? { text: "#ffffff", sub: "rgba(255,255,255,0.78)" } : pickCfTextColors(bgColor);
  const root = screenContentEl.querySelector(".coverflow-screen");
  if (root) {
    root.style.setProperty("--cf-text", colors.text);
    root.style.setProperty("--cf-sub", colors.sub);
  }
}

async function applyCoverFlowBackground(trackId, myToken) {
  const art = await getArtForTrack(trackId);
  if (myToken !== state.npBuildToken) return;
  const bgColor = (art && art.color) || settings.screenColor;
  applyCoverFlowTheming(bgColor, art && art.url);
}

function renderNowPlayingCoverFlow() {
  const stageMissing = !screenContentEl.querySelector(".coverflow-screen");
  if (state.npBuiltStyle !== "coverflow" || stageMissing) {
    state.npBuiltStyle = "coverflow";
    state.npBuiltTrackId = state.currentTrackId;
    state.cfSlots = null;
    buildCoverFlowDOM();
  } else if (state.npBuiltTrackId !== state.currentTrackId) {
    state.npBuiltTrackId = state.currentTrackId;
    const matchedSlot = state.cfSlots && state.cfSlots.find((s) => s.trackId === state.currentTrackId);
    if (matchedSlot && matchedSlot.role === "next") slideCoverFlow("forward");
    else if (matchedSlot && matchedSlot.role === "prev") slideCoverFlow("backward");
    else buildCoverFlowDOM(); // arbitrary jump (e.g. picked a different song from a list) — no meaningful slide direction
  }
  updateCoverFlowProgress();
}

/* Reassigns the existing cover elements to their new roles (current->prev,
   next->current, etc.) instead of recreating them, so the CSS transition on
   .cf-track can animate a real slide from the old position to the new one —
   the cover that becomes "current" visibly glides into that spot rather than
   the screen popping to a freshly rebuilt state. The element vacated by the
   old prev/next is recycled as the new far side and teleported off-stage
   (transition disabled for one frame) before sliding into view. */
function slideCoverFlow(direction) {
  const myToken = ++state.npBuildToken;
  const slots = state.cfSlots;
  const prevSlot = slots.find((s) => s.role === "prev");
  const curSlot = slots.find((s) => s.role === "current");
  const nextSlot = slots.find((s) => s.role === "next");
  let recycled;

  if (direction === "forward") {
    curSlot.el.classList.replace("cf-current", "cf-prev");
    curSlot.role = "prev";
    nextSlot.el.classList.replace("cf-next", "cf-current");
    nextSlot.role = "current";
    recycled = prevSlot;
    recycled.trackId = neighborTrackIds().nextId;
    recycled.role = "next";
    recycled.el.classList.toggle("cf-empty", !recycled.trackId);
    teleportOffstage(recycled.el, "right");
    requestAnimationFrame(() => {
      recycled.el.classList.remove("cf-offstage-right");
      recycled.el.classList.add("cf-next");
    });
  } else {
    curSlot.el.classList.replace("cf-current", "cf-next");
    curSlot.role = "next";
    prevSlot.el.classList.replace("cf-prev", "cf-current");
    prevSlot.role = "current";
    recycled = nextSlot;
    recycled.trackId = neighborTrackIds().prevId;
    recycled.role = "prev";
    recycled.el.classList.toggle("cf-empty", !recycled.trackId);
    teleportOffstage(recycled.el, "left");
    requestAnimationFrame(() => {
      recycled.el.classList.remove("cf-offstage-left");
      recycled.el.classList.add("cf-prev");
    });
  }

  const track = state.library.find((t) => t.id === state.currentTrackId);
  updateCoverFlowMeta(track);
  applyCoverFlowBackground(state.currentTrackId, myToken);

  getArtForTrack(recycled.trackId).then((art) => {
    if (myToken !== state.npBuildToken) return;
    setSlotArt(recycled.el, art);
  });
}

function teleportOffstage(el, side) {
  el.classList.remove("cf-prev", "cf-current", "cf-next");
  el.classList.add("cf-notransition", side === "right" ? "cf-offstage-right" : "cf-offstage-left");
  void el.offsetWidth; // flush so the browser commits the instant jump before we re-enable transitions
  el.classList.remove("cf-notransition");
}

async function buildCoverFlowDOM() {
  const myToken = ++state.npBuildToken;
  const track = state.library.find((t) => t.id === state.currentTrackId);
  const { prevId, nextId } = neighborTrackIds();

  screenContentEl.style.backgroundColor = settings.screenColor;
  screenContentEl.innerHTML = `
    <div class="coverflow-screen" style="--cf-text:${settings.theme === "silver" ? "#15161a" : "#ffffff"};">
      <div class="cf-bg"></div>
      <div class="cf-stage">
        <div class="cf-track cf-prev${prevId ? "" : " cf-empty"}"><div class="cf-art">♪</div></div>
        <div class="cf-track cf-current"><div class="cf-art">♪</div></div>
        <div class="cf-track cf-next${nextId ? "" : " cf-empty"}"><div class="cf-art">♪</div></div>
      </div>
      <div class="cf-meta">
        <div class="cf-title">${track ? esc(track.title) : "Unknown Title"}</div>
        <div class="cf-artist">${track ? esc(track.artist) : "Unknown Artist"}</div>
        <div class="cf-album">${track ? esc(track.album) : "Unknown Album"}</div>
      </div>
      <div class="cf-progress-section">
        <div class="cf-bar-track" id="cfBarTrack"><div class="cf-bar-fill" id="cfBarFill"><span class="cf-scrubber-thumb"></span></div></div>
        <div class="cf-time-row">
          <span id="cfTimeCur">0:00</span>
          <span id="cfTimeRemaining">-0:00</span>
        </div>
      </div>
    </div>`;

  const stage = screenContentEl.querySelector(".cf-stage");
  state.cfSlots = [
    { el: stage.querySelector(".cf-prev"), role: "prev", trackId: prevId },
    { el: stage.querySelector(".cf-current"), role: "current", trackId: state.currentTrackId },
    { el: stage.querySelector(".cf-next"), role: "next", trackId: nextId },
  ];

  setupSeekBar(document.getElementById("cfBarTrack"));
  requestAnimationFrame(() => stage && stage.classList.add("cf-pop"));

  const [prevArt, curArt, nextArt] = await Promise.all([
    getArtForTrack(prevId),
    getArtForTrack(state.currentTrackId),
    getArtForTrack(nextId),
  ]);

  if (myToken !== state.npBuildToken) return; // superseded by a newer track change
  const liveStage = screenContentEl.querySelector(".cf-stage");
  if (!liveStage) return;

  setSlotArt(liveStage.querySelector(".cf-prev"), prevArt);
  setSlotArt(liveStage.querySelector(".cf-current"), curArt);
  setSlotArt(liveStage.querySelector(".cf-next"), nextArt);

  const bgColor = (curArt && curArt.color) || settings.screenColor;
  applyCoverFlowTheming(bgColor, curArt && curArt.url);
}

function updateCoverFlowProgress() {
  const track = state.library.find((t) => t.id === state.currentTrackId);
  const dur = audioEl.duration || (track ? track.duration : 0) || 0;
  const cur = audioEl.currentTime || 0;
  const remaining = Math.max(0, dur - cur);
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

  const fill = document.getElementById("cfBarFill");
  if (fill) fill.style.width = pct + "%";
  const curEl = document.getElementById("cfTimeCur");
  if (curEl) curEl.textContent = formatDuration(cur);
  const remEl = document.getElementById("cfTimeRemaining");
  if (remEl) remEl.textContent = "-" + formatDuration(remaining);
}

function renderNowPlayingIfTop() {
  if (topScreen() && topScreen().kind === "nowplaying") renderNowPlaying();
  updateCarPlay();
}

/* ---------------------------------------------------------
   8c. CarPlay Mode — phones held in landscape
   The iPod shell is hidden by CSS under this media query and a
   CarPlay-style Now Playing / Songs UI is shown instead. It reads
   the same playback state, so rotating back resumes seamlessly.
--------------------------------------------------------- */
const carplayMQ = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)");
const carplayEl = document.getElementById("carplay");
const cpNowPlayingEl = document.getElementById("cpNowPlaying");
const cpSongsEl = document.getElementById("cpSongs");
const cpListEl = document.getElementById("cpList");
const cpClockEl = document.getElementById("cpClock");
const cpArtEl = document.getElementById("cpArt");
const cpTitleEl = document.getElementById("cpTitle");
const cpArtistEl = document.getElementById("cpArtist");
const cpAlbumEl = document.getElementById("cpAlbum");
const cpBarFillEl = document.getElementById("cpBarFill");
const cpTimeCurEl = document.getElementById("cpTimeCur");
const cpTimeRemainingEl = document.getElementById("cpTimeRemaining");
const cpShuffleBtnEl = document.getElementById("cpShuffleBtn");
const cpRepeatBtnEl = document.getElementById("cpRepeatBtn");
const cpBgLayerEls = carplayEl.querySelectorAll(".cp-bg-layer");

let cpView = "nowplaying";
let cpBuiltTrackId; // undefined forces the first paint
let cpBuiltArtUrl;
let cpBgFront = 0;

function isCarPlay() { return carplayMQ.matches; }

function cpTime(sec) { return sec > 0 ? formatDuration(sec) : "0:00"; }

function updateCarPlayClock() {
  if (!isCarPlay()) return;
  cpClockEl.textContent = new Date()
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .replace(/\s?[AP]\.?M\.?$/i, "");
}

function setCarPlayView(view) {
  cpView = view;
  cpNowPlayingEl.hidden = view !== "nowplaying";
  cpSongsEl.hidden = view !== "songs";
  carplayEl.classList.toggle("view-songs", view === "songs");
  carplayEl.querySelector(".cp-app-music").classList.toggle("active", view === "nowplaying");
  carplayEl.querySelector(".cp-app-library").classList.toggle("active", view === "songs");
  if (view === "songs") renderCarPlayList();
  else setCarPlayTitle(cpTitleEl.textContent);
}

function renderCarPlayList() {
  const songs = sortedSongs();
  if (!songs.length) {
    cpListEl.innerHTML = `<div class="cp-list-empty">No songs yet.<br>Rotate to portrait to add music.</div>`;
    return;
  }
  cpListEl.innerHTML = songs.map((t, i) => `
    <button class="cp-row${t.id === state.currentTrackId ? " current" : ""}" data-cp="play" data-idx="${i}">
      <span class="cp-row-icon">${t.id === state.currentTrackId ? "♫" : ""}</span>
      <span class="cp-row-text">
        <span class="cp-row-title">${esc(t.title)}</span>
        <span class="cp-row-sub">${esc(t.artist || "Unknown Artist")}</span>
      </span>
      <span class="cp-row-dur">${formatDuration(t.duration)}</span>
    </button>`).join("");
}

/* Cross-fades the blurred backdrop to the new cover (or to black when the
   track has no artwork). */
function setCarPlayBackdrop(url) {
  const next = cpBgLayerEls[1 - cpBgFront];
  const cur = cpBgLayerEls[cpBgFront];
  if (url) {
    next.style.backgroundImage = `url('${url}')`;
    next.classList.add("show");
    cur.classList.remove("show");
    cpBgFront = 1 - cpBgFront;
  } else {
    cur.classList.remove("show");
    next.classList.remove("show");
  }
}

function setCarPlayTitle(text) {
  cpTitleEl.classList.remove("scrolling");
  cpTitleEl.innerHTML = `<span class="cp-marquee-inner">${esc(text)}</span>`;
  requestAnimationFrame(() => {
    const inner = cpTitleEl.firstElementChild;
    if (!inner) return;
    if (!cpTitleEl.clientWidth) return; // hidden (Songs view); re-measured when shown
    const overflow = inner.scrollWidth - cpTitleEl.clientWidth;
    if (overflow > 2) {
      cpTitleEl.style.setProperty("--cp-marquee-dist", `-${overflow + 12}px`);
      cpTitleEl.style.setProperty("--cp-marquee-time", `${Math.max(7, overflow / 18)}s`);
      cpTitleEl.classList.add("scrolling");
    }
  });
}

function updateCarPlay() {
  if (!isCarPlay()) return;
  const track = state.library.find((t) => t.id === state.currentTrackId);

  carplayEl.classList.toggle("is-playing", state.isPlaying);
  carplayEl.classList.toggle("is-empty", !track);

  if (cpBuiltTrackId !== state.currentTrackId || cpBuiltArtUrl !== state.artObjectUrl) {
    cpBuiltTrackId = state.currentTrackId;
    cpBuiltArtUrl = state.artObjectUrl;
    setCarPlayTitle(track ? track.title : "Not Playing");
    setCarPlayBackdrop(state.artObjectUrl);
    cpArtistEl.textContent = track ? (track.artist || "Unknown Artist") : "";
    cpAlbumEl.textContent = track ? (track.album || "Unknown Album") : "";
    cpArtEl.style.backgroundImage = state.artObjectUrl ? `url('${state.artObjectUrl}')` : "";
    cpArtEl.classList.toggle("has-art", !!state.artObjectUrl);
    if (cpView === "songs") renderCarPlayList();
  }

  const dur = audioEl.duration || (track ? track.duration : 0) || 0;
  const cur = track ? (audioEl.currentTime || 0) : 0;
  cpBarFillEl.style.width = (dur ? Math.min(100, (cur / dur) * 100) : 0) + "%";
  cpTimeCurEl.textContent = cpTime(cur);
  cpTimeRemainingEl.textContent = "-" + cpTime(Math.max(0, dur - cur));

  const repeat = settings.repeat;
  cpRepeatBtnEl.classList.toggle("on", repeat !== "off");
  cpRepeatBtnEl.classList.toggle("one", repeat === "one");
  cpShuffleBtnEl.classList.toggle("on", !!state.shuffleOrigQueue);
}

/* Shuffle toggle: keeps the current song playing and shuffles the rest of
   the queue behind it; toggling off restores the original order. */
function toggleCarPlayShuffle() {
  if (!state.queue.length) return;
  if (state.shuffleOrigQueue) {
    state.queue = state.shuffleOrigQueue;
    state.shuffleOrigQueue = null;
  } else {
    state.shuffleOrigQueue = state.queue.slice();
    const rest = state.queue.filter((id) => id !== state.currentTrackId);
    state.queue = state.currentTrackId ? [state.currentTrackId, ...shuffleArray(rest)] : shuffleArray(rest);
  }
  state.queueIndex = Math.max(0, state.queue.indexOf(state.currentTrackId));
  state.npBuiltStyle = null; // cover flow neighbours changed; rebuild when back in portrait
}

function cycleCarPlayRepeat() {
  const order = ["off", "all", "one"];
  settings.repeat = order[(order.indexOf(settings.repeat) + 1) % order.length];
}

carplayEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cp]");
  if (!btn) return;
  haptic("press");
  switch (btn.dataset.cp) {
    case "nowplaying": setCarPlayView("nowplaying"); break;
    case "songs":
    case "home": setCarPlayView("songs"); break;
    case "shuffleall":
      state.shuffleOrigQueue = null;
      shuffleAll();
      setCarPlayView("nowplaying");
      break;
    case "play": {
      state.shuffleOrigQueue = null;
      state.queue = sortedSongs().map((t) => t.id);
      playQueueIndex(Number(btn.dataset.idx));
      setCarPlayView("nowplaying");
      break;
    }
    case "playpause":
      if (!state.currentTrackId) { setCarPlayView("songs"); break; }
      togglePlayPause();
      break;
    case "prev": playPrev(); break;
    case "next": playNext(); break;
    case "shuffle": toggleCarPlayShuffle(); break;
    case "repeat": cycleCarPlayRepeat(); break;
  }
  updateCarPlay();
});

setupSeekBar(document.getElementById("cpBarTrack"));

function onCarPlayModeChange() {
  if (isCarPlay()) {
    // The quiz lives on the iPod screen only; leave it rather than let it
    // keep playing behind the CarPlay UI.
    if (state.navStack.length && topScreen().kind === "quiz") popScreen();
    cpBuiltTrackId = undefined;
    updateCarPlayClock();
    setCarPlayView(cpView);
    updateCarPlay();
  } else {
    // Back to the iPod: force the now-playing screen to rebuild in case the
    // track or queue changed while it was hidden.
    state.npBuiltStyle = null;
    if (state.navStack.length) render();
  }
}
if (carplayMQ.addEventListener) carplayMQ.addEventListener("change", onCarPlayModeChange);
else if (carplayMQ.addListener) carplayMQ.addListener(onCarPlayModeChange);
setInterval(updateCarPlayClock, 10000);

/* ---------------------------------------------------------
   9. Playback Engine
--------------------------------------------------------- */
async function loadAndPlay(trackId) {
  state.currentTrackId = trackId;

  if (state.audioObjectUrl) { URL.revokeObjectURL(state.audioObjectUrl); state.audioObjectUrl = null; }
  if (state.artObjectUrl) { URL.revokeObjectURL(state.artObjectUrl); state.artObjectUrl = null; }

  const [audioRec, artRec] = await Promise.all([
    idbGet("audio", trackId),
    idbGet("art", trackId),
  ]);

  if (!audioRec || !audioRec.blob) { console.warn("Missing audio blob for", trackId); return; }

  state.audioObjectUrl = URL.createObjectURL(audioRec.blob);
  audioEl.src = state.audioObjectUrl;

  if (artRec && artRec.blob) state.artObjectUrl = URL.createObjectURL(artRec.blob);

  renderNowPlayingIfTop();
  updateMediaSessionMetadata();

  try {
    await audioEl.play();
  } catch (err) {
    console.warn("Playback tap needed:", err);
  }
}

function playQueueIndex(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.queueIndex = i;
  loadAndPlay(state.queue[i]);
  ensureNowPlayingOnTop();
}

function playNext() {
  if (state.queueIndex + 1 < state.queue.length) {
    playQueueIndex(state.queueIndex + 1);
  } else if (settings.repeat === "all" && state.queue.length > 0) {
    playQueueIndex(0);
  }
}

function playPrev(forceSkip = false) {
  if (!forceSkip && audioEl.currentTime > 3) {
    audioEl.currentTime = 0;
    return;
  }
  if (state.queueIndex - 1 >= 0) {
    playQueueIndex(state.queueIndex - 1);
  } else if (settings.repeat === "all" && state.queue.length > 0) {
    playQueueIndex(state.queue.length - 1);
  }
}

function setQueueFromScreen(screen, idx) {
  state.shuffleOrigQueue = null;
  state.queue = screen.trackIds.slice();
  playQueueIndex(idx);
}

function shuffleAll() {
  if (!state.library.length) return;
  state.shuffleOrigQueue = null;
  state.queue = shuffleArray(state.library.map((t) => t.id));
  playQueueIndex(0);
}

function togglePlayPause() {
  if (!audioEl.src) return;
  if (audioEl.paused) audioEl.play().catch(() => {});
  else audioEl.pause();
}

audioEl.addEventListener("play", () => {
  state.isPlaying = true;
  if (statusPlayIconEl) statusPlayIconEl.textContent = "▶";
  updateMediaSessionPlaybackState();
  renderNowPlayingIfTop();
});

audioEl.addEventListener("pause", () => {
  state.isPlaying = false;
  if (statusPlayIconEl) statusPlayIconEl.textContent = "❚❚";
  updateMediaSessionPlaybackState();
  renderNowPlayingIfTop();
});

audioEl.addEventListener("timeupdate", () => {
  renderNowPlayingIfTop();
  try {
    if ("mediaSession" in navigator && isFinite(audioEl.duration)) {
      navigator.mediaSession.setPositionState({
        duration: audioEl.duration || 0,
        playbackRate: audioEl.playbackRate || 1,
        position: Math.min(audioEl.currentTime || 0, audioEl.duration || 0),
      });
    }
  } catch (e) {}
});

audioEl.addEventListener("ended", () => {
  const mode = settings.repeat;
  if (mode === "one") { audioEl.currentTime = 0; audioEl.play().catch(() => {}); return; }
  if (state.queueIndex + 1 < state.queue.length) { playNext(); return; }
  if (mode === "all" && state.queue.length) { playQueueIndex(0); return; }
  state.isPlaying = false;
  if (statusPlayIconEl) statusPlayIconEl.textContent = "❚❚";
  renderNowPlayingIfTop();
});

/* ---------------------------------------------------------
   10. Media Session
--------------------------------------------------------- */
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => audioEl.play().catch(() => {}),
    pause: () => audioEl.pause(),
    previoustrack: () => playPrev(),
    nexttrack: () => playNext(),
    seekbackward: (d) => { audioEl.currentTime = Math.max(0, audioEl.currentTime - (d.seekOffset || 10)); },
    seekforward: (d) => { audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + (d.seekOffset || 10)); },
    seekto: (d) => { if (d.seekTime != null) audioEl.currentTime = d.seekTime; },
    stop: () => { audioEl.pause(); audioEl.currentTime = 0; },
  };
  Object.entries(handlers).forEach(([action, fn]) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) {}
  });
}

function updateMediaSessionMetadata() {
  if (!("mediaSession" in navigator)) return;
  const track = state.library.find((t) => t.id === state.currentTrackId);
  if (!track) return;
  const artwork = state.artObjectUrl
    ? [{ src: state.artObjectUrl, sizes: "512x512", type: "image/png" }]
    : [{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }];
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist, album: track.album, artwork,
    });
  } catch (e) {}
}

function updateMediaSessionPlaybackState() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
}

/* ---------------------------------------------------------
   11. Music Import & Tag Extraction
--------------------------------------------------------- */
function triggerAddMusic() { fileInputEl.click(); }

function getDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let done = false;
    const finish = (val) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(val); };
    a.addEventListener("loadedmetadata", () => finish(isFinite(a.duration) ? a.duration : 0));
    a.addEventListener("error", () => finish(0));
    setTimeout(() => finish(0), 8000);
    a.preload = "metadata";
    a.src = url;
  });
}

async function importOneFile(file) {
  const id = uid();
  let title = "", artist = "", album = "", artworkBlob = null;

  const looksLikeMp3 = /mpeg/i.test(file.type) || /\.mp3$/i.test(file.name);
  const looksLikeMp4 = /^audio\/(mp4|x-m4a)/i.test(file.type) || /\.(m4a|aac|mp4)$/i.test(file.name);
  if (looksLikeMp3) {
    try {
      const buf = await file.arrayBuffer();
      const tag = ID3.parse(buf);
      if (tag) { title = tag.title; artist = tag.artist; album = tag.album; artworkBlob = tag.artwork; }
    } catch (e) {}
  } else if (looksLikeMp4) {
    try {
      const buf = await file.arrayBuffer();
      const tag = MP4Tag.parse(buf);
      if (tag) { title = tag.title; artist = tag.artist; album = tag.album; artworkBlob = tag.artwork; }
    } catch (e) {}
  }

  const base = file.name.replace(/\.[^.]+$/, "");
  if (!title) {
    if (base.includes(" - ")) {
      const parts = base.split(" - ");
      artist = artist || parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    } else {
      title = base;
    }
  }
  if (!artist) artist = "Unknown Artist";
  if (!album) album = "Unknown Album";
  if (!title) title = base || "Untitled";

  const duration = await getDuration(file);

  await idbPut("meta", {
    id, title, artist, album, duration,
    addedAt: Date.now(),
    sizeBytes: file.size,
    mimeType: file.type || "audio/mpeg",
    hasArt: !!artworkBlob,
  });
  await idbPut("audio", { id, blob: file });
  if (artworkBlob) await idbPut("art", { id, blob: artworkBlob });
}

async function handleFilesSelected(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;

  state.importing = true;
  const progressScreen = { key: "progress", kind: "progress", title: "Add Music", done: 0, total: files.length, currentName: files[0].name };
  pushScreen(progressScreen);

  for (let i = 0; i < files.length; i++) {
    progressScreen.currentName = files[i].name;
    render();
    try { await importOneFile(files[i]); } catch (e) {}
    progressScreen.done = i + 1;
    render();
  }

  state.importing = false;
  await refreshLibrary();
  state.navStack = [buildMainMenu()];
  render();
}

fileInputEl.addEventListener("change", (e) => {
  handleFilesSelected(e.target.files);
  fileInputEl.value = "";
});

async function refreshLibrary() {
  state.library = await idbGetAll("meta");
}

async function clearLibrary() {
  if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
  if (state.artObjectUrl) URL.revokeObjectURL(state.artObjectUrl);
  for (const entry of state.npCoverCache.values()) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  state.npCoverCache.clear();
  state.npBuiltTrackId = undefined;
  state.npBuiltStyle = null;
  state.cfSlots = null;
  audioEl.pause();
  audioEl.removeAttribute("src");
  state.currentTrackId = null;
  state.queue = [];
  state.queueIndex = -1;
  state.shuffleOrigQueue = null;
  await idbClearAll();
  await refreshLibrary();
}

/* ---------------------------------------------------------
   12. Click Sound
--------------------------------------------------------- */
let audioCtx = null;
function playTick() {
  if (!settings.wheelSound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.value = 1500;
    g.gain.setValueAtTime(0.045, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.03);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.03);
  } catch (e) {}
}

/* Haptics. Android/Chrome gets navigator.vibrate. iOS Safari has no
   vibrate API, but since iOS 18 toggling an <input type="checkbox" switch>
   plays the system haptic, so we click a hidden label bound to one. This
   only fires inside a user gesture, which every call site here is. */
const VIBRATE_MS = { tick: 8, press: 15 };
const canVibrate = typeof navigator.vibrate === "function";
const hapticsSupported = canVibrate || isIOS;
let hapticLabelEl = null;

function getHapticLabel() {
  if (hapticLabelEl) return hapticLabelEl;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.id = "hapticSwitch";
  input.tabIndex = -1;
  hapticLabelEl = document.createElement("label");
  hapticLabelEl.htmlFor = input.id;
  hapticLabelEl.setAttribute("aria-hidden", "true");
  hapticLabelEl.className = "haptic-proxy";
  hapticLabelEl.appendChild(input);
  // Keep the proxy's clicks from reaching any document-level handlers.
  hapticLabelEl.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(hapticLabelEl);
  return hapticLabelEl;
}

function haptic(kind = "tick") {
  if (!settings.haptics) return;
  try {
    if (canVibrate) navigator.vibrate(VIBRATE_MS[kind] || VIBRATE_MS.tick);
    else if (isIOS) getHapticLabel().click();
  } catch (e) {}
}

function clickFeedback(kind = "tick") {
  haptic(kind);
  playTick();
}

/* ---------------------------------------------------------
   13. Overlays
--------------------------------------------------------- */
let volumeOverlayTimer = null;
function flashVolumeOverlay() {
  if (!volumeOverlayEl || !volumeFillEl) return;
  volumeFillEl.style.width = Math.round(audioEl.volume * 100) + "%";
  volumeOverlayEl.classList.add("show");
  clearTimeout(volumeOverlayTimer);
  volumeOverlayTimer = setTimeout(() => volumeOverlayEl.classList.remove("show"), 900);
}

let trackHudTimer = null;
function flashTrackHud(dir) {
  if (!trackHudOverlayEl) return;
  const isNext = dir === "next";
  const track = state.library.find((t) => t.id === state.currentTrackId);
  const trackName = track ? track.title : (isNext ? "Next Track" : "Previous Track");
  
  trackHudIconEl.textContent = isNext ? "▶▶|" : "|◀◀";
  trackHudTextEl.textContent = trackName;
  trackHudOverlayEl.classList.add("show");
  
  clearTimeout(trackHudTimer);
  trackHudTimer = setTimeout(() => {
    trackHudOverlayEl.classList.remove("show");
  }, 1000);
}

/* ---------------------------------------------------------
   14. Wheel & Button Handling
--------------------------------------------------------- */
function moveSelection(delta) {
  const screen = topScreen();
  if (screen.kind === "list" && screen.items.length) {
    screen.selected = Math.max(0, Math.min(screen.items.length - 1, screen.selected + delta));
    render();
  } else if (screen.kind === "quiz") {
    if (screen.phase === "reveal") return;
    screen.selected = Math.max(0, Math.min(quizRowCount(screen) - 1, screen.selected + delta));
    render();
  } else if (screen.kind === "rgb-tuner") {
    // If on color row (0,1,2), adjust color value!
    if (screen.selected < 3) {
      const step = delta * 5;
      if (screen.selected === 0) screen.r = Math.max(0, Math.min(255, screen.r + step));
      else if (screen.selected === 1) screen.g = Math.max(0, Math.min(255, screen.g + step));
      else if (screen.selected === 2) screen.b = Math.max(0, Math.min(255, screen.b + step));

      const hex = rgbToHex(screen.r, screen.g, screen.b);
      if (screen.target === "shell") settings.shellColor = hex;
      else settings.screenColor = hex;
      render();
    } else {
      // Just moving on "Done"
      screen.selected = Math.max(0, Math.min(3, screen.selected + delta));
      render();
    }
  }
}

function activateSelected() {
  const screen = topScreen();
  if (screen.kind === "list" && screen.items.length) {
    const item = screen.items[screen.selected];
    if (!item) return;
    if (screen.trackIds) setQueueFromScreen(screen, screen.selected);
    else if (item.action) item.action(screen.selected);
  } else if (screen.kind === "rgb-tuner") {
    if (screen.selected === 3) {
      popScreen();
    } else {
      screen.selected = (screen.selected + 1) % 4;
      render();
    }
  }
}

function onMenuButton() {
  if (state.hold) return;
  clickFeedback("press");
  if (state.stickersEditing) {
    setStickersEditingMode(false);
    return;
  }
  popScreen();
}

function onSelectButton() {
  if (state.hold) return;
  clickFeedback("press");
  const screen = topScreen();
  if (screen.kind === "list" || screen.kind === "rgb-tuner") activateSelected();
  else if (screen.kind === "quiz") quizSelect(screen);
  else if (screen.kind === "nowplaying") togglePlayPause();
}

function onPlayPauseButton() {
  if (state.hold) return;
  clickFeedback("press");
  if (topScreen().kind === "quiz") return;
  if (!state.currentTrackId) {
    const screen = topScreen();
    if (screen.kind === "list" && screen.trackIds && screen.items.length) {
      setQueueFromScreen(screen, screen.selected);
      return;
    }
    return;
  }
  togglePlayPause();
  ensureNowPlayingOnTop();
}

function onNextButton() {
  if (state.hold) return;
  clickFeedback("press");
  const screen = topScreen();
  if (screen.kind === "nowplaying") {
    playNext();
    flashTrackHud("next");
  } else if (screen.kind === "rgb-tuner") {
    screen.selected = (screen.selected + 1) % 4;
    render();
  } else {
    moveSelection(5);
  }
}

function onPrevButton() {
  if (state.hold) return;
  clickFeedback("press");
  const screen = topScreen();
  if (screen.kind === "nowplaying") {
    playPrev();
    flashTrackHud("prev");
  } else if (screen.kind === "rgb-tuner") {
    screen.selected = (screen.selected + 3) % 4;
    render();
  } else {
    moveSelection(-5);
  }
}

document.querySelectorAll(".wheel-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const action = btn.dataset.action;
    if (action === "menu") onMenuButton();
    else if (action === "next") onNextButton();
    else if (action === "prev") onPrevButton();
    else if (action === "playpause") onPlayPauseButton();
  });
});
document.getElementById("centerBtn").addEventListener("click", (e) => { e.preventDefault(); onSelectButton(); });

screenContentEl.addEventListener("click", (e) => {
  const row = e.target.closest(".menu-row");
  if (row) {
    const screen = topScreen();
    if (screen.kind === "quiz") {
      if (screen.phase === "reveal") return;
      screen.selected = Number(row.dataset.idx);
      quizSelect(screen);
      return;
    }
    if (screen.kind !== "list") return;
    haptic("press");
    const idx = Number(row.dataset.idx);
    screen.selected = idx;
    if (screen.trackIds) setQueueFromScreen(screen, idx);
    else if (screen.items[idx] && screen.items[idx].action) screen.items[idx].action(idx);
    render();
    return;
  }

  const rgbRow = e.target.closest(".rgb-row");
  if (rgbRow) {
    const screen = topScreen();
    if (screen.kind !== "rgb-tuner") return;
    const idx = Number(rgbRow.dataset.idx);
    if (idx === 3) popScreen();
    else {
      screen.selected = idx;
      render();
    }
  }
});

/* Direct touch/pointer drag on the RGB bars (works on iOS since native
   <input type="color"> is unsupported there — this reuses the existing
   RGB tuner instead of needing the click wheel spun). Updates DOM in place
   during the drag rather than calling render(), because replacing the node
   under an active touch/pointer capture cancels the gesture on iOS Safari. */
function paintRgbTuner(screen) {
  const hex = rgbToHex(screen.r, screen.g, screen.b);
  const preview = screenContentEl.querySelector(".rgb-preview-box");
  if (preview) { preview.style.background = hex; preview.textContent = hex.toUpperCase(); }
  const vals = [screen.r, screen.g, screen.b];
  screenContentEl.querySelectorAll(".rgb-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.classList.toggle("selected", idx === screen.selected);
    if (idx > 2) return;
    const fill = row.querySelector(".rgb-bar-fill");
    const valEl = row.querySelector(".rgb-val");
    if (fill) fill.style.width = Math.round((vals[idx] / 255) * 100) + "%";
    if (valEl) valEl.textContent = vals[idx];
  });
}

function setRgbFromBarPointer(track, clientX) {
  const screen = topScreen();
  if (screen.kind !== "rgb-tuner") return;
  const idx = Number(track.closest(".rgb-row").dataset.idx);
  if (idx > 2) return;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const val = Math.round(pct * 255);
  screen.selected = idx;
  if (idx === 0) screen.r = val;
  else if (idx === 1) screen.g = val;
  else screen.b = val;

  const hex = rgbToHex(screen.r, screen.g, screen.b);
  if (screen.target === "shell") settings.shellColor = hex;
  else settings.screenColor = hex;
  paintRgbTuner(screen);
}

let rgbBarDragging = false;
screenContentEl.addEventListener("pointerdown", (e) => {
  const track = e.target.closest(".rgb-bar-track");
  if (!track) return;
  rgbBarDragging = true;
  try { track.setPointerCapture(e.pointerId); } catch (err) {}
  setRgbFromBarPointer(track, e.clientX);
  e.preventDefault();
});
screenContentEl.addEventListener("pointermove", (e) => {
  if (!rgbBarDragging) return;
  const track = e.target.closest(".rgb-bar-track") || screenContentEl.querySelector(".rgb-row.selected .rgb-bar-track");
  if (track) setRgbFromBarPointer(track, e.clientX);
});
["pointerup", "pointercancel"].forEach((evt) => {
  screenContentEl.addEventListener(evt, () => { rgbBarDragging = false; });
});

/* Click-wheel rotation gesture with touch preservation */
let wheelActive = false;
let lastAngleDeg = null;
let accumDeg = 0;
const TICK_THRESHOLD = 20;

let trackSkipTicks = 0;
let lastTrackSkipTime = 0;
const TICKS_PER_TRACK_SKIP = 1;
const TRACK_SKIP_COOLDOWN = 190;

function angleFromEvent(evt, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = evt.clientX - cx;
  const dy = evt.clientY - cy;
  if (Math.hypot(dx, dy) < rect.width * 0.16) return null;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

function normDeg(a) { return ((a + 180) % 360 + 360) % 360 - 180; }

function handleWheelTick(direction) {
  const screen = topScreen();
  if (state.hold) return;
  clickFeedback("tick");

  if (screen.kind === "nowplaying") {
    const mode = settings.wheelNowPlaying;

    if (mode === "volume") {
      audioEl.volume = Math.max(0, Math.min(1, audioEl.volume + direction * 0.05));
      localStorage.setItem("ripod:volume", String(audioEl.volume));
      flashVolumeOverlay();
    } else {
      const now = Date.now();
      if ((trackSkipTicks > 0 && direction < 0) || (trackSkipTicks < 0 && direction > 0)) {
        trackSkipTicks = 0;
      }
      trackSkipTicks += direction;

      if (trackSkipTicks >= TICKS_PER_TRACK_SKIP) {
        trackSkipTicks = 0;
        if (now - lastTrackSkipTime > TRACK_SKIP_COOLDOWN) {
          lastTrackSkipTime = now;
          playNext();
          flashTrackHud("next");
        }
      } else if (trackSkipTicks <= -TICKS_PER_TRACK_SKIP) {
        trackSkipTicks = 0;
        if (now - lastTrackSkipTime > TRACK_SKIP_COOLDOWN) {
          lastTrackSkipTime = now;
          playPrev();
          flashTrackHud("prev");
        }
      }
    }
  } else {
    moveSelection(direction);
  }
}

wheelRingEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".center-btn")) return;
  if (state.hold) return;
  wheelActive = true;
  try { wheelRingEl.setPointerCapture(e.pointerId); } catch (err) {}
  const rect = wheelRingEl.getBoundingClientRect();
  lastAngleDeg = angleFromEvent(e, rect);
  accumDeg = 0;
  trackSkipTicks = 0;
});

wheelRingEl.addEventListener("pointermove", (e) => {
  if (!wheelActive || state.hold) return;
  const rect = wheelRingEl.getBoundingClientRect();
  const angle = angleFromEvent(e, rect);
  if (angle == null || lastAngleDeg == null) { lastAngleDeg = angle; return; }
  const delta = normDeg(angle - lastAngleDeg);
  lastAngleDeg = angle;
  accumDeg += delta;
  while (accumDeg >= TICK_THRESHOLD) { handleWheelTick(1); accumDeg -= TICK_THRESHOLD; }
  while (accumDeg <= -TICK_THRESHOLD) { handleWheelTick(-1); accumDeg += TICK_THRESHOLD; }
});

function endWheelGesture(e) {
  wheelActive = false;
  lastAngleDeg = null;
  accumDeg = 0;
  trackSkipTicks = 0;
  try { wheelRingEl.releasePointerCapture(e.pointerId); } catch (err) {}
}
wheelRingEl.addEventListener("pointerup", endWheelGesture);
wheelRingEl.addEventListener("pointercancel", endWheelGesture);

/* Keyboard support */
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") handleWheelTick(-1);
  else if (e.key === "ArrowDown") handleWheelTick(1);
  else if (e.key === "Enter") onSelectButton();
  else if (e.key === "Escape") onMenuButton();
  else if (e.key === " ") { e.preventDefault(); onPlayPauseButton(); }
});

/* ---------------------------------------------------------
   15. Hold Switch
--------------------------------------------------------- */
holdSwitchEl.addEventListener("click", () => {
  haptic("press");
  state.hold = !state.hold;
  holdSwitchEl.classList.toggle("active", state.hold);
  holdSwitchEl.setAttribute("aria-pressed", String(state.hold));
  clickwheelEl.classList.toggle("held", state.hold);
  holdBadgeEl.classList.toggle("show", state.hold);
});

/* ---------------------------------------------------------
   16. Boot
--------------------------------------------------------- */
async function boot() {
  setupMediaSession();

  if ("storage" in navigator && "persist" in navigator.storage) {
    try { await navigator.storage.persist(); } catch (e) {}
  }

  await refreshLibrary();
  await loadStickers();
  state.navStack = [buildMainMenu()];
  render();
  onCarPlayModeChange();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
}

boot();

})();