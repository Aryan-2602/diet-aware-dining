/**
 * The one canonical set of example queries.
 *
 * Three unrelated sets used to exist — on the landing page, in the search form,
 * and as the textarea placeholder — sharing no strings, and two of the landing
 * examples named things OpenStreetMap cannot filter on ("high-protein"), so they
 * could not succeed even when typed correctly.
 *
 * Every one of these names a city: without one there is nothing to geocode and
 * the search dead-ends before it reaches Overpass.
 */
export const EXAMPLE_PROMPTS = [
  "Vegan sushi in Seattle",
  "Halal burgers with gluten-free buns in Santa Monica",
  "Vegetarian Indian restaurants near Downtown Los Angeles",
] as const;

/** Shown in the search textarea. Same shape as the examples above. */
export const SEARCH_PLACEHOLDER = 'e.g. "Gluten-free Thai food in Seattle"';
