For HarabiBot, I think operation-centered is better than pure D, but the best version is a hybrid.

Pure D organizes code by domain:

world / colony / military / operations

That gives clear ownership, but interactions like remotes + shared haulers + spawning can still become awkward.

Operation-centered architecture naturally represents how your bot thinks:

Colony
├─ Economy
│ ├─ Remote A
│ └─ Remote B
├─ Defense
└─ Expansion

while shared mechanisms stay outside:

operations/ # goals, hierarchy, coordination
capabilities/
spawning/
logistics/
combat/
movement/
world/
infrastructure/
kernel/

So I would currently favor:

Operations = main runtime/decision hierarchy
Capabilities = reusable mechanisms
World = information/model
Kernel = minimal tick execution
Infrastructure = persistence/logging/etc.

This also avoids a question that bothered us in D: whether something belongs to colony, military, or operations. A DefenseOperation can own the objective while simply using the combat capability.

The main risk is making everything an operation. I would strongly avoid that. Operations should represent persistent goals/responsibilities, not utilities or every individual task.

I agree. But current harabibot has managers that run owned rooms, manage empire wide goals and cpu. Do you think those can be merged into operations(missions)m

Mostly yes, but not all managers should become operations.

Current manager role New home
Run each owned room ColonyOperation
Empire-wide strategy/goals EmpireOperation / root operation
Expansion / war / remotes child operations
CPU monitoring/budgeting kernel, not an operation
Shared spawning/logistics/etc. capabilities, not operations

I would imagine the hierarchy roughly as:

EmpireOperation
├── ColonyOperation W1N1
│ ├── EconomyOperation
│ ├── DefenseOperation
│ └── RemoteOperation ...
├── ColonyOperation W5N3
├── ExpansionOperation
└── WarOperation
└── SiegeOperation ...

This can replace much of the current manager + mission split. Instead of:

EmpireManager → RoomManager → creates/manages Missions

you get one consistent model:

EmpireOperation
↓
ColonyOperation
↓
child operations

But I would not force manager code wholesale into operations. Some current manager responsibilities probably need to be separated:

RoomManager today
├── strategic decisions → ColonyOperation
├── spawning implementation → spawn capability
├── logistics implementation → logistics capability
└── bookkeeping → infrastructure/world state

And CPU is especially different. CPU doesn't represent a goal such as maintain this colony. It controls how the whole program is allowed to execute:

kernel
cpuBudget

      ↓ constrains

EmpireOperation
ColonyOperations
WarOperations

So my preferred direction is:

Replace managers whose job is "own and coordinate a responsibility" with operations. Keep managers whose job is providing a reusable mechanism as capabilities/infrastructure—or remove the Manager abstraction entirely.

That could make the architecture substantially more uniform than current HarabiBot without making everything an operation.

Currently missions request creeps and then roomManagers run and spawn creeps
So any mission can request creep from any room
How the new system handle it?

Keep that capability, but make it explicit as an empire-level spawn allocation system.

Any Operation
↓
SpawnRequest
↓
Empire Spawn Allocator
↓
chooses colony/spawn
↓
Colony spawn capability
↓
spawnCreep()

For example:

interface SpawnRequest {
requester: OperationId
body: BodyPartConstant[]
priority: number

preferredRooms?: RoomName[]
maxDistance?: number
targetRoom?: RoomName
}

Each colony exposes its available spawning capacity:

Colony W1N1 ─┐
Colony W5N3 ─┼→ SpawnAllocator
Colony W8N2 ─┘

Then a SiegeOperation, RemoteOperation, DefenseOperation, etc. can request a creep without knowing which room will spawn it.

The allocator decides based on things such as:

available spawn
energy
travel distance
priority
existing queue
boosts/resources if relevant

So your current behavior is preserved:

Mission → request creep → RoomManager chooses/spawns

but becomes:

Operation → SpawnRequest → SpawnAllocator → Colony spawn capability

I prefer this because operations describe what they need, while the allocator owns the empire-wide decision of where to obtain it.

A colony-local request could still strongly prefer its own colony, while an emergency or military operation could draw from anywhere.

Then that higher-level operation should own/coordinate child operations, not directly micromanage their internals.

Example:

AssaultOperation
├── QuadOperation A
├── QuadOperation B
└── QuadOperation C

AssaultOperation decides things like:

which target/objective each quad gets
when to advance / hold / retreat
which quad supports another
formation-level positioning
priority between objectives

Each QuadOperation still owns:

moving its 4 creeps
maintaining formation
local targeting
healing / attack execution
immediate tactical safety

Communication can be simple:

quad.setObjective(...)
quad.getStatus()

or shared structured state:

interface QuadCommand {
targetRoom: RoomName
target?: Id<Structure>
mode: "advance" | "hold" | "retreat"
anchor?: RoomPosition
}

So:

AssaultOperation
↓ commands / objectives
QuadOperation
↓ status / capability
AssaultOperation

This is exactly where hierarchy is useful.

The important boundary is:

Parent coordinates children at a higher abstraction level. Child decides how to perform its assigned responsibility.

So the assault should say:

“Quad A pressure north ramparts, Quad B cover its retreat.”

not:

“Creep A1 move east, A2 move northeast, heal A3.”

That low-level control stays inside the quad.

Would it be any case that needs to loop several times over different operations?

Yes. Some coordination problems may need iterative passes across multiple operations, but I would treat that as an exception, not the default.

Examples:

Assault coordination: several quad operations propose positions, parent sees conflicts, reassigns objectives, quads re-evaluate.
Shared logistics: remotes request hauling, allocator assigns haulers, some requests remain uncovered, operations adjust priorities or fallback behavior.
Spawn/resource competition: one allocation changes what other operations can reasonably request.

A simple model could be:

plan all relevant operations
→ allocate
→ reconcile affected operations
→ execute

Where reconcile() is optional:

interface Operation {
plan?(): void
reconcile?(): void
execute(): void
}

I would avoid a generic:

repeat until stable

loop across the whole operation tree. That can be expensive and hard to reason about.

Instead, if a particular subsystem genuinely needs iteration, let that subsystem own it. For example:

AssaultOperation.coordinateChildren()
→ evaluate all quads
→ assign objectives
→ detect conflicts
→ adjust once or twice

So the principle would be:

One global planning/allocation pass by default. Local bounded iteration where coordination actually requires it.

That keeps CPU predictable while still allowing sophisticated multi-operation cooperation.

Is recent md file enough to start rewriting?

Yes. It is enough to start, as long as you treat it as a direction, not a fixed architecture spec.

It already defines the important parts:

rewrite goals
your role vs the agent’s role
operation-centered architecture
hierarchy of operations
operations vs capabilities
shared-resource requests/allocation
minimal kernel
handling of execution-order dependencies
CPU-priority concept
permission to revise the design later

It intentionally leaves details open, such as the exact Operation interface, folder tree, lifecycle, planning/execution flow, allocator APIs, and world model.

That is appropriate. I would start with one small vertical slice:

EmpireOperation
→ ColonyOperation
→ one simple child responsibility
→ spawn request
→ spawn capability

Then review how that feels before committing the whole bot to the architecture.
