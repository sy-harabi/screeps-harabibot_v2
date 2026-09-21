const SOFT_ASSIGNMENT_PENALTY = 4

const NO_REQUEST = 0xffff

let heapScratch = new Uint16Array(0)
let heapSizeScratch = new Uint16Array(0)
let distanceScratch = new Uint8Array(0)

let assignedRequestScratch = new Uint16Array(0)
let matchingAmountScratch = new Int32Array(0)

const requestScratch: EnergyRequest[] = []

export function matchEnergySuppliers(requests: ReadonlyMap<string, EnergyRequest>, suppliers: readonly Creep[]): void {
  requestScratch.length = 0

  for (const request of requests.values()) {
    if (request.remainingAmount > 0) {
      requestScratch.push(request)
    }
  }

  const requestCount = requestScratch.length
  const supplierCount = suppliers.length

  for (let requestIndex = 0; requestIndex < requestCount; requestIndex++) {
    matchingAmountScratch[requestIndex] = requestScratch[requestIndex].remainingAmount
  }

  for (let requestIndex = 0; requestIndex < requestCount; requestIndex++) {
    const request = requestScratch[requestIndex]

    for (let supplierIndex = 0; supplierIndex < supplierCount; supplierIndex++) {
      const supplier = suppliers[supplierIndex]

      const distance = supplier.pos.getRangeTo(request.target.pos)

      distanceScratch[requestIndex * supplierCount + supplierIndex] = distance

      // 기존 bot처럼 min heap에 supplierIndex 삽입
    }
  }
}

function getEffectiveDistance(distance: number, request: EnergyRequest): number {
  return distance + request.softAssignments * SOFT_ASSIGNMENT_PENALTY
}
