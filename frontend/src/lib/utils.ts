/** Simple className combiner (clsx-compatible for basic use cases) */
export function clsx(...args: (string | undefined | null | false | Record<string, boolean>)[]): string {
  const classes: string[] = []
  for (const arg of args) {
    if (!arg) continue
    if (typeof arg === 'string') {
      classes.push(arg)
    } else if (typeof arg === 'object') {
      for (const [key, val] of Object.entries(arg)) {
        if (val) classes.push(key)
      }
    }
  }
  return classes.join(' ')
}
