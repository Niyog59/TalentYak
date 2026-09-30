"use client";

import { useContext, useId } from "react";
import { ActionForm } from "@/components/form/action-form";
import { ActionStateContext, SubmitButton, TextField } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";
import {
  addCertificateAction,
  attachCertificateFileAction,
  removeCertificateAction,
} from "@/app/(marketing)/account/coach-application/actions";
import { MAX_CERTIFICATES } from "@/lib/coach-applications/rules";

export interface CertificateRow {
  id: string;
  qualification: string;
  issuing_body: string;
  expires_on: string | null;
  file_kind: string | null;
  checked: boolean;
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

function FileInput({ label, required = false }: { label: string; required?: boolean }) {
  const id = useId();
  const state = useContext(ActionStateContext);
  const error = state?.fieldErrors?.file;
  return (
    <div>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      <input
        id={id}
        name="file"
        type="file"
        accept={ACCEPT}
        required={required}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        className="mt-2 block w-full text-[0.9375rem] file:mr-4 file:min-h-11 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-4 file:font-semibold"
      />
      <p id={`${id}-help`} className="mt-1.5 text-sm text-ink-muted">
        A photo or PDF of the certificate, up to 4 MB. Photos are cleaned of hidden details such as location. Only TalentYak&rsquo;s reviewers can open it.
      </p>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatExpiry(date: string | null) {
  if (!date) return "Doesn't expire";
  return `Expires ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))}`;
}

export function Certificates({
  applicationId,
  certificates,
  editable,
}: {
  applicationId: string;
  certificates: CertificateRow[];
  editable: boolean;
}) {
  return (
    <div className="grid gap-6">
      {certificates.length === 0 ? (
        <p className="text-ink-muted">No qualifications added yet. They&rsquo;re optional, but they help us review your application.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {certificates.map((c) => (
            <li key={c.id} className="grid gap-3 p-4">
              <div>
                <p className="font-semibold">{c.qualification}</p>
                <p className="text-ink-muted">
                  {c.issuing_body} · {formatExpiry(c.expires_on)}
                </p>
                <p className="mt-1 text-sm">
                  {c.file_kind ? (
                    <span className="inline-flex items-center gap-1.5"><Icon name="check" className="size-4 text-success" />{c.file_kind === "pdf" ? "PDF attached" : "Photo attached"}</span>
                  ) : (
                    <span className="text-ink-muted">No file attached</span>
                  )}
                  {c.checked ? <span className="ml-3 inline-flex items-center gap-1.5 font-semibold text-brand"><Icon name="shield" className="size-4" />Checked by TalentYak</span> : null}
                </p>
              </div>
              {editable ? (
                <div className="flex flex-wrap items-end gap-4">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer font-semibold text-brand">{c.file_kind ? "Replace the file" : "Add a file"}</summary>
                    <ActionForm action={attachCertificateFileAction} resetOnSuccess className="mt-3 grid gap-3">
                      <input type="hidden" name="application_id" value={applicationId} />
                      <input type="hidden" name="certificate_id" value={c.id} />
                      <FileInput label="Certificate file" required />
                      <div><SubmitButton pendingLabel="Uploading…" variant="secondary">Upload</SubmitButton></div>
                    </ActionForm>
                  </details>
                  <ActionForm action={removeCertificateAction}>
                    <input type="hidden" name="certificate_id" value={c.id} />
                    <SubmitButton pendingLabel="Removing…" variant="quiet">Remove</SubmitButton>
                  </ActionForm>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable && certificates.length < MAX_CERTIFICATES ? (
        <ActionForm action={addCertificateAction} resetOnSuccess className="grid gap-5 rounded-xl border border-line bg-paper-raised p-4 sm:p-6">
          <h3 className="text-lg font-semibold">Add a qualification</h3>
          <input type="hidden" name="application_id" value={applicationId} />
          <TextField name="qualification" label="Qualification" required maxLength={160} placeholder="For example, Level 3 Personal Trainer" />
          <TextField name="issuing_body" label="Issuing organisation" required maxLength={160} />
          <TextField name="expires_on" label="Expiry date" type="date" required={false} help="Leave empty if it doesn't expire." className="sm:max-w-xs" />
          <FileInput label="Certificate file" />
          <div><SubmitButton pendingLabel="Adding…" variant="secondary">Add qualification</SubmitButton></div>
        </ActionForm>
      ) : editable ? (
        <p className="text-ink-muted">You&rsquo;ve added the maximum of {MAX_CERTIFICATES} qualifications. Remove one to add another.</p>
      ) : null}
    </div>
  );
}
