# 0003. Pause freezes time, not orders

## Status

Accepted

## Context

Tactical pause has to stop the incident while the player retasks units. If commands waited for the next tick, a paused game could not show the new order. If pause also froze the command inbox, individual overrides would be awkward to issue.

## Decision

`pause` stops `tick()` and `step()`. Positions and the tick counter stay put. `move-responder` and `move-team` still apply immediately, create or suspend tasks, and appear in the next snapshot. Movement begins on resume.

Shift-queue is not implemented. A new order replaces the open move it targets, using the override rules in [tasks.md](../tasks.md).

## Consequences

The HUD can display a running order while the yard is frozen. Tests can pause, issue a move, and prove that time did not advance. A later queue can sit in front of `apply` without changing the tick loop.
