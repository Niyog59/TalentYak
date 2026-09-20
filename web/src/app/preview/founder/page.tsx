import type { Metadata } from "next";
import { formatDay, formatMoney } from "@/lib/format";
import { sampleFounderBookings, sampleFounderCoaches } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Founder operations" };

/*
 * Founder layout reference: dense but readable tables that become stacked
 * rows on phones instead of scrolling sideways. Status labels needing action
 * are distinguished by wording and a tint, never by colour alone.
 */

const attention = new Set(["Payment failed", "Coach change requested"]);

function Status({ value }: { value: string }) {
  const needsAction = attention.has(value);
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold ${
        needsAction ? "bg-danger-tint text-danger" : "bg-paper-raised text-ink"
      }`}
    >
      {needsAction && <span className="sr-only">Needs action: </span>}
      {value}
    </span>
  );
}

export default function PreviewFounderPage() {
  const openActions = sampleFounderBookings.filter((b) => attention.has(b.status)).length;

  return (
    <>
      <h1 className="text-4xl font-semibold">Overview</h1>
      <p className="mt-2 text-ink-muted">
        <span className="tabular font-semibold text-ink">{openActions}</span> bookings need your action.
      </p>

      <section aria-labelledby="bookings-heading" className="mt-8">
        <h2 id="bookings-heading" className="text-xl font-semibold">Customers and bookings</h2>

        <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
          <table className="w-full text-left">
            <caption className="sr-only">Recent bookings</caption>
            <thead className="border-b border-line bg-paper-raised text-sm">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Booking</th>
                <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
                <th scope="col" className="px-4 py-3 font-semibold">Coach and offer</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sampleFounderBookings.map((booking) => (
                <tr key={booking.id}>
                  <th scope="row" className="tabular px-4 py-3 font-semibold">{booking.id}</th>
                  <td className="px-4 py-3">{booking.customer}</td>
                  <td className="px-4 py-3">
                    {booking.coach}
                    <span className="block text-sm text-ink-muted">{booking.offer}</span>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{formatMoney(booking.amountMinor, booking.currency)}</td>
                  <td className="px-4 py-3"><Status value={booking.status} /></td>
                  <td className="tabular px-4 py-3">{formatDay(booking.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface md:hidden">
          {sampleFounderBookings.map((booking) => (
            <li key={booking.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="tabular font-semibold">{booking.id}</p>
                <Status value={booking.status} />
              </div>
              <p className="mt-1">{booking.customer} · {booking.coach}</p>
              <p className="text-ink-muted">{booking.offer}</p>
              <p className="tabular mt-1 flex justify-between gap-2">
                <span>{formatMoney(booking.amountMinor, booking.currency)}</span>
                <span className="text-ink-muted">{formatDay(booking.created)}</span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="coaches-heading" className="mt-10">
        <h2 id="coaches-heading" className="text-xl font-semibold">Coaches</h2>

        <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
          <table className="w-full text-left">
            <caption className="sr-only">Coaches</caption>
            <thead className="border-b border-line bg-paper-raised text-sm">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Coach</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Clients</th>
                <th scope="col" className="px-4 py-3 font-semibold">Credentials</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sampleFounderCoaches.map((coach) => (
                <tr key={coach.id}>
                  <th scope="row" className="px-4 py-3 font-semibold">{coach.name}</th>
                  <td className="tabular px-4 py-3 text-right">{coach.clients} of {coach.capacity}</td>
                  <td className="px-4 py-3">{coach.credentials}</td>
                  <td className="px-4 py-3"><Status value={coach.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-surface md:hidden">
          {sampleFounderCoaches.map((coach) => (
            <li key={coach.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{coach.name}</p>
                <Status value={coach.status} />
              </div>
              <p className="tabular mt-1">{coach.clients} of {coach.capacity} clients</p>
              <p className="text-ink-muted">{coach.credentials}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
