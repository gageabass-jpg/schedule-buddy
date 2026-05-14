import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "../firebase";

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  /** Firestore server timestamp; may be null briefly between local write and server ack. */
  createdAt: Timestamp | null;
}

export class ChatError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ChatError";
  }
}

/** Append a chat message to households/{hid}/chat. */
export async function sendChatMessage(
  householdId: string,
  text: string,
  senderName: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const uid = auth.currentUser?.uid;
  if (!householdId || !uid) throw new ChatError("Not signed in.");
  try {
    await addDoc(collection(db, "households", householdId, "chat"), {
      senderId: uid,
      senderName: senderName || "Member",
      text: trimmed.slice(0, 2000),         // hard cap so a fat-finger paste can't blow up storage
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    throw new ChatError("Couldn't send message.", e);
  }
}

/** Delete a message you authored. (No-op on others' messages — rules reject.) */
export async function deleteChatMessage(householdId: string, messageId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, "households", householdId, "chat", messageId));
  } catch (e) {
    throw new ChatError("Couldn't delete message.", e);
  }
}

/** Subscribe to the chat in chronological order. Returns an unsubscribe fn. */
export function subscribeChat(
  householdId: string,
  onSnap: (msgs: ChatMessage[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const q = query(
    collection(db, "households", householdId, "chat"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      const out: ChatMessage[] = [];
      snap.forEach((d) => {
        const data = d.data();
        out.push({
          id: d.id,
          senderId: String(data.senderId ?? ""),
          senderName: String(data.senderName ?? "Member"),
          text: String(data.text ?? ""),
          createdAt: (data.createdAt as Timestamp | undefined) ?? null,
        });
      });
      onSnap(out);
    },
    onError,
  );
}

/** Stamp "I just opened the chat" so unread badges clear. */
export async function markChatRead(householdId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!householdId || !uid) return;
  try {
    await setDoc(
      doc(db, "households", householdId, "chatRead", uid),
      { lastReadAt: serverTimestamp(), uid },
      { merge: true },
    );
  } catch {
    // best-effort — don't break the UI for a missing badge
  }
}

/** Subscribe to other members' lastReadAt — used by readers indicator. */
export function subscribeChatRead(
  householdId: string,
  onSnap: (byUid: Record<string, number>) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, "households", householdId, "chatRead"),
    (snap) => {
      const out: Record<string, number> = {};
      snap.forEach((d) => {
        const data = d.data();
        const ts = data.lastReadAt as Timestamp | undefined;
        if (ts) out[d.id] = ts.toMillis();
      });
      onSnap(out);
    },
  );
}
