"use client";

import { useEffect } from "react";
import { Sections } from "@/lib/sections";
import { ASCII_BANNER } from "@/data/asciiBanner";

export default function NfoBanner() {
  // Signal LensWarp that ASCII content is ready for capture
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("ascii-ready"));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const text = ASCII_BANNER;

  const info = `\n\n   .nfo viewer re: hoppcx.top\n   ���������������������������������������\n   sys: 9800X3D @ 5.7GHZ\n   aim: op1we + obsidian dots @ 50cm on glass pad\n   keys: Fun60proHE + 240hz\n\n   links:\n`;

  const shouldAppendInfo = text && !/\.nfo viewer re:/i.test(text) && !/^\s*links:\s*$/mi.test(text);
  const output = shouldAppendInfo ? `${text.replace(/\n?$/, "\n")}${info}` : (text || info);

  return <pre className="nfo" data-section={Sections.ASCII_BANNER}>{output}</pre>;
}

