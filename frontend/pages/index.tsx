import { useState, useRef, useEffect, useCallback } from "react";
import Head from "next/head";
import ChatInput from "../src/components/ChatInput";
import ChatMessage from "../src/components/ChatMessage";
import LoginForm from "../src/components/LoginForm";
import { signIn, signOut, getCurrentSession, AuthTokens } from "../src/lib/auth";
import {
  sendMessage,
  generateSessionId,
  ChatMessage as ChatMessageType,
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
  const [auth, setAuth] = useState<AuthTokens | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionId] = useState(generateSessionId);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentSession().then((session) => {
      if (session) setAuth(session);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleLogin = async (username: string, password: string) => {
    setAuthError(null);
    try {
      const tokens = await signIn(username, password);
      setAuth(tokens);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Authentication failed";
      setAuthError(errorMessage);
    }
  };

  const handleLogout = () => {
    signOut();
    setAuth(null);
    setMessages([]);
  };

  const handleSend = useCallback(
    (content: string) => {
      if (!auth) return;

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
        auth.accessToken,
        sessionId,
        "default_user",
        (chunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + chunk,
              };
            }
            return updated;
          });
        },
        () => setIsStreaming(false),
        (error) => {
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
    [auth, sessionId]
  );

  if (!authChecked) {
    return (
      <div className="loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (!auth) {
    return (
      <>
        <Head>
          <title>Sign In — NEXT Insurance Financial Advisor</title>
        </Head>
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
          <ChatInput onSend={handleSend} disabled={isStreaming} />
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
