import ReactMarkdown from "react-markdown";
import type { ChatMessage as ChatMessageType } from "../lib/agent";
import { sanitizeHtml } from "../lib/sanitizer";

interface ChatMessageProps {
  message: ChatMessageType;
}

// Visual metadata for the routing chip (which specialist + Decider confidence).
const ROUTE_META: Record<string, { label: string; emoji: string; cls: string }> = {
  budget: { label: "Budget agent", emoji: "💰", cls: "route-budget" },
  investment: { label: "Investment agent", emoji: "📈", cls: "route-investment" },
  both: { label: "Both specialists", emoji: "🔀", cls: "route-both" },
};

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const routing = message.routing;
  // When Decider wasn't confident enough, the LLM chose the specialist: say so.
  const meta = routing
    ? routing.escalated
      ? { label: "Escalated to LLM", emoji: "🧠", cls: "route-escalate" }
      : ROUTE_META[routing.route]
    : undefined;

  return (
    <div className={`message ${isUser ? "user" : "assistant"}`}>
      {/* Routing visualization — makes the Decider decision visible */}
      {!isUser && routing && meta && (
        <div
          className="routing-chip"
          title={
            routing.escalated
              ? "Strands Decider 2B was not confident enough, so the LLM chose"
              : "Routed by Strands Decider 2B"
          }
        >
          <span className={`route-dot ${meta.cls}`}>{meta.emoji}</span>
          <span>{meta.label}</span>
          <span className="conf-bar">
            <span
              className="conf-fill"
              style={{ width: `${Math.round(routing.confidence * 100)}%` }}
            />
          </span>
          <span className="conf-val">
            {Math.round(routing.confidence * 100)}%
          </span>
        </div>
      )}

      <div className="message-bubble">
        {isUser ? (
          <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>
        ) : (
          <ReactMarkdown>{sanitizeHtml(message.content || "")}</ReactMarkdown>
        )}
        <p className="message-time">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
