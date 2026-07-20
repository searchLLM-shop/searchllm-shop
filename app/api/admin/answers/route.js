import { auth, currentUser } from "@clerk/nextjs/server";
import { getDraftAnswers, setAnswerStatus, bulkPublishDrafts } from "@/lib/db";
import { isAdminEmail } from "@/lib/isAdmin";

async function guard() {
  const { userId } = await auth();
  if (!userId) return "Not signed in";
  const user = await currentUser();
  if (!isAdminEmail(user?.emailAddresses?.[0]?.emailAddress)) return "Forbidden";
  return null;
}

export async function GET() {
  const err = await guard();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });
  return Response.json({ answers: await getDraftAnswers(60) });
}

export async function PATCH(req) {
  const err = await guard();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });
  const { id, status } = await req.json();
  await setAnswerStatus(id, status);
  return Response.json({ id, status });
}

export async function POST(req) {
  const err = await guard();
  if (err) return Response.json({ error: err }, { status: err === "Forbidden" ? 403 : 401 });
  const { action } = await req.json();
  if (action !== "publish_all") return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ published: await bulkPublishDrafts() });
}
