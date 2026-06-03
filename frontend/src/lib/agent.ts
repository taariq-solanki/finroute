const ENDPOINT = process.env.NEXT_PUBLIC_AGENTCORE_ENDPOINT || "";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/**
 * Strip <thinking>...</thinking> tags from streamed content.
 * These are internal chain-of-thought from the model and shouldn't be shown.
 */
function stripThinkingTags(text: string): string {
  // Remove complete <thinking>...</thinking> blocks
  let cleaned = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Remove opening tag if block hasn't closed yet
  cleaned = cleaned.replace(/<thinking>[\s\S]*/gi, "");
  // Remove stray closing tags
  cleaned = cleaned.replace(/<\/thinking>/gi, "");
  return cleaned;
}

/**
 * Send a message to the AgentCore runtime endpoint.
 * Uses the same invocation pattern as the deployment notebook:
 * POST to /runtimes/{arn}/invocations with SSE streaming response.
 */
export async function sendMessage(
  prompt: string,
  accessToken: string,
  sessionId: string,
  actorId: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void
): Promise<void> {
  try {
    const response = await fetch(`${ENDPOINT}?qualifier=DEFAULT`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
      },
      body: JSON.stringify({
        prompt,
        session_id: sessionId,
        actor_id: actorId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      onError(`Request failed: ${response.status} - ${errorText}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let insideThinking = false;
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE-style lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          let data = line.slice(6).replace(/"/g, "");
          if (data === "[DONE]") {
            onDone();
            return;
          }

          // Track thinking state across chunks
          if (data.includes("<thinking>")) {
            insideThinking = true;
          }
          if (data.includes("</thinking>")) {
            insideThinking = false;
            data = data.replace(/<\/thinking>/gi, "");
          }

          // Skip content inside thinking blocks
          if (insideThinking) {
            continue;
          }

          // Clean any residual thinking tags
          data = stripThinkingTags(data);

          if (data.trim()) {
            fullResponse += data;
            onChunk(data);
          }
        } else if (line.trim() && !insideThinking) {
          const text = line.replace(/"/g, "");
          const cleaned = stripThinkingTags(text);
          if (cleaned.trim()) {
            onChunk("\n" + cleaned);
          }
        }
      }
    }

    onDone();
  } catch (error) {
    onError(error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Generate a unique session ID (must be at least 33 characters for AgentCore).
 */
export function generateSessionId(): string {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}
