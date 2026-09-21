import { getCreepHeap } from "../../runtime/creepRuntime"
import type { EnergyRequest } from "./logistics"

interface LogisticsSupplierRuntime {
  targetRequestId?: string
  committed?: boolean
}

const SOFT_ASSIGNMENT_PENALTY = 4
const NO_REQUEST = 0xffff

let heapScratch = new Uint16Array(0)
let heapSizeScratch = new Uint16Array(0)
let distanceScratch = new Uint8Array(0)
let activeRequestScratch = new Uint16Array(0)
let assignedRequestScratch = new Uint16Array(0)
let matchingAmountScratch = new Int32Array(0)
let supplierAmountScratch = new Uint32Array(0)

const requestScratch: EnergyRequest[] = []

export function matchEnergySuppliers(requests: ReadonlyMap<string, EnergyRequest>, suppliers: readonly Creep[]): void {
  if (suppliers.length === 0) {
    return
  }

  const requestCount = collectActiveRequests(requests)

  if (requestCount === 0) {
    return
  }

  const supplierCount = suppliers.length
  const heapStride = ensureScratch(requestCount, supplierCount)

  prepareSupplierAmounts(suppliers, supplierCount)
  buildSupplierHeaps(suppliers, requestCount, supplierCount, heapStride)
  runProposalMatching(requestCount, supplierCount, heapStride)
  writeAssignments(suppliers, supplierCount)
}

function collectActiveRequests(requests: ReadonlyMap<string, EnergyRequest>): number {
  requestScratch.length = 0

  for (const request of requests.values()) {
    if (request.remainingAmount > 0) {
      requestScratch.push(request)
    }
  }

  return requestScratch.length
}

function prepareSupplierAmounts(suppliers: readonly Creep[], supplierCount: number): void {
  for (let supplierIndex = 0; supplierIndex < supplierCount; supplierIndex++) {
    supplierAmountScratch[supplierIndex] = suppliers[supplierIndex].store.getUsedCapacity(RESOURCE_ENERGY)
  }
}

function buildSupplierHeaps(
  suppliers: readonly Creep[],
  requestCount: number,
  supplierCount: number,
  heapStride: number,
): void {
  for (let requestIndex = 0; requestIndex < requestCount; requestIndex++) {
    const request = requestScratch[requestIndex]
    const distanceBase = requestIndex * supplierCount
    const heapBase = requestIndex * heapStride
    let heapSize = 0

    matchingAmountScratch[requestIndex] = request.remainingAmount

    for (let supplierIndex = 0; supplierIndex < supplierCount; supplierIndex++) {
      const supplier = suppliers[supplierIndex]
      const distance = supplier.pos.getRangeTo(request.target.pos)

      distanceScratch[distanceBase + supplierIndex] = distance

      let currentIndex = ++heapSize

      while (currentIndex > 1) {
        const parentIndex = currentIndex >> 1
        const parentSupplierIndex = heapScratch[heapBase + parentIndex]

        if (distanceScratch[distanceBase + parentSupplierIndex] <= distance) {
          break
        }

        heapScratch[heapBase + currentIndex] = parentSupplierIndex
        currentIndex = parentIndex
      }

      heapScratch[heapBase + currentIndex] = supplierIndex
    }

    heapSizeScratch[requestIndex] = heapSize
  }
}

function runProposalMatching(requestCount: number, supplierCount: number, heapStride: number): void {
  while (true) {
    let activeRequestCount = 0

    for (let requestIndex = 0; requestIndex < requestCount; requestIndex++) {
      if (matchingAmountScratch[requestIndex] <= 0 || heapSizeScratch[requestIndex] === 0) {
        continue
      }

      activeRequestScratch[activeRequestCount++] = requestIndex
    }

    if (activeRequestCount === 0) {
      return
    }

    for (let activeIndex = 0; activeIndex < activeRequestCount; activeIndex++) {
      const requestIndex = activeRequestScratch[activeIndex]
      const supplierIndex = popClosestSupplier(requestIndex, supplierCount, heapStride)

      if (supplierIndex === undefined) {
        continue
      }

      const previousRequestIndex = assignedRequestScratch[supplierIndex]

      if (
        previousRequestIndex !== NO_REQUEST &&
        !shouldSwitchRequest(supplierIndex, previousRequestIndex, requestIndex, supplierCount)
      ) {
        continue
      }

      const supplierAmount = supplierAmountScratch[supplierIndex]

      if (previousRequestIndex !== NO_REQUEST) {
        matchingAmountScratch[previousRequestIndex] += supplierAmount
      }

      matchingAmountScratch[requestIndex] -= supplierAmount
      assignedRequestScratch[supplierIndex] = requestIndex
    }
  }
}

