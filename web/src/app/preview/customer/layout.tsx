import { AppShell } from "@/components/shell/app-shell";
import { customerNav } from "@/components/shell/nav";
import { SampleBanner } from "@/components/ui/sample";
import { sampleCustomer } from "@/lib/sample/fitness";

export default function PreviewCustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      nav={customerNav("/preview/customer")}
      identity={{ name: sampleCustomer.name, detail: `Coach: ${sampleCustomer.coachName}` }}
      banner={<SampleBanner />}
    >
      {children}
    </AppShell>
  );
}
