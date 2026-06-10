# Hubstudio SHEIN Pricing Review Design

## Goal

Build a local web console that connects to the installed Hubstudio fingerprint browser, opens the profile named `女装希音1`, enters the SHEIN seller backend, and processes all pages in the New Product Negotiation area.

The first version focuses only on checking prices and rejecting products that do not meet the pricing rules. It does not save Excel or CSV files, does not manage account passwords, and does not process verification codes automatically.

## User Workflow

1. The user opens the local web console.
2. The user clicks Start.
3. The system connects to the Hubstudio local API.
4. The system searches for the Hubstudio profile named `女装希音1`.
5. The system starts that profile and connects to the browser it opens.
6. The system enters the SHEIN seller backend.
7. If the login page appears, the system clicks Login because the account and password are already saved in the browser profile.
8. If verification, two-factor authentication, or login failure appears, the system pauses and asks the user to handle it manually.
9. The system enters the SHEIN New Product Negotiation page.
10. The system reads every product on the current page, processes each product, then continues through all pages until there is no next page.
11. The web console displays current status, logs, and the current run's result table.

## Pricing Rules

For each product, the system reads:

- Quoted price
- Current selling price
- Official suggested price

The derived values are:

- Original price = `quoted price - 10`
- 70 percent threshold = `original price * 0.7`

A product passes if either condition is true:

- Current selling price is greater than the 70 percent threshold.
- Official suggested price is greater than or equal to `8`.

A product fails only when both conditions are false.

Failed products are rejected in the SHEIN page. No rejection reason is entered.

The comparison is strict for the 70 percent rule. If the current selling price is exactly equal to the 70 percent threshold, that condition does not pass.

Example:

- Quoted price: `100`
- Original price: `90`
- 70 percent threshold: `63`
- Current selling price `64`: passes
- Current selling price `63`: fails this condition
- Current selling price `62.99`: fails this condition
- Official suggested price `8`: passes even if the current selling price fails the 70 percent condition

## System Components

### Web Console

The web console provides:

- Start, Pause, and Stop buttons
- Current task state: idle, connecting, starting profile, logging in, navigating, pricing, paused, completed, or failed
- Live log messages
- Current run results with product information, quoted price, original price, 70 percent threshold, current selling price, official suggested price, pass or fail status, action taken, and error message if any

Results only need to exist for the current page session in the first version. Refreshing or closing the console may clear the results.

### Hubstudio Integration

This module is responsible for:

- Discovering or configuring the Hubstudio local API address, port, and token if required
- Searching for the browser profile named `女装希音1`
- Starting the profile
- Getting the browser control connection information, such as a debugging URL or browser endpoint
- Reporting clear errors to the console when the API is unavailable, the profile is not found, or the browser connection cannot be obtained

The exact Hubstudio API details are a required discovery step before implementation because the API configuration is not currently known.

### Browser Control

This module is responsible for:

- Connecting to the browser instance started by Hubstudio
- Detecting whether SHEIN is already logged in
- Clicking Login when the saved account and password are available on the login page
- Pausing when verification, two-factor authentication, login failure, or unexpected account state appears
- Navigating to the New Product Negotiation page

### SHEIN New Product Negotiation Processor

This module is responsible for:

- Verifying that the current page is the New Product Negotiation page before taking reject actions
- Reading product rows on the current page
- Extracting quoted price, current selling price, and official suggested price
- Normalizing price text by removing currency symbols, commas, and extra spaces
- Applying the pricing rules
- Recording passing products without clicking approval or submit actions
- Rejecting failed products without entering a rejection reason
- Marking rejected products as rejected in the console after the page confirms the action
- Moving through all pages until no next page remains

### Task State And Retry Control

This module is responsible for:

- Managing Start, Pause, and Stop state
- Letting Pause take effect after the current product is processed
- Stopping all future page turns and clicks after Stop
- Retrying temporary failures such as page load timeout, missing elements, price extraction failure, or reject button click failure
- Pausing after repeated failure so the user can inspect the page
- Preventing the same product from being rejected twice in one run when the page refreshes or retries

## Error Handling

The system retries temporary failures a small number of times before pausing.

Temporary failures include:

- Page load timeout
- Product row not fully loaded
- Price text missing during the first read
- Reject button temporarily unavailable
- Next page button temporarily unavailable

The system pauses immediately for high-risk states:

- Hubstudio profile cannot start
- Browser cannot be controlled
- SHEIN login verification appears
- Two-factor authentication appears
- SHEIN session expires
- The current page is not recognized as New Product Negotiation
- Product price data remains unreadable after retries

When price data cannot be read reliably, the product must not be rejected.

## Safety Boundaries

The first version intentionally excludes:

- Excel or CSV export
- Importing product data from external files
- Long-term history storage
- Multi-profile or parallel processing
- Automatic verification code handling
- Automatic password management
- Automatic approval or submit actions for passing products
- Automatic price modification

Reject actions are allowed only after the page has been verified as the SHEIN New Product Negotiation page and the product row has valid price data.

## Acceptance Criteria

Hubstudio integration is accepted when:

- The system can find and start `女装希音1`.
- The system can connect to the browser started by that profile.
- API failures are shown clearly in the web console.

Login and navigation are accepted when:

- The system can continue if SHEIN is already logged in.
- The system can click Login when saved credentials are present.
- The system pauses for verification, two-factor authentication, or login failure.
- The system reaches the New Product Negotiation page.

Price reading is accepted when:

- The system reads quoted price, current selling price, and official suggested price from the product list.
- Currency symbols, commas, and extra spaces do not break numeric parsing.
- Missing or invalid price values do not cause rejection.

Pricing logic is accepted when:

- Quoted price `100`, current selling price `64`, official suggested price below `8`: passes.
- Quoted price `100`, current selling price `63`, official suggested price below `8`: fails.
- Quoted price `100`, current selling price `62.99`, official suggested price below `8`: fails.
- Quoted price `100`, current selling price `62.99`, official suggested price `8`: passes.

Page processing is accepted when:

- Passing products are recorded only.
- Failed products are rejected without a rejection reason.
- Reject success is shown in the console.
- The system processes all pages until no next page remains.

Console controls are accepted when:

- Start begins the task.
- Pause waits for the current product to finish, then pauses.
- Stop prevents further processing.
- Status, logs, and result rows update during the run.

Retry behavior is accepted when:

- Temporary page or element failures are retried.
- Repeated failures pause the task instead of continuing unsafe actions.
- Failure reasons are visible in the console.
