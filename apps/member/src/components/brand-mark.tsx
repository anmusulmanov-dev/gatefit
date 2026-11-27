/**
 * The organization's logo when it has uploaded one (TZ F-10.7), otherwise the Gatefit mark:
 * a rounded tile in the theme's brand colour. Decorative: the name is always written beside it. A light tile keeps
 * a dark logo readable on dark top bars (Olov, dark mode).
 */
export function BrandMark({
  logoUrl = null,
  className = '',
}: {
  logoUrl?: string | null;
  className?: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed link from our own API
      <img
        src={logoUrl}
        alt=""
        className={`h-8 w-auto max-w-32 shrink-0 rounded-md bg-white object-contain p-0.5 shadow-card ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`gf-primary-fill grid size-8 shrink-0 place-items-center rounded-md font-heading text-base font-extrabold ${className}`}
    >
      G
    </span>
  );
}
