# SHEIN API Pricing Exploration Design

## Goal

Move pricing automation away from fragile UI clicking toward an API-first flow. The first phase is exploration only: capture the SHEIN seller-center network requests used by the existing price-adjustment page, identify the pending-list and batch-decision endpoints, and verify those requests can be replayed from the logged-in Hubstudio browser session.

## Current Problem

The current runner controls the SHEIN seller page through DOM clicks. This works on the main computer but fails on other computers when page loading, dialogs, or the pending-task drawer behave differently. Common failures include repeating the first page, missing product rows after batch submit, and stopping before later selected shops run.

## Proposed Approaches

### Recommended: Browser Session + Internal API Replay

Use Hubstudio exactly as today to open the fingerprint browser and preserve the logged-in SHEIN session. Add an exploration mode that listens to page network traffic while the user manually performs one batch confirmation. The tool records request URL, method, headers shape, query/body schema, and response summary for likely pricing endpoints. A follow-up verifier replays candidate requests using the same browser context via Playwright request APIs.

This is the best near-term option because it avoids UI clicking for the pricing operation while keeping the existing login and fingerprint environment.

### Alternative: Official SHEIN OpenAPI

Apply for SHEIN Open Platform access and confirm whether a public endpoint exists for new-product negotiation or price-adjustment confirmation. This is the cleanest long-term path, but it may not expose the exact seller-center workflow we need.

### Fallback: Harden Existing UI Automation

Keep fixing page-click behavior with more waits and drawer recovery. This is the least preferred option because it remains sensitive to page layout, computer speed, and SHEIN UI changes.

## Phase 1 Scope

Add an API exploration mode, not a full replacement runner.

The mode should:

- Start the selected Hubstudio profile.
- Open the SHEIN seller price-adjustment page.
- Attach listeners for `request`, `response`, and failed requests.
- Let the user manually click through one pricing batch.
- Save a sanitized capture file under `runtime/api-captures/`.
- Highlight likely endpoints containing pricing, discuss, negotiation, batch, pending, task, or price-related keywords.
- Preserve enough request metadata to implement replay later, while avoiding sensitive token dumps in the control-panel UI.

Out of scope for this phase:

- Fully replacing the current pricing runner.
- Sending batch decisions automatically through the captured endpoint.
- Building central multi-computer orchestration.

## Data Flow

1. Control panel starts an API exploration run for one selected shop.
2. Runner opens Hubstudio and navigates to SHEIN.
3. Capture service records matching network requests and responses.
4. User manually performs one batch confirmation in the fingerprint browser.
5. User stops capture from the control panel.
6. Capture file is written locally and summarized in logs.
7. We review candidate endpoints and choose replay targets.

## Error Handling

- If SHEIN requires login, pause as the current runner does.
- If no matching requests are captured, keep the full request index and log that no likely pricing endpoint was detected.
- If capture writing fails, log the filesystem path and error.
- If the browser crashes, save whatever was captured before failure.

## Testing

Unit tests should cover:

- Request classifier detects likely pricing endpoints.
- Sanitizer removes sensitive headers such as cookies and authorization tokens from logs.
- Capture writer creates a timestamped JSON file.
- Runner can start and stop capture without invoking the existing UI pricing processor.

## Success Criteria

The phase is successful when one manual pricing action produces a local capture file with candidate endpoints and enough request/response detail to attempt API replay in the next phase.
