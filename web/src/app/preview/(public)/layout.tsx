import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { SampleBanner } from "@/components/ui/sample";

export default function PreviewPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SampleBanner />
      <SiteNav />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
