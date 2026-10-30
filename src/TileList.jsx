import { memo, useEffect, useRef, useState } from "react";
import { STATUS_COLOR, STATUS_LABEL } from "./status.js";
import { visibleRange, scrollToReveal } from "./tileListUtils.js";

// Tinggi baris tetap (padding 5+5, thumbnail 28, border 1) — syarat windowing.
const ROW_H = 39;

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

// memo: baris hanya di-render ulang bila tile-nya sendiri / status aktifnya berubah.
const TileRow = memo(function TileRow({ t, i, active, img, tileSize, th, onPick }) {
  return (
    <div onClick={() => onPick(i)}
      style={{
        height: ROW_H, padding: "5px 8px", cursor: "pointer",
        background: active ? th.tileActive : "transparent",
        borderLeft: `3px solid ${active ? th.tileActiveBorder : STATUS_COLOR[t.status] + "55"}`,
        borderBottom: `1px solid ${th.tileBorder}`,
        display: "flex", alignItems: "center", gap: 6, transition: "background .1s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = th.tileHover; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ width: 40, height: 28, background: th.cardBg, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
        {img && <TileThumbnail img={img} x={t.x} y={t.y} size={tileSize} />}
      </div>
      <div>
        <div style={{ fontSize: 9, color: active ? th.text : th.textMid }}>r{t.row} c{t.col}</div>
        <div style={{ fontSize: 9, color: STATUS_COLOR[t.status] }}>{STATUS_LABEL[t.status]}</div>
      </div>
    </div>
  );
});

/**
 * Daftar tile ber-windowing: hanya baris yang terlihat (+overscan) yang di-render,
 * sehingga proyek ribuan tile tetap ringan. Tile aktif selalu digulir agar terlihat.
 */
export default function TileList({ tiles, curIdx, img, tileSize, th, onPick }) {
  const ref = useRef();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Navigasi keyboard (A/D/J, auto-advance) bisa memindah tile aktif ke luar layar.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = scrollToReveal(curIdx, el.scrollTop, el.clientHeight, ROW_H);
    if (next !== null) {
      el.scrollTop = next;
      // Sinkronkan langsung: event scroll baru datang di frame berikutnya, dan tanpa ini
      // jendela baris sempat menampilkan posisi lama (baris kosong berkedip).
      setScrollTop(next);
    }
  }, [curIdx]);

  const { start, end } = visibleRange(scrollTop, viewH, ROW_H, tiles.length);
  const rows = [];
  for (let i = start; i < end; i++) {
    const t = tiles[i];
    rows.push(<TileRow key={t.id} t={t} i={i} active={i === curIdx} img={img}
      tileSize={tileSize} th={th} onPick={onPick} />);
  }

  return (
    <div ref={ref} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} style={{ overflowY: "auto", flex: 1 }}>
      <div style={{ height: tiles.length * ROW_H, position: "relative" }}>
        <div style={{ position: "absolute", top: start * ROW_H, left: 0, right: 0 }}>{rows}</div>
      </div>
    </div>
  );
}
