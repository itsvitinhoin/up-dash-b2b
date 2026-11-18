import { useEffect, useRef, useState } from "react";

const KEY = "updash.portfolio-tv-mode.v1";

export function useTvMode() {
  const [enabled, setEnabled] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const enteredFullscreen = useRef(false);

  useEffect(() => {
    if (enabled)
      document.documentElement.setAttribute("data-up-tv-mode", "true");
    else document.documentElement.removeAttribute("data-up-tv-mode");
    try {
      if (enabled) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {
      /* Focus mode still works without storage. */
    }
    return () => document.documentElement.removeAttribute("data-up-tv-mode");
  }, [enabled]);

  useEffect(() => {
    const onFullscreen = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false;
        setEnabled(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEnabled(false);
        if (enteredFullscreen.current && document.fullscreenElement)
          void document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
      if (enteredFullscreen.current && document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let disposed = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (
        document.visibilityState !== "visible" ||
        disposed ||
        (lock && !lock.released)
      )
        return;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed) await acquired.release();
        else lock = acquired;
      } catch {
        /* The browser may deny a screen lock; the dashboard keeps running. */
      }
    };
    const onVisible = () => {
      void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (enabled) {
        setEnabled(false);
        if (enteredFullscreen.current && document.fullscreenElement)
          await document.exitFullscreen();
        enteredFullscreen.current = false;
      } else {
        setEnabled(true);
        document.querySelector("#main-content")?.scrollTo({ top: 0 });
        if (
          document.documentElement.requestFullscreen &&
          !document.fullscreenElement
        ) {
          await document.documentElement.requestFullscreen();
          enteredFullscreen.current = true;
        }
      }
    } catch {
      setNotice(
        "Modo TV ativo sem menus. Para ocultar também as barras do navegador, use a opção Tela cheia do navegador.",
      );
    } finally {
      setBusy(false);
    }
  }

  return { enabled, busy, notice, toggle };
}
