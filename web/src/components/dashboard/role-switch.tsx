import Link from "next/link";

/*
 * For someone who is both a coach and a client. Two separate dashboards with
 * separate data — switching never carries anything from one into the other.
 */
export function RoleSwitch({ current }: { current: "client" | "coach" }) {
  const item = (role: "client" | "coach", href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === role ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-md px-4 font-semibold ${current === role ? "bg-brand text-white" : "text-ink hover:bg-brand-tint"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Switch dashboard" className="inline-flex rounded-lg border border-line-strong bg-surface p-1">
      {item("client", "/account", "My coaching")}
      {item("coach", "/coach", "My clients")}
    </nav>
  );
}
