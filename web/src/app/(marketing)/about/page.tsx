import type { Metadata } from "next";
import { SectionLabel } from "@/components/section";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="font-display text-4xl">About Ghartira</h1>
      <p className="devanagari mt-2 text-ink/50">घरतिर — toward home</p>

      <div className="mt-10 max-w-2xl space-y-6 text-lg leading-relaxed text-ink/85">
        <p>
          Ghartira exists because leaving Nepal does not release you from the
          things that must happen there. A father&rsquo;s shraddha on the
          correct tithi. A grandmother who needs someone reliable. Books that
          need keeping, children who need teaching, a body that needs looking
          after by someone who understands dal bhat.
        </p>
        <p>
          We connect Nepali families abroad with professionals in Nepal we
          would trust with our own families — and we stay accountable for
          every booking. Providers are paid well above local rates and paid
          fast, because good work comes from being treated well.
        </p>
        <p>
          We started with the hardest thing to get right: ancestral rites,
          where a mistake is not an inconvenience but a wound. If we can be
          trusted with your father&rsquo;s shraddha, we can be trusted with
          the rest.
        </p>
      </div>

      <section className="mt-16 max-w-2xl">
        <SectionLabel>Where we are</SectionLabel>
        <p className="leading-relaxed text-ink/80">
          Operations run between Houston, Texas and Kathmandu, Nepal. Our
          ceremony partners work at Gokarna and Pashupatinath; our coaches and
          professionals work across Nepal, on your timezone.
        </p>
      </section>
    </div>
  );
}
