"use client";

import { useEffect, useState } from "react";

export default function NfoBanner() {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    let active = true;
    fetch("/asciart.nfo")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not ok"))))
      .then((t) => {
        if (active) setText(t);
      })
      .catch(() => {
        if (active) setText("");
      });
    return () => {
      active = false;
    };
  }, []);

  const info = `\n\n   .nfo viewer re: hoppcx.top\n   ───────────────────────────────────────\n   sys: 9800X3D @ 5.7GHZ\n   aim: op1we + obsidian dots @ 50cm on glass pad\n   keys: Fun60proHE + 240hz\n\n   links:\n`;

  const shouldAppendInfo = text && !/\.nfo viewer re:/i.test(text) && !/^\s*links:\s*$/mi.test(text);
  const output = shouldAppendInfo ? `${text.replace(/\n?$/, "\n")}${info}` : (text || info);

  return <pre className="nfo">{output}</pre>;
}
