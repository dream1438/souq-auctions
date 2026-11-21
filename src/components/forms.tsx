"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FormAction } from "@/lib/form";

/**
 * A form wired to a Server Action. Shows the action's translated error or
 * success message and disables the button while it runs.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  submitClass = "btn btn-primary",
  className = "flex flex-col gap-4",
  hidden,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClass?: string;
  className?: string;
  hidden?: Record<string, string | number | null | undefined>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  // Submitting by hand keeps what the person typed when the action answers with an error
  // (React clears a form after its action runs). Without JavaScript the plain form action still works.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className={className}>
      {hidden &&
        Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value ?? ""} />)}
      {children}
      {state?.error && (
        <p role="alert" className="notice notice-bad">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="notice notice-ok">
          {state.ok}
        </p>
      )}
      <button type="submit" className={submitClass} disabled={pending}>
        {pending ? (pendingLabel ?? submitLabel) : submitLabel}
      </button>
    </form>
  );
}

/** Live countdown to the end of an auction. Renders on the client only, so the clock is the visitor's. */
export function Countdown({ endsAt, endedLabel }: { endsAt: string; endedLabel: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return <span className="timer">…</span>;
  const left = Math.floor((new Date(endsAt).getTime() - now) / 1000);
  if (left <= 0) return <span className="timer timer-ended">{endedLabel}</span>;
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const tone = left < 300 ? "timer timer-final" : left < 3600 ? "timer timer-soon" : "timer";
  return <span className={tone}>{label}</span>;
}

async function shrink(file: File, maxSide: number): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Photo picker. Phone photos are several megabytes each, so they are resized
 * in the browser to at most 1600px before upload. That keeps uploads quick on
 * mobile data and inside the hosting request size limit.
 */
export function ImageInput({
  name,
  label,
  hint,
  multiple = false,
  max = 1,
  required = false,
}: {
  name: string;
  label: string;
  hint?: string;
  multiple?: boolean;
  max?: number;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  async function onChange() {
    const element = input.current;
    if (!element?.files) return;
    const chosen = Array.from(element.files).slice(0, max);
    const resized = await Promise.all(chosen.map((file) => shrink(file, 1600)));
    const transfer = new DataTransfer();
    resized.forEach((file) => transfer.items.add(file));
    element.files = transfer.files;
    setPreviews(resized.map((file) => URL.createObjectURL(file)));
  }

  return (
    <div className="field">
      <label htmlFor={`file-${name}`}>{label}</label>
      <input
        ref={input}
        id={`file-${name}`}
        name={name}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        required={required}
        onChange={onChange}
        className="input"
      />
      {hint && <p className="hint">{hint}</p>}
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="h-20 w-20 rounded-md border border-line object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Re-reads the page from the server every few seconds, so bids and the timer stay current without websockets. */
export function AutoRefresh({ endsAt, idleSeconds = 20 }: { endsAt?: string | null; idleSeconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const left = endsAt ? (new Date(endsAt).getTime() - Date.now()) / 1000 : Infinity;
      // Faster near the end of an auction, when bids come in quickly.
      const wait = left < -30 ? null : left < 180 ? 4 : idleSeconds;
      if (wait === null) return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") router.refresh();
        schedule();
      }, wait * 1000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [endsAt, idleSeconds, router]);
  return null;
}
