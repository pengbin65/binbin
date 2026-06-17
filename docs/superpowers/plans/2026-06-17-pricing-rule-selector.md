# Pricing Rule Selector

## Goal

Add a control-panel pricing rule selector so new shops can use a different pass rule without changing the existing women SHEIN rule.

## Requirements

- Keep the existing women SHEIN rule as the default:
  - original price = quoted price - 10
  - pass when current selling price is greater than 70% of original price
  - also pass when official suggested price is at least 8 USD
- Add a low-price rule:
  - pass when official suggested price is at least 0.7 USD
- Send the selected rule from the browser panel to the server when starting a run.
- Pass the selected rule through the runner into the SHEIN processor.
- Show readable reasons for the new rule in the result table.

## Implementation Steps

1. Add failing tests for the new pricing rule and server/runner rule propagation.
2. Extend the pricing domain with rule IDs and low-price decisions.
3. Thread the selected rule through server start, runner, and SHEIN processor.
4. Add radio controls to the panel for selecting the rule.
5. Run targeted tests and typecheck.
6. Commit the change locally; push to GitHub only if a remote is configured.
