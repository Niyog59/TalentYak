import "server-only";
import type { Vertical, Service, IntakeSchema } from "@/lib/catalog/types";
import { getModules, getModule } from "@/verticals/registry";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Catalog reads. Supabase is the source of truth once connected;
 * until then the registry seed data serves the site so it runs
 * with zero infrastructure.
 */

type DbVertical = {
  slug: string;
  name: string;
  name_ne: string | null;
  tagline: string;
  description: string;
  status: Vertical["status"];
  sort: number;
};

type DbService = {
  id: string;
  vertical_slug: string;
  name: string;
  summary: string;
  description: string;
  price_cents: number;
  currency: "usd";
  billing_type: Service["billingType"];
  billing_interval: Service["billingInterval"] | null;
  price_note: string | null;
  status: Service["status"];
  sort: number;
  metadata: Record<string, unknown> | null;
};

function mapVertical(v: DbVertical): Vertical {
  return {
    slug: v.slug,
    name: v.name,
    nameNe: v.name_ne ?? undefined,
    tagline: v.tagline,
    description: v.description,
    status: v.status,
    sort: v.sort,
  };
}

function mapService(s: DbService): Service {
  return {
    id: s.id,
    verticalSlug: s.vertical_slug,
    name: s.name,
    summary: s.summary,
    description: s.description,
    priceCents: s.price_cents,
    currency: s.currency,
    billingType: s.billing_type,
    billingInterval: s.billing_interval ?? undefined,
    priceNote: s.price_note ?? undefined,
    status: s.status,
    sort: s.sort,
    metadata: s.metadata ?? undefined,
  };
}

export async function getVerticals(): Promise<Vertical[]> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase!
      .from("verticals")
      .select("*")
      .neq("status", "hidden")
      .order("sort");
    if (data && data.length > 0) return (data as DbVertical[]).map(mapVertical);
  }
  return getModules()
    .map((m) => m.vertical)
    .filter((v) => v.status !== "hidden")
    .sort((a, b) => a.sort - b.sort);
}

export async function getVertical(slug: string): Promise<Vertical | null> {
  const all = await getVerticals();
  return all.find((v) => v.slug === slug) ?? null;
}

export async function getServicesByVertical(
  verticalSlug: string,
): Promise<Service[]> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase!
      .from("services")
      .select("*")
      .eq("vertical_slug", verticalSlug)
      .neq("status", "hidden")
      .order("sort");
    if (data && data.length > 0) return (data as DbService[]).map(mapService);
  }
  return (getModule(verticalSlug)?.services ?? [])
    .filter((s) => s.status !== "hidden")
    .sort((a, b) => a.sort - b.sort);
}

export async function getService(serviceId: string): Promise<Service | null> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase!
      .from("services")
      .select("*")
      .eq("id", serviceId)
      .maybeSingle();
    if (data) return mapService(data as DbService);
  }
  for (const mod of getModules()) {
    const found = mod.services.find((s) => s.id === serviceId);
    if (found) return found;
  }
  return null;
}

export function getIntakeSchema(serviceId: string): IntakeSchema | null {
  for (const mod of getModules()) {
    const schema = mod.intakeSchemas.find((s) => s.serviceId === serviceId);
    if (schema) return schema;
  }
  return null;
}
