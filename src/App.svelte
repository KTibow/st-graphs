<script lang="ts">
  import RoutePicker from './lib/RoutePicker.svelte'
  import {
    fetchRouteShape, fetchTripsForRouteFull, fetchTripDetails, routeColor
  } from './lib/api'
  import type { StopEntry, TripScheduleEntry } from './lib/types'

  let routeId = $state('')
  let color = $state('#677483')
  let allStops = $state<Map<string, StopEntry>>(new Map())
  let trips: TripScheduleEntry[] = $state([])
  let directions: { name: string; stopIds: string[] }[] = $state([])
  let selectedDir = $state(-1)
  let selectedTripIdx = $state(-1)
  let statusMsg = $state('')

  // Polling
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let isPolling = $state(false)

  // Data recording: array of snapshots
  // Each snapshot: { time: number (epoch ms), stops: Map<stopId, { predicted, scheduled, dev }> }
  let snapshots: Array<{
    t: number
    stops: Map<string, { predicted: number; scheduled: number; dev: number }>
  }> = $state([])

  // ── Derived state ──

  let dirTrips = $derived.by(() => {
    if (selectedDir < 0 || !directions[selectedDir]) return []
    const ids = new Set(directions[selectedDir].stopIds)
    return trips.filter(t => t.schedule?.stopTimes?.some(s => ids.has(s.stopId)))
  })

  let selectedTrip = $derived(
    selectedTripIdx >= 0 && dirTrips[selectedTripIdx] ? dirTrips[selectedTripIdx] : null
  )

  let trackedStops = $derived.by(() => {
    if (!selectedTrip || selectedDir < 0) return []
    const dirIds = new Set(directions[selectedDir]?.stopIds || [])
    return (selectedTrip.schedule?.stopTimes || [])
      .filter(st => dirIds.has(st.stopId))
      .map(st => ({
        stopId: st.stopId,
        name: allStops.get(st.stopId)?.name || st.stopId,
        arrivalTime: st.arrivalTime,
      }))
  })

  let sampleCount = $derived(snapshots.length)

  // Graph dimensions
  let graphWidth = $state(800)
  let graphHeight = $state(400)
  let graphWrap = $state<HTMLDivElement | null>(null)

  // Resize observer for graph container
  $effect(() => {
    const el = graphWrap
    if (!el) return
    // Set initial size
    graphWidth = el.clientWidth
    graphHeight = el.clientHeight
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        graphWidth = e.contentRect.width
        graphHeight = e.contentRect.height
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  })

  // ── Colors ──
  const STOP_COLORS = [
    '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4',
    '#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#dcbeff',
    '#9a6324','#fffac8','#800000','#aaffc3','#808000','#ffd8b1',
    '#000075','#a9a9a9','#e6beff','#ff477e','#00ced1','#ff8c00',
  ]
  function stopColor(i: number) { return STOP_COLORS[i % STOP_COLORS.length] }

  // ── SVG graph data ──
  let showPredicted = $state(true)

  // Margins (px)
  const ML = 65, MR = 150, MT = 30, MB = 50

  let plotW = $derived(Math.max(graphWidth - ML - MR, 100))
  let plotH = $derived(Math.max(graphHeight - MT - MB, 50))

  // Compute axis ranges + lines
  let tMin = $derived(snapshots.length > 0 ? snapshots[0].t : 0)
  let tMax = $derived(snapshots.length > 0 ? snapshots[snapshots.length - 1].t : 0)
  let tRange = $derived(Math.max(tMax - tMin, 1000))

  let yMin = $derived.by(() => {
    if (snapshots.length === 0) return 0
    let m = Infinity
    for (const s of snapshots)
      for (const st of trackedStops) {
        const d = s.stops.get(st.stopId)
        if (d) { const v = showPredicted ? d.predicted : d.scheduled; if (v < m) m = v }
      }
    return m === Infinity ? 0 : m
  })
  let yMax = $derived.by(() => {
    if (snapshots.length === 0) return 1
    let m = -Infinity
    for (const s of snapshots)
      for (const st of trackedStops) {
        const d = s.stops.get(st.stopId)
        if (d) { const v = showPredicted ? d.predicted : d.scheduled; if (v > m) m = v }
      }
    return m === -Infinity ? 1 : m
  })
  let yPad = $derived(Math.max((yMax - yMin) * 0.1, 60000))
  let yAxisMin = $derived(yMin - yPad)
  let yAxisMax = $derived(yMax + yPad)
  let yRange = $derived(Math.max(yAxisMax - yAxisMin, 1000))

  // Grid lines
  let yStep = $derived(niceStep(yRange / 5))
  let yTicks = $derived.by(() => {
    const ticks: number[] = []
    const start = Math.ceil(yAxisMin / yStep) * yStep
    for (let y = start; y <= yAxisMax; y += yStep) ticks.push(y)
    return ticks
  })

  let xStep = $derived(Math.max(Math.round(tRange / 6 / 1000) * 1000, 1000))
  let xTicks = $derived.by(() => {
    const ticks: number[] = []
    for (let x = tMin; x <= tMax; x += xStep) ticks.push(x)
    return ticks
  })

  // Coordinate transforms
  function xPos(t: number) { return ML + ((t - tMin) / tRange) * plotW }
  function yPos(v: number) { return MT + plotH - ((v - yAxisMin) / yRange) * plotH }

  // Line paths for each stop
  let paths = $derived.by(() => {
    return trackedStops.map((st, si) => {
      const pts: { x: number; y: number }[] = []
      for (const s of snapshots) {
        const d = s.stops.get(st.stopId)
        if (!d) continue
        const v = showPredicted ? d.predicted : d.scheduled
        pts.push({ x: xPos(s.t), y: yPos(v) })
      }
      return { stopName: st.name, color: stopColor(si), pts }
    })
  })

  // Latest values for stop list
  let lastValues = $derived.by(() => {
    if (snapshots.length === 0) return new Map<string, number>()
    const last = snapshots[snapshots.length - 1]
    const m = new Map<string, number>()
    for (const st of trackedStops) {
      const d = last.stops.get(st.stopId)
      if (d) m.set(st.stopId, showPredicted ? d.predicted : d.scheduled)
    }
    return m
  })

  // ── Actions ──

  async function selectRoute(id: string) {
    stopPolling()
    routeId = id; trips = []; directions = []; selectedDir = -1
    selectedTripIdx = -1; snapshots = []
    if (!id) return
    color = routeColor(id); statusMsg = 'loading…'
    const [shapeResult, tripsData] = await Promise.all([
      fetchRouteShape(id), fetchTripsForRouteFull(id)
    ])
    if (!shapeResult) { statusMsg = 'failed'; return }
    trips = tripsData.trips
    // Use stops from trips-for-route refs — they're more complete than route shape's
    allStops = new Map(tripsData.stops.map(s => [s.id, s]))
    const groups = shapeResult.shape.stopGroupings?.[0]?.stopGroups || []
    directions = groups.map(g => ({
      name: g.name?.name || g.name || 'Direction',
      stopIds: g.stopIds || []
    }))
    statusMsg = `${trips.length} trips`
  }

  function selectDirection(idx: number) {
    selectedDir = idx; selectedTripIdx = -1; snapshots = []; stopPolling()
  }

  // React to trip selection via bind:group on radio buttons
  $effect(() => {
    const idx = selectedTripIdx
    snapshots = []; stopPolling()
    if (idx >= 0) {
      isPolling = true; takeSnapshot()
      pollTimer = setInterval(takeSnapshot, 10000)
    }
  })

  function startPolling() {
    stopPolling(); isPolling = true
    takeSnapshot(); pollTimer = setInterval(takeSnapshot, 10000)
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    isPolling = false
  }

  async function takeSnapshot() {
    const trip = selectedTrip
    if (!trip) return
    try {
      const detail = await fetchTripDetails(trip.tripId)
      const dev = detail.status?.scheduleDeviation ?? 0
      const serviceDate = detail.serviceDate || trip.serviceDate
      // Use the server's lastUpdateTime as the snapshot timestamp — that's when OBA
      // actually computed these predictions. Using Date.now() would add noise from
      // network latency and processing delay.
      const snapshotTime = detail.status?.lastUpdateTime || Date.now()
      const stops = new Map<string, { predicted: number; scheduled: number; dev: number }>()
      for (const st of detail.schedule?.stopTimes || []) {
        const scheduled = serviceDate + st.arrivalTime * 1000
        stops.set(st.stopId, { predicted: scheduled + dev * 1000, scheduled, dev })
      }
      snapshots = [...snapshots, { t: snapshotTime, stops }]
    } catch (e) { console.error('poll', e) }
  }

  function clearData() {
    snapshots = []; stopPolling()
    if (selectedTripIdx >= 0) startPolling()
  }

  function downloadCSV() {
    if (snapshots.length === 0 || trackedStops.length === 0) return
    let csv = 'timestamp_epoch,timestamp_iso'
    for (const st of trackedStops) {
      const name = st.name.replace(/[,"\n]/g, ' ')
      csv += `,${name}_predicted,${name}_scheduled,${name}_dev`
    }
    csv += '\n'
    for (const s of snapshots) {
      csv += `${s.t},${new Date(s.t).toISOString()}`
      for (const st of trackedStops) {
        const d = s.stops.get(st.stopId)
        csv += d ? `,${d.predicted},${d.scheduled},${d.dev}` : ',,,'
      }
      csv += '\n'
    }
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eta-${selectedTrip?.tripId?.slice(-8) || 'x'}-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function niceStep(range: number): number {
    const exp = Math.pow(10, Math.floor(Math.log10(range)))
    const mant = range / exp
    if (mant < 1.5) return exp * 0.2
    if (mant < 3.5) return exp * 0.5
    if (mant < 7.5) return exp * 1
    return exp * 2
  }

  function fmtTime(epoch: number): string {
    const d = new Date(epoch)
    return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`
  }
</script>

<div id="shell">
  <div id="sidebar">
    <RoutePicker onSelect={selectRoute} />

    {#if routeId}
      {#if directions.length > 0}
        <div class="dir-bar">
          {#each directions as dir, i}
            <button class="dir-chip" class:active={selectedDir === i} onclick={() => selectDirection(i)}>
              {dir.name}
              <span class="dir-count">{dir.stopIds.length}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if selectedDir >= 0}
        <div class="trip-picker">
          <div class="trip-radio-group">
            {#each dirTrips as t, i}
              {@const vid = t.status?.vehicleId ? t.status.vehicleId.split('_').pop()?.slice(-4) : t.tripId.slice(-4)}
              {@const ns = t.status?.nextStop}
              {@const nsName = ns ? (allStops.get(ns)?.name || ns) : ''}
              {@const cs = t.status?.closestStop}
              {@const csName = cs ? (allStops.get(cs)?.name || cs) : ''}
              {@const dev = t.status?.scheduleDeviation}
              {@const phase = t.status?.phase || 'scheduled'}
              <label class="trip-radio" class:active={selectedTripIdx === i}>
                <input type="radio" name="trip" value={i} bind:group={selectedTripIdx} />
                <span class="trip-radio-body">
                  <span class="trip-radio-head">
                    <span class="trip-vehicle">🚌 #{vid}</span>
                    <span class="trip-phase" class:late={dev && dev > 30} class:early={dev && dev < -30}>
                      {phase.replace('_', ' ')}
                    </span>
                    {#if dev != null}
                      <span class="trip-dev" class:late={dev > 30} class:early={dev < -30}>
                        {dev > 0 ? '+' : ''}{dev}s
                      </span>
                    {/if}
                  </span>
                  <span class="trip-radio-dest">
                    {#if nsName}
                      <span class="trip-next-label">next →</span>
                      <span class="trip-next-name">{nsName}</span>
                    {:else if csName}
                      <span class="trip-next-label">at</span>
                      <span class="trip-next-name">{csName}</span>
                    {:else}
                      <span class="trip-next-label dim">no position</span>
                    {/if}
                  </span>
                  <span class="trip-radio-stops label-sm">
                    {t.schedule?.stopTimes?.length || '?'} stops · {t.tripId.slice(-8)}
                  </span>
                </span>
              </label>
            {/each}
            {#if dirTrips.length === 0}
              <div class="trip-empty label-sm">no active trips right now</div>
            {/if}
          </div>
        </div>
      {/if}

      {#if selectedTripIdx >= 0 && trackedStops.length > 0}
        <div class="controls">
          <div class="control-row">
            <button class="ctrl-btn" onclick={clearData} disabled={snapshots.length === 0}>Clear</button>
            <button class="ctrl-btn" onclick={downloadCSV} disabled={snapshots.length < 2}>CSV</button>
            <label class="toggle-label">
              <input type="checkbox" bind:checked={showPredicted} />
              <span>Predicted</span>
            </label>
          </div>
          <div class="status-line">
            <span class="label-sm">{snapshots.length} sample{snapshots.length !== 1 ? 's' : ''}{isPolling ? ' · polling' : ''}</span>
          </div>
        </div>

        <div class="stop-list">
          {#each trackedStops as st, i}
            <div class="stop-item">
              <span class="stop-dot" style="background:{stopColor(i)}"></span>
              <span class="stop-name">{st.name}</span>
              <span class="stop-meta mono">
                {#if lastValues.has(st.stopId)}
                  {fmtTime(lastValues.get(st.stopId)!)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      {#if statusMsg}
        <div class="status-bar label-sm">{statusMsg}</div>
      {/if}
    {:else}
      <div class="empty-panel">
        <div class="empty-icon">📊</div>
        <p>Pick a route, direction &amp; trip</p>
      </div>
    {/if}
  </div>

  <div id="graph-wrap" bind:this={graphWrap}>
    {#if snapshots.length >= 2 && trackedStops.length > 0 && graphWidth > 100}
      <svg
        id="graph-svg"
        viewBox="0 0 {graphWidth} {graphHeight}"
        style="width:100%;height:100%;display:block"
        preserveAspectRatio="xMidYMid meet"
      >
        <!-- Grid lines Y -->
        {#each yTicks as yv}
          <line x1={ML} y1={yPos(yv)} x2={ML + plotW} y2={yPos(yv)} stroke="rgba(128,128,128,0.15)" stroke-width="1" />
          <text x={ML - 6} y={yPos(yv) + 3} text-anchor="end" fill="rgba(128,128,128,0.6)" font-size="10" font-family="system-ui,sans-serif">{fmtTime(yv)}</text>
        {/each}

        <!-- Grid lines X -->
        {#each xTicks as xt}
          <line x1={xPos(xt)} y1={MT} x2={xPos(xt)} y2={MT + plotH} stroke="rgba(128,128,128,0.15)" stroke-width="1" />
          <text x={xPos(xt)} y={MT + plotH + 16} text-anchor="middle" fill="rgba(128,128,128,0.6)" font-size="10" font-family="system-ui,sans-serif">{fmtTime(xt)}</text>
        {/each}

        <!-- Axes labels -->
        <text x={10} y={MT + plotH / 2} text-anchor="middle" fill="rgba(128,128,128,0.5)" font-size="10" font-family="system-ui,sans-serif"
              transform="rotate(-90,10,{MT + plotH / 2})">
          {showPredicted ? 'Predicted arrival' : 'Scheduled arrival'}
        </text>
        <text x={ML + plotW / 2} y={graphHeight - 4} text-anchor="middle" fill="rgba(128,128,128,0.5)" font-size="10" font-family="system-ui,sans-serif">
          Wall time
        </text>

        <!-- Title -->
        <text x={ML + plotW / 2} y={14} text-anchor="middle" fill="rgba(128,128,128,0.7)" font-size="12" font-family="system-ui,sans-serif">
          Trip {selectedTrip?.tripId?.slice(-6) || '?'} — {snapshots.length} samples
        </text>

        <!-- Data lines -->
        {#each paths as p}
          {#if p.pts.length >= 2}
            <polyline
              points={p.pts.map(pt => `${pt.x},${pt.y}`).join(' ')}
              fill="none"
              stroke={p.color}
              stroke-width="2"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          {/if}
        {/each}

        <!-- Stop labels at latest point -->
        {#each paths as p}
          {@const last = p.pts[p.pts.length - 1]}
          {#if last}
            <text x={last.x + 5} y={last.y + 3} fill={p.color} font-size="11" font-family="system-ui,sans-serif">{p.stopName}</text>
          {/if}
        {/each}
      </svg>
    {:else if selectedTripIdx >= 0}
      <div class="graph-placeholder">
        <div class="empty-icon">⏳</div>
        <p>Waiting for data…</p>
        <p class="label-sm">Need at least 2 samples</p>
      </div>
    {:else}
      <div class="graph-placeholder">
        <div class="empty-icon">📈</div>
        <p>Select a trip to graph ETA over time</p>
        <p class="label-sm">Each stop's line should be flat if ETA math is correct</p>
      </div>
    {/if}
  </div>
</div>

<style>
  #shell { display: flex; height: 100dvh; }
  #sidebar {
    width: 380px; min-width: 380px;
    background: var(--m3c-surface-container-low);
    display: flex; flex-direction: column; overflow-y: auto;
    border-right: 1px solid var(--m3c-outline-variant);
  }
  #graph-wrap {
    flex: 1; position: relative;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  #graph-svg { display: block; }

  .dir-bar {
    display: flex; gap: 4px; padding: 8px 12px;
    border-bottom: 1px solid var(--m3c-outline-variant); flex-wrap: wrap;
  }
  .dir-chip {
    padding: 6px 14px; border: 1px solid var(--m3c-outline); border-radius: 20px;
    background: transparent; color: var(--m3c-on-surface-variant);
    font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
    transition: all 0.12s; display: inline-flex; align-items: center; gap: 4px;
  }
  .dir-chip:hover { border-color: var(--m3c-primary); color: var(--m3c-primary); }
  .dir-chip.active { background: var(--m3c-primary); color: var(--m3c-on-primary); border-color: var(--m3c-primary); }
  .dir-count { font-size: 10px; opacity: 0.7; font-weight: 400; }

  .trip-picker { padding: 8px 12px; border-bottom: 1px solid var(--m3c-outline-variant); }
  .trip-picker { padding: 6px 8px; border-bottom: 1px solid var(--m3c-outline-variant); max-height: 240px; overflow-y: auto; }
  .trip-radio-group { display: flex; flex-direction: column; gap: 4px; }
  .trip-radio {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 8px 10px; border-radius: 10px;
    border: 1px solid var(--m3c-outline-variant);
    background: var(--m3c-surface-container);
    cursor: pointer; transition: all 0.1s;
  }
  .trip-radio:hover { border-color: var(--m3c-primary); background: var(--m3c-surface-container-high); }
  .trip-radio.active { border-color: var(--m3c-primary); background: var(--m3c-primary-container-subtle); }
  .trip-radio input { margin-top: 2px; accent-color: var(--m3c-primary); flex-shrink: 0; }
  .trip-radio-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .trip-radio-head { display: flex; align-items: center; gap: 6px; }
  .trip-vehicle { font-size: 13px; font-weight: 600; }
  .trip-phase {
    font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 4px;
    background: var(--m3c-surface-container-high); color: var(--m3c-on-surface-variant);
    text-transform: capitalize;
  }
  .trip-dev {
    margin-left: auto; font-size: 11px; font-weight: 500;
    color: var(--m3c-on-surface-variant);
  }
  .trip-dev.late { color: var(--m3c-error); }
  .trip-dev.early { color: var(--m3c-tertiary); }
  .trip-radio-dest {
    display: flex; align-items: center; gap: 4px;
    font-size: 12px; overflow: hidden;
  }
  .trip-next-label { font-size: 10px; color: var(--m3c-on-surface-variant); flex-shrink: 0; font-weight: 500; }
  .trip-next-label.dim { opacity: 0.5; }
  .trip-next-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .trip-radio-stops { color: var(--m3c-on-surface-variant); opacity: 0.6; }
  .trip-empty { padding: 12px; text-align: center; }

  .controls { padding: 8px 12px; border-bottom: 1px solid var(--m3c-outline-variant); display: flex; flex-direction: column; gap: 6px; }
  .control-row { display: flex; gap: 6px; align-items: center; }
  .ctrl-btn {
    padding: 4px 10px; border: 1px solid var(--m3c-outline); border-radius: 6px;
    background: transparent; color: var(--m3c-on-surface);
    font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer;
  }
  .ctrl-btn:hover:not(:disabled) { background: var(--m3c-surface-container-high); border-color: var(--m3c-primary); }
  .ctrl-btn:disabled { opacity: 0.4; cursor: default; }
  .toggle-label { margin-left: auto; display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: var(--m3c-on-surface-variant); cursor: pointer; }
  .toggle-label input { accent-color: var(--m3c-primary); }
  .status-line { display: flex; justify-content: space-between; }

  .stop-list { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 4px; }
  .stop-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; font-size: 12px; }
  .stop-item:hover { background: var(--m3c-surface-container); }
  .stop-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .stop-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .stop-meta { font-size: 10px; color: var(--m3c-on-surface-variant); flex-shrink: 0; }

  .status-bar { padding: 6px 12px; border-top: 1px solid var(--m3c-outline-variant); background: var(--m3c-surface-container); text-align: center; opacity: 0.6; }
  .empty-panel, .graph-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--m3c-on-surface-variant); padding: 40px; text-align: center; }
  .empty-icon { font-size: 36px; opacity: 0.4; }
  .empty-panel p, .graph-placeholder p { font-size: 13px; font-weight: 500; }

  @media (width < 768px) {
    #shell { flex-direction: column; }
    #sidebar { width: 100vw; min-width: 0; max-height: 50dvh; border-right: none; border-bottom: 1px solid var(--m3c-outline-variant); }
    #graph-wrap { min-height: 50dvh; }
  }
</style>
