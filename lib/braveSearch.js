// lib/braveSearch.js
//
// Superseded by lib/search.js, which made the search provider swappable
// (Brave / Serper / Tavily) behind one interface. Kept as a re-export so
// any older import path keeps working; new code should import from
// "@/lib/search" directly.

export {
  shouldSearch,
  isFactSensitive,
  searchDepth,
  formatSearchContext,
  THIN_RATING_COUNT,
  webSearch,
  webSearch as braveSearch,
} from "@/lib/search";
