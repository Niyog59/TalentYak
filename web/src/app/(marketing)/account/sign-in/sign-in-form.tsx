"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    "idle" | "sending" | "sent" | "error" | "unconfigured"
  >("idle");

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      setState("unconfigured");
      return;
    }
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setState(error ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <p className="border border-line bg-paper-raised p-6 text-sm leading-relaxed">
        Check your email — we sent a sign-in link to{" "}
        <span className="font-medium">{email}</span>.
      </p>
    );
  }

  return (
    <form onSubmit={sendMagicLink} className="space-y-4">
      <label className="block">
        <span className="label mb-2 block text-ink/60">Email address</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-[3px] border border-line bg-white/60 px-4 py-3 font-sans text-sm outline-none focus:border-ink"
        />
      </label>
      <Button type="submit" disabled={state === "sending"} className="w-full">
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </Button>
      {state === "error" && (
        <p className="text-sm text-terracotta-dark">
          Something went wrong — please try again.
        </p>
      )}
      {state === "unconfigured" && (
        <p className="text-sm text-terracotta-dark">
          Accounts are not live yet. Bookings currently run through our
          concierge — email hello@ghartira.com.
        </p>
      )}
    </form>
  );
}
