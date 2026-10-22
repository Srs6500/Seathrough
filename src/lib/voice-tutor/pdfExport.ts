import { jsPDF } from "jspdf";
import type { ChatMessage, DrawScene, VoiceLessonPlan } from "@/lib/voice-tutor/sessionTypes";

export async function exportVoiceSessionPdf(input: {
  label: string;
  topic: string;
  objective?: string;
  messages: ChatMessage[];
  plan?: VoiceLessonPlan | null;
  drawings?: Array<{ title: string; scene: DrawScene }>;
}): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;
  const width = doc.internal.pageSize.getWidth() - margin * 2;

  const line = (text: string, size = 11, color: [number, number, number] = [26, 43, 60]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const rows = doc.splitTextToSize(text, width) as string[];
    for (const row of rows) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(row, margin, y);
      y += size + 4;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(15, 79, 124);
  doc.text("SeeThrough — Voice Tutor session", margin, y);
  y += 28;

  line(`Topic: ${input.topic || input.label}`, 12);
  if (input.objective) line(`Objective: ${input.objective}`, 11, [61, 81, 102]);
  line(`Exported: ${new Date().toLocaleString()}`, 10, [106, 125, 144]);
  y += 10;

  line("Conversation", 14, [15, 79, 124]);
  y += 4;
  for (const message of input.messages) {
    const who = message.role === "user" ? "You" : "Tutor";
    line(`${who}: ${message.text}`, 11);
    y += 4;
  }

  if (input.plan?.beats?.length) {
    y += 8;
    line("Lesson structure (backend plan)", 14, [15, 79, 124]);
    y += 4;
    line(input.plan.objective, 11, [61, 81, 102]);
    input.plan.beats.forEach((beat, index) => {
      line(`${index + 1}. ${beat.say}`, 10);
    });
  }

  if (input.drawings?.length) {
    y += 8;
    line("Diagrams referenced", 14, [15, 79, 124]);
    for (const drawing of input.drawings) {
      line(`• ${drawing.title || drawing.scene.title || drawing.scene.kind}`, 11);
    }
  }

  const filename = `seethrough-voice-${(input.label || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}.pdf`;
  doc.save(filename);
}
