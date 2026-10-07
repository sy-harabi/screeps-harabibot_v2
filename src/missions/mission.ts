export type MissionId = string

export interface MissionBaseMemory<T extends string> {
  readonly type: T
  readonly parentId?: MissionId
  readonly createdAt: number

  finishedAt?: number
}
