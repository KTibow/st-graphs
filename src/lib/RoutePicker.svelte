<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchRoutes } from './api'
  import type { RouteEntry } from './types'

  let { onSelect = (_id: string) => {} } = $props()

  let routes: RouteEntry[] = $state([])
  let loading = $state(true)

  onMount(async () => {
    routes = await fetchRoutes()
    loading = false
  })
</script>

<select
  class="route-select"
  onchange={(e) => onSelect((e.target as HTMLSelectElement).value)}
>
  <option value="">
    {loading ? '…' : '— pick a route —'}
  </option>
  {#each routes as r (r.id)}
    <option value={r.id}>{r.shortName} — {r.longName || r.description}</option>
  {/each}
</select>

<style>
  .route-select {
    width: 100%;
    padding: 10px 36px 10px 14px;
    border: none;
    border-bottom: 1px solid var(--m3c-outline-variant);
    background: var(--m3c-surface-container-low);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    color: var(--m3c-on-surface);
    cursor: pointer;
    transition: background 0.12s;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%23787a8a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
  }
  .route-select:focus {
    outline: none;
    background: var(--m3c-surface-container);
  }
  .route-select option {
    background: var(--m3c-surface);
    color: var(--m3c-on-surface);
  }
</style>
