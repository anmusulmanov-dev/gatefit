/** The Gatefit mark: a rounded tile in the theme's brand colour. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`gf-primary-fill grid size-8 shrink-0 place-items-center rounded-md font-heading text-base font-extrabold ${className}`}
    >
      G
    </span>
  );
}
