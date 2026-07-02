export interface ObaResponse<T> {
  code: number
  currentTime: number
  data: T
  text?: string
  version?: number
}

export interface RouteEntry {
  agencyId: string
  color: string
  description: string
  id: string
  longName: string
  nullSafeShortName?: string
  shortName: string
  textColor?: string
  type?: number
  url?: string
}

export interface VehicleEntry {
  vehicleId: string
  tripId: string
  status: string
  phase: string
  lastUpdateTime: number
  lastLocationUpdateTime: number
  location?: { lat: number; lon: number }
  tripStatus?: TripStatus
  occupancyCapacity?: number
  occupancyCount?: number
  occupancyStatus?: string
}

export interface TripStatus {
  activeTripId: string
  blockTripSequence?: number
  position?: { lat: number; lon: number }
  lastKnownLocation?: { lat: number; lon: number }
  lastKnownOrientation?: number
  phase: string
  status: string
  scheduleDeviation: number
  nextStop: string
  nextStopTimeOffset: number
  closestStop: string
  closestStopTimeOffset: number
  distanceAlongTrip: number
  totalDistanceAlongTrip: number
  scheduledDistanceAlongTrip?: number
  lastUpdateTime: number
  lastLocationUpdateTime?: number
  predicted: boolean
  serviceDate: number
  vehicleId?: string
  vehicleFeatures?: string[]
  orientation?: number
  frequency?: null
  occupancyCapacity?: number
  occupancyCount?: number
  occupancyStatus?: string
  situationIds?: string[]
  lastKnownDistanceAlongTrip?: number
}

export interface StopTimeEntry {
  arrivalTime: number
  departureTime: number
  stopId: string
  stopHeadsign: string
  distanceAlongTrip: number
  historicalOccupancy?: string
}

export interface TripScheduleEntry {
  tripId: string
  serviceDate: number
  status: string
  schedule: {
    nextTripId?: string
    previousTripId?: string
    stopTimes: StopTimeEntry[]
    timeZone: string
    frequency?: null
  }
  status?: TripStatus
  frequency?: null
  situationIds?: string[]
}

export interface StopEntry {
  id: string
  name: string
  lat: number
  lon: number
  code: string
  direction: string
  routeIds: string[]
  locationType?: number
  parent?: string
  staticRouteIds?: string[]
  wheelchairBoarding?: string
}

export interface RouteShapeEntry {
  stopIds: string[]
  polylines: Array<{ points: string }>
  stopGroupings: Array<{
    type: string
    stopGroups: Array<{
      name: { name: string; names: string[]; type: string }
      stopIds: string[]
      id?: string
      polylines?: Array<{ points: string }>
      subGroups?: unknown[]
    }>
  }>
  routeId?: string
}

export interface ArrivalDeparture {
  routeId: string
  tripId: string
  routeShortName: string
  tripHeadsign: string
  routeLongName: string
  predictedArrivalTime: number
  scheduledArrivalTime: number
  predictedDepartureTime: number
  scheduledDepartureTime: number
  predicted: boolean
  lastUpdateTime: number
  distanceFromStop: number
  numberOfStopsAway: number
  stopId: string
  stopName?: string
  // Undocumented but present
  tripStatus?: TripStatus
  vehicleId?: string
  serviceDate?: number
  situationIds?: string[]
  status?: string
  stopSequence?: number
  totalStopsInTrip?: number
  blockTripSequence?: number
  arrivalEnabled?: boolean
  departureEnabled?: boolean
  frequency?: null
  actualTrack?: string
  scheduledTrack?: string
  predictedArrivalInterval?: null | number
  predictedDepartureInterval?: null | number
  scheduledArrivalInterval?: null | number
  scheduledDepartureInterval?: null | number
  historicalOccupancy?: string
  occupancyStatus?: string
  predictedOccupancy?: string
}

export interface RouteColorMap {
  [routeId: string]: string
}
