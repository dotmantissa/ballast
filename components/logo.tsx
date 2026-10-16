export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="36"
      height="36"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 24h40l-7 22H25L12 24Z"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M8 32h48" stroke="currentColor" strokeWidth="3" />
      <path d="M25 38h15l-2 8H28l-3-8Z" fill="currentColor" />
      <path
        d="M32 13v11"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
