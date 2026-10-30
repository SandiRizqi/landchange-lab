import { useEffect, useRef } from "react";
import { fitScale, tileIndexAt } from "./indexMapUtils.js";

// Lebar konten panel kanan (195 - padding 2×14).
const MAP_W = 167;
const MAP_MAX_H = 200;
// Warna status di peta (pending sengaja tidak diwarnai).
const STATUS_FILL = {
  labeled:   "rgba(34,197,94,0.45)",
  no_change: "rgba(59,130,246,0.40)",
  skipped:   "rgba(245,158,11,0.40)",
};
// Penanda tile aktif: kuning, sengaja beda dari merah mask.
const MARK = "#facc15";

/**
 * Index View: thumbnail citra penuh + posisi tile yang sedang dilabeli.
 * Klik peta untuk lompat ke tile di lokasi tersebut.
 */
export default function IndexMap({ img, imgW, imgH, tiles, curIdx, tileSize, stride, onPick, th }) {
  const canvasRef = useRef();
  const baseRef = useRef(null);
  const scale = fitScale(imgW, imgH, MAP_W, MAP_MAX_H);
  const mw = Math.max(1, Math.round(imgW * scale));
  const mh = Math.max(1, Math.round(imgH * scale));

  // Thumbnail citra penuh di-cache sekali: citra asli bisa >10.000 px,
  // jangan digambar ulang dari sumber setiap kali tile berganti.
  useEffect(() => {
    if (!img || !scale) { baseRef.current = null; return; }
    const c = document.createElement("canvas");
    c.width = mw; c.height = mh;
    c.getContext("2d").drawImage(img, 0, 0, imgW, imgH, 0, 0, mw, mh);
    baseRef.current = c;
  }, [img, imgW, imgH, mw, mh, scale]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, mw, mh);
    if (baseRef.current) ctx.drawImage(baseRef.current, 0, 0);

    // Status per sel stride (bukan per tile penuh) agar tile yang tumpang
    // tindih tidak menumpuk warnanya.
    const cell = Math.max(1, stride * scale);
    for (const t of tiles) {
      const fill = STATUS_FILL[t.status];
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(t.x * scale, t.y * scale, cell, cell);
    }

    const cur = tiles[curIdx];
    if (!cur) return;
    const cx = (cur.x + tileSize / 2) * scale;
    const cy = (cur.y + tileSize / 2) * scale;
    const s = Math.max(6, tileSize * scale); // tetap terlihat walau tile kecil di peta

    // Garis silang melintang peta supaya posisi mudah ditemukan.
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, mh);
    ctx.moveTo(0, cy); ctx.lineTo(mw, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Kotak footprint tile: outline hitam + kuning agar kontras di latar apa pun.
    ctx.lineWidth = 3; ctx.strokeStyle = "#000";
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    ctx.lineWidth = 1.5; ctx.strokeStyle = MARK;
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  }, [tiles, curIdx, mw, mh, scale, stride, tileSize]);

  const onClick = e => {
    if (!scale) return;
    const r = canvasRef.current.getBoundingClientRect();
    const idx = tileIndexAt(tiles, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale, stride);
    if (idx >= 0) onPick(idx);
  };

  const cur = tiles[curIdx];
  return (
    <div>
      <canvas ref={canvasRef} width={mw} height={mh} onClick={onClick}
        title="Klik untuk lompat ke tile di lokasi ini"
        style={{ display: "block", width: mw, height: mh, cursor: "pointer",
          borderRadius: 3, border: `1px solid ${th.border}`, background: th.canvasBg }} />
      {cur && (
        <div style={{ fontSize: 9, color: th.textMid2, marginTop: 5, lineHeight: 1.6 }}>
          <span style={{ color: MARK }}>■</span> r{cur.row} · c{cur.col}
          {" · "}{Math.round(((cur.x + tileSize / 2) / imgW) * 100)}% ↔ {Math.round(((cur.y + tileSize / 2) / imgH) * 100)}% ↕
          <br />
          px x {cur.x}–{cur.x + tileSize} · y {cur.y}–{cur.y + tileSize}
        </div>
      )}
    </div>
  );
}
