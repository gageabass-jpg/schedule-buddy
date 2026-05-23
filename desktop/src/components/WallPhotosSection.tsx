// Photo gallery management for the wall display's scene rotation.
//
// Drag-drop or click-to-pick. Photos get resized to max 1920px and
// JPEG-compressed client-side before upload, then mirrored as a
// Firestore doc so the wall page (via getWallState) can list them.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import {
  deleteWallPhoto, listWallPhotos, uploadWallPhoto, type WallPhoto,
} from "../lib/wallPhotos";

interface Props {
  householdId: string | null;
  t: ThemeTokens;
  palette: Palette;
}

export function WallPhotosSection({ householdId, t, palette }: Props) {
  const [photos, setPhotos] = useState<WallPhoto[] | null>(null);
  const [uploading, setUploading] = useState(0);   // count of in-flight uploads
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!householdId) { setPhotos([]); return; }
    try {
      setPhotos(await listWallPhotos(householdId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load photos.");
    }
  }, [householdId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onFiles = async (files: FileList | File[]) => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) {
      setErr("Drop image files (JPEG/PNG/WebP).");
      return;
    }
    setUploading((n) => n + arr.length);
    try {
      // Run uploads in parallel so a 10-photo drop doesn't take 30s.
      await Promise.all(arr.map(async (f) => {
        try { await uploadWallPhoto(householdId, f); }
        catch (e) { setErr(e instanceof Error ? e.message : "Upload failed."); }
      }));
      await refresh();
    } finally {
      setUploading((n) => Math.max(0, n - arr.length));
    }
  };

  const onPick = () => inputRef.current?.click();

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) await onFiles(e.dataTransfer.files);
  };

  const onDelete = async (p: WallPhoto) => {
    if (!householdId) return;
    if (!confirm("Delete this photo from the wall display?")) return;
    try {
      await deleteWallPhoto(householdId, p.id, p.storagePath);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Drop zone */}
      <div
        onClick={onPick}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          padding: "18px 16px",
          borderRadius: 10,
          border: `1.5px dashed ${dragOver ? palette.G : t.sep}`,
          background: dragOver ? `${palette.G}14` : t.bgElev,
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.12s",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
          {uploading > 0
            ? `Uploading ${uploading}…`
            : "Drag photos here or click to pick"}
        </div>
        <div style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
          JPEG · PNG · WebP. Resized to 1920px max before upload.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
            e.target.value = "";   // allow re-picking same file
          }}
        />
      </div>

      {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

      {/* Photo grid */}
      {photos === null && (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>Loading…</div>
      )}
      {photos !== null && photos.length === 0 && (
        <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
          No photos yet. The wall will show only the dashboard until you add some.
        </div>
      )}
      {photos !== null && photos.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            gap: 8,
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: "relative",
                aspectRatio: "16 / 9",
                borderRadius: 8,
                overflow: "hidden",
                background: t.bgElev,
                border: `0.5px solid ${t.sep}`,
              }}
            >
              <img
                src={p.url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                loading="lazy"
              />
              <button
                type="button"
                onClick={() => onDelete(p)}
                title="Delete"
                style={{
                  position: "absolute",
                  top: 4, right: 4,
                  width: 22, height: 22,
                  borderRadius: 11,
                  border: 0,
                  background: "rgba(0,0,0,0.65)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "inherit",
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: t.text3, lineHeight: 1.5 }}>
        Photos appear on the wall display in a slideshow that takes over for ~30 seconds every 5 minutes,
        then fades back to the dashboard. Delete instantly removes a photo from all your wall displays.
      </div>
    </div>
  );
}
