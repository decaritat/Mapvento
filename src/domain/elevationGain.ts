export const ELEVATION_SMOOTHING_RADIUS_KM = 0.05
export const ELEVATION_GAIN_THRESHOLD_M = 3

export type CumulativeElevationGain = {
  ascent: number[]
  descent: number[]
}

/** Moving average over a distance window; reduces sensor/DEM noise. */
export function smoothElevations(
  elevations: number[],
  distances: number[],
  radiusKm = ELEVATION_SMOOTHING_RADIUS_KM,
) {
  if (elevations.length < 3 || distances.length !== elevations.length) return [...elevations]
  const result: number[] = []
  let start = 0
  let end = 0
  let sum = 0
  for (let index = 0; index < elevations.length; index += 1) {
    while (end < elevations.length && distances[end] <= distances[index] + radiusKm) {
      sum += elevations[end]
      end += 1
    }
    while (distances[start] < distances[index] - radiusKm) {
      sum -= elevations[start]
      start += 1
    }
    result.push(sum / (end - start))
  }
  return result
}

/**
 * Cumulative ascent and descent per point. Elevations are smoothed and
 * changes only count once they exceed a threshold (hysteresis), so small
 * oscillations do not accumulate into inflated totals.
 */
export function cumulativeElevationGain(
  elevations: number[],
  distances: number[],
  threshold = ELEVATION_GAIN_THRESHOLD_M,
): CumulativeElevationGain {
  const smoothed = smoothElevations(elevations, distances)
  const ascent: number[] = []
  const descent: number[] = []
  let totalAscent = 0
  let totalDescent = 0
  let reference = smoothed[0] ?? 0
  for (let index = 0; index < smoothed.length; index += 1) {
    const change = smoothed[index] - reference
    if (change >= threshold) {
      totalAscent += change
      reference = smoothed[index]
    } else if (change <= -threshold) {
      totalDescent -= change
      reference = smoothed[index]
    }
    ascent.push(totalAscent)
    descent.push(totalDescent)
  }
  return { ascent, descent }
}
