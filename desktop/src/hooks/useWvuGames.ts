import { useEffect, useState } from "react";
import { loadWvuSchedule, type WvuGame } from "../lib/wvuSchedule";

/** Loads the WVU football schedule once (same-origin JSON), keyed by ISO date. */
export function useWvuGames(): Map<string, WvuGame> {
  const [games, setGames] = useState<Map<string, WvuGame>>(new Map());
  useEffect(() => {
    let alive = true;
    loadWvuSchedule().then((m) => { if (alive) setGames(m); });
    return () => { alive = false; };
  }, []);
  return games;
}
