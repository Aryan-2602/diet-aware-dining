"use client";

/**
 * Labelled form controls.
 *
 * `Field` owns the label/control association and generates the id, so a
 * control cannot be rendered without a label — previously only one of the
 * app's four inputs had one, and the main location input had no label and no
 * focus ring.
 *
 * The label may be visually hidden where the surrounding copy already names
 * the control, but it is always present for assistive tech.
 */
import { useId } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400";

export function Field({
  label,
  hint,
  labelHidden = false,
  className,
  children,
}: {
  label: string;
  hint?: string;
  labelHidden?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className={cn(
          "mb-1.5 block text-xs font-medium text-gray-700",
          labelHidden && "sr-only"
        )}
      >
        {label}
      </label>
      {children({ id, "aria-describedby": hintId })}
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-gray-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(CONTROL, "resize-none", className)} {...rest} />
  );
}
