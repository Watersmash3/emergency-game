# 0001. Headless simulation in a worker

## Status

Accepted

## Context

The rules of the game have to be testable without a browser, and the rendered frame rate must not define simulation time. React and Phaser both want to own state if they are allowed to.

## Decision

`packages/simulation` is a framework-free TypeScript package. Tests call it directly. The browser hosts one instance in a module worker. React and Phaser read snapshots and submit commands. They do not mutate entity state.

## Consequences

Command latency is one message, which is invisible at this scale. The worker is the only place that advances time. A future save system can persist the snapshot without importing Phaser. Multiplayer is not represented in the protocol, and a network transport should not be added until the game needs it.
