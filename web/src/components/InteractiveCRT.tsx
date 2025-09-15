"use client";

import dynamic from "next/dynamic";

const ClientEffects = dynamic(() => import("@/components/ClientEffects"), { ssr: false });

export default function InteractiveCRT() {
  return <ClientEffects />;
}

