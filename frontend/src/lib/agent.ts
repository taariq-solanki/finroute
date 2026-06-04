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
  // Convert literal \n sequences to actual newlines
  cleaned = cleaned.replace(/\\n/g, "\n");
  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();
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
    let fullResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE-style lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        let data = "";

        if (line.startsWith("data: ")) {
          data = line.slice(6).replace(/"/g, "");
          if (data === "[DONE]") {
            onDone();
            return;
          }
        } else if (line.trim()) {
          data = line.replace(/"/g, "");
        } else {
          continue;
        }

        if (data.trim()) {
          fullResponse += data;
          // Strip all thinking tags from the accumulated response and emit the clean version
          const cleaned = stripThinkingTags(fullResponse);
          onChunk(cleaned);
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
  const seg = () => Math.random().toString(36).substring(2);
  let id = seg() + seg() + seg() + seg();
  // Ensure minimum 33 characters
  while (id.length < 36) {
    id += Math.random().toString(36).substring(2);
  }
  return id.substring(0, 36);
}
