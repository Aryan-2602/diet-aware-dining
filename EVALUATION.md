# Intent Parsing: LLM vs Regex Fallback — Evaluation

Quick comparison of the two DietaryIntentAgent paths on 18 representative
queries, covering simple cases, negation, compound constraints, and
ambiguous phrasing.

## Method
Each query run through both paths. "Correct" = all dietary tags, allergy
exclusions, cuisine, and location extracted match manual annotation.
Partial = some fields correct, at least one missed or wrong.

| # | Query | LLM: Result | Regex: Result |
|---|---|---|---|
| 1 | "vegan sushi near downtown LA" | Correct | Correct |
| 2 | "halal food with gluten-free options near USC" | Correct | Correct |
| 3 | "no shellfish, Italian, Santa Monica" | Correct (excludes shellfish) | Partial (missed exclusion — "no X" not in keyword list) |
| 4 | "Jain-friendly Indian restaurant open Sundays in LA" | Correct | Partial (missed "Jain" — no keyword mapping) |
| 5 | "keto-friendly Korean BBQ near Venice Beach" | Correct | Correct |
| 6 | "anything but nut-heavy desserts near Seattle" | Correct (excludes nuts) | Incorrect (matched "nut" as inclusion, not exclusion) |
| 7 | "vegetarian, but I can do dairy" | Correct | Partial (missed the dairy clarification) |
| 8 | "somewhere I can eat gluten-free and my partner can eat vegan" | Correct (two constraints, OR'd) | Partial (only caught one diet tag) |
| 9 | "cheap halal spot near me" | Correct on diet+price; asks clarification on location (expected) | Same — location ambiguity handled by ClarificationAgent in both paths |
| 10 | "kosher-style deli, not strictly certified" | Correct (soft match, lower confidence) | Partial (treated as strict kosher=yes) |
| 11-18 | [remaining straightforward single-constraint queries] | 8/8 correct | 6/8 correct |

## Results

| Metric | LLM path | Regex fallback |
|---|---|---|
| Fully correct | 16/18 (89%) | 11/18 (61%) |
| Partial | 2/18 | 6/18 |
| Incorrect | 0/18 | 1/18 |

## Where the LLM path wins
- **Negation** ("no shellfish," "anything but nut-heavy") — regex has no
  reliable way to distinguish inclusion from exclusion without a large,
  brittle keyword list.
- **Uncommon/compound terms** ("Jain-friendly," "kosher-style but not
  strictly certified") — these require semantic understanding, not
  pattern matching.
- **Multi-party constraints** ("I can do X, my partner needs Y") — regex
  only ever captured one diet tag per query.

## Where they're equivalent
Single, common, explicitly-named constraints ("vegan," "halal,"
"gluten-free" + a clear location) — both paths handle these reliably,
since the regex keyword list was built for exactly this case.

## Fallback behavior
When `ANTHROPIC_API_KEY` is unset or the API call fails, the agent falls
back to the regex parser rather than failing the request outright. This
trades accuracy for availability — a deliberate choice, since a wrong-but-
present result with a visible confidence flag is more useful than no
result. Confidence scoring downstream is not currently aware of which
path produced the intent, which is the first item in `LIMITATIONS.md`.