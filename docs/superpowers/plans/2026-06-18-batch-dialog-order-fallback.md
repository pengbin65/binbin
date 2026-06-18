# Batch Dialog Order Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SHEIN batch confirmation independent of shop-specific product ID text formats.

**Architecture:** Keep the existing product-ID matching as the first choice, but add an order-based fallback inside the batch confirmation dialog. The main page already computes the current page decisions in row order, and the batch dialog presents selected products in that same order; footer totals remain the final confirmation guard.

**Tech Stack:** TypeScript, Playwright page evaluation scripts, Vitest.

---

### Task 1: Cover Fallback Selection

**Files:**
- Modify: `src/shein/shein-processor.ts`
- Modify: `tests/shein/shein-processor.test.ts`

- [ ] Add a failing unit test for choosing the next unapplied item when the dialog row has no usable product ID.
- [ ] Implement a small exported helper for this index selection behavior.
- [ ] Run the SHEIN processor tests.

### Task 2: Apply Fallback in Browser Script

**Files:**
- Modify: `src/shein/shein-processor.ts`

- [ ] Update the batch dialog page-evaluate script to use ID matching first and row-order fallback second.
- [ ] Keep footer count matching as the final guard before confirmation.
- [ ] Run SHEIN processor tests and typecheck.

### Task 3: Restart and Commit

**Files:**
- No additional files.

- [ ] Restart the local server on port 3210.
- [ ] Commit the fix to the current branch.
