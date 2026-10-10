import { useState, useRef, useEffect, useCallback } from "react";
import Head from "next/head";
import ChatInput from "../src/components/ChatInput";
import ChatMessage from "../src/components/ChatMessage";
import LoginForm from "../src/components/LoginForm";
import {
  signIn,
  signOut,
  isAuthenticated,
  getIdToken,
  setOnSessionExpired,
  preserveConversationHistory,
  restoreConversationHistory,
  ChatMessage as AuthChatMessage,
} from "../src/lib/auth";
import {
  sendMessage,
  generateSessionId,
  ChatMessage as ChatMessageType,
  WafErrorInfo,
} from "../src/lib/agent";

const SUGGESTIONS = [
  "Create a monthly budget for $6,000 income",
  "Analyze AAPL and MSFT stock performance",
  "Build a conservative portfolio for $25K",
  "Compare NVDA, TSLA, and META over 6 months",
  "What's the 50/30/20 rule for budgeting?",
  "How should I allocate savings for insurance premiums?",
];

export default function Home() {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionId] = useState(generateSessionId);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check in-memory auth state on mount
    setLoggedIn(isAuthenticated());
    setAuthChecked(true);

    // Restore any preserved conversation history from a prior session expiry
    const restored = restoreConversationHistory();
    if (restored && restored.length > 0) {
      const restoredMessages: ChatMessageType[] = restored.map((m) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
      setMessages(restoredMessages);
    }
  }, []);

  // Wire the session-expiry callback so expiry surfaces without a send-first.
  // handleSessionExpired() in auth.ts preserves messages before invoking this,
  // and restoreConversationHistory (mount effect) repopulates them on re-login.
  useEffect(() => {
    setOnSessionExpired(() => {
      setLoggedIn(false);
      setSessionExpired(true);
    });
    return () => setOnSessionExpired(null);
  }, []);

  // Cleanup countdown timer on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Preserve conversation history whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      const serializable: AuthChatMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
      }));
      preserveConversationHistory(serializable);
    }
  }, [messages]);

  const handleLogin = async (username: string, password: string) => {
    setAuthError(null);
    try {
      await signIn(username, password);
      setSessionExpired(false);
      setLoggedIn(true);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Authentication failed";
      setAuthError(errorMessage);
    }
  };

  const handleLogout = () => {
    signOut();
    setLoggedIn(false);
    setMessages([]);
  };

  const startRateLimitCountdown = useCallback((seconds: number) => {
    // Clear any existing countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
    }
    setRateLimitCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setRateLimitCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!loggedIn) return;

      let idToken: string;
      try {
        idToken = await getIdToken();
      } catch {
        // Session expired via the send path. The onSessionExpired callback
        // already flips state; set it here too in case the callback was unset.
        setLoggedIn(false);
        setSessionExpired(true);
        return;
      }

      const userMessage: ChatMessageType = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        role: "user",
        content,
        timestamp: new Date(),
      };

      const assistantMessage: ChatMessageType = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2) + "a",
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      sendMessage(
        content,
        idToken,
        sessionId,
        "default_user",
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: chunk,
              };
            }
            return updated;
          });
        },
        () => setIsStreaming(false),
        (error, wafError?: WafErrorInfo) => {
          // Start countdown timer for rate limit responses
          if (wafError?.status === 429 && wafError.retryAfterSeconds) {
            startRateLimitCountdown(wafError.retryAfterSeconds);
          }

          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: `❌ Error: ${error}`,
              };
            }
            return updated;
          });
          setIsStreaming(false);
        }
      );
    },
    [loggedIn, sessionId, startRateLimitCountdown]
  );

  if (!authChecked) {
    return (
      <div className="loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <>
        <Head>
          <title>Sign In — NEXT Insurance Financial Advisor</title>
        </Head>
        {sessionExpired && (
          <div className="session-expired-banner" role="alert">
            Your session expired, please sign in again.
          </div>
        )}
        <LoginForm onLogin={handleLogin} error={authError} />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Financial Advisor — NEXT Insurance</title>
      </Head>
      <div className="app-container">
        {/* Header */}
        <header className="header">
          <div className="header-brand">
            <div className="header-logo">NI</div>
            <div>
              <h1>Financial Advisor</h1>
              <p>Budget planning &bull; Investment analysis &bull; Insurance guidance</p>
            </div>
          </div>
          <button onClick={handleLogout} className="signout-btn">
            Sign Out
          </button>
        </header>

        {/* Chat Area */}
        <main className="chat-area">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="icon">💼</div>
              <h2>How can I help with your finances today?</h2>
              <p>
                Get personalized budget advice, investment portfolio
                recommendations, stock analysis, and insurance planning guidance.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}

          {isStreaming && (
            <div className="streaming">
              <div className="dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
              Analyzing...
            </div>
          )}

          <div ref={chatEndRef} />
        </main>

        {/* Input Area */}
        <div className="input-area">
          {rateLimitCountdown > 0 && (
            <div className="rate-limit-banner" role="alert">
              ⏳ Rate limit reached. You can send a new message in {rateLimitCountdown} second{rateLimitCountdown !== 1 ? "s" : ""}.
            </div>
          )}
          <ChatInput onSend={handleSend} disabled={isStreaming || rateLimitCountdown > 0} />
        </div>

        {/* Footer Branding */}
        <div className="footer-brand">
          <a
            href="https://www.nextinsurance.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            NEXT Insurance
          </a>
          {" "}&bull; AI-Powered Financial Intelligence
          <div className="powered-by">Powered by CloudAge</div>
        </div>
      </div>
    </>
  );
}
