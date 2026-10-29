import { getUserFromRequest } from "@/lib/auth/requestUser";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { answerFeatureQuestion, xrayAskSchema } from "@/lib/xray/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = xrayAskSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Ask a question about this feature first." },
      { status: 400 },
    );
  }

  try {
    const result = await answerFeatureQuestion({
      question: parsed.data.question,
      feature: parsed.data.feature,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: toUserFacingError(
          error,
          "Could not explain that feature. Try again in a moment.",
        ),
      },
      { status: 502 },
    );
  }
}
