import type { ButtonHTMLAttributes, Ref } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'secondary' | 'primary' | 'quiet' | 'danger'
  small?: boolean
  tooltip?: string
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'secondary',
  small,
  tooltip,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const button = (
    <button
      {...props}
      type={props.type ?? 'button'}
      data-ui-tooltip={tooltip}
      className={`ui-button ui-button--${variant}${small ? ' ui-button--small' : ''} ${className}`}
    >
      {children}
    </button>
  )
  // Native disabled buttons cannot receive focus. The description remains
  // reachable by keyboard without enabling or disguising the disabled action.
  return props.disabled && tooltip ? (
    <span
      className="ui-disabled-hint"
      role="group"
      tabIndex={0}
      data-ui-tooltip={tooltip}
      aria-label={tooltip}
    >
      {button}
    </span>
  ) : (
    button
  )
}

export function IconButton({
  label,
  tooltip,
  className = '',
  ...props
}: Omit<ButtonProps, 'aria-label'> & { label: string }) {
  return (
    <Button
      {...props}
      aria-label={label}
      tooltip={tooltip ?? label}
      className={`ui-button--icon ${className}`}
    />
  )
}
