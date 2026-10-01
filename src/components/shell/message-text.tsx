import { toSegments } from "@/lib/portal/message-text";

/** Renders an agent/customer message with **bold** and line breaks, no raw markdown. */
export function MessageText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {toSegments(text).map((s, i) =>
        s.bold ? <strong key={i} className="font-semibold">{s.text}</strong> : s.text,
      )}
    </p>
  );
}
