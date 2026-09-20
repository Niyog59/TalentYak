import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { csvField } from "@/lib/payouts";
import { formatMinorAsDecimal } from "@/lib/money/money";

export const dynamic = "force-dynamic";

/**
 * Download a payout batch as CSV.
 *
 * A POST, never a GET: exporting records a state change and an audit event, and
 * a GET can be triggered by a link preview, a prefetch or an image tag on
 * another site. The request must come from this site's own page, and the
 * database function checks the admin's second factor again.
 *
 * Exporting is NOT paying. The batch moves to "exported"; each coach becomes
 * paid only when a transfer reference is recorded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const origin = request.headers.get("origin");
  const expected = new URL(env.siteUrl).origin;
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== expected && origin !== requestOrigin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("admin_export_payout_batch", { p_batch_id: id });
  if (error || !data) {
    return NextResponse.json({ error: error?.hint || "Export failed" }, { status: 400 });
  }

  const result = data as {
    label: string;
    currency: string;
    rows: { item_id: string; display_name: string; channel: string | null; masked_reference: string | null; amount_minor: number; currency: string; entry_count: number; state: string }[];
  };

  const lines = [
    ["Item", "Coach", "Method", "Account (masked)", "Currency", "Amount", "Entries", "Status"].map(csvField).join(","),
    ...result.rows.map((r) =>
      [
        csvField(r.item_id),
        csvField(r.display_name),
        csvField(r.channel),
        csvField(r.masked_reference),
        csvField(r.currency),
        formatMinorAsDecimal(Number(r.amount_minor), r.currency),
        String(r.entry_count),
        csvField(r.state === "prepared" ? "NOT PAID" : r.state),
      ].join(","),
    ),
  ];

  const safeLabel = result.label.replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 60);
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="talentyak-payouts-${safeLabel}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
