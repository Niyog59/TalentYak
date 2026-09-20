import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatDay, zoneCity } from "@/lib/format";
import { sampleCoachOverview } from "@/lib/sample/fitness";

/** Client roster — a table on wide screens, stacked rows on phones. */
export function ClientList() {
  const clients = sampleCoachOverview.clients;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
        <table className="w-full text-left">
          <caption className="sr-only">Clients</caption>
          <thead className="border-b border-line bg-paper-raised">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Client</th>
              <th scope="col" className="px-5 py-3 font-semibold">Plan</th>
              <th scope="col" className="px-5 py-3 font-semibold">Client&rsquo;s timezone</th>
              <th scope="col" className="px-5 py-3 font-semibold">Last workout</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {clients.map((client) => (
              <tr key={client.id}>
                <th scope="row" className="px-5 py-3 font-semibold">
                  <Link href={`/preview/coach/clients/${client.id}`} className="text-brand underline-offset-4 hover:underline">
                    {client.name}
                  </Link>
                </th>
                <td className="px-5 py-3">{client.plan}</td>
                <td className="px-5 py-3">{zoneCity(client.timeZone)}</td>
                <td className="tabular px-5 py-3">{client.lastWorkout ? formatDay(client.lastWorkout) : "None yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface md:hidden">
        {clients.map((client) => (
          <li key={client.id}>
            <Link href={`/preview/coach/clients/${client.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-semibold">{client.name}</span>
                <span className="block text-ink-muted">
                  {client.plan} · {zoneCity(client.timeZone)}
                </span>
                <span className="tabular block text-sm text-ink-muted">
                  Last workout: {client.lastWorkout ? formatDay(client.lastWorkout) : "none yet"}
                </span>
              </span>
              <Icon name="arrowRight" className="size-5 shrink-0 text-brand" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
