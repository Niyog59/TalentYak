import { AppShell } from "@/components/shell/app-shell";
import { coachNav } from "@/components/shell/nav";
import { SampleBanner } from "@/components/ui/sample";
import { sampleCoachOverview } from "@/lib/sample/fitness";

export default function PreviewCoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      nav={coachNav("/preview/coach", { clientsIndex: true, extras: false })}
      identity={{ name: sampleCoachOverview.coachName, detail: "Coach" }}
      banner={<SampleBanner />}
    >
      {children}
    </AppShell>
  );
}
