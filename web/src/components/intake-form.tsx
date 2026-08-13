import type { IntakeField } from "@/lib/catalog/types";

const inputClass =
  "w-full rounded-[3px] border border-line bg-white/60 px-4 py-3 font-sans text-sm outline-none focus:border-ink";

/**
 * Generic intake field renderer. Every vertical's booking form is
 * driven by its registered IntakeSchema — no per-vertical form code.
 * Fields are named intake_<key> and parsed by createBooking.
 */
export function IntakeFields({ fields }: { fields: IntakeField[] }) {
  return (
    <>
      {fields.map((field) => (
        <label key={field.key} className="block">
          <span className="label mb-2 block text-ink/60">
            {field.label}
            {field.required && <span className="text-terracotta"> *</span>}
          </span>
          {renderInput(field)}
          {field.help && (
            <span className="mt-1 block text-xs leading-relaxed text-ink/50">
              {field.help}
            </span>
          )}
        </label>
      ))}
    </>
  );
}

function renderInput(field: IntakeField) {
  const name = `intake_${field.key}`;
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          name={name}
          required={field.required}
          placeholder={field.placeholder}
          rows={4}
          className={inputClass}
        />
      );
    case "select":
      return (
        <select name={name} required={field.required} className={inputClass}>
          <option value="">Select…</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="space-y-2 pt-1">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-3 font-sans text-sm">
              <input
                type="radio"
                name={name}
                value={o.value}
                required={field.required}
                className="accent-[#1B2A4A]"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    case "checkbox":
      return (
        <div className="space-y-2 pt-1">
          {field.options?.map((o) => (
            <label key={o.value} className="flex items-center gap-3 font-sans text-sm">
              <input
                type="checkbox"
                name={name}
                value={o.value}
                className="accent-[#1B2A4A]"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    case "date":
      return (
        <input
          type="date"
          name={name}
          required={field.required}
          className={inputClass}
        />
      );
    case "number":
      return (
        <input
          type="number"
          name={name}
          required={field.required}
          placeholder={field.placeholder}
          className={inputClass}
        />
      );
    default:
      return (
        <input
          type="text"
          name={name}
          required={field.required}
          placeholder={field.placeholder}
          className={inputClass}
        />
      );
  }
}
