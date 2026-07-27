"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatRelative } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Cpu,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  SendHorizonal,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { ProposeFixDialog } from "@/components/proposals/propose-fix-dialog";
import { Button } from "@/components/ui/button";
import {
  getDetectionAlerts,
  getDetections,
  streamAssistantChat,
  type Detection,
  type DetectionAlert,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose-watchtower break-words text-sm leading-relaxed text-[var(--foreground)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold">{children}</h3>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[var(--foreground)]">{children}</strong>
          ),
          code: ({ children, className }) => {
            const isBlock = (className ?? "").startsWith("language-");
            return isBlock ? (
              <code className="block whitespace-pre-wrap font-mono text-[12.5px] leading-snug">
                {children}
              </code>
            ) : (
              <code className="rounded bg-[var(--surface-subtle)] px-1 py-0.5 font-mono text-[12.5px]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-3">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-[var(--accent-strong)] underline"
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  error?: boolean;
};

type AnalystGoal =
  | "find_weaknesses"
  | "reduce_false_positives"
  | "improve_detection_coverage"
  | "stabilize_failing_tests";

const GOAL_LABELS: Record<AnalystGoal, string> = {
  find_weaknesses: "Find weaknesses",
  reduce_false_positives: "Reduce false positives",
  improve_detection_coverage: "Improve coverage",
  stabilize_failing_tests: "Stabilize failing tests",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function safeFormatRelative(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Just now";
    return formatRelative(date, new Date());
  } catch {
    return "Just now";
  }
}

function scrollChatToBottom(container: HTMLDivElement | null) {
  if (!container) return;
  container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
}

function formatDateTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function normalizeDetectionResult(value?: string | null) {
  return (value || "").trim().toUpperCase();
}

function modelFamily(model: string) {
  return model.startsWith("deepseek") ? "DeepSeek" : "OpenAI";
}

function WatchtowerPageContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<DetectionAlert | null>(null);
  const [mounted, setMounted] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("deepseek-chat");
  const [analystGoal, setAnalystGoal] = useState<AnalystGoal>("find_weaknesses");
  const [proposeSeed, setProposeSeed] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AI_REQUEST_TIMEOUT_MS = 20000;
  const AI_DISABLED = false;

  const detectionId = searchParams.get("detectionId");
  const alertId = searchParams.get("alertId");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const timer = setTimeout(() => scrollChatToBottom(chatContainerRef.current), 50);
    return () => clearTimeout(timer);
  }, [messages, mounted]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Watchtower took too long to load.")), 8000),
      );

      const allDetections = await Promise.race([getDetections(), timeout]);

      if (detectionId) {
        const detection = allDetections.find((item) => String(item.id) === detectionId) || null;
        setSelectedDetection(detection);

        if (detection && alertId) {
          try {
            const alerts = await getDetectionAlerts(detectionId);
            const alert = alerts.find((item) => item.id === Number(alertId)) || null;
            setSelectedAlert(alert);
          } catch (err) {
            console.error("Failed to load alert:", err);
          }
        } else {
          setSelectedAlert(null);
        }

        if (detection) {
          const contextMessage = `I'm ready to review **${detection.title}** (\`${detection.technique_id}\`).

I can help you:
- summarize detection trust and latest evidence
- explain why a validation failed or went inconclusive
- propose safer tuning changes and a retest path${alertId ? "\n- break down the selected evidence record" : ""}`;

          setMessages([
            {
              id: 1,
              role: "assistant",
              content: contextMessage,
              timestamp: new Date().toISOString(),
            },
          ]);
        } else {
          setMessages([]);
        }
      } else {
        setSelectedDetection(null);
        setSelectedAlert(null);
        setMessages([]);
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to load Watchtower data."));
    } finally {
      setLoading(false);
    }
  }, [alertId, detectionId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSend = useCallback(
    async () => {
      const prompt = customPrompt.trim();
      const promptTitle = prompt;
      const contextScope =
        selectedDetection || selectedAlert ? "detection" : "portfolio";

      if (!prompt || sending || AI_DISABLED) return;

      const now = new Date().toISOString();
      const baseId = messages.length ? messages[messages.length - 1].id + 1 : 1;
      const assistantId = baseId + 1;

      const userMsg: ChatMessage = {
        id: baseId,
        role: "user",
        content: promptTitle,
        timestamp: now,
      };
      const placeholderMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg, placeholderMsg]);
      setSending(true);

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      const requestId = ++requestIdRef.current;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (requestIdRef.current !== requestId) return;
        abortControllerRef.current?.abort();
        setSending(false);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content:
                    "The AI response timed out before any tokens arrived. Try a shorter question or a smaller model.",
                  error: true,
                  timestamp: new Date().toISOString(),
                }
              : message,
          ),
        );
      }, AI_REQUEST_TIMEOUT_MS);

      let received = false;

      await streamAssistantChat(
        {
          prompt,
          context_scope: contextScope,
          detection_id: selectedDetection?.id || null,
          alert_id: selectedAlert?.id || null,
          model_name: selectedModel,
          analyst_goal: analystGoal,
        },
        {
          signal: abortControllerRef.current.signal,
          onDelta: (delta) => {
            if (requestIdRef.current !== requestId) return;
            if (!received) {
              received = true;
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }
            }
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta }
                  : message,
              ),
            );
          },
          onDone: () => {
            if (requestIdRef.current !== requestId) return;
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setSending(false);
            setCustomPrompt("");
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId && !message.content
                  ? { ...message, content: "_(no response received)_", error: true }
                  : message,
              ),
            );
          },
          onError: (errorText) => {
            if (requestIdRef.current !== requestId) return;
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            setSending(false);
            const providerLabel = modelFamily(selectedModel);
            const keyHint =
              providerLabel === "DeepSeek"
                ? "DEEPSEEK_API_KEY (or OPENAI_API_KEY compatibility variable)"
                : "OPENAI_API_KEY";
            let message = errorText;
            if (errorText.includes("503") || errorText.includes("OPENAI_API_KEY")) {
              message = `${providerLabel} is not configured.

Please ensure:
- ${keyHint} is set on the backend
- the AI provider is set to ${providerLabel}
- the selected model and API base URL are valid`;
            }
            setMessages((prev) =>
              prev.map((messageItem) =>
                messageItem.id === assistantId
                  ? {
                      ...messageItem,
                      content: message,
                      error: true,
                      timestamp: new Date().toISOString(),
                    }
                  : messageItem,
              ),
            );
          },
        },
      );

      abortControllerRef.current = null;
    },
    [
      AI_DISABLED,
      analystGoal,
      customPrompt,
      messages,
      selectedAlert,
      selectedDetection,
      selectedModel,
      sending,
    ],
  );

  if (loading) {
    return (
      <PageContainer>
        <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-10">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                <Cpu className="h-8 w-8 animate-pulse text-[var(--accent-strong)]" />
              </div>
              <Sparkles className="absolute -right-1 -top-1 h-5 w-5 text-[var(--accent-strong)]" />
            </div>
            <div>
              <p className="text-lg font-semibold text-[var(--foreground)]">Loading Watchtower</p>
              <p className="text-sm text-[var(--surface-subtle-foreground)]">
                Preparing workspace context for trust and validation analysis.
              </p>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
          <div className="space-y-4 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
            <div>
              <p className="mb-2 text-lg font-semibold text-red-300">Failed to load Watchtower</p>
              <p className="mb-4 text-sm text-[var(--surface-subtle-foreground)]">{error}</p>
              <Button onClick={() => loadData()} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg" className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
        <div className="border-b border-[var(--stroke-soft)] px-5 py-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                    <Cpu className="h-5 w-5 text-[var(--accent-strong)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--surface-subtle-foreground)]">
                      Watchtower
                    </p>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
                      {selectedDetection ? selectedDetection.title : "Detection trust assistant"}
                    </h1>
                  </div>
                </div>
                <p className="mt-3 max-w-2xl text-sm text-[var(--surface-subtle-foreground)]">
                  {selectedDetection
                    ? "Review one detection at a time. Ask for a trust summary, explain the latest result, or request the safest next tuning step."
                    : "Use one clear question at a time to find coverage gaps, explain failing validations, or decide what the team should fix next."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {messages.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMessages([]);
                      setCustomPrompt("");
                      abortControllerRef.current?.abort();
                    }}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    New thread
                  </Button>
                ) : null}
              </div>
            </div>

          </div>
        </div>

        <section className="flex min-h-[72vh] flex-col bg-[var(--surface-elevated)]">
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-5">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {selectedDetection
                      ? "Ask one focused question about this detection."
                      : "Ask one focused question about your workspace."}
                  </p>
                  <p className="mt-1 text-sm text-[var(--surface-subtle-foreground)]">
                    {selectedDetection
                      ? "Example: Explain why the latest validation failed."
                      : "Example: What is the highest-priority coverage gap right now?"}
                  </p>
                </div>
              ) : null}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
                      <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl border px-4 py-3",
                      message.role === "user"
                        ? "border-[var(--accent-line)] bg-[var(--accent-soft)]"
                        : "border-[var(--stroke-soft)] bg-[var(--surface-card)]",
                      message.error && "border-red-500/35 bg-red-500/10",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--surface-subtle-foreground)]">
                        {message.role === "user" ? "Analyst" : "Watchtower"}
                      </span>
                      <span className="text-[11px] text-[var(--surface-subtle-foreground)]">
                        {mounted ? safeFormatRelative(message.timestamp) : "Just now"}
                      </span>
                    </div>

                    {message.role === "assistant" ? (
                      <MarkdownContent content={message.content || (sending ? "..." : "")} />
                    ) : (
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">
                        {message.content}
                      </div>
                    )}

                    {message.role === "assistant" && !message.error && selectedDetection ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setProposeSeed(message.content)}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-strong)] transition hover:brightness-110"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          File as proposal
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {message.role === "user" ? (
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
                      <Cpu className="h-4 w-4 text-[var(--foreground)]" />
                    </div>
                  ) : null}
                </div>
              ))}

              {sending ? (
                <div className="flex gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
                    <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                  </div>
                  <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking through the current PurveX context
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4">
            <div className="mx-auto max-w-3xl">
              <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] transition-colors focus-within:border-[var(--accent-line)]">
                <textarea
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !sending &&
                      customPrompt.trim() &&
                      !AI_DISABLED
                    ) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder={
                    selectedDetection
                      ? "Ask one focused question about this detection..."
                      : "Ask one focused question about your workspace..."
                  }
                  disabled={AI_DISABLED}
                  className="block max-h-40 min-h-[70px] w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--surface-subtle-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="flex flex-col gap-3 border-t border-[var(--stroke-soft)] px-3 py-3 sm:flex-row sm:items-center sm:justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={sending || !customPrompt.trim() || AI_DISABLED}
                    className="bg-[var(--accent-strong)] text-white hover:opacity-90"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <>
                        <SendHorizonal className="mr-1.5 h-3.5 w-3.5" />
                        Ask Watchtower
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {AI_DISABLED ? (
                <p className="mt-2 text-center text-xs text-[var(--surface-subtle-foreground)]">
                  Watchtower is temporarily unavailable for this workspace.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </section>

      <ProposeFixDialog
        open={proposeSeed !== null}
        onOpenChange={(open) => {
          if (!open) setProposeSeed(null);
        }}
        detection={selectedDetection}
        proposerLabel={`PurveX Assistant · ${selectedModel}`}
        initialField="siem_query"
        initialReason={proposeSeed ?? ""}
      />
    </PageContainer>
  );
}

export default function WatchtowerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-page)]" />}>
      <WatchtowerPageContent />
    </Suspense>
  );
}
