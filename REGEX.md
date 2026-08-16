# Known Limitations

Honest gaps in the current system, in rough priority order.

1. **Confidence scoring doesn't know which intent-parsing path was used.**
   A result derived from a regex-fallback parse (weaker on negation and
   compound constraints, see EVALUATION.md) is scored with the same
   confidence logic as an LLM-parsed one. The TrustConfidenceAgent should
   ideally discount confidence when the fallback path fired, so a user
   isn't shown high confidence built on a shakier intent extraction.

2. **OSM dietary tag coverage is inconsistent by region.** Confidence
   scoring rewards data completeness, but that just reflects how well a
   given area has been mapped by contributors — not the restaurant's
   actual practices. A dense city center will show higher-confidence
   results than a suburb with the same real-world dietary accommodation,
   purely because more mappers have tagged it.

3. **No live monitoring on the free APIs (Overpass, Nominatim).** Both
   are community-run and rate-limited with no SLA. There's no retry/backoff
   or user-facing status indicator if either degrades or goes down —
   the request just fails.

4. **Evaluation set is small and manually annotated (18 queries).** Good
   enough to validate the LLM-vs-regex tradeoff directionally, not enough
   to make a statistically confident accuracy claim. A production version
   would need a larger, ideally crowd-sourced or expert-reviewed set.

5. **Review-count proxy in confidence scoring is a placeholder.** OSM
   doesn't have a native review system, so this signal is weaker than
   the name implies and shouldn't be weighted as heavily as it currently is.

## What I'd do with more time
Fix #1 first — it's the cheapest and most directly affects whether a user
can trust the confidence score they're shown, which is the core promise
of the whole system. #4 second, since it's what would let me make a real
claim about #1's fix actually working.