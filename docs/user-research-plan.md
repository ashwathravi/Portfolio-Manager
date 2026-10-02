# User research plan

From the Sep 2026 design review. The product shipped against these
hypotheses (Today as triage, policy at order time, one ticket, labelled
example data); the studies below check them with real use.

## Jobs to be done

1. When the market opens, I want to know in ten seconds whether anything needs action, so I don't make unforced errors.
2. Before I trade, I want my own rules checked against the order, so impulse doesn't override my plan.
3. At the end of the week, I want to see whether I followed my process, separately from whether I made money.

## Hypotheses and what shipped

| # | Hypothesis | Shipped as | Signal that it's wrong |
|---|---|---|---|
| H1 | Users open the app for "anything need me?" far more often than for analysis. | Today leads with net worth and a ranked "Needs your attention" list. | Diary entries mostly start from Performance or Research, not Today. |
| H2 | Policy breaches matter at order time and in the weekly review; a permanent grid is noise. | One-line policy strip with checks behind a disclosure; breaches surface in triage and on the Trade ticket. | Participants open the full checks on most visits, or miss breaches. |
| H3 | Nobody needs three execution layouts. | One ticket (Focus); Checkout and Terminal removed. | Task 3 time is worse than the old Focus baseline, or users ask for a keyboard mode. |
| H4 | Sample numbers beside real ones make users doubt every number. | Every example figure is tagged Sample; a switch hides them. | Participants can't tell which numbers are theirs (ask after task 1). |

## Studies

| Method | Who | Length | Answers |
|---|---|---|---|
| Diary study | The owner + 4 active investors | 2 weeks | Why each session started and which page answered it (H1). One short entry per session: trigger, first page, what they did. |
| Moderated usability test | 5–6 participants | 45 min each | The five tasks below, timed, with errors and confidence (H2–H4). Run on the current build and keep the recordings as a baseline. |
| Open card sort | 15 participants | Async, ~15 min | How people group the 21 former page names; confirms or reshapes the 8 destinations. |

## Usability tasks

1. "How much are you up or down today, and why?" — success: answer from Today within 30s.
2. "Is anything breaking your risk rules? What would you do about it?" — success: finds the breach and the linked fix.
3. "Draft a 20-share NVDA buy and link it to your thesis." — success: rationale complete, policy check read, under 2 minutes.
4. "Find your worst decision last month." — success: reaches Performance › Behaviour or the journal.
5. "A fund you track changed its 13F. Does it affect you?" — success: Alpha Radar overlap read in Research.

## Interview guide (usability sessions)

- **Warm-up (5 min):** how they track investments today; last trade they regret.
- **Context (10 min):** their morning routine; where rules live (head, spreadsheet, broker).
- **Tasks (20 min):** the five tasks, think-aloud, no hints.
- **Reaction (5 min):** which numbers they trusted and why; what "Sample" meant to them.
- **Wrap-up (5 min):** what they'd remove; anything missing.

## Synthesis

Affinity-map observations by job; score each finding by impact × frequency;
feed changes back into `docs/current-focus.md`.
