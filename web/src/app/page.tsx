import DesktopShell from "@/components/DesktopShell";
import InteractiveCRT from "@/components/InteractiveCRT";
import { Sections } from "@/lib/sections";

export default function Home() {
  return (
    <>
      {/* Wrap the entire scene so the CRT can postprocess full viewport */}
      <div id="crt-scene" className="crt-scene" data-section={Sections.SHELL_ROOT}>
        <DesktopShell />
        {/* Full-viewport CRT pipeline overlay: captures crt-scene excluding itself */}
        <InteractiveCRT />
      </div>
    </>
  );
}
