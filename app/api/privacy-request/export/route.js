// app/api/privacy-request/export/route.js
//
// Self-service data export — the user downloads their OWN compiled
// data directly, no admin step required. Safe by construction: scoped
// to auth().userId, never an arbitrary target, so there's no way to
// pull anyone else's data through this route. Logs a fulfilled
// privacy_requests row for the audit trail (fire-and-forget — a logging
// failure should never block the actual download).
//
// GET -> downloads a JSON file of the signed-in user's own data.

import { auth } from "@clerk/nextjs/server";
import { compileUserDataExport } from "@/lib/privacyExport";
import { logFulfilledAccessRequest } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });

  const data = await compileUserDataExport(userId);
  logFulfilledAccessRequest(userId).catch(() => {});

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="my-searchllm-data.json"`,
    },
  });
}
