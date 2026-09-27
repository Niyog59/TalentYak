"use client";

import { Button } from "@/components/button";

/** Opens the browser's print dialog, where "Save as PDF" gives a download. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" size="sm" className="print:hidden" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
