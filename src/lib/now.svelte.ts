import { SvelteDate } from 'svelte/reactivity'

export const now = new SvelteDate()

// Tick every second so reactive reads of now.getTime() update live
let ticking = $effect.root(() => {
  const interval = setInterval(() => {
    now.setTime(Date.now())
  }, 200)
  return () => clearInterval(interval)
})
