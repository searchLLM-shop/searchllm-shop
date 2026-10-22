"use client";

// "+ Add to list" — puts a product (an affiliate listing) and/or a generic
// product term on the shopper's shopping list (see app/api/shopping-list).
// Works signed-out too. The list itself lives in the account drawer.

import { useState } from "react";
import { trackEvent } from "@/lib/track";

export default function AddToListButton({ listingId = null, qcTerm = null, label = "＋ Add to list", style = {} }) {
  const [state, setState] = useState("idle"); // idle | busy | added | error
  const [message, setMessage] = useState(null);

  async function add() {
    if (state === "busy" || state === "added") return;
    setState("busy");
    setMessage(null);
    try {
      const resp = await fetch("/api/shopping-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, qcTerm }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || "Could not add to your list.");
      trackEvent("shopping_list_add", { kind: listingId ? "listing" : "term" });
      setState("added");
    } catch (e) {
      setMessage(e.message);
      setState("error");
    }
  }

  const added = state === "added";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
      <button
        type="button"
        onClick={add}
        disabled={state === "busy" || added}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500,
          color: added ? "#0F6E56" : "#854F0B", background: "transparent",
          border: `0.5px solid ${added ? "#0F6E5666" : "#854F0B66"}`, padding: "7px 14px", borderRadius: 8,
          cursor: added ? "default" : "pointer", ...style,
        }}
      >
        {added ? "✓ On your list" : state === "busy" ? "Adding…" : label}
      </button>
      {state === "error" && message && <span style={{ fontSize: 11, color: "#A03530" }}>{message}</span>}
    </span>
  );
}
