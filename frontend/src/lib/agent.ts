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
 * Configuration for the SSE parser callbacks.
 */
interface SSEParserConfig {
  onChunk: (accumulatedContent: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

/**
 * SSEParser handles Server-Sent Events parsing with correct content preservation.
 *
 * Key behaviors:
 * - Lines starting with "data: " have content extracted after the prefix
 * - Only outer protocol-level wrapping quotes are stripped (not internal quotes)
 * - "[DONE]" after prefix stripping is treated as termination signal, not content
 * - Non-data non-empty lines are skipped with a console warning
 * - Empty lines (SSE event boundaries) are skipped silently
 * - Premature stream termination delivers accumulated content via onError
 */
class SSEParser {
  private buffer: string = "";
  private fullResponse: string = "";
  private receivedDone: boolean = false;

  constructor(private config: SSEParserConfig) {}

  /**
   * Feed raw decoded text from the fetch reader into the parser.
   * Handles chunk boundaries by buffering incomplete lines.
   */
  processChunk(rawText: string): void {
    this.buffer += rawText;

    // Split on newlines; the last element may be an incomplete line
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    this.processLines(lines);
  }

  /**
   * Parse buffered lines into SSE events.
   * Applies outer-quote stripping only, preserving all internal content.
   */
  private processLines(lines: string[]): void {
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        // Extract content after the "data: " prefix (6 characters)
        let data = line.slice(6);

        // Strip only outer protocol-level wrapping quotes
        if (data.startsWith('"') && data.endsWith('"')) {
          data = data.slice(1, -1);
        }

        // Check for stream termination sentinel
        if (data === "[DONE]") {
          this.receivedDone = true;
          this.config.onDone();
          return;
        }

        // Append content and emit cleaned accumulated response
        if (data.trim()) {
          this.fullResponse += data;
          const cleaned = stripThinkingTags(this.fullResponse);
          this.config.onChunk(cleaned);
        }
      } else if (line.trim()) {
        // Non-data, non-empty line - skip without appending, log warning
        console.warn(
          `[SSEParser] Skipping non-data line: "${line.substring(0, 100)}"`
        );
      }
      // Empty lines (SSE event boundaries) are silently skipped
    }
  }

  /**
   * Signal that the stream has ended. If [DONE] was not received,
   * treat this as a normal stream completion (AgentCore does not send [DONE]).
   * Only invoke error callback if no content was received at all.
   */
  finalize(): void {
    // Process any remaining buffered content
    if (this.buffer.trim()) {
      this.processLines([this.buffer]);
      this.buffer = "";
    }

    if (!this.receivedDone) {
      // AgentCore streams end normally without [DONE] signal.
      // Only treat as error if we received NO content at all.
      if (!this.fullResponse) {
        this.config.onError(
          "Stream ended without receiving any content"
        );
      } else {
        // Normal completion - call onDone
        this.config.onDone();
      }
    }
  }
}

/**
 * Parsed WAF error information returned when a request is blocked.
 */
export interface WafErrorInfo {
  status: number;
  message: string;
  retryAfterSeconds?: number;
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
  onError: (error: string, wafError?: WafErrorInfo) => void
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
      // Handle WAF-specific HTTP status codes
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
        const seconds = isNaN(retryAfterSeconds) ? 60 : retryAfterSeconds;
        const message = `Rate limit reached. You can send a new message in ${seconds} seconds.`;
        onError(message, { status: 429, message, retryAfterSeconds: seconds });
        return;
      }

      if (response.status === 413) {
        const message = "Message too long for this service. Please shorten your message.";
        onError(message, { status: 413, message });
        return;
      }

      if (response.status === 403) {
        const message = "Request blocked by security policy. Please modify your message and try again.";
        onError(message, { status: 403, message });
        return;
      }

      // Generic error fallback for other status codes
      const errorText = await response.text();
      onError(`Request failed: ${response.status} - ${errorText}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError("No response body");
      return;
    }

    // Use TextDecoder with stream mode to handle multi-byte UTF-8
    // characters that may be split across chunk boundaries
    const decoder = new TextDecoder("utf-8", { fatal: false });

    const parser = new SSEParser({
      onChunk,
      onDone,
      onError,
    });

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Flush any remaining bytes from the decoder
        const remaining = decoder.decode(new Uint8Array(0), { stream: false });
        if (remaining) {
          parser.processChunk(remaining);
        }
        parser.finalize();
        break;
      }

      // Decode with stream: true to handle multi-byte characters split across chunks
      const text = decoder.decode(value, { stream: true });
      parser.processChunk(text);
    }
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
