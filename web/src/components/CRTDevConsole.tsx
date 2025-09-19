"use client";

// Lightweight dev-only console API to inspect/tweak CRT micro-effects.
// Exposes window.CRT with get/set helpers in development builds.

import { useEffect } from "react";
import {
  setCRTAlive,
  setPhosphor,
  setCRTWarpSlider,
  setCRTWarpEnabled,
  setCRTWarpGrid,
} from "@/components/LensWarp";

type CRTState = {
  alive: number;
  effectiveAlive: number;
  mainsHz: number;
  fps: number;
  gated: boolean;
  reduced: boolean;
  mode?: 'HQ'|'LQ';
  buffers?: string;
  decayMs?: { r: number; g: number; b: number };
  halo?: number;
  beam?: { on: boolean; beamPx: number; modDepth: number; interlace: boolean };
};

const defaultState: CRTState = {
  alive: 0,
  effectiveAlive: 0,
  mainsHz: 60,
  fps: 60,
  gated: false,
  reduced: false,
};

type CRTApi = {
  help: () => void;
  get: () => CRTState;
  set: (a: number | { alive?: number; mainsHz?: number }, hz?: number) => CRTState;
  enable: () => CRTState;
  disable: () => CRTState;
  hz: (hz: number) => CRTState;
  phosphor: (opts: { rMs?: number; gMs?: number; bMs?: number; halo?: number }) => CRTState;
  mode: (m: 'HQ'|'LQ') => void;
  beam: (opts: { on?: boolean; beamPx?: number; modDepth?: number; interlace?: boolean }) => CRTState;
  debug: (on: boolean, persist?: boolean) => void;
  warpSlider: (s: number) => CRTState;
  warpEnabled: (enabled: boolean) => CRTState;
  warpOff: () => CRTState;
  warpGrid: (show: boolean) => CRTState;
};

declare global {
  interface Window { CRT?: CRTApi }
}

export default function CRTDevConsole() {
  useEffect(() => {
    let last: CRTState = { ...defaultState };
    const onState = (ev: Event) => {
      const e = ev as CustomEvent<CRTState>;
      if (e.detail) last = { ...last, ...e.detail };
    };
    window.addEventListener("crt-state", onState as EventListener);

    const api = {
      help() {
        console.log(`CRT console API\n\n` +
          `window.CRT.get()                       -> current state\n` +
          `window.CRT.set(alive[, mainsHz])       -> set alive [0..1] and optional mains\n` +
          `window.CRT.set({ alive, mainsHz })     -> same via object\n` +
          `window.CRT.enable() / window.CRT.disable()\n` +
          `window.CRT.hz(50|60)                   -> set mains Hz\n` +
          `window.CRT.phosphor({ rMs,gMs,bMs,halo }) -> set decay (s) and halo gain\n`
          + `window.CRT.mode('HQ'|'LQ')           -> force mode and reload\n`
          + `window.CRT.beam({ on, beamPx, modDepth, interlace }) -> beam controls (HQ only)\n`
          + `window.CRT.warpSlider(0..1)         -> set warp strength slider\n`
          + `window.CRT.warpEnabled(true|false)  -> toggle warp on/off\n`
          + `window.CRT.warpOff()                -> disable warp immediately\n`
          + `window.CRT.warpGrid(true|false)     -> show sampling grid overlay\n`
          + `window.CRT.debug(true|false[, persist]) -> toggle diagnostic logging\n`
        );
      },
      get(): CRTState {
        return { ...last };
      },
      set(a: number | Partial<CRTState>, hz?: number) {
        if (typeof a === "number") {
          setCRTAlive(a, hz);
        } else {
          const alive = typeof a.alive === "number" ? a.alive : last.alive;
          const mainsHz = typeof a.mainsHz === "number" ? a.mainsHz : (typeof hz === "number" ? hz : last.mainsHz);
          setCRTAlive(alive, mainsHz);
        }
        return api.get();
      },
      enable() { return api.set(1); },
      disable() { return api.set(0); },
      hz(hz: number) { return api.set(last.alive, hz); },
      phosphor(opts: { rMs?: number; gMs?: number; bMs?: number; halo?: number }) { setPhosphor(opts); return api.get(); },
      mode(m: 'HQ'|'LQ') { try { localStorage.setItem('crt-mode', m); } catch {} location.reload(); },
      beam(opts: { on?: boolean; beamPx?: number; modDepth?: number; interlace?: boolean }) { window.dispatchEvent(new CustomEvent('crt-beam', { detail: opts })); return api.get(); },
      debug(on: boolean, persist?: boolean) { window.dispatchEvent(new CustomEvent('crt-debug', { detail: { debug: !!on, persist: !!persist } })); },
      warpSlider(s: number) { setCRTWarpSlider(s); return api.get(); },
      warpEnabled(enabled: boolean) { setCRTWarpEnabled(enabled); return api.get(); },
      warpOff() { setCRTWarpEnabled(false); setCRTWarpSlider(0); return api.get(); },
      warpGrid(show: boolean) { setCRTWarpGrid(show); return api.get(); },
    };

    try {
      Object.defineProperty(window, "CRT", { value: api, writable: false });
      console.log("CRT dev console ready: window.CRT.help()");
    } catch {
      console.warn("Unable to attach window.CRT");
    }

    return () => {
      window.removeEventListener("crt-state", onState as EventListener);
      window.CRT = undefined;
    };
  }, []);

  return null;
}
