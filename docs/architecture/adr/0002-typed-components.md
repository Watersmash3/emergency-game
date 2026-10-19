# 0002. Typed components instead of a generic ECS

## Status

Accepted

## Context

Responders, teams, vehicles, and incidents will eventually be composed of different data. A general entity-component-system framework would add archetype storage, queries, and scheduling before the game has more than four movers.

## Decision

An entity is a stable id plus optional component objects: position, movement, responder, and team membership. Systems are plain functions that read those objects and visit entities in sorted id order. Definitions live in scenario data. Instances live in the simulation.

## Consequences

Adding a component is a type change and a system, which is easy to see in review. The model will not scale to tens of thousands of entities without a different store. That is acceptable for an incident-scale simulation. Empty component interfaces and unused query helpers are not part of the code.
