"use client";

// components/TrendingStrip.jsx
//
// "Trending now" pills on the homepage idle state — real aggregate
// search demand (/api/trending, lib/db.js's getPublicTrendingCategories),
// not hardcoded examples like ResearchTab's CHIP_EXAMPLES. Anonymous,
// matched-only categories from the last 7 days; fails silently (renders
// nothing) if there's too little data yet or the fetch errors, since an
// empty/broken "Trending now" row would look worse than no row at all.

import { useEffect, useState } from "react";

export default function TrendingStrip({ onPick }) {
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/trending")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.categories)) setCategories(data.categories);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!categories.length) return null;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: -12, marginBottom: 22 }}>
      <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500 }}>Trending now:</span>
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onPick(cat)}
          className="sllm-example-chip"
          style={{
            background: "none",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: 14,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--color-text-secondary, var(--color-text-tertiary))",
            cursor: "pointer",
            textTransform: "capitalize",
            whiteSpace: "nowrap",
          }}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
