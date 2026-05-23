// Wall display photos — the Mac UI uploads to Firebase Storage and
// writes a Firestore doc that points at the download URL. The wall
// page (and getWallState Cloud Function) reads from Firestore, fetches
// bytes from Storage.
//
// Path layout:
//   Storage:   wallPhotos/{householdId}/{photoId}
//   Firestore: households/{householdId}/wallPhotos/{photoId}
//
// Photos are resized + recompressed client-side before upload so we
// don't ship 12 MP iPhone HEIC files into Storage and burn bandwidth
// on every wall load. Target: max 1920px on the longest edge, JPEG
// quality ~0.85. Typical original 8MB → ~600KB after resize.

import {
  collection, deleteDoc, doc, getDocs, orderBy, query, setDoc, serverTimestamp,
} from "firebase/firestore";
import {
  deleteObject, getDownloadURL, ref, uploadBytes,
} from "firebase/storage";
import { auth, db, storage } from "../firebase";

export interface WallPhoto {
  id: string;
  url: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: number;
}

class WallPhotoError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WallPhotoError";
  }
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function genPhotoId(): string {
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

// ─────────────────── client-side resize + compress ───────────────────

const MAX_EDGE  = 1920;
const QUALITY   = 0.85;

async function resizeImage(file: File): Promise<Blob> {
  // Load into an Image. HEIC won't decode in most desktop browsers,
  // but Electron's Chromium handles common camera formats fine; we
  // fall back to passing the original through if decode fails.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload  = () => resolve(im);
      im.onerror = () => reject(new Error("Couldn't decode image"));
      im.src = url;
    });

    const ratio = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.round(img.width  * ratio);
    const h = Math.round(img.height * ratio);

    // No resize needed and source is already JPEG? Just pass through.
    if (ratio === 1 && file.type === "image/jpeg") return file;

    const canvas = document.createElement("canvas");
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new WallPhotoError("No canvas 2d context");
    ctx.drawImage(img, 0, 0, w, h);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new WallPhotoError("toBlob returned null")),
        "image/jpeg",
        QUALITY,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─────────────────── public API ───────────────────

export async function uploadWallPhoto(householdId: string, file: File): Promise<WallPhoto> {
  if (!auth.currentUser) throw new WallPhotoError("Not signed in.");
  if (!householdId) throw new WallPhotoError("No household linked.");
  if (!file.type.startsWith("image/")) {
    throw new WallPhotoError("That doesn't look like an image.");
  }

  const photoId = genPhotoId();
  const path    = `wallPhotos/${householdId}/${photoId}`;
  const blob    = await resizeImage(file);

  // Storage upload — content type is always image/jpeg after resize.
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);

  // Mirror doc in Firestore so the Cloud Function can list without
  // touching Storage (cheaper, and avoids needing signed URL flow).
  await setDoc(doc(db, "households", householdId, "wallPhotos", photoId), {
    url,
    storagePath: path,
    uploadedBy: auth.currentUser.uid,
    createdAt: Date.now(),
    serverCreatedAt: serverTimestamp(),
  });

  return {
    id: photoId, url, storagePath: path,
    uploadedBy: auth.currentUser.uid,
    createdAt: Date.now(),
  };
}

export async function listWallPhotos(householdId: string): Promise<WallPhoto[]> {
  if (!householdId) return [];
  const q = query(
    collection(db, "households", householdId, "wallPhotos"),
    orderBy("createdAt", "desc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      url: String(data.url ?? ""),
      storagePath: String(data.storagePath ?? ""),
      uploadedBy: String(data.uploadedBy ?? ""),
      createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    };
  });
}

export async function deleteWallPhoto(householdId: string, photoId: string, storagePath: string): Promise<void> {
  // Delete Firestore first. If Storage delete fails, we have an orphan
  // file but it's invisible to the wall (which reads via Firestore).
  await deleteDoc(doc(db, "households", householdId, "wallPhotos", photoId));
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (e) {
    // Storage delete failures aren't fatal — log and move on.
    console.warn("Storage delete failed; photo metadata removed.", e);
  }
}
