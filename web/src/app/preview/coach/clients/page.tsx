import type { Metadata } from "next";
import { ClientList } from "@/app/preview/coach/client-list";

export const metadata: Metadata = { title: "Clients" };

export default function PreviewCoachClientsPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold">Clients</h1>
      <div className="mt-8">
        <ClientList />
      </div>
    </>
  );
}
