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

  return <pre className="nfo">{text}</pre>; 
}

