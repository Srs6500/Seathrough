import type { BrowserStreamEvent } from "@/lib/browser-experience/types";

export function browserExperienceSseResponse(
  run: (send: (event: BrowserStreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: BrowserStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      void (async () => {
        try {
          await run(send);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Something went wrong while starting the browser lesson.";
          send({ type: "error", error: message });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
