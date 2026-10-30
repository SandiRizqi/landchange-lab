import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen, save as dialogSave, message } from "@tauri-apps/plugin-dialog";
import JSZip from "jszip";
import { v4 as uuidv4 } from "uuid";
import IndexMap from "./IndexMap.jsx";
import { maskHasContent, statusAfterEdit } from "./maskUtils.js";
import { shouldHandleShortcut } from "./keyboardUtils.js";
import { stepSwipe } from "./viewUtils.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const DISPLAY = 540;
// Backdrop for QC image panels — deliberately NOT black/white so that
// black/white change masks stay visible against it.
const QC_IMG_BG = "#5b6b80";
const STATUS_COLOR = { pending: "#475569", labeled: "#22c55e", no_change: "#3b82f6", skipped: "#f59e0b" };
const STATUS_LABEL = { pending: "Belum", labeled: "Berubah", no_change: "Tidak Berubah", skipped: "Skip" };
// Mode tampilan: [mode, ikon, label, shortcut]
const VIEW_MODES = [["swipe", "⇔", "Swipe", "1"], ["flicker", "◉", "Flicker", "2"], ["diff", "◑", "Blend", "3"]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── MASK HELPERS ────────────────────────────────────────────────────────────
const newMaskCanvas = size => {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  return c;
};
const canvasHasContent = c =>
  !!c && maskHasContent(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);

/** Kembalikan tile "Berubah" tanpa isi mask ke "Belum" (data lama sebelum perbaikan eraser). */
function repairFalseLabels(tiles) {
  let fixed = 0;
  const out = tiles.map(t => {
    if (t.status !== "labeled" || canvasHasContent(t.maskCanvas)) return t;
    fixed++;
    return { ...t, status: "pending", maskCanvas: null };
  });
  return { tiles: out, fixed };
}

// ─── THEMES ──────────────────────────────────────────────────────────────────
const DARK = {
  appBg:            "#080e1c",
  barBg:            "#060c18",
  border:           "#1a2a44",
  text:             "#c9d8ed",
  textMuted:        "#64748b",
  textFaint:        "#2d4a6e",
  textTiny:         "#1e3a5f",
  textMid:          "#4a6a8a",
  textMid2:         "#94a3b8",
  textMid3:         "#334155",
  cardBg:           "#0d1526",
  cardBgAlt:        "#0a1120",
  canvasBg:         "#040810",
  tileHover:        "#0d1f3c",
  tileActive:       "#0f2a4a",
  tileActiveBorder: "#4a9eff",
  tileBorder:       "#0b1525",
  overlayBg:        "#000a",
  inputBorder:      "#1e3a5f",
  swipeIconText:    "#0a1120",
  pickGradient:     "#0a1120dd",
  scrollTrack:      "#0d1526",
  scrollThumb:      "#1e3a5f",
  blendLabel:       "#c9d8ed66",
  // active-selected tileSize button
  tileSizeActiveBg:     "#2a1f0a",
  tileSizeActiveBorder: "#f59e0b",
  tileSizeActiveColor:  "#f59e0b",
  tileSizeIdleBg:       "#0d1526",
  tileSizeIdleBorder:   "#1e3a5f",
  tileSizeIdleColor:    "#4a6a8a",
};

const LIGHT = {
  appBg:            "#f0f4f8",
  barBg:            "#ffffff",
  border:           "#d1dce8",
  text:             "#1e293b",
  textMuted:        "#64748b",
  textFaint:        "#64748b",
  textTiny:         "#94a3b8",
  textMid:          "#475569",
  textMid2:         "#64748b",
  textMid3:         "#64748b",
  cardBg:           "#ffffff",
  cardBgAlt:        "#f8fafc",
  canvasBg:         "#d8e4ef",
  tileHover:        "#eff6ff",
  tileActive:       "#dbeafe",
  tileActiveBorder: "#3b82f6",
  tileBorder:       "#eef3f9",
  overlayBg:        "#fffa",
  inputBorder:      "#cbd5e1",
  swipeIconText:    "#1e293b",
  pickGradient:     "#f1f5f9ee",
  scrollTrack:      "#f1f5f9",
  scrollThumb:      "#cbd5e1",
  blendLabel:       "#1e293b99",
  tileSizeActiveBg:     "#fef3c7",
  tileSizeActiveBorder: "#f59e0b",
  tileSizeActiveColor:  "#d97706",
  tileSizeIdleBg:       "#f8fafc",
  tileSizeIdleBorder:   "#d1dce8",
  tileSizeIdleColor:    "#64748b",
};

// ─── TAURI ───────────────────────────────────────────────────────────────────
async function openImageNative(label) {
  const path = await dialogOpen({
    title: `Pilih ${label}`,
    filters: [{ name: "Citra", extensions: ["tif","tiff","png","jpg","jpeg","bmp"] }],
    multiple: false,
  });
  if (!path) return null;
  const b64 = await invoke("load_image_as_png_b64", { path });
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  return { el: img, width: img.naturalWidth, height: img.naturalHeight, path };
}

async function imageFromB64(b64) {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  return img;
}

// Write a (possibly large) Uint8Array to disk in chunks.
// Building one giant JS array via Array.from(blob) throws
// "RangeError: Invalid array length" once the export grows past a few hundred MB,
// so we stream it in modest slices the IPC bridge can handle safely.
const IPC_CHUNK = 16 * 1024 * 1024; // 16 MB per IPC call
async function writeBytes(path, bytes, onProgress) {
  if (bytes.length <= IPC_CHUNK) {
    await invoke("save_bytes_to_path", { path, data: Array.from(bytes) });
    onProgress?.(100);
    return;
  }
  let first = true;
  for (let off = 0; off < bytes.length; off += IPC_CHUNK) {
    const slice = bytes.subarray(off, Math.min(off + IPC_CHUNK, bytes.length));
    await invoke("append_bytes_to_path", { path, data: Array.from(slice), first });
    first = false;
    onProgress?.(Math.round(Math.min(off + IPC_CHUNK, bytes.length) / bytes.length * 100));
  }
}

async function pathExists(path) {
  try { return await invoke("path_exists", { path }); }
  catch { return false; }
}

// ─── UPLOAD ZONE ─────────────────────────────────────────────────────────────
function PickZone({ label, tag, image, onImage, th }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    try { const img = await openImageNative(label); if (img) onImage(img); }
    catch (e) { await message(String(e), { title: "Error", kind: "error" }); }
    finally { setLoading(false); }
  };
  return (
    <div style={{
      border: `2px dashed ${image ? "#22c55e55" : th.inputBorder}`,
      borderRadius: 10, background: th.cardBg,
      overflow: "hidden", position: "relative", minHeight: 170,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {loading ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, color: "#f59e0b", display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</div>
          <div style={{ color: th.textMuted, fontSize: 12, marginTop: 6 }}>Membaca citra…</div>
        </div>
      ) : image ? (
        <>
          <img src={image.el.src} alt="" style={{ width: "100%", height: 170, objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(transparent 45%, ${th.pickGradient})`,
            display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 10 }}>
            <div style={{ color: th.textMid2, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {image.path.split(/[/\\]/).pop()}
            </div>
            <div style={{ color: th.textMuted, fontSize: 10 }}>{image.width}×{image.height}px</div>
            <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
              <button onClick={handle} style={smBtn(th.cardBgAlt, "#60a5fa")}>Ganti</button>
              <button onClick={() => onImage(null)} style={smBtn(th.cardBgAlt, "#f87171")}>✕</button>
            </div>
          </div>
        </>
      ) : (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: 10, color: tag === "T1" ? "#4a9eff" : "#f59e0b", letterSpacing: 3, marginBottom: 8 }}>◉ {tag}</div>
          <div style={{ color: th.textMid, fontSize: 13, marginBottom: 10 }}>{label}</div>
          <button onClick={handle} style={{ background: "transparent", border: `1px solid ${th.inputBorder}`, color: th.textMid, borderRadius: 6, padding: "7px 18px", fontSize: 12, cursor: "pointer" }}>
            Pilih File…
          </button>
          <div style={{ color: th.textTiny, fontSize: 10, marginTop: 6 }}>GeoTIFF · TIFF · PNG · JPG</div>
        </div>
      )}
    </div>
  );
}

const smBtn = (bg, color) => ({ background: bg, border: `1px solid ${color}44`, color, borderRadius: 5, padding: "3px 10px", fontSize: 11, cursor: "pointer" });

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [stage, setStage]       = useState("setup");
  const [img1, setImg1]         = useState(null);
  const [img2, setImg2]         = useState(null);
  const [tileSize, setTileSize] = useState(256);
  const [stride, setStride]     = useState(128);
  const [generating, setGenerating] = useState(false);
  const [genProg, setGenProg]   = useState(0);

  const [tiles, setTiles]       = useState([]);
  const [curIdx, setCurIdx]     = useState(0);

  const [projectId, setProjectId] = useState(null);

  // Theme
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("lclab_darkmode");
    return saved === null ? true : saved === "true";
  });
  const th = darkMode ? DARK : LIGHT;

  useEffect(() => { localStorage.setItem("lclab_darkmode", darkMode); }, [darkMode]);

  // View mode
  const [mode, setMode]         = useState("swipe");
  const [swipeX, setSwipeX]     = useState(50);
  const [flickerImg, setFlickerImg] = useState(1);
  const [flickerSpeed, setFlickerSpeed] = useState(650);

  // Drawing
  const [tool, setTool]         = useState("brush");
  const [brushSize, setBrushSize] = useState(28);
  const [maskOpacity, setMaskOpacity] = useState(0.6);
  const [isDrawing, setIsDrawing] = useState(false);

  // Polygon tool
  const [polygonPoints, setPolygonPoints] = useState([]);
  const polygonPointsRef = useRef([]);

  // Zoom + pan
  const [zoom, setZoom]         = useState(1);
  const [panX, setPanX]         = useState(0);
  const [panY, setPanY]         = useState(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart                = useRef(null);

  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [cursorVisible, setCursorVisible] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [exportProg, setExportProg] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Quality Control
  const [qcSamples, setQcSamples] = useState([]);   // { id,row,col,status, beforeUrl, afterUrl, maskUrl }
  const [qcManifest, setQcManifest] = useState(null);
  const [qcProg, setQcProg] = useState(0);
  const [qcSaving, setQcSaving] = useState(false);
  const [qcView, setQcView] = useState("after"); // before | after | mask
  const [qcSource, setQcSource] = useState(null); // { type:"zip" } | { type:"folder", root, sep }
  const [qcHardDelete, setQcHardDelete] = useState(false); // folder mode: ✕ deletes files on disk
  const [qcLayout, setQcLayout] = useState("single"); // single | grid
  const [qcIndex, setQcIndex] = useState(0); // current sample in single view

  const dispRef       = useRef();
  const maskRef       = useRef();
  const polyRef       = useRef();
  const canvasWrapRef = useRef();
  const lastPos       = useRef(null);
  const undoRef       = useRef({});
  // Stroke brush/eraser yang sedang berjalan: { idx, canvas }. Canvas dimutasi
  // selama drag dan baru di-commit ke state tiles saat stroke selesai.
  const strokeRef     = useRef(null);

  const W = useRef({});
  useEffect(() => {
    W.current = { tiles, curIdx, img1, img2, tileSize, mode, swipeX, flickerImg,
      maskOpacity, brushSize, tool, zoom, panX, panY, spaceDown, autoAdvance,
      polygonPoints, projectId };
  });

  useEffect(() => { polygonPointsRef.current = polygonPoints; }, [polygonPoints]);

  // ── Theme-derived style helpers (inside component so they can access `th`)
  const iconBtn = {
    background: th.cardBg, border: `1px solid ${th.inputBorder}`,
    color: th.textMuted, borderRadius: 4, padding: "1px 7px", fontSize: 12, cursor: "pointer", lineHeight: 1.4,
  };
  const tbBtn = (bg, color) => ({
    background: bg, border: `1px solid ${color}44`, color,
    borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap",
  });
  const panelLabel = { fontSize: 9, color: th.textFaint, letterSpacing: 1.5, marginBottom: 7 };

  // Tombol tidak mengambil fokus saat diklik (Enter/Space tak memicunya ulang), dan slider
  // melepas fokus setelah digeser — shortcut keyboard selalu langsung berfungsi.
  const keepShortcutFocus = e => { if (e.target.closest?.("button")) e.preventDefault(); };
  const releaseSliderFocus = () => {
    const a = document.activeElement;
    if (a?.tagName === "INPUT" && a.type === "range") a.blur();
  };

  // ── Center canvas
  const centerCanvas = useCallback(() => {
    if (!canvasWrapRef.current) return;
    const { width: ww, height: wh } = canvasWrapRef.current.getBoundingClientRect();
    setPanX((ww - DISPLAY) / 2);
    setPanY((wh - DISPLAY) / 2);
  }, []);

  useEffect(() => {
    if (stage === "labeling") setTimeout(centerCanvas, 50);
  }, [stage, centerCanvas]);

  useEffect(() => {
    if (stage !== "labeling" || mode !== "flicker") return;
    const id = setInterval(() => setFlickerImg(f => f === 1 ? 2 : 1), flickerSpeed);
    return () => clearInterval(id);
  }, [stage, mode, flickerSpeed]);

  // ── Redraw display canvas
  const redrawDisplay = useCallback(() => {
    const { tiles, curIdx, img1, img2, tileSize, mode, swipeX, flickerImg } = W.current;
    if (!dispRef.current || !img1 || !img2 || !tiles[curIdx]) return;
    const { x, y } = tiles[curIdx];
    const ctx = dispRef.current.getContext("2d");
    ctx.clearRect(0, 0, DISPLAY, DISPLAY);
    if (mode === "swipe") {
      const sx = Math.round((swipeX / 100) * DISPLAY);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sx, DISPLAY); ctx.clip();
      ctx.drawImage(img1.el, x, y, tileSize, tileSize, 0, 0, DISPLAY, DISPLAY); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(sx, 0, DISPLAY - sx, DISPLAY); ctx.clip();
      ctx.drawImage(img2.el, x, y, tileSize, tileSize, 0, 0, DISPLAY, DISPLAY); ctx.restore();
      ctx.strokeStyle = "#fff8"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, DISPLAY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx, DISPLAY / 2, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0a1120"; ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("⇔", sx, DISPLAY / 2);
      ctx.fillStyle = "#4a9effcc"; ctx.font = "bold 11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("T1 BEFORE", 8, 8);
      ctx.fillStyle = "#f59e0bcc"; ctx.textAlign = "right"; ctx.fillText("T2 AFTER", DISPLAY - 8, 8);
    } else if (mode === "flicker") {
      ctx.drawImage(flickerImg === 1 ? img1.el : img2.el, x, y, tileSize, tileSize, 0, 0, DISPLAY, DISPLAY);
      ctx.fillStyle = flickerImg === 1 ? "rgba(59,130,246,0.10)" : "rgba(245,158,11,0.10)";
      ctx.fillRect(0, 0, DISPLAY, DISPLAY);
      ctx.fillStyle = flickerImg === 1 ? "#4a9effcc" : "#f59e0bcc";
      ctx.font = "bold 12px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(flickerImg === 1 ? "◀ T1 BEFORE" : "▶ T2 AFTER", 10, 10);
    } else {
      ctx.drawImage(img1.el, x, y, tileSize, tileSize, 0, 0, DISPLAY, DISPLAY);
      ctx.globalAlpha = 0.52;
      ctx.drawImage(img2.el, x, y, tileSize, tileSize, 0, 0, DISPLAY, DISPLAY);
      ctx.globalAlpha = 1;
      // blend label color saved in ref for use here
      ctx.fillStyle = W.current._blendLabel || "#c9d8ed66";
      ctx.font = "bold 11px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText("◑ BLEND T1+T2", 10, 10);
    }
  }, []);

  // Keep blendLabel color accessible inside the non-reactive redrawDisplay
  useEffect(() => { W.current._blendLabel = th.blendLabel; }, [th]);

  // Gambar layer mask tampilan dari sebuah canvas mask (null = kosongkan).
  const paintMaskLayer = useCallback(mc => {
    if (!maskRef.current) return;
    const ctx = maskRef.current.getContext("2d");
    ctx.clearRect(0, 0, DISPLAY, DISPLAY);
    if (mc) {
      ctx.globalAlpha = W.current.maskOpacity;
      ctx.drawImage(mc, 0, 0, DISPLAY, DISPLAY);
      ctx.globalAlpha = 1;
    }
  }, []);

  const redrawMask = useCallback(() => {
    const { tiles, curIdx } = W.current;
    const s = strokeRef.current;
    // Selama stroke berjalan, tampilkan canvas kerja (belum di-commit ke state).
    paintMaskLayer(s && s.idx === curIdx ? s.canvas : tiles[curIdx]?.maskCanvas || null);
  }, [paintMaskLayer]);

  const redrawPoly = useCallback((pts, mousePos) => {
    if (!polyRef.current) return;
    const ctx = polyRef.current.getContext("2d");
    ctx.clearRect(0, 0, DISPLAY, DISPLAY);
    if (!pts || pts.length === 0) return;
    const { tool } = W.current;
    const strokeColor = tool === "eraser" ? "#4a9eff" : "#ff3232";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = tool === "eraser" ? "rgba(74,158,255,0.15)" : "rgba(255,50,50,0.15)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (mousePos) ctx.lineTo(mousePos.x, mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (pts.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? strokeColor : "#fff";
      ctx.fill();
    });
  }, []);

  // `stage` ikut: canvas baru ter-mount saat masuk labeling, padahal img1/img2/curIdx
  // sudah diset sebelumnya — tanpa ini tile pertama tampil kosong sampai ada interaksi.
  useEffect(() => { redrawDisplay(); }, [stage, curIdx, mode, swipeX, flickerImg, img1, img2, tileSize]);
  useEffect(() => { redrawMask(); }, [curIdx, tiles, maskOpacity]);

  useEffect(() => {
    if (tool !== "polygon") {
      setPolygonPoints([]);
      if (polyRef.current) polyRef.current.getContext("2d").clearRect(0, 0, DISPLAY, DISPLAY);
    }
  }, [curIdx, tool]);

  // ── Generate tiles
  const generateTiles = useCallback(async () => {
    if (!img1 || !img2) return;
    setGenerating(true);
    const pid = uuidv4();
    setProjectId(pid);
    const w = Math.min(img1.width, img2.width);
    const h = Math.min(img1.height, img2.height);
    const cols = Math.max(1, Math.floor((w - tileSize) / stride) + 1);
    const rows = Math.max(1, Math.floor((h - tileSize) / stride) + 1);
    const result = [];
    let n = 0, total = rows * cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        result.push({ id: `${r}_${c}`, row: r, col: c, x: c * stride, y: r * stride, status: "pending", maskCanvas: null });
        n++;
        if (n % 50 === 0) { setGenProg(Math.round(n / total * 100)); await sleep(0); }
      }
    }
    undoRef.current = {};
    setTiles(result); setCurIdx(0);
    setZoom(1); setPanX(0); setPanY(0);
    setGenerating(false); setStage("labeling");
  }, [img1, img2, tileSize, stride]);

  // ── Undo
  const saveUndo = useCallback(() => {
    const { tiles, curIdx } = W.current;
    const tile = tiles[curIdx];
    if (!tile) return;
    const stack = undoRef.current[tile.id] || [];
    let snapshot = null;
    if (tile.maskCanvas) {
      snapshot = document.createElement("canvas");
      snapshot.width = tile.maskCanvas.width;
      snapshot.height = tile.maskCanvas.height;
      snapshot.getContext("2d").drawImage(tile.maskCanvas, 0, 0);
    }
    // Status ikut disimpan agar undo mengembalikan status asli (mis. no_change).
    stack.push({ canvas: snapshot, status: tile.status });
    if (stack.length > 20) stack.shift();
    undoRef.current[tile.id] = stack;
  }, []);

  // Satu-satunya jalur menyimpan hasil edit mask. Status dihitung dari ISI mask,
  // jadi mask kosong (mis. habis dihapus eraser) tidak pernah tercatat "Berubah".
  const commitMask = useCallback((idx, mc) => {
    const tiles = W.current.tiles;
    const tile = tiles[idx];
    if (!tile) return;
    const has = canvasHasContent(mc);
    const updated = [...tiles];
    updated[idx] = { ...tile, maskCanvas: has ? mc : null, status: statusAfterEdit(tile.status, has) };
    W.current.tiles = updated;
    setTiles(updated);
    if (idx === W.current.curIdx) paintMaskLayer(has ? mc : null);
  }, [paintMaskLayer]);

  const endStroke = useCallback(() => {
    const s = strokeRef.current;
    if (!s) return;
    strokeRef.current = null;
    commitMask(s.idx, s.canvas);
  }, [commitMask]);

  const undo = useCallback(() => {
    endStroke();
    const { tiles, curIdx } = W.current;
    const tile = tiles[curIdx];
    if (!tile) return;
    const stack = undoRef.current[tile.id] || [];
    if (!stack.length) return;
    const prev = stack.pop();
    undoRef.current[tile.id] = stack;
    const updated = [...tiles];
    updated[curIdx] = { ...tile, maskCanvas: prev.canvas, status: prev.status };
    W.current.tiles = updated;
    setTiles(updated);
    paintMaskLayer(prev.canvas);
  }, [endStroke, paintMaskLayer]);

  const getPos = useCallback(e => {
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const { zoom, panX, panY } = W.current;
    return { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom };
  }, []);

  // Menggambar ke canvas kerja stroke (strokeRef). Tidak menyentuh state tiles —
  // commit (dan penentuan status) terjadi sekali di endStroke.
  const drawStroke = useCallback((pos, prev) => {
    const s = strokeRef.current;
    if (!s) return;
    const { tileSize, brushSize, tool } = W.current;
    if (pos.x < 0 || pos.x > DISPLAY || pos.y < 0 || pos.y > DISPLAY) return;
    const ctx = s.canvas.getContext("2d");
    const sc = tileSize / DISPLAY;
    const r = (brushSize / 2) * sc;
    ctx.beginPath();
    if (prev) {
      const dx = pos.x - prev.x, dy = pos.y - prev.y;
      const steps = Math.max(1, Math.floor(Math.hypot(dx, dy) / (r * 0.4)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        ctx.moveTo((prev.x + dx * t) * sc, (prev.y + dy * t) * sc);
        ctx.arc((prev.x + dx * t) * sc, (prev.y + dy * t) * sc, r, 0, Math.PI * 2);
      }
    } else {
      ctx.arc(pos.x * sc, pos.y * sc, r, 0, Math.PI * 2);
    }
    if (tool === "brush") {
      ctx.fillStyle = "rgba(255,50,50,1)"; ctx.fill();
    } else {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)"; ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    paintMaskLayer(s.canvas);
  }, [paintMaskLayer]);

  const finishPolygon = useCallback(() => {
    const pts = polygonPointsRef.current;
    const clearPoly = () => {
      setPolygonPoints([]); polygonPointsRef.current = [];
      if (polyRef.current) polyRef.current.getContext("2d").clearRect(0, 0, DISPLAY, DISPLAY);
    };
    if (pts.length < 3) { clearPoly(); return; }
    const { tiles, curIdx, tileSize, tool } = W.current;
    const tile = tiles[curIdx];
    // Menghapus di tile tanpa mask: tidak ada yang berubah, jangan buat mask kosong.
    if (tool === "eraser" && !tile.maskCanvas) { clearPoly(); return; }
    saveUndo();
    const mc = tile.maskCanvas || newMaskCanvas(tileSize);
    const ctx = mc.getContext("2d");
    const sc = tileSize / DISPLAY;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * sc, pts[0].y * sc);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sc, pts[i].y * sc);
    ctx.closePath();
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.fillStyle = "rgba(255,50,50,1)";
    }
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    commitMask(curIdx, mc);
    clearPoly();
  }, [saveUndo, commitMask]);

  const fillAll = useCallback(() => {
    const { curIdx, tileSize } = W.current;
    saveUndo();
    const mc = newMaskCanvas(tileSize);
    const ctx = mc.getContext("2d");
    ctx.fillStyle = "rgba(255,50,50,1)";
    ctx.fillRect(0, 0, tileSize, tileSize);
    commitMask(curIdx, mc);
  }, [saveUndo, commitMask]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom(z => {
      const nz = clamp(z * factor, 0.5, 10);
      setPanX(px => mx - (mx - px) * (nz / z));
      setPanY(py => my - (my - py) * (nz / z));
      return nz;
    });
  }, []);

  const resetZoom = useCallback(() => { centerCanvas(); setZoom(1); }, [centerCanvas]);

  const onCanvasMouseDown = useCallback(e => {
    if (e.button === 1 || W.current.spaceDown) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX - W.current.panX, y: e.clientY - W.current.panY };
      return;
    }
    if (e.button !== 0) return;
    const { tool } = W.current;
    if (tool === "polygon") {
      const p = getPos(e);
      const pts = polygonPointsRef.current;
      if (pts.length >= 3) {
        const dx = p.x - pts[0].x, dy = p.y - pts[0].y;
        if (Math.hypot(dx, dy) < 12) { finishPolygon(); return; }
      }
      const newPts = [...pts, p];
      setPolygonPoints(newPts);
      polygonPointsRef.current = newPts;
      redrawPoly(newPts, null);
      return;
    }
    const { tiles, curIdx, tileSize } = W.current;
    const tile = tiles[curIdx];
    // Eraser di tile tanpa mask: tidak ada yang dihapus — jangan buat mask/undo kosong.
    if (tool === "eraser" && !tile.maskCanvas) return;
    saveUndo();
    strokeRef.current = { idx: curIdx, canvas: tile.maskCanvas || newMaskCanvas(tileSize) };
    setIsDrawing(true);
    const p = getPos(e);
    lastPos.current = p;
    drawStroke(p, null);
  }, [getPos, drawStroke, saveUndo, finishPolygon, redrawPoly]);

  const onCanvasMouseMove = useCallback(e => {
    const rect = canvasWrapRef.current.getBoundingClientRect();
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (isPanning && panStart.current) {
      setPanX(e.clientX - panStart.current.x);
      setPanY(e.clientY - panStart.current.y);
      return;
    }
    const { tool } = W.current;
    if (tool === "polygon") {
      const p = getPos(e);
      redrawPoly(polygonPointsRef.current, polygonPointsRef.current.length > 0 ? p : null);
      return;
    }
    if (isDrawing) {
      const p = getPos(e);
      drawStroke(p, lastPos.current);
      lastPos.current = p;
    }
  }, [isPanning, isDrawing, getPos, drawStroke, redrawPoly]);

  const onCanvasMouseUp = useCallback(() => {
    if (isPanning) { setIsPanning(false); panStart.current = null; return; }
    if (W.current.tool !== "polygon") { endStroke(); setIsDrawing(false); lastPos.current = null; }
  }, [isPanning, endStroke]);

  const onCanvasMouseLeave = useCallback(() => {
    if (W.current.tool !== "polygon") {
      endStroke();
      setIsDrawing(false);
      lastPos.current = null;
    }
    setIsPanning(false);
    setCursorVisible(false);
    panStart.current = null;
  }, [endStroke]);

  const onCanvasMouseEnter = useCallback(() => setCursorVisible(true), []);
  const onCanvasDblClick = useCallback(() => { if (W.current.tool === "polygon") finishPolygon(); }, [finishPolygon]);

  const goTo = useCallback(idx => {
    if (idx < 0 || idx >= W.current.tiles.length) return;
    endStroke(); // jangan sampai stroke yang belum selesai hilang saat pindah tile
    setCurIdx(idx);
  }, [endStroke]);

  const goToNextPending = useCallback(() => {
    const { tiles, curIdx } = W.current;
    const next = tiles.findIndex((t, i) => i > curIdx && t.status === "pending");
    if (next !== -1) goTo(next);
    else { const first = tiles.findIndex(t => t.status === "pending"); if (first !== -1) goTo(first); }
  }, [goTo]);

  const clearMask = useCallback(() => {
    saveUndo();
    commitMask(W.current.curIdx, null);
  }, [saveUndo, commitMask]);

  const markStatus = useCallback((status) => {
    const { tiles, curIdx, autoAdvance } = W.current;
    const updated = [...tiles];
    updated[curIdx] = { ...tiles[curIdx], status, ...(status === "no_change" ? { maskCanvas: null } : {}) };
    setTiles(updated);
    if (autoAdvance) {
      const next = updated.findIndex((t, i) => i > curIdx && t.status === "pending");
      if (next !== -1) goTo(next); else goTo(Math.min(curIdx + 1, tiles.length - 1));
    } else goTo(Math.min(curIdx + 1, tiles.length - 1));
  }, [goTo]);

  const confirmNext = useCallback(() => {
    const { tiles, curIdx, autoAdvance } = W.current;
    const t = tiles[curIdx];
    const updated = [...tiles];
    if (t.status === "pending" && !t.maskCanvas) { updated[curIdx] = { ...t, status: "no_change" }; setTiles(updated); }
    if (autoAdvance) {
      const next = updated.findIndex((tt, i) => i > curIdx && tt.status === "pending");
      if (next !== -1) goTo(next); else goTo(Math.min(curIdx + 1, tiles.length - 1));
    } else goTo(Math.min(curIdx + 1, tiles.length - 1));
  }, [goTo]);

  useEffect(() => {
    if (stage !== "labeling") return;
    const down = e => { if (e.code === "Space" && shouldHandleShortcut(e.target, " ")) { e.preventDefault(); setSpaceDown(true); } };
    const up   = e => { if (e.code === "Space") { setSpaceDown(false); setIsPanning(false); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [stage]);

  useEffect(() => {
    if (stage !== "labeling") return;
    const fn = e => {
      if (!shouldHandleShortcut(e.target, e.key)) return;
      if (e.code === "Space") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { undo(); return; }
      if (e.key === "Escape" && W.current.tool === "polygon") {
        setPolygonPoints([]); polygonPointsRef.current = [];
        if (polyRef.current) polyRef.current.getContext("2d").clearRect(0, 0, DISPLAY, DISPLAY);
        return;
      }
      if (e.key === "Enter" && W.current.tool === "polygon") { finishPolygon(); return; }
      const map = {
        "ArrowRight": () => goTo(W.current.curIdx + 1),
        "d":          () => goTo(W.current.curIdx + 1),
        "ArrowLeft":  () => goTo(W.current.curIdx - 1),
        "a":          () => goTo(W.current.curIdx - 1),
        "j":          goToNextPending,
        "Enter":      confirmNext,
        "n":          () => markStatus("no_change"),
        "s":          () => markStatus("skipped"),
        "b":          () => setTool("brush"),
        "e":          () => setTool("eraser"),
        "p":          () => setTool("polygon"),
        "f":          fillAll,
        "c":          clearMask,
        "r":          resetZoom,
        "1":          () => setMode("swipe"),
        "2":          () => setMode("flicker"),
        "3":          () => setMode("diff"),
        ",":          () => setSwipeX(x => stepSwipe(x, -1)),
        ".":          () => setSwipeX(x => stepSwipe(x, +1)),
        "+":          () => setZoom(z => clamp(z * 1.2, 0.5, 10)),
        "=":          () => setZoom(z => clamp(z * 1.2, 0.5, 10)),
        "-":          () => setZoom(z => clamp(z / 1.2, 0.5, 10)),
        "[":          () => setBrushSize(v => Math.max(v - 4, 4)),
        "]":          () => setBrushSize(v => Math.min(v + 4, 120)),
      };
      map[e.key]?.();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stage, goTo, goToNextPending, confirmNext, markStatus, clearMask, undo, fillAll, resetZoom, finishPolygon]);

  // ── Keyboard navigation for QC single view
  useEffect(() => {
    if (stage !== "qc" || qcLayout !== "single") return;
    const fn = e => {
      if (!shouldHandleShortcut(e.target, e.key)) return;
      if (e.key === "ArrowRight" || e.key === "d") { setQcIndex(i => Math.min(i + 1, qcSamples.length - 1)); }
      else if (e.key === "ArrowLeft" || e.key === "a") { setQcIndex(i => Math.max(i - 1, 0)); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        const s = qcSamples[qcIndex];
        if (s) deleteQCSample(s.id);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stage, qcLayout, qcSamples, qcIndex]);

  // ── Canvas helpers
  const canvasToBlob = c => new Promise(res => c.toBlob(res, "image/png"));
  const canvasToB64 = c => new Promise(res => c.toBlob(b => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(",")[1]);
    reader.readAsDataURL(b);
  }, "image/png"));

  const makeTileCanvas = (imgEl, tile) => {
    const c = document.createElement("canvas"); c.width = tileSize; c.height = tileSize;
    c.getContext("2d").drawImage(imgEl, tile.x, tile.y, tileSize, tileSize, 0, 0, tileSize, tileSize);
    return c;
  };
  const makeMaskCanvas = tile => {
    const mc = document.createElement("canvas"); mc.width = tileSize; mc.height = tileSize;
    const ctx = mc.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, tileSize, tileSize);
    if (tile.maskCanvas) {
      const tmp = document.createElement("canvas"); tmp.width = tileSize; tmp.height = tileSize;
      tmp.getContext("2d").drawImage(tile.maskCanvas, 0, 0);
      const src = tmp.getContext("2d").getImageData(0, 0, tileSize, tileSize);
      const dst = ctx.getImageData(0, 0, tileSize, tileSize);
      for (let i = 0; i < src.data.length; i += 4) {
        const v = src.data[i + 3] > 100 ? 255 : 0;
        dst.data[i] = v; dst.data[i+1] = v; dst.data[i+2] = v; dst.data[i+3] = 255;
      }
      ctx.putImageData(dst, 0, 0);
    }
    return mc;
  };

  // ── Export
  const exportLabels = async () => {
    const labeled = tiles.filter(t => t.status === "labeled" || t.status === "no_change");
    if (!labeled.length) { await message("Belum ada tile yang dilabeli!", { title: "Export", kind: "warning" }); return; }
    const pid = projectId || uuidv4();
    const savePath = await dialogSave({
      title: "Simpan hasil label sebagai ZIP",
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }],
      defaultPath: `landchange_${pid.slice(0,8)}_${labeled.length}tiles.zip`,
    });
    if (!savePath) return;
    setExporting(true); setExportProg(0);
    try {
      const zip = new JSZip();
      const bef = zip.folder("before"), aft = zip.folder("after"), msk = zip.folder("masks");
      const w = Math.min(img1.width, img2.width), h = Math.min(img1.height, img2.height);
      const cols = Math.max(1, Math.floor((w - tileSize) / stride) + 1);
      const rows = Math.max(1, Math.floor((h - tileSize) / stride) + 1);
      const allTileMeta = tiles.map(t => ({ id: t.id, row: t.row, col: t.col, x: t.x, y: t.y, status: t.status }));
      for (let i = 0; i < labeled.length; i++) {
        const tile = labeled[i];
        const name = `tile_r${tile.row}_c${tile.col}.png`;
        bef.file(name, await canvasToBlob(makeTileCanvas(img1.el, tile)));
        aft.file(name,  await canvasToBlob(makeTileCanvas(img2.el, tile)));
        msk.file(name,  await canvasToBlob(makeMaskCanvas(tile)));
        setExportProg(Math.round(((i + 1) / labeled.length) * 100));
        if (i % 5 === 0) await sleep(0);
      }
      zip.file("manifest.json", JSON.stringify({
        version: 1, projectId: pid, exportedAt: new Date().toISOString(),
        img1Path: img1.path, img2Path: img2.path, tileSize, stride,
        gridRows: rows, gridCols: cols, tiles: allTileMeta,
      }, null, 2));
      const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      await writeBytes(savePath, blob, p => setExportProg(p));
      await message(`Berhasil ekspor ${labeled.length} tile ke:\n${savePath}`, { title: "✓ Export Selesai", kind: "info" });
    } catch (e) { await message("Export gagal: " + String(e), { title: "Error", kind: "error" }); }
    setExporting(false);
  };

  // ── Save Project
  const saveProject = async () => {
    const pid = projectId || uuidv4();
    if (!projectId) setProjectId(pid);
    const savePath = await dialogSave({
      title: "Simpan Project",
      filters: [{ name: "LandChange Project", extensions: ["lcproject"] }],
      defaultPath: `project_${pid.slice(0,8)}.lcproject`,
    });
    if (!savePath) return;
    setSaving(true);
    try {
      const zip = new JSZip();
      const maskFolder = zip.folder("masks");
      const tilesWithMasks = [];
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const meta = { id: t.id, row: t.row, col: t.col, x: t.x, y: t.y, status: t.status, hasMask: !!t.maskCanvas };
        if (t.maskCanvas) {
          const b64 = await canvasToB64(t.maskCanvas);
          maskFolder.file(`tile_r${t.row}_c${t.col}.png`, b64, { base64: true });
        }
        tilesWithMasks.push(meta);
        if (i % 20 === 0) await sleep(0);
      }
      const w = Math.min(img1.width, img2.width), h = Math.min(img1.height, img2.height);
      const cols = Math.max(1, Math.floor((w - tileSize) / stride) + 1);
      const rows = Math.max(1, Math.floor((h - tileSize) / stride) + 1);
      zip.file("project.json", JSON.stringify({
        version: 1, projectId: pid, savedAt: new Date().toISOString(),
        img1Path: img1.path, img2Path: img2.path, tileSize, stride,
        gridRows: rows, gridCols: cols, tiles: tilesWithMasks,
      }, null, 2));
      const blob = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
      await writeBytes(savePath, blob);
      await message(`Project disimpan ke:\n${savePath}`, { title: "✓ Project Tersimpan", kind: "info" });
    } catch (e) { await message("Gagal simpan project: " + String(e), { title: "Error", kind: "error" }); }
    setSaving(false);
  };

  // ── Load Project
  const loadProject = async () => {
    const path = await dialogOpen({ title: "Buka Project", filters: [{ name: "LandChange Project", extensions: ["lcproject"] }], multiple: false });
    if (!path) return;
    setLoading(true);
    try {
      const bytes = await invoke("read_file_bytes", { path });
      let zip;
      try { zip = await JSZip.loadAsync(new Uint8Array(bytes)); }
      catch { throw new Error("File tidak bisa dibaca sebagai arsip project (mungkin rusak atau bukan .lcproject)."); }
      const pjFile = zip.file("project.json");
      if (!pjFile) throw new Error("Bukan file project LandChange yang valid: 'project.json' tidak ditemukan di dalam arsip.");
      let project;
      try { project = JSON.parse(await pjFile.async("string")); }
      catch { throw new Error("'project.json' rusak / tidak bisa dibaca."); }
      if (!Array.isArray(project.tiles) || !project.img1Path || !project.img2Path) {
        throw new Error("Struktur project.json tidak lengkap (tiles / img1Path / img2Path hilang).");
      }
      // Validate the source images still exist before trying to decode them.
      const missing = [];
      if (!(await pathExists(project.img1Path))) missing.push("• Before (T1): " + project.img1Path);
      if (!(await pathExists(project.img2Path))) missing.push("• After (T2): " + project.img2Path);
      if (missing.length) {
        throw new Error("Citra asli tidak ditemukan di lokasi semula:\n\n" + missing.join("\n") +
          "\n\nKembalikan file citra ke lokasi tersebut (atau buat ulang project) lalu coba lagi.");
      }
      const [i1b64, i2b64] = await Promise.all([
        invoke("load_image_as_png_b64", { path: project.img1Path }),
        invoke("load_image_as_png_b64", { path: project.img2Path }),
      ]);
      const [i1el, i2el] = await Promise.all([imageFromB64(i1b64), imageFromB64(i2b64)]);
      const reconstructed = [];
      for (const meta of project.tiles) {
        let maskCanvas = null;
        if (meta.hasMask) {
          const maskFile = zip.file(`masks/tile_r${meta.row}_c${meta.col}.png`);
          if (maskFile) {
            const maskEl = await imageFromB64(await maskFile.async("base64"));
            maskCanvas = document.createElement("canvas");
            maskCanvas.width = project.tileSize; maskCanvas.height = project.tileSize;
            maskCanvas.getContext("2d").drawImage(maskEl, 0, 0);
          }
        }
        reconstructed.push({ id: meta.id, row: meta.row, col: meta.col, x: meta.x, y: meta.y, status: meta.status, maskCanvas });
      }
      undoRef.current = {};
      setProjectId(project.projectId);
      setImg1({ el: i1el, width: i1el.naturalWidth, height: i1el.naturalHeight, path: project.img1Path });
      setImg2({ el: i2el, width: i2el.naturalWidth, height: i2el.naturalHeight, path: project.img2Path });
      const { tiles: repaired, fixed } = repairFalseLabels(reconstructed);
      setTileSize(project.tileSize); setStride(project.stride);
      setTiles(repaired); setCurIdx(0);
      setZoom(1); setPanX(0); setPanY(0);
      setStage("labeling");
      if (fixed) await message(
        `${fixed} tile berstatus "Berubah" ternyata tidak punya mask (sisa bug eraser versi lama) ` +
        `dan dikembalikan ke "Belum". Simpan project untuk menyimpan perbaikan ini.`,
        { title: "Perbaikan data", kind: "info" });
    } catch (e) { await message("Gagal buka project: " + String(e), { title: "Error", kind: "error" }); }
    setLoading(false);
  };

  // ── Import Exported ZIP
  const importExportedZip = async () => {
    const path = await dialogOpen({ title: "Import Export ZIP", filters: [{ name: "ZIP Archive", extensions: ["zip"] }], multiple: false });
    if (!path) return;
    setLoading(true);
    try {
      const bytes = await invoke("read_file_bytes", { path });
      let zip;
      try { zip = await JSZip.loadAsync(new Uint8Array(bytes)); }
      catch { throw new Error("File tidak bisa dibaca sebagai arsip ZIP (mungkin rusak)."); }
      const manifestFile = zip.file("manifest.json");
      if (!manifestFile) {
        await message("File ZIP ini tidak memiliki manifest.json.\nHanya ZIP hasil export versi terbaru yang bisa diimport.", { title: "Error", kind: "error" });
        setLoading(false); return;
      }
      let manifest;
      try { manifest = JSON.parse(await manifestFile.async("string")); }
      catch { throw new Error("'manifest.json' rusak / tidak bisa dibaca."); }
      if (!Array.isArray(manifest.tiles) || !manifest.img1Path || !manifest.img2Path) {
        throw new Error("Struktur manifest.json tidak lengkap (tiles / img1Path / img2Path hilang).");
      }
      const missing = [];
      if (!(await pathExists(manifest.img1Path))) missing.push("• Before (T1): " + manifest.img1Path);
      if (!(await pathExists(manifest.img2Path))) missing.push("• After (T2): " + manifest.img2Path);
      if (missing.length) {
        throw new Error("Citra asli tidak ditemukan di lokasi semula:\n\n" + missing.join("\n") +
          "\n\nKembalikan file citra ke lokasi tersebut lalu coba lagi.");
      }
      const [i1b64, i2b64] = await Promise.all([
        invoke("load_image_as_png_b64", { path: manifest.img1Path }),
        invoke("load_image_as_png_b64", { path: manifest.img2Path }),
      ]);
      const [i1el, i2el] = await Promise.all([imageFromB64(i1b64), imageFromB64(i2b64)]);
      const reconstructed = [];
      for (const meta of manifest.tiles) {
        let maskCanvas = null;
        if (meta.status === "labeled") {
          const maskFile = zip.file(`masks/tile_r${meta.row}_c${meta.col}.png`);
          if (maskFile) {
            const maskEl = await imageFromB64(await maskFile.async("base64"));
            maskCanvas = document.createElement("canvas");
            maskCanvas.width = manifest.tileSize; maskCanvas.height = manifest.tileSize;
            const ctx = maskCanvas.getContext("2d");
            ctx.drawImage(maskEl, 0, 0);
            const imgData = ctx.getImageData(0, 0, manifest.tileSize, manifest.tileSize);
            for (let i = 0; i < imgData.data.length; i += 4) {
              const white = imgData.data[i] > 128;
              imgData.data[i] = white ? 255 : 0; imgData.data[i+1] = white ? 50 : 0;
              imgData.data[i+2] = white ? 50 : 0; imgData.data[i+3] = white ? 255 : 0;
            }
            ctx.putImageData(imgData, 0, 0);
          }
        }
        reconstructed.push({ id: meta.id, row: meta.row, col: meta.col, x: meta.x, y: meta.y, status: meta.status, maskCanvas });
      }
      undoRef.current = {};
      setProjectId(manifest.projectId);
      setImg1({ el: i1el, width: i1el.naturalWidth, height: i1el.naturalHeight, path: manifest.img1Path });
      setImg2({ el: i2el, width: i2el.naturalWidth, height: i2el.naturalHeight, path: manifest.img2Path });
      const { tiles: repaired, fixed } = repairFalseLabels(reconstructed);
      setTileSize(manifest.tileSize); setStride(manifest.stride);
      setTiles(repaired); setCurIdx(0);
      setZoom(1); setPanX(0); setPanY(0);
      setStage("labeling");
      if (fixed) await message(
        `${fixed} tile berstatus "Berubah" di ZIP ini mask-nya kosong (sisa bug eraser versi lama) ` +
        `dan dikembalikan ke "Belum". Export ulang agar dataset bersih.`,
        { title: "Perbaikan data", kind: "info" });
    } catch (e) { await message("Gagal import ZIP: " + String(e), { title: "Error", kind: "error" }); }
    setLoading(false);
  };

  // ── Quality Control: open an exported ZIP and review samples
  const openQC = async () => {
    const path = await dialogOpen({ title: "Buka Hasil Export untuk QC", filters: [{ name: "ZIP Archive", extensions: ["zip"] }], multiple: false });
    if (!path) return;
    setLoading(true); setQcProg(0);
    try {
      const bytes = await invoke("read_file_bytes", { path });
      let zip;
      try { zip = await JSZip.loadAsync(new Uint8Array(bytes)); }
      catch { throw new Error("File tidak bisa dibaca sebagai arsip ZIP (mungkin rusak)."); }

      // Tolerant reader: handle ZIPs where files are nested under a top folder,
      // have different path separators/casing, or have NO manifest.json at all.
      const norm = n => n.replace(/\\/g, "/");
      const byLower = {}; // lowercased path -> actual entry name
      for (const n of Object.keys(zip.files)) if (!zip.files[n].dir) byLower[norm(n).toLowerCase()] = n;
      const getEntry = p => byLower[p.toLowerCase()];

      // Locate manifest.json at any depth and derive the folder prefix from it.
      let prefix = "";
      let manifest = null;
      const manifestKey = Object.keys(byLower).find(k => k.endsWith("manifest.json"));
      if (manifestKey) {
        prefix = manifestKey.slice(0, manifestKey.length - "manifest.json".length); // "" or "sub/"
        try { manifest = JSON.parse(await zip.file(byLower[manifestKey]).async("string")); } catch { manifest = null; }
      }

      // Find all before/*.png under the prefix (works even without a manifest).
      const beforePrefix = (prefix + "before/").toLowerCase();
      let beforeKeys = Object.keys(byLower).filter(k => k.startsWith(beforePrefix) && k.endsWith(".png"));
      // If prefix guess found nothing, fall back to any "before/" folder in the zip.
      if (!beforeKeys.length) {
        const anyBefore = Object.keys(byLower).find(k => k.includes("/before/") || k.startsWith("before/"));
        if (anyBefore) {
          const idx = anyBefore.indexOf("before/");
          prefix = anyBefore.slice(0, idx);
          beforeKeys = Object.keys(byLower).filter(k => k.startsWith((prefix + "before/").toLowerCase()) && k.endsWith(".png"));
        }
      }
      if (!beforeKeys.length) {
        throw new Error("ZIP ini tidak berisi folder before/after/masks hasil export aplikasi ini, jadi tidak bisa di-QC.");
      }

      // Status/row/col from manifest if available, keyed by filename.
      const metaByName = {};
      if (manifest && Array.isArray(manifest.tiles)) {
        for (const t of manifest.tiles) metaByName[`tile_r${t.row}_c${t.col}.png`] = t;
      }
      const parseRC = name => {
        const m = /tile_r(\d+)_c(\d+)\.png$/i.exec(name);
        return m ? { row: +m[1], col: +m[2] } : { row: 0, col: 0 };
      };

      const samples = [];
      for (let i = 0; i < beforeKeys.length; i++) {
        const bActual = byLower[beforeKeys[i]];
        const name = bActual.slice(prefix.length + "before/".length); // filename, original case
        const aEntry = getEntry(prefix + "after/" + name);
        const mEntry = getEntry(prefix + "masks/" + name);
        if (!aEntry) continue; // need a matching after/ image
        const meta = metaByName[name] || parseRC(name);
        const row = meta.row ?? 0, col = meta.col ?? 0;
        const status = meta.status || "labeled";
        const beforeUrl = "data:image/png;base64," + await zip.file(bActual).async("base64");
        const afterUrl  = "data:image/png;base64," + await zip.file(aEntry).async("base64");
        const maskUrl   = mEntry ? "data:image/png;base64," + await zip.file(mEntry).async("base64") : null;
        samples.push({ id: meta.id || `${row}_${col}`, row, col, status, name, beforeUrl, afterUrl, maskUrl });
        if (i % 5 === 0) { setQcProg(Math.round((i + 1) / beforeKeys.length * 100)); await sleep(0); }
      }
      if (!samples.length) throw new Error("Tidak ada pasangan before/after yang cocok ditemukan di dalam ZIP.");

      setQcManifest(manifest);
      setQcSamples(samples);
      setQcSource({ type: "zip" });
      setQcHardDelete(false);
      setQcIndex(0);
      setStage("qc");
    } catch (e) { await message("Gagal membuka untuk QC: " + String(e), { title: "Error", kind: "error" }); }
    setLoading(false);
  };

  // ── Quality Control: open a loose folder (before/ after/ masks/) for review
  const openQCFolder = async () => {
    const dir = await dialogOpen({ title: "Pilih folder dataset (berisi before/ after/ masks/)", directory: true, multiple: false });
    if (!dir) return;
    setLoading(true); setQcProg(0);
    try {
      const sep = dir.includes("\\") ? "\\" : "/";
      const join = (...p) => p.join(sep);

      // Allow the user to pick either the dataset root, or the before/ folder itself.
      let root = dir;
      if (!(await pathExists(join(root, "before")))) {
        const base = dir.replace(/[\\/]+$/, "");
        const leaf = base.split(/[\\/]/).pop().toLowerCase();
        if (leaf === "before" || leaf === "after" || leaf === "masks") {
          root = base.slice(0, base.length - leaf.length).replace(/[\\/]+$/, "");
        }
      }
      const beforeDir = join(root, "before");
      const afterDir  = join(root, "after");
      const masksDir  = join(root, "masks");
      if (!(await pathExists(beforeDir)) || !(await pathExists(afterDir))) {
        throw new Error("Folder yang dipilih tidak berisi sub-folder 'before' dan 'after'.\nPilih folder dataset hasil export (yang di dalamnya ada before/ after/ masks/).");
      }

      let beforeFiles;
      try { beforeFiles = await invoke("list_dir", { path: beforeDir }); }
      catch (e) { throw new Error("Tidak bisa membaca folder before: " + String(e)); }
      beforeFiles = beforeFiles.filter(n => n.toLowerCase().endsWith(".png"));
      if (!beforeFiles.length) throw new Error("Folder 'before' tidak berisi file .png.");

      // Optional manifest in the folder root for status/row/col.
      let manifest = null;
      if (await pathExists(join(root, "manifest.json"))) {
        try {
          const mb = await invoke("read_file_bytes", { path: join(root, "manifest.json") });
          manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(mb)));
        } catch { manifest = null; }
      }
      const metaByName = {};
      if (manifest && Array.isArray(manifest.tiles)) {
        for (const t of manifest.tiles) metaByName[`tile_r${t.row}_c${t.col}.png`] = t;
      }
      const parseRC = name => {
        const m = /tile_r(\d+)_c(\d+)\.png$/i.exec(name);
        return m ? { row: +m[1], col: +m[2] } : { row: 0, col: 0 };
      };

      const samples = [];
      for (let i = 0; i < beforeFiles.length; i++) {
        const name = beforeFiles[i];
        if (!(await pathExists(join(afterDir, name)))) continue; // need matching after image
        const hasMask = await pathExists(join(masksDir, name));
        const beforeUrl = "data:image/png;base64," + await invoke("load_image_as_png_b64", { path: join(beforeDir, name) });
        const afterUrl  = "data:image/png;base64," + await invoke("load_image_as_png_b64", { path: join(afterDir, name) });
        const maskUrl   = hasMask ? "data:image/png;base64," + await invoke("load_image_as_png_b64", { path: join(masksDir, name) }) : null;
        const meta = metaByName[name] || parseRC(name);
        const row = meta.row ?? 0, col = meta.col ?? 0;
        samples.push({ id: meta.id || `${row}_${col}`, row, col, status: meta.status || "labeled", name, beforeUrl, afterUrl, maskUrl });
        setQcProg(Math.round((i + 1) / beforeFiles.length * 100));
        if (i % 3 === 0) await sleep(0);
      }
      if (!samples.length) throw new Error("Tidak ada pasangan before/after yang cocok di folder ini.");

      setQcManifest(manifest);
      setQcSamples(samples);
      setQcSource({ type: "folder", root, sep });
      setQcHardDelete(false);
      setQcIndex(0);
      setStage("qc");
    } catch (e) { await message("Gagal membuka folder untuk QC: " + String(e), { title: "Error", kind: "error" }); }
    setLoading(false);
  };

  // Remove a sample from the QC review set. In folder mode with "hard delete" on,
  // the before/after/mask files are also removed from disk immediately (permanent).
  const deleteQCSample = async (id) => {
    if (qcHardDelete && qcSource?.type === "folder") {
      const s = qcSamples.find(x => x.id === id);
      if (s) {
        const join = (...p) => p.join(qcSource.sep);
        try {
          await invoke("delete_file", { path: join(qcSource.root, "before", s.name) });
          await invoke("delete_file", { path: join(qcSource.root, "after",  s.name) });
          await invoke("delete_file", { path: join(qcSource.root, "masks",  s.name) });
        } catch (e) {
          await message("Gagal menghapus file dari disk: " + String(e), { title: "Error", kind: "error" });
          return; // keep the sample in the list if delete failed
        }
      }
    }
    const newLen = qcSamples.length - 1;
    setQcSamples(prev => prev.filter(s => s.id !== id));
    setQcIndex(i => Math.max(0, Math.min(i, newLen - 1)));
  };

  // Save the cleaned dataset (kept samples only) to a folder — NOT a zip.
  const saveCleanDataset = async () => {
    if (!qcSamples.length) { await message("Tidak ada sample tersisa untuk disimpan.", { title: "QC", kind: "warning" }); return; }
    const dir = await dialogOpen({ title: "Pilih folder untuk menyimpan dataset bersih", directory: true, multiple: false });
    if (!dir) return;
    setQcSaving(true); setQcProg(0);
    try {
      const sep = dir.includes("\\") ? "\\" : "/";
      const join = (...p) => p.join(sep);
      const b64ToBytes = (dataUrl) => {
        const b64 = dataUrl.split(",")[1];
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      };
      for (let i = 0; i < qcSamples.length; i++) {
        const s = qcSamples[i];
        await invoke("save_bytes_to_path", { path: join(dir, "before", s.name), data: Array.from(b64ToBytes(s.beforeUrl)) });
        await invoke("save_bytes_to_path", { path: join(dir, "after",  s.name), data: Array.from(b64ToBytes(s.afterUrl)) });
        if (s.maskUrl) await invoke("save_bytes_to_path", { path: join(dir, "masks", s.name), data: Array.from(b64ToBytes(s.maskUrl)) });
        setQcProg(Math.round((i + 1) / qcSamples.length * 100));
        if (i % 5 === 0) await sleep(0);
      }
      // Write an updated manifest reflecting only the kept samples.
      const keptIds = new Set(qcSamples.map(s => s.id));
      const cleanTiles = (qcManifest?.tiles && qcManifest.tiles.length)
        ? qcManifest.tiles.filter(t => keptIds.has(t.id ?? `${t.row}_${t.col}`))
        : qcSamples.map(s => ({ id: s.id, row: s.row, col: s.col, status: s.status }));
      const cleanManifest = {
        ...(qcManifest || {}),
        version: qcManifest?.version ?? 1,
        cleanedAt: new Date().toISOString(),
        tiles: cleanTiles,
        sampleCount: qcSamples.length,
      };
      await invoke("save_bytes_to_path", { path: join(dir, "manifest.json"), data: Array.from(new TextEncoder().encode(JSON.stringify(cleanManifest, null, 2))) });
      await message(`Dataset bersih (${qcSamples.length} sample) disimpan ke:\n${dir}\n\nStruktur: before/ · after/ · masks/ · manifest.json`, { title: "✓ QC Selesai", kind: "info" });
    } catch (e) { await message("Gagal menyimpan dataset bersih: " + String(e), { title: "Error", kind: "error" }); }
    setQcSaving(false);
  };

  // ── Stats
  const stats = {
    total:     tiles.length,
    labeled:   tiles.filter(t => t.status === "labeled").length,
    no_change: tiles.filter(t => t.status === "no_change").length,
    skipped:   tiles.filter(t => t.status === "skipped").length,
    pending:   tiles.filter(t => t.status === "pending").length,
  };
  const done = stats.labeled + stats.no_change;
  const tile = tiles[curIdx];
  const showBrushCursor = cursorVisible && !spaceDown && tool !== "polygon";
  const showPolyCursor  = cursorVisible && !spaceDown && tool === "polygon";

  // ── Theme toggle button style
  const themeToggleStyle = {
    background: th.cardBg,
    border: `1px solid ${th.border}`,
    color: th.textMuted,
    borderRadius: 6,
    padding: "3px 10px",
    fontSize: 13,
    cursor: "pointer",
    lineHeight: 1.4,
    flexShrink: 0,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: "100vh", background: th.appBg, color: th.text,
      fontFamily: "'IBM Plex Mono', monospace", display: "flex", flexDirection: "column", userSelect: "none" }}
      onMouseDown={keepShortcutFocus} onMouseUp={releaseSliderFocus}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&family=Barlow+Condensed:wght@600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: ${th.scrollTrack}; }
        ::-webkit-scrollbar-thumb { background: ${th.scrollThumb}; border-radius: 3px; }
        input[type=range] { accent-color: #f59e0b; cursor: pointer; }
      `}</style>

      {/* ── TOP BAR */}
      <div style={{ background: th.barBg, borderBottom: `1px solid ${th.border}`, padding: "0 16px",
        height: 42, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 19, fontWeight: 800, color: "#f59e0b", letterSpacing: 1 }}>
          LANDCHANGE<span style={{ color: "#4a9eff" }}>·LAB</span>
        </span>

        {stage === "labeling" && (
          <>
            <span style={{ color: th.border }}>│</span>
            <span style={{ fontSize: 11, color: th.textMuted }}>
              Tile <span style={{ color: th.text }}>{curIdx + 1}/{tiles.length}</span>
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              {Object.keys(STATUS_LABEL).map(k => stats[k] > 0 && (
                <span key={k} style={{ fontSize: 10, color: STATUS_COLOR[k] }}>
                  {STATUS_LABEL[k]}: <strong>{stats[k]}</strong>
                </span>
              ))}
            </div>
            <div style={{ marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setZoom(z => clamp(z / 1.2, 0.5, 10))} style={iconBtn}>−</button>
              <span style={{ fontSize: 10, color: th.textMuted, minWidth: 38, textAlign: "center" }}>
                {Math.round(zoom * 100)}%
              </span>
              <button onClick={() => setZoom(z => clamp(z * 1.2, 0.5, 10))} style={iconBtn}>+</button>
              <button onClick={resetZoom} style={{ ...iconBtn, fontSize: 9 }}>FIT</button>
            </div>
            {projectId && (
              <span style={{ fontSize: 9, color: th.textTiny, marginLeft: 4 }}>
                ID: {projectId.slice(0, 8)}
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 9, color: th.textTiny }}>
              [A/D] nav · [B/E/P] tool · [1-3] mode · [,/.] swipe · [F] fill · [C] clear · [Ctrl+Z] undo
            </span>
            <button onClick={() => setStage("setup")} style={smBtn(th.cardBgAlt, th.textMuted)}>← Setup</button>
          </>
        )}

        {/* Theme toggle — always visible */}
        <div style={{ marginLeft: stage === "labeling" ? 0 : "auto" }}>
          <button onClick={() => setDarkMode(d => !d)} style={themeToggleStyle} title="Ganti tema">
            {darkMode ? "☀ Terang" : "☾ Gelap"}
          </button>
        </div>
      </div>

      {/* ══ SETUP ════════════════════════════════════════════════════════════════ */}
      {stage === "setup" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, overflow: "auto" }}>
          <div style={{ width: "100%", maxWidth: 660 }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontFamily: "'Barlow Condensed'", fontSize: 13, color: th.textFaint, letterSpacing: 4, textTransform: "uppercase" }}>
                Upload Citra Multitemporal
              </div>
              <div style={{ fontSize: 11, color: th.textTiny, marginTop: 4 }}>
                Mendukung GeoTIFF · TIFF · PNG · JPG — dibaca langsung dari disk
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 10, color: "#4a9eff", letterSpacing: 2, marginBottom: 6 }}>▶ BEFORE (T1)</div>
                <PickZone label="Citra T1 (Before)" tag="T1" image={img1} onImage={setImg1} th={th} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#f59e0b", letterSpacing: 2, marginBottom: 6 }}>▶ AFTER (T2)</div>
                <PickZone label="Citra T2 (After)" tag="T2" image={img2} onImage={setImg2} th={th} />
              </div>
            </div>

            <div style={{ background: th.cardBgAlt, border: `1px solid ${th.border}`, borderRadius: 10, padding: 18, marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: th.textFaint, letterSpacing: 2, marginBottom: 14 }}>▶ SLIDING WINDOW PARAMETER</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 10, color: th.textMid, marginBottom: 7 }}>TILE SIZE (px)</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {[128, 256, 512].map(v => (
                      <button key={v} onClick={() => setTileSize(v)} style={{
                        padding: "5px 13px", borderRadius: 5, fontSize: 12, cursor: "pointer",
                        border: `1px solid ${tileSize === v ? th.tileSizeActiveBorder : th.tileSizeIdleBorder}`,
                        background: tileSize === v ? th.tileSizeActiveBg : th.tileSizeIdleBg,
                        color: tileSize === v ? th.tileSizeActiveColor : th.tileSizeIdleColor,
                      }}>{v}</button>
                    ))}
                    <input type="number" value={tileSize} onChange={e => setTileSize(+e.target.value)} min={32} max={2048}
                      style={{ width: 70, background: th.cardBg, border: `1px solid ${th.inputBorder}`, color: th.text, borderRadius: 5, padding: "5px 8px", fontSize: 12 }} />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: th.textMid, marginBottom: 7 }}>
                    STRIDE — <span style={{ color: th.text }}>overlap: {Math.max(0, tileSize - stride)}px</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="range" min={16} max={tileSize} value={stride} onChange={e => setStride(+e.target.value)} style={{ flex: 1 }} />
                    <span style={{ color: "#f59e0b", minWidth: 40, fontSize: 13 }}>{stride}px</span>
                  </div>
                </div>
                {img1 && img2 && (() => {
                  const w = Math.min(img1.width, img2.width), h = Math.min(img1.height, img2.height);
                  const c = Math.max(1, Math.floor((w - tileSize) / stride) + 1);
                  const r = Math.max(1, Math.floor((h - tileSize) / stride) + 1);
                  return (
                    <div style={{ fontSize: 11, color: th.textFaint, textAlign: "right" }}>
                      <span style={{ color: "#4a9eff", fontSize: 14 }}>{c * r}</span> tiles ({c}×{r})
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button onClick={loadProject} disabled={loading}
                style={{ flex: 1, padding: 10, borderRadius: 7, border: `1px solid ${th.border}`, background: th.cardBg,
                  color: th.textMid, cursor: "pointer", fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1 }}>
                {loading ? "MEMBUKA…" : "📂 BUKA PROJECT (.lcproject)"}
              </button>
              <button onClick={importExportedZip} disabled={loading}
                style={{ flex: 1, padding: 10, borderRadius: 7, border: `1px solid ${th.border}`, background: th.cardBg,
                  color: th.textMid, cursor: "pointer", fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1 }}>
                {loading ? "MEMBUKA…" : "📦 IMPORT EXPORT (lanjut label)"}
              </button>
            </div>

            <div style={{ fontSize: 9, color: th.textFaint, letterSpacing: 1.5, marginBottom: 6 }}>
              ▶ QUALITY CONTROL — review & hapus sample tak relevan
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button onClick={openQC} disabled={loading}
                style={{ flex: 1, padding: 10, borderRadius: 7,
                  border: `1px solid #a855f755`, background: darkMode ? "#1a0f2a" : "#faf5ff",
                  color: "#a855f7", cursor: "pointer", fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1 }}>
                {loading ? "MEMBUKA…" : "🔍 QC dari ZIP"}
              </button>
              <button onClick={openQCFolder} disabled={loading}
                style={{ flex: 1, padding: 10, borderRadius: 7,
                  border: `1px solid #a855f755`, background: darkMode ? "#1a0f2a" : "#faf5ff",
                  color: "#a855f7", cursor: "pointer", fontSize: 12, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1 }}>
                {loading ? "MEMBUKA…" : "📁 QC dari Folder (before/after/masks)"}
              </button>
            </div>

            <button onClick={generateTiles} disabled={!img1 || !img2 || generating}
              style={{
                width: "100%", padding: 13, borderRadius: 8, border: "none",
                cursor: !img1 || !img2 ? "not-allowed" : "pointer",
                background: !img1 || !img2 ? th.cardBg : generating ? "#0a2a1a" : "linear-gradient(135deg, #166534, #22c55e)",
                color: !img1 || !img2 ? th.textTiny : "#fff",
                fontFamily: "'Barlow Condensed'", fontSize: 15, fontWeight: 700, letterSpacing: 2,
              }}>
              {generating ? `GENERATING… ${genProg}%` : "▶ MULAI LABELING"}
            </button>
          </div>
        </div>
      )}

      {/* ══ LABELING ══════════════════════════════════════════════════════════════ */}
      {stage === "labeling" && tile && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* LEFT: Tile list */}
          <div style={{ width: 158, background: th.barBg, borderRight: `1px solid ${th.border}`,
            display: "flex", flexDirection: "column", flexShrink: 0 }}>
            <div style={{ padding: "7px 10px", fontSize: 10, color: th.textFaint, letterSpacing: 1,
              borderBottom: `1px solid ${th.border}`, flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>TILES ({tiles.length})</span>
              <button onClick={goToNextPending} title="Jump to next pending [J]"
                style={{ ...smBtn(th.cardBg, "#f59e0b"), padding: "1px 6px", fontSize: 9 }}>→ pending</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1 }}>
              {tiles.map((t, i) => (
                <div key={t.id} onClick={() => goTo(i)}
                  style={{
                    padding: "5px 8px", cursor: "pointer",
                    background: i === curIdx ? th.tileActive : "transparent",
                    borderLeft: `3px solid ${i === curIdx ? th.tileActiveBorder : STATUS_COLOR[t.status] + "55"}`,
                    borderBottom: `1px solid ${th.tileBorder}`,
                    display: "flex", alignItems: "center", gap: 6, transition: "background .1s",
                  }}
                  onMouseEnter={e => { if (i !== curIdx) e.currentTarget.style.background = th.tileHover; }}
                  onMouseLeave={e => { if (i !== curIdx) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ width: 40, height: 28, background: th.cardBg, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
                    {img1 && <TileThumbnail img={img1.el} x={t.x} y={t.y} size={tileSize} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: i === curIdx ? th.text : th.textMid }}>r{t.row} c{t.col}</div>
                    <div style={{ fontSize: 9, color: STATUS_COLOR[t.status] }}>{STATUS_LABEL[t.status]}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CENTER: Canvas area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            {/* Top toolbar — isinya statis (tidak ada elemen yang muncul/hilang sesuai
                tool/mode) agar tingginya konstan dan canvas tidak bergeser saat digitasi. */}
            <div style={{ background: th.barBg, borderBottom: `1px solid ${th.border}`, padding: "5px 10px",
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
              {[["brush","✏ Brush","B"],["eraser","◻ Eraser","E"],["polygon","⬡ Polygon","P"]].map(([t, label, k]) => (
                <button key={t} onClick={() => setTool(t)} style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                  border: `1px solid ${tool === t ? "#f59e0b" : th.border}`,
                  background: tool === t ? (darkMode ? "#2a1f0a" : "#fef3c7") : th.cardBgAlt,
                  color: tool === t ? "#f59e0b" : th.textMid,
                }}>{label} <span style={{ fontSize: 9, opacity: 0.4 }}>[{k}]</span></button>
              ))}
              <div style={{ width: 1, background: th.border, height: 18, margin: "0 4px" }} />
              <button onClick={undo} style={tbBtn(darkMode ? "#1e3a5f" : th.cardBgAlt, th.textMuted)}>↩ Undo [Ctrl+Z]</button>
              <button onClick={fillAll} style={tbBtn(darkMode ? "#2a1f0a" : "#fff7ed","#fb923c")}>⬛ Fill [F]</button>
              <button onClick={clearMask} style={tbBtn(darkMode ? "#2a1515" : "#fef2f2","#ef4444")}>✕ Clear [C]</button>
              <div style={{ width: 1, background: th.border, height: 18, margin: "0 4px" }} />
              <button onClick={() => markStatus("no_change")} style={tbBtn(darkMode ? "#0f1f3a" : "#eff6ff","#3b82f6")}>◎ No Change [N]</button>
              <button onClick={confirmNext} title="Konfirmasi & lanjut [Enter]" style={tbBtn(darkMode ? "#0f2a1a" : "#f0fdf4","#22c55e")}>✓ Confirm [↵]</button>
              <button onClick={() => markStatus("skipped")} style={tbBtn(darkMode ? "#2a200a" : "#fffbeb","#f59e0b")}>⋯ Skip [S]</button>
              <div style={{ width: 1, background: th.border, height: 18, margin: "0 4px" }} />
              <button onClick={() => goTo(curIdx - 1)} disabled={curIdx === 0} style={tbBtn(th.cardBgAlt, curIdx === 0 ? th.textTiny : th.textMuted)}>← [A]</button>
              <button onClick={() => goTo(curIdx + 1)} disabled={curIdx >= tiles.length - 1} style={tbBtn(th.cardBgAlt, curIdx >= tiles.length - 1 ? th.textTiny : th.textMuted)}>→ [D]</button>
              <button onClick={goToNextPending} title="Lompat ke tile berikutnya yang belum dilabeli" style={tbBtn(darkMode ? "#2a1f0a" : "#fffbeb","#f59e0b")}>⟶ Pending [J]</button>
            </div>

            {/* Canvas wrapper */}
            <div
              ref={canvasWrapRef}
              style={{
                flex: 1, position: "relative", overflow: "hidden",
                cursor: spaceDown ? (isPanning ? "grabbing" : "grab") : tool === "polygon" ? "crosshair" : "none",
                background: th.canvasBg,
              }}
              onWheel={onWheel}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseLeave}
              onMouseEnter={onCanvasMouseEnter}
              onDoubleClick={onCanvasDblClick}
            >
              <div style={{
                position: "absolute", left: 0, top: 0,
                transformOrigin: "0 0",
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                width: DISPLAY, height: DISPLAY,
                boxShadow: darkMode ? "0 0 0 1px #1a2a44, 0 4px 32px #000a" : "0 0 0 1px #d1dce8, 0 4px 20px #0002",
              }}>
                <canvas ref={dispRef} width={DISPLAY} height={DISPLAY} style={{ position: "absolute", inset: 0, display: "block" }} />
                <canvas ref={maskRef} width={DISPLAY} height={DISPLAY} style={{ position: "absolute", inset: 0, display: "block" }} />
                <canvas ref={polyRef} width={DISPLAY} height={DISPLAY} style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }} />
              </div>

              {showBrushCursor && (
                <div style={{
                  position: "absolute",
                  width: brushSize * zoom, height: brushSize * zoom,
                  borderRadius: "50%",
                  border: `1.5px solid ${tool === "brush" ? "#ff3232cc" : "#4a9effcc"}`,
                  background: tool === "brush" ? "#ff323218" : "#4a9eff18",
                  pointerEvents: "none",
                  transform: "translate(-50%, -50%)",
                  left: cursorPos.x, top: cursorPos.y,
                  transition: "width .08s, height .08s",
                }} />
              )}
              {showPolyCursor && (
                <div style={{ position: "absolute", pointerEvents: "none", left: cursorPos.x, top: cursorPos.y, transform: "translate(-50%, -50%)", width: 16, height: 16 }}>
                  <div style={{ position: "absolute", left: 7, top: 0, width: 2, height: 16, background: "#ff3232cc" }} />
                  <div style={{ position: "absolute", top: 7, left: 0, width: 16, height: 2, background: "#ff3232cc" }} />
                </div>
              )}

              <div style={{ position: "absolute", bottom: 10, right: 10, background: th.overlayBg,
                padding: "3px 8px", borderRadius: 4, fontSize: 10, color: STATUS_COLOR[tile.status],
                border: `1px solid ${STATUS_COLOR[tile.status]}44`, pointerEvents: "none" }}>
                {STATUS_LABEL[tile.status]}
              </div>
              <div style={{ position: "absolute", bottom: 10, left: 10, background: th.overlayBg,
                padding: "3px 8px", borderRadius: 4, fontSize: 9, color: th.textMuted, pointerEvents: "none" }}>
                r{tile.row} · c{tile.col} · @{tile.x},{tile.y} · {Math.round(zoom * 100)}%
              </div>
              {zoom <= 1.05 && (
                <div style={{ position: "absolute", top: 10, right: 10, background: th.overlayBg,
                  padding: "3px 8px", borderRadius: 4, fontSize: 9, color: th.textMid3, pointerEvents: "none" }}>
                  Scroll to zoom · Space+drag to pan
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Tools panel */}
          <div style={{ width: 195, background: th.barBg, borderLeft: `1px solid ${th.border}`,
            padding: 14, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", flexShrink: 0 }}>

            <div>
              <div style={panelLabel}>VIEW</div>
              <div style={{ display: "flex", gap: 4 }}>
                {VIEW_MODES.map(([m, icon, label, k]) => (
                  <button key={m} onClick={() => setMode(m)} title={`${label} [${k}]`} style={{
                    flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 10, cursor: "pointer",
                    border: `1px solid ${mode === m ? "#4a9eff" : th.border}`,
                    background: mode === m ? (darkMode ? "#0d2a4a" : "#dbeafe") : th.cardBgAlt,
                    color: mode === m ? "#4a9eff" : th.textMid,
                  }}>{icon} {label}</button>
                ))}
              </div>
              {/* Tinggi tetap: berganti mode tidak menggeser panel di bawahnya. */}
              <div style={{ height: 40, marginTop: 8 }}>
                {mode === "swipe" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: "#4a9eff" }}>T1</span>
                      <input type="range" min={0} max={100} value={swipeX}
                        onChange={e => setSwipeX(+e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                      <span style={{ fontSize: 9, color: "#f59e0b" }}>T2</span>
                    </div>
                    <div style={{ fontSize: 9, color: th.textFaint, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                      <span>{swipeX}%</span><span>[,] [.] geser</span>
                    </div>
                  </>
                )}
                {mode === "flicker" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: th.textFaint }}>Cepat</span>
                      <input type="range" min={200} max={1500} value={flickerSpeed}
                        onChange={e => setFlickerSpeed(+e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                      <span style={{ fontSize: 9, color: th.textFaint }}>Lambat</span>
                    </div>
                    <div style={{ fontSize: 9, color: th.textFaint, marginTop: 4 }}>
                      Ganti citra tiap {flickerSpeed} ms
                    </div>
                  </>
                )}
              </div>
            </div>

            {img1 && img2 && (
              <div>
                <div style={panelLabel}>INDEX VIEW</div>
                <IndexMap
                  img={img1.el}
                  imgW={Math.min(img1.width, img2.width)}
                  imgH={Math.min(img1.height, img2.height)}
                  tiles={tiles} curIdx={curIdx} tileSize={tileSize} stride={stride}
                  onPick={goTo} th={th} />
              </div>
            )}

            {tool !== "polygon" && (
              <div>
                <div style={panelLabel}>BRUSH SIZE — <span style={{ color: th.text }}>{brushSize}px</span></div>
                <input type="range" min={4} max={120} value={brushSize} onChange={e => setBrushSize(+e.target.value)} style={{ width: "100%" }} />
                <div style={{ fontSize: 9, color: th.textFaint, marginTop: 3 }}>[  ] / []  to adjust</div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                  <div style={{
                    width: Math.min(brushSize * zoom, 56), height: Math.min(brushSize * zoom, 56),
                    borderRadius: "50%", transition: "all .15s",
                    background: tool === "brush" ? "#ff323255" : "#4a9eff22",
                    border: `1.5px solid ${tool === "brush" ? "#ff3232" : "#4a9eff"}`,
                    maxWidth: 56, maxHeight: 56,
                  }} />
                </div>
              </div>
            )}

            {tool === "polygon" && (
              <div style={{ background: th.cardBgAlt, borderRadius: 6, padding: 10, border: `1px solid #f59e0b44` }}>
                <div style={{ fontSize: 9, color: "#f59e0b", letterSpacing: 1, marginBottom: 6 }}>⬡ POLYGON TOOL</div>
                <div style={{ fontSize: 9, color: th.textMid, lineHeight: 1.8 }}>
                  • Klik untuk tambah titik<br/>
                  • Klik titik pertama atau tekan <strong style={{ color: th.text }}>Enter</strong> untuk selesai<br/>
                  • <strong style={{ color: th.text }}>Esc</strong> untuk membatalkan<br/>
                  • Ganti ke Eraser untuk hapus area<br/>
                  • {polygonPoints.length} titik aktif
                </div>
                {polygonPoints.length >= 3 && (
                  <button onClick={finishPolygon} style={{ ...smBtn(darkMode ? "#2a1f0a" : "#fef3c7", "#f59e0b"), width: "100%", marginTop: 8, textAlign: "center" }}>
                    ✓ Selesaikan Polygon
                  </button>
                )}
                {polygonPoints.length > 0 && (
                  <button onClick={() => { setPolygonPoints([]); polygonPointsRef.current = []; if (polyRef.current) polyRef.current.getContext("2d").clearRect(0, 0, DISPLAY, DISPLAY); }}
                    style={{ ...smBtn(darkMode ? "#2a1515" : "#fef2f2", "#ef4444"), width: "100%", marginTop: 4, textAlign: "center" }}>
                    ✕ Batal
                  </button>
                )}
              </div>
            )}

            <div>
              <div style={panelLabel}>MASK OPACITY — <span style={{ color: th.text }}>{Math.round(maskOpacity * 100)}%</span></div>
              <input type="range" min={10} max={100} value={maskOpacity * 100}
                onChange={e => setMaskOpacity(+e.target.value / 100)} style={{ width: "100%" }} />
            </div>

            <div style={{ background: th.cardBgAlt, borderRadius: 6, padding: 10, border: `1px solid ${th.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={panelLabel}>AUTO SKIP TO PENDING</div>
                <button onClick={() => setAutoAdvance(v => !v)} style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                  border: `1px solid ${autoAdvance ? "#22c55e55" : th.border}`,
                  background: autoAdvance ? (darkMode ? "#0f2a1a" : "#f0fdf4") : th.cardBg,
                  color: autoAdvance ? "#22c55e" : th.textMuted,
                }}>{autoAdvance ? "ON" : "OFF"}</button>
              </div>
              <div style={{ fontSize: 9, color: th.textFaint, marginTop: 4, lineHeight: 1.6 }}>
                Setelah N/Enter/S otomatis lompat ke tile pending berikutnya
              </div>
            </div>

            <div style={{ background: th.cardBgAlt, borderRadius: 6, padding: 10, border: `1px solid ${th.border}` }}>
              <div style={panelLabel}>MASK LEGEND</div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                <div style={{ width: 13, height: 13, borderRadius: 2, background: "#ff3232" }} />
                <span style={{ fontSize: 10, color: th.textMid2 }}>Berubah → putih</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 13, height: 13, borderRadius: 2, background: darkMode ? "#111" : "#e2e8f0", border: `1px solid ${th.border}` }} />
                <span style={{ fontSize: 10, color: th.textMid2 }}>Tidak berubah → hitam</span>
              </div>
            </div>

            <div>
              <div style={panelLabel}>PROGRESS</div>
              <div style={{ background: th.cardBg, borderRadius: 3, overflow: "hidden", height: 5, marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${(done / tiles.length) * 100}%`,
                  background: "linear-gradient(90deg,#22c55e,#4ade80)", transition: "width .3s" }} />
              </div>
              <div style={{ fontSize: 10, color: th.textMuted, textAlign: "center", marginBottom: 4 }}>
                {done}/{tiles.length} selesai
              </div>
              {Object.entries({ labeled: stats.labeled, no_change: stats.no_change, skipped: stats.skipped, pending: stats.pending })
                .map(([k, v]) => v > 0 && (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: STATUS_COLOR[k], marginTop: 2 }}>
                    <span>{STATUS_LABEL[k]}</span><span>{v}</span>
                  </div>
                ))}
            </div>

            <div>
              <div style={panelLabel}>PROJECT</div>
              <button onClick={saveProject} disabled={saving}
                style={{
                  width: "100%", padding: 8, borderRadius: 6, marginBottom: 6,
                  border: `1px solid ${th.border}`,
                  background: th.cardBg,
                  color: saving ? th.textTiny : th.textMid,
                  cursor: saving ? "not-allowed" : "pointer",
                  fontFamily: "'Barlow Condensed'", fontSize: 11, fontWeight: 700, letterSpacing: 1,
                }}>
                {saving ? "MENYIMPAN…" : "💾 SIMPAN PROJECT"}
              </button>
            </div>

            <div style={{ marginTop: "auto" }}>
              <div style={panelLabel}>EXPORT</div>
              <div style={{ fontSize: 9, color: th.textFaint, marginBottom: 8, lineHeight: 1.7 }}>
                ZIP → <span style={{ color: "#4a9eff" }}>before/</span> · <span style={{ color: "#f59e0b" }}>after/</span> · <span style={{ color: "#22c55e" }}>masks/</span> · manifest.json
                <br /><span style={{ color: th.textTiny }}>putih=changed · hitam=unchanged</span>
              </div>
              {exporting && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ background: th.cardBg, borderRadius: 3, overflow: "hidden", height: 4 }}>
                    <div style={{ height: "100%", width: `${exportProg}%`, background: "#22c55e", transition: "width .2s" }} />
                  </div>
                  <div style={{ fontSize: 9, color: "#22c55e", textAlign: "center", marginTop: 3 }}>Packing… {exportProg}%</div>
                </div>
              )}
              <button onClick={exportLabels} disabled={exporting || done === 0}
                style={{
                  width: "100%", padding: 9, borderRadius: 6,
                  border: `1px solid ${done === 0 ? th.border : "#22c55e55"}`,
                  background: done === 0 ? th.cardBg : exporting ? (darkMode ? "#0a1a10" : "#f0fdf4") : (darkMode ? "#0f2a1a" : "#dcfce7"),
                  color: done === 0 ? th.textTiny : "#22c55e",
                  cursor: done === 0 || exporting ? "not-allowed" : "pointer",
                  fontFamily: "'Barlow Condensed'", fontSize: 12, fontWeight: 700, letterSpacing: 1,
                }}>
                {exporting ? "MENYIMPAN…" : `⬇ SIMPAN ZIP (${done})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ QUALITY CONTROL ════════════════════════════════════════════════════════ */}
      {stage === "qc" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* QC toolbar */}
          <div style={{ background: th.barBg, borderBottom: `1px solid ${th.border}`, padding: "8px 14px",
            display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "'Barlow Condensed'", fontSize: 14, fontWeight: 700, color: "#a855f7", letterSpacing: 1 }}>
              🔍 QUALITY CONTROL
            </span>
            <span style={{ color: th.border }}>│</span>
            <span style={{ fontSize: 11, color: th.textMuted }}>
              Sisa sample: <strong style={{ color: th.text }}>{qcSamples.length}</strong>
            </span>
            <div style={{ display: "flex", gap: 4 }}>
              {[["single","◫ Satu per satu"],["grid","▦ Grid"]].map(([k, label]) => (
                <button key={k} onClick={() => setQcLayout(k)} style={{
                  padding: "3px 11px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                  border: `1px solid ${qcLayout === k ? "#a855f7" : th.border}`,
                  background: qcLayout === k ? (darkMode ? "#1a0f2a" : "#faf5ff") : th.cardBgAlt,
                  color: qcLayout === k ? "#a855f7" : th.textMid,
                }}>{label}</button>
              ))}
            </div>
            {qcSource?.type === "folder" && (
              <button onClick={() => setQcHardDelete(v => !v)} title="Saat ON, tombol ✕ langsung menghapus file before/after/mask dari folder di disk (permanen)."
                style={{ padding: "3px 11px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                  border: `1px solid ${qcHardDelete ? "#ef4444" : th.border}`,
                  background: qcHardDelete ? (darkMode ? "#2a1515" : "#fef2f2") : th.cardBgAlt,
                  color: qcHardDelete ? "#ef4444" : th.textMid }}>
                🗑 Hapus permanen: {qcHardDelete ? "ON" : "OFF"}
              </button>
            )}
            <span style={{ fontSize: 10, color: qcHardDelete ? "#ef4444" : th.textFaint }}>
              {qcHardDelete
                ? "[A]/[D] pindah sample · ✕ atau [Del] menghapus file dari disk PERMANEN (tidak bisa di-undo)"
                : "Bandingkan Before · After · Mask · [A]/[D] pindah · ✕ atau [Del] buang sample (file aman sampai Simpan Dataset Bersih)"}
            </span>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {qcSaving && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 80, background: th.cardBg, borderRadius: 3, overflow: "hidden", height: 4 }}>
                    <div style={{ height: "100%", width: `${qcProg}%`, background: "#a855f7" }} />
                  </div>
                  <span style={{ fontSize: 9, color: "#a855f7" }}>{qcProg}%</span>
                </div>
              )}
              <button onClick={saveCleanDataset} disabled={qcSaving || !qcSamples.length}
                style={{ padding: "7px 16px", borderRadius: 6,
                  border: `1px solid ${qcSamples.length ? "#22c55e55" : th.border}`,
                  background: qcSamples.length ? (darkMode ? "#0f2a1a" : "#dcfce7") : th.cardBg,
                  color: qcSamples.length ? "#22c55e" : th.textTiny,
                  cursor: qcSaving || !qcSamples.length ? "not-allowed" : "pointer",
                  fontFamily: "'Barlow Condensed'", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
                {qcSaving ? "MENYIMPAN…" : `💾 SIMPAN DATASET BERSIH (${qcSamples.length})`}
              </button>
              <button onClick={() => { setStage("setup"); setQcSamples([]); setQcManifest(null); }} style={smBtn(th.cardBgAlt, th.textMuted)}>← Keluar</button>
            </div>
          </div>

          {/* QC gallery */}
          {qcSamples.length === 0 ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: th.textMuted, fontSize: 13 }}>
              Semua sample telah dihapus. Simpan dataset bersih akan menghasilkan folder kosong.
            </div>
          ) : qcLayout === "grid" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: 14,
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, alignContent: "start" }}>
              {qcSamples.map(s => (
                <QCCard key={s.id} sample={s} onDelete={() => deleteQCSample(s.id)} th={th} darkMode={darkMode} />
              ))}
            </div>
          ) : (
            <QCSingle
              sample={qcSamples[Math.min(qcIndex, qcSamples.length - 1)]}
              index={Math.min(qcIndex, qcSamples.length - 1)}
              total={qcSamples.length}
              onPrev={() => setQcIndex(i => Math.max(i - 1, 0))}
              onNext={() => setQcIndex(i => Math.min(i + 1, qcSamples.length - 1))}
              onDelete={() => { const s = qcSamples[Math.min(qcIndex, qcSamples.length - 1)]; if (s) deleteQCSample(s.id); }}
              hardDelete={qcHardDelete && qcSource?.type === "folder"}
              th={th} darkMode={darkMode}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── QC sample card: before / after / mask shown side-by-side for direct comparison
function QCCard({ sample, onDelete, th, darkMode }) {
  const panels = [
    { label: "BEFORE", color: "#4a9eff", src: sample.beforeUrl },
    { label: "AFTER",  color: "#f59e0b", src: sample.afterUrl },
    { label: "MASK",   color: "#22c55e", src: sample.maskUrl },
  ];
  return (
    <div style={{ background: th.cardBg, border: `1px solid ${th.border}`, borderRadius: 8, overflow: "hidden" }}>
      {/* header: id + status + delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: `1px solid ${th.border}` }}>
        <span style={{ fontSize: 10, color: th.textMid }}>r{sample.row} · c{sample.col}</span>
        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3,
          color: sample.status === "labeled" ? "#22c55e" : "#3b82f6",
          background: (sample.status === "labeled" ? "#22c55e" : "#3b82f6") + "22" }}>
          {sample.status === "labeled" ? "CHANGED" : "NO CHANGE"}
        </span>
        <button onClick={onDelete} title="Hapus sample ini (before + after + mask)"
          style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 5,
            border: "1px solid #ef444488", background: darkMode ? "#2a1515" : "#fef2f2", color: "#ef4444",
            cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>
      {/* before / after / mask side-by-side (square via padding-bottom hack — reliable everywhere) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, background: th.border }}>
        {panels.map(p => (
          <div key={p.label} style={{ position: "relative", width: "100%", paddingBottom: "100%", background: QC_IMG_BG, overflow: "hidden" }}>
            {p.src
              ? <img src={p.src} alt={p.label} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontSize: 9 }}>tidak ada mask</div>}
            <span style={{ position: "absolute", top: 4, left: 4, background: "#000a", color: p.color,
              fontSize: 8, padding: "1px 5px", borderRadius: 3, letterSpacing: 1 }}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── QC single view: one sample at a time, large, with prev/next navigation
function QCSingle({ sample, index, total, onPrev, onNext, onDelete, hardDelete, th, darkMode }) {
  if (!sample) return null;
  const panels = [
    { label: "BEFORE (T1)", color: "#4a9eff", src: sample.beforeUrl },
    { label: "AFTER (T2)",  color: "#f59e0b", src: sample.afterUrl },
    { label: "MASK",        color: "#22c55e", src: sample.maskUrl },
  ];
  const navBtn = (dis) => ({
    padding: "8px 18px", borderRadius: 6, border: `1px solid ${th.border}`,
    background: dis ? th.cardBg : th.cardBgAlt, color: dis ? th.textTiny : th.text,
    cursor: dis ? "not-allowed" : "pointer", fontSize: 13, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1,
  });
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: 16, gap: 12 }}>
      {/* big before / after / mask */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, justifyContent: "center" }}>
        {panels.map(p => (
          <div key={p.label} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 11, color: p.color, letterSpacing: 1, marginBottom: 6, textAlign: "center", fontWeight: 700 }}>{p.label}</div>
            <div style={{ flex: 1, minHeight: 0, background: QC_IMG_BG, borderRadius: 8, border: `1px solid ${th.border}`,
              display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {p.src
                ? <img src={p.src} alt={p.label} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block", imageRendering: "pixelated" }} />
                : <span style={{ color: "#e2e8f0", fontSize: 12 }}>tidak ada mask</span>}
            </div>
          </div>
        ))}
      </div>
      {/* nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexShrink: 0 }}>
        <button onClick={onPrev} disabled={index <= 0} style={navBtn(index <= 0)}>← Sebelumnya [A]</button>
        <div style={{ textAlign: "center", minWidth: 220 }}>
          <div style={{ fontSize: 14, color: th.text }}>
            Sample <strong>{index + 1}</strong> / {total}
          </div>
          <div style={{ fontSize: 11, color: th.textMuted }}>
            r{sample.row} · c{sample.col} ·{" "}
            <span style={{ color: sample.status === "labeled" ? "#22c55e" : "#3b82f6" }}>
              {sample.status === "labeled" ? "CHANGED" : "NO CHANGE"}
            </span>
          </div>
        </div>
        <button onClick={onNext} disabled={index >= total - 1} style={navBtn(index >= total - 1)}>Berikutnya → [D]</button>
        <div style={{ width: 1, height: 28, background: th.border, margin: "0 4px" }} />
        <button onClick={onDelete} title="Hapus sample ini (before + after + mask) — [Del]"
          style={{ padding: "8px 18px", borderRadius: 6, border: `1px solid #ef4444${hardDelete ? "" : "88"}`,
            background: hardDelete ? "#ef4444" : (darkMode ? "#2a1515" : "#fef2f2"), color: hardDelete ? "#fff" : "#ef4444",
            cursor: "pointer", fontSize: 13, fontFamily: "'Barlow Condensed'", fontWeight: 700, letterSpacing: 1 }}>
          ✕ Hapus {hardDelete ? "(permanen)" : "sample"} [Del]
        </button>
      </div>
    </div>
  );
}

function TileThumbnail({ img, x, y, size }) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current || !img) return;
    const ctx = ref.current.getContext("2d");
    ctx.clearRect(0, 0, 40, 28);
    ctx.drawImage(img, x, y, size, size, 0, 0, 40, 28);
  }, [img, x, y, size]);
  return <canvas ref={ref} width={40} height={28} style={{ display: "block" }} />;
}
