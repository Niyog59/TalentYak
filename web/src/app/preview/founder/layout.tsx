import { AppShell } from "@/components/shell/app-shell";
import { founderNav } from "@/components/shell/nav";
import { SampleBanner } from "@/components/ui/sample";

export default function PreviewFounderLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      nav={founderNav("/preview/founder", { real: false })}
      identity={{ name: "Sample founder", detail: "Founder" }}
      banner={<SampleBanner />}
    >
      {children}
    </AppShell>
  );
}
