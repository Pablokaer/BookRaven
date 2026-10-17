import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Progress } from "../lib/api";
import { deviceId } from "../lib/device";
import { eventsLiveSince, onServerEvent } from "../lib/events";
import { fetchProgress, lastLocalUpdate, type Position } from "../lib/progress";
import { useDocumentEvent } from "../lib/useLatest";

export type Remote = Pick<Progress, "locator" | "percentage" | "label" | "deviceName" | "updatedAt">;

/**
 * "Continue where you left off on another device": `remote` is a newer position reached on
 * another device, heard of live (SSE), when coming back to the app, or passed to `offerRemote`.
 */
export function useRemoteProgress(id: string, positionRef: RefObject<Position | null>) {
  const [remote, setRemote] = useState<Remote | null>(null);

  const offerRemote = useCallback(
    (p: Remote & { deviceId?: string | null }) => {
      if (p.deviceId === deviceId) return;
      if (new Date(p.updatedAt).getTime() <= lastLocalUpdate(id)) return;
      if (positionRef.current?.locator === p.locator) return;
      setRemote(p);
    },
    [id, positionRef],
  );

  // Another device moved forward: offer to jump there (live, via SSE).
  useEffect(
    () =>
      onServerEvent((event, data) => {
        if (event === "progress.updated" && data.bookId === id) offerRemote(data);
      }),
    [id, offerRemote],
  );

  // Coming back to the app (phone unlocked, tab focused): check the server too, unless the live
  // connection has been up all along since the book opened (it would have told).
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, [id]);
  useDocumentEvent("visibilitychange", () => {
    if (document.visibilityState !== "visible" || eventsLiveSince(openedAt.current)) return;
    fetchProgress(id)
      .then((p) => p && offerRemote(p))
      .catch(() => {});
  });

  return { remote, setRemote, offerRemote };
}
