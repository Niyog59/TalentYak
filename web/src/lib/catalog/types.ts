export type BillingType = "one_time" | "subscription";
export type CatalogStatus = "active" | "coming_soon" | "hidden";

export interface Vertical {
  slug: string;
  name: string;
  /** Devanagari name, shown as a small editorial accent */
  nameNe?: string;
  tagline: string;
  description: string;
  status: CatalogStatus;
  sort: number;
}

export interface Service {
  /** stable slug id, unique across the platform */
  id: string;
  verticalSlug: string;
  name: string;
  summary: string;
  description: string;
  priceCents: number;
  currency: "usd";
  billingType: BillingType;
  billingInterval?: "month" | "quarter";
  /** e.g. "per ceremony", "/month billed quarterly" */
  priceNote?: string;
  status: CatalogStatus;
  sort: number;
  metadata?: Record<string, unknown>;
}

export type IntakeFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "number";

export interface IntakeField {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  placeholder?: string;
}

export interface IntakeSchema {
  serviceId: string;
  version: number;
  fields: IntakeField[];
}

export function formatPrice(service: Service): string {
  const dollars = service.priceCents / 100;
  const amount = Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
  if (service.billingType === "subscription") {
    return `${amount}/${service.billingInterval === "quarter" ? "qtr" : "mo"}`;
  }
  return amount;
}
