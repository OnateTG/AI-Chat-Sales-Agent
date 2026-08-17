# Engine-level stress test scenarios (Evaluation Protocol §2)

Per the protocol: "For each, before running: write down the expected state
after the customer's message... and the expected next action... A mismatch
is a defect, not a matter of interpretation." That expected-outcome column
is deliberately left blank below — filling it in is real work that
deserves someone's actual attention per scenario, not a placeholder pass.

| # | Scenario | Expected state/action (fill in before running) |
|---|---|---|
| 1 | Customer answers three questions in one message | |
| 2 | Customer contradicts themselves on a factual detail | |
| 3 | Customer contradicts themselves on their goal (soft conflict) | |
| 4 | Customer asks for pricing immediately | |
| 5 | Customer gives a vague, minimal goal | |
| 6 | Customer changes their mind mid-conversation | |
| 7 | Customer ignores a question and changes subject | |
| 8 | Customer asks an unrelated question mid-flow | |
| 9 | Customer goes quiet, then returns later | |
| 10 | Customer's situation doesn't map to any `available_option` | |
