import { useEffect, useId, useRef } from 'react'

/** One delegated surface, rather than a React tree/timer for every table cell.
 * Native manual popover renders above dialogs too. No essential copy belongs here.
 */
export function TooltipHost() {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    const tip = ref.current!
    let target: HTMLElement | null = null
    let previous: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const hide = () => {
      clearTimeout(timer)
      tip.hidePopover()
      if (target) {
        if (previous) target.setAttribute('aria-describedby', previous)
        else target.removeAttribute('aria-describedby')
      }
      target = null
    }
    const show = (node: HTMLElement) => {
      if (target === node) return
      hide()
      target = node
      previous = node.getAttribute('aria-describedby')
      timer = setTimeout(() => {
        if (!node.isConnected) return hide()
        tip.textContent = node.dataset.uiTooltip ?? ''
        tip.showPopover()
        node.setAttribute('aria-describedby', [previous, id].filter(Boolean).join(' '))
        const box = node.getBoundingClientRect(),
          bounds = tip.getBoundingClientRect()
        // In the compact sidebar a below-anchor popover covers the next row.
        // Keep hints hoverable, but place them outside the navigation hit area.
        const besideSidebar = node.closest('.app-sidebar') !== null
        const left = besideSidebar ? box.right + 8 : box.left
        const top = besideSidebar
          ? Math.min(box.top, innerHeight - bounds.height - 8)
          : box.bottom + bounds.height + 8 > innerHeight
            ? box.top - bounds.height - 6
            : box.bottom + 6
        tip.style.left = `${Math.max(8, Math.min(left, innerWidth - bounds.width - 8))}px`
        tip.style.top = `${Math.max(8, top)}px`
      }, 350)
    }
    const enter = (event: Event) => {
      const node =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-ui-tooltip]')
          : null
      if (node) show(node)
    }
    const leave = (event: Event) => {
      const related = (event as MouseEvent).relatedTarget
      if (related instanceof Node && (tip.contains(related) || target?.contains(related))) return
      if (event.target instanceof Element && event.target.closest('[data-ui-tooltip]')) hide()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', enter)
    document.addEventListener('focusin', enter)
    document.addEventListener('pointerout', leave)
    document.addEventListener('focusout', leave)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    tip.addEventListener('pointerleave', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', enter)
      document.removeEventListener('focusin', enter)
      document.removeEventListener('pointerout', leave)
      document.removeEventListener('focusout', leave)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
      tip.removeEventListener('pointerleave', hide)
    }
  }, [id])
  return <div ref={ref} id={id} role="tooltip" popover="manual" className="ui-tooltip" />
}
