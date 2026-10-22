// app/api/shopping-list/route.js
//
// The shopper's shopping list: things they have decided to buy, collected
// across searches. Works for guests (cookie identity) and signed-in members;
// a guest's items are merged into the account the first time the member's
// list is read after signing in.
//
//   GET                         -> items (+ which quick-commerce apps are on)
//   POST  {listingId?, qcTerm?} -> add (an affiliate listing and/or a generic
//                                  product term the quick-commerce links search)
//   PATCH {id, bought}          -> tick / untick
//   DELETE ?id=                 -> remove

import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateGuestId } from "@/lib/guestId";
import {
  addShoppingListItem, getShoppingList, setShoppingListItemBought, removeShoppingListItem,
  mergeGuestShoppingList, recordEvent, query, SHOPPING_LIST_MAX,
} from "@/lib/db";
import { cleanTerm, enabledPlatforms, QC_PLATFORMS } from "@/lib/quickCommerce";

async function resolveIdentity() {
  const { userId } = await auth();
  return { userId, identity: userId || (await getOrCreateGuestId()) };
}

export async function GET() {
  try {
    const { userId, identity } = await resolveIdentity();
    if (userId) {
      // Read the guest cookie without creating one.
      const guestId = (await cookies()).get("sllm_guest_id")?.value;
      if (guestId) await mergeGuestShoppingList(guestId, userId).catch((e) => console.error("List merge failed:", e.message));
    }
    const items = await getShoppingList(identity);
    return Response.json({
      items,
      max: SHOPPING_LIST_MAX,
      platforms: enabledPlatforms().map((id) => ({ id, name: QC_PLATFORMS[id].name })),
    });
  } catch (err) {
    console.error("Shopping list read failed:", err.message);
    return Response.json({ items: [], max: SHOPPING_LIST_MAX, platforms: [] });
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const listingId = Number.isInteger(body.listingId) ? body.listingId : null;
  const term = cleanTerm(body.qcTerm) || null;
  if (!listingId && !term) return Response.json({ error: "Nothing to add" }, { status: 400 });

  try {
    const { identity } = await resolveIdentity();

    let title = term;
    let network = null;
    if (listingId) {
      const { rows } = await query(
        `SELECT brand, product, network FROM listings WHERE id = $1 AND status = 'approved'`,
        [listingId]
      );
      if (!rows.length) return Response.json({ error: "That product isn't available any more." }, { status: 404 });
      title = [rows[0].brand, rows[0].product].filter(Boolean).join(" ").slice(0, 160);
      network = rows[0].network;
    }

    const result = await addShoppingListItem({ identity, listingId, qcTerm: term, title });
    if (result.full) return Response.json({ error: `Your list is full (${SHOPPING_LIST_MAX} items). Remove something to add more.` }, { status: 409 });

    if (result.added) {
      // Basket intent, counted without any query text.
      recordEvent({ eventType: "list_add", identity, listingId, network }).catch(() => {});
    }
    return Response.json({ ok: true, added: result.added });
  } catch (err) {
    console.error("Shopping list add failed:", err.message);
    return Response.json({ error: "Could not add to your list." }, { status: 500 });
  }
}

export async function PATCH(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  try {
    const { identity } = await resolveIdentity();
    return Response.json({ ok: await setShoppingListItemBought(identity, id, body.bought === true) });
  } catch (err) {
    console.error("Shopping list update failed:", err.message);
    return Response.json({ error: "Could not update." }, { status: 500 });
  }
}

export async function DELETE(req) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return Response.json({ error: "Bad id" }, { status: 400 });
  try {
    const { identity } = await resolveIdentity();
    return Response.json({ ok: await removeShoppingListItem(identity, id) });
  } catch (err) {
    console.error("Shopping list remove failed:", err.message);
    return Response.json({ error: "Could not remove." }, { status: 500 });
  }
}
