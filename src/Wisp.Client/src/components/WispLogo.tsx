interface Props {
  size?: number
  className?: string
}

/** Decorative next to a wordmark, or inside a control with its own label. */
export function WispLogo({ size = 28, className = '' }: Props) {
  return (
    <img
      src="/branding/wispa.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${className}`}
    />
  )
}
