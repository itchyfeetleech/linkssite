"use client";

import dynamic from "next/dynamic";

const ClientEffects = dynamic(() => import("@/components/ClientEffects"), { ssr: false });
const LensWarp = dynamic(() => import("@/components/LensWarp"), { ssr: false });

export default function InteractiveCRT() {
  return (
    <>
      <ClientEffects />
      <LensWarp />
    </>
  );
}