function writeAssignments(suppliers: readonly Creep[], supplierCount: number): void {
  for (let supplierIndex = 0; supplierIndex < supplierCount; supplierIndex++) {
    const requestIndex = assignedRequestScratch[supplierIndex]

    if (requestIndex === NO_REQUEST) {
      continue
    }

    const supplier = suppliers[supplierIndex]
    const request = requestScratch[requestIndex]
    const runtime = getCreepHeap<LogisticsSupplierRuntime>(supplier.name)

    runtime.targetRequestId = request.id
    runtime.committed = false
  }
}

function shouldSwitchRequest(
  supplierIndex: number,
  previousRequestIndex: number,
  nextRequestIndex: number,
  supplierCount: number,
): boolean {
  const previousRequest = requestScratch[previousRequestIndex]
  const nextRequest = requestScratch[nextRequestIndex]

  if (nextRequest.priority < previousRequest.priority) {
    return true
  }

  if (nextRequest.priority > previousRequest.priority) {
    return false
  }

  const previousDistance =
    distanceScratch[previousRequestIndex * supplierCount + supplierIndex] +
    previousRequest.softAssignments * SOFT_ASSIGNMENT_PENALTY

  const nextDistance =
    distanceScratch[nextRequestIndex * supplierCount + supplierIndex] +
    nextRequest.softAssignments * SOFT_ASSIGNMENT_PENALTY

  return nextDistance < previousDistance
}

function popClosestSupplier(requestIndex: number, supplierCount: number, heapStride: number): number | undefined {
  const heapBase = requestIndex * heapStride
  const distanceBase = requestIndex * supplierCount
  let heapSize = heapSizeScratch[requestIndex]

  if (heapSize === 0) {
    return
  }

  const result = heapScratch[heapBase + 1]

  if (heapSize === 1) {
    heapSizeScratch[requestIndex] = 0
    return result
  }

  const lastSupplierIndex = heapScratch[heapBase + heapSize]
  heapSize--

  let currentIndex = 1

  while (true) {
    const leftIndex = currentIndex << 1

    if (leftIndex > heapSize) {
      break
    }

    const rightIndex = leftIndex + 1
    let childIndex = leftIndex

    if (
      rightIndex <= heapSize &&
      distanceScratch[distanceBase + heapScratch[heapBase + rightIndex]] <
        distanceScratch[distanceBase + heapScratch[heapBase + leftIndex]]
    ) {
      childIndex = rightIndex
    }

    const childSupplierIndex = heapScratch[heapBase + childIndex]

    if (distanceScratch[distanceBase + lastSupplierIndex] <= distanceScratch[distanceBase + childSupplierIndex]) {
      break
    }

    heapScratch[heapBase + currentIndex] = childSupplierIndex
    currentIndex = childIndex
  }

  heapScratch[heapBase + currentIndex] = lastSupplierIndex
  heapSizeScratch[requestIndex] = heapSize

  return result
}

function ensureScratch(requestCount: number, supplierCount: number): number {
  const heapStride = supplierCount + 1

  heapScratch = growUint16(heapScratch, requestCount * heapStride)
  heapSizeScratch = growUint16(heapSizeScratch, requestCount)
  distanceScratch = growUint8(distanceScratch, requestCount * supplierCount)
  activeRequestScratch = growUint16(activeRequestScratch, requestCount)
  assignedRequestScratch = growUint16(assignedRequestScratch, supplierCount)
  matchingAmountScratch = growInt32(matchingAmountScratch, requestCount)
  supplierAmountScratch = growUint32(supplierAmountScratch, supplierCount)

  heapSizeScratch.fill(0, 0, requestCount)
  assignedRequestScratch.fill(NO_REQUEST, 0, supplierCount)

  return heapStride
}

function growUint8(array: Uint8Array<ArrayBuffer>, minimumLength: number): Uint8Array<ArrayBuffer> {
  return array.length >= minimumLength ? array : new Uint8Array(getGrownLength(array.length, minimumLength))
}

function growUint16(array: Uint16Array<ArrayBuffer>, minimumLength: number): Uint16Array<ArrayBuffer> {
  return array.length >= minimumLength ? array : new Uint16Array(getGrownLength(array.length, minimumLength))
}

function growUint32(array: Uint32Array<ArrayBuffer>, minimumLength: number): Uint32Array<ArrayBuffer> {
  return array.length >= minimumLength ? array : new Uint32Array(getGrownLength(array.length, minimumLength))
}

function growInt32(array: Int32Array<ArrayBuffer>, minimumLength: number): Int32Array<ArrayBuffer> {
  return array.length >= minimumLength ? array : new Int32Array(getGrownLength(array.length, minimumLength))
}

function getGrownLength(currentLength: number, minimumLength: number): number {
  let length = currentLength || 16

  while (length < minimumLength) {
    length *= 2
  }

  return length
}
