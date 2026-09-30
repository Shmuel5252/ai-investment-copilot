import { useId } from "react";
import { cx } from "./cx";

// Form controls share one vocabulary: a label above, the control, then an
// optional help line and an error line that is announced. The control
// border is the `control` token (3:1 against paper and white); focus is
// the accent ring from globals.css.
const CONTROL =
  "w-full rounded-md border border-control bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-negative";
// single-line controls share the md button height (h-9); the textarea pads instead
const LINE = "h-9";

export function Field({
  label,
  help,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Render prop: receives the ids to wire onto the control. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span aria-hidden="true" className="text-negative">
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {help && !error && (
        <p id={helpId} className="text-xs text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cx(CONTROL, LINE, className)} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cx(CONTROL, "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, invalid, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select aria-invalid={invalid || undefined} className={cx(CONTROL, LINE, "appearance-none bg-no-repeat pe-9", className)} style={{ backgroundImage: CHEVRON, backgroundPosition: "left 0.75rem center", backgroundSize: "1rem" }} {...rest}>
      {children}
    </select>
  );
}

// A chevron drawn in the muted ink, placed at the end edge (left, in RTL).
const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6a6158" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')}")`;
