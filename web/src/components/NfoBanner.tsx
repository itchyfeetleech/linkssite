"use client";

import { useEffect, useState } from "react";

export default function NfoBanner() {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    fetch("/asciart.nfo")
      .then((res) => (res.ok ? res.text() : ""))
      .then((data) => {
        setText(data);
        window.dispatchEvent(new Event("ascii-ready"));
      })
      .catch(() => {
        setText("");
        window.dispatchEvent(new Event("ascii-ready"));
      });
  }, []);

  const info = `\n\n   .nfo viewer re: hoppcx.top\n   ───────────────────────────────────────\n   sys: 9800X3D @ 5.7GHZ\n   aim: op1we + obsidian dots @ 50cm on glass pad\n   keys: Fun60proHE + 240hz\n\n   links:\n`;

  const shouldAppendInfo = text && !/\.nfo viewer re:/i.test(text) && !/^\s*links:\s*$/mi.test(text);
  const output = shouldAppendInfo ? `${text.replace(/\n?$/, "\n")}${info}` : (text || info);

  return <pre className="nfo">{output}</pre>;
}
