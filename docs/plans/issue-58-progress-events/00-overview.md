# Overview

> **Issue:** #58 follow-up: rich workflow progress events
> **Classification Type:** T2
> **Severity:** Medium

## Goal

Expose privacy-safe, structured Start-of-Day progress for both initial generation and rejection replans, then render it as a compact phase stepper, live status, and capped expandable activity log.

## Approach

Add an optional `onProgress` sink to the workflow and wrap the existing injected `ChatCompletionsClient` with a role/schema-aware measuring decorator. The decorator observes every retry attempt without changing `agentClient.ts`, validates responses for telemetry only, and emits duration/outcome diagnostics without retaining raw model content. Extend `AgentPanel` with a 20-entry activity log shared by initial and replan calls.

## Key Files

| File | Purpose |
| --- | --- |
| `src/lib/agent/startOfDayWorkflow.ts` | Event vocabulary, phase emission, measuring client decorator |
| `src/lib/agent/startOfDayWorkflow.test.ts` | Retry, duration, classification, and phase coverage |
| `src/components/ProjectManager/AgentPanel.tsx` | Stepper, live status, details log, clear action |
| `src/state/AgentApprovalContext.test.tsx` | Production panel progress rendering coverage |

## Dependencies / Prerequisites

- Existing strict planner/writer request helpers and injectable workflow client.
- Existing initial and replan calls in `AgentPanel`.

## Risks / Open Questions

- Telemetry validation intentionally parses twice: once for observation and once in the unchanged strict agent client. This is low-cost and prevents signature churn.
- Raw response bodies must never be included in progress events or rendered logs.

