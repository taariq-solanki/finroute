/**
 * Mock fetch utility for testing SSE streaming, JSON responses, and error scenarios.
 * Provides configurable responses for the agent communication layer.
 */

export interface MockFetchResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | ReadableStream<Uint8Array>;
  ok?: boolean;
}

export interface SSEEvent {
  data: string;
  event?: string;
  id?: string;
}

/**
 * Creates a ReadableStream that emits SSE-formatted chunks.
 * Useful for testing the SSE parser with controlled streaming data.
 */
export function createSSEStream(events: SSEEvent[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        let chunk = "";
        if (event.event) {
          chunk += `event: ${event.event}\n`;
        }
        if (event.id) {
          chunk += `id: ${event.id}\n`;
        }
        chunk += `data: ${event.data}\n\n`;

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/**
 * Creates a ReadableStream from raw string chunks (no SSE formatting).
 * Useful for testing raw chunk processing and UTF-8 boundary handling.
 */
export function createRawStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/**
 * Creates a ReadableStream from raw byte arrays.
 * Useful for testing multi-byte UTF-8 split across chunk boundaries.
 */
export function createByteStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/**
 * Installs a mock fetch implementation on the global scope.
 * Returns a controller object to configure responses and inspect calls.
 */
export function installMockFetch() {
  const calls: { url: string; options?: RequestInit }[] = [];
  let responseQueue: MockFetchResponse[] = [];
  let defaultResponse: MockFetchResponse = {
    status: 200,
    statusText: "OK",
    ok: true,
    headers: { "content-type": "application/json" },
    body: "{}",
  };

  const mockFetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, options });

    const response = responseQueue.shift() || defaultResponse;
    const headers = new Headers(response.headers || {});

    return {
      ok: response.ok ?? (response.status ? response.status >= 200 && response.status < 300 : true),
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      headers,
      json: async () => {
        if (typeof response.body === "string") {
          return JSON.parse(response.body);
        }
        throw new Error("Cannot parse stream as JSON");
      },
      text: async () => {
        if (typeof response.body === "string") {
          return response.body;
        }
        throw new Error("Cannot read stream as text");
      },
      body: typeof response.body === "string" ? null : response.body,
      getReader: () => {
        if (typeof response.body !== "string" && response.body) {
          return response.body.getReader();
        }
        throw new Error("No readable stream available");
      },
    } as unknown as Response;
  });

  global.fetch = mockFetch as unknown as typeof global.fetch;

  return {
    /** All recorded fetch calls */
    get calls() {
      return calls;
    },

    /** The underlying jest mock function */
    mock: mockFetch,

    /** Set the default response for all unqueued requests */
    setDefault(response: MockFetchResponse) {
      defaultResponse = response;
    },

    /** Queue a specific response for the next request */
    enqueue(response: MockFetchResponse) {
      responseQueue.push(response);
    },

    /** Queue multiple responses in order */
    enqueueAll(responses: MockFetchResponse[]) {
      responseQueue.push(...responses);
    },

    /** Enqueue a JSON response */
    enqueueJson(data: unknown, status = 200) {
      responseQueue.push({
        status,
        ok: status >= 200 && status < 300,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    },

    /** Enqueue an SSE streaming response */
    enqueueSSE(events: SSEEvent[]) {
      responseQueue.push({
        status: 200,
        ok: true,
        headers: { "content-type": "text/event-stream" },
        body: createSSEStream(events),
      });
    },

    /** Enqueue a network error */
    enqueueNetworkError(message = "Network error") {
      mockFetch.mockRejectedValueOnce(new Error(message));
    },

    /** Reset all state */
    reset() {
      calls.length = 0;
      responseQueue = [];
      mockFetch.mockClear();
    },

    /** Restore original fetch */
    restore() {
      if ((global.fetch as unknown) === mockFetch) {
        delete (global as Record<string, unknown>).fetch;
      }
    },
  };
}
