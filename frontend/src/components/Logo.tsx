/**
 * FinRoute logo mark.
 *
 * Concept: a routing node that branches into two paths (the orchestrator
 * routing to specialist agents) with the upper path rising like a growth
 * arrow (finance). Rendered with FinRoute's signature blue→violet→coral
 * gradient. Pure inline SVG — no asset files, works in static export.
 */
interface LogoProps {
  size?: number;
  /** Unique id suffix so multiple instances don't clash on gradient defs. */
  idSuffix?: string;
  className?: string;
}

export default function Logo({ size = 40, idSuffix = "hdr", className }: LogoProps) {
  const gid = `fr-grad-${idSuffix}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="FinRoute logo"
    >
      <defs>
        <linearGradient id={gid} x1="6" y1="42" x2="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9B72F2" />
          <stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>

      {/* Routing path: starts bottom-left, hits a decision node, branches —
          the upper branch rises (growth), the lower branch levels off. */}
      <path
        d="M9 34 L20 34 C24 34 24 20 30 20 L40 20"
        stroke={`url(#${gid})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 34 C24 34 24 30 30 30 L39 30"
        stroke={`url(#${gid})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.5"
      />

      {/* Decision node (the router) */}
      <circle cx="20" cy="34" r="4.5" fill={`url(#${gid})`} />

      {/* Growth arrowhead on the rising branch */}
      <path
        d="M40 20 L34 20 M40 20 L40 26"
        stroke={`url(#${gid})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Start node */}
      <circle cx="9" cy="34" r="3" fill={`url(#${gid})`} />
    </svg>
  );
}
