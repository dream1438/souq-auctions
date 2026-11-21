/** Shown while a page's live data streams in. Kept free of text so it works in both languages. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-6 h-40 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}
