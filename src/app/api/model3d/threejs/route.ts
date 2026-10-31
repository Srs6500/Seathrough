import { toUserFacingError } from "@/lib/errors/userFacing";
import { buildThreeModelFromImage } from "@/lib/model3d/threeFromImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8_000_000;

/** Free image → 3D: returns Three.js code for the sandboxed scene viewer. */
export async function POST(request: Request) {
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
      { error: "Use a JPEG, PNG, or WebP image under 8MB." },
      { status: 400 },
    );
  }

  try {
    const program = await buildThreeModelFromImage(
      { bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type },
      request.signal,
    );
    return Response.json(program);
  } catch (error) {
    console.error("[model3d/threejs]", error);
    return Response.json(
      { error: toUserFacingError(error, "Couldn't build the 3D model. Try again.") },
      { status: 502 },
    );
  }
}
