import { envPresence } from "@/lib/env";
import { toUserFacingError } from "@/lib/errors/userFacing";
import { getTripoBalance, startImageToModel } from "@/lib/model3d/tripo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = ["image/jpeg", "image/png"];
const MAX_BYTES = 20_000_000;

/** Start an image → 3D job. Body: multipart `image` (JPEG/PNG). */
export async function POST(request: Request) {
  if (!envPresence().TRIPO_API_KEY) {
    return Response.json(
      { error: "3D models aren't set up yet (TRIPO_API_KEY missing)." },
      { status: 503 },
    );
  }

  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("image");
  } catch {
    /* handled below */
  }
  if (!(file instanceof File) || file.size <= 0) {
    return Response.json({ error: "Attach an image to turn into 3D." }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) {
    return Response.json(
      { error: "Use a JPEG or PNG image under 20MB." },
      { status: 400 },
    );
  }

  try {
    const taskId = await startImageToModel({
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      fileName: file.name || (file.type === "image/png" ? "image.png" : "image.jpg"),
    });
    return Response.json({ taskId });
  } catch (error) {
    console.error("[model3d/create]", error);
    // Tripo freezes credits up front, so an empty account fails at creation.
    if ((await getTripoBalance()) === 0) {
      return Response.json(
        { error: "The Tripo account is out of credits — top it up to make 3D models." },
        { status: 402 },
      );
    }
    return Response.json(
      { error: toUserFacingError(error, "Couldn't start the 3D model. Try again.") },
      { status: 502 },
    );
  }
}
