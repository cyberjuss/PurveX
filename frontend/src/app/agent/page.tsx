"use client";

import { useEffect, useState, useRef, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  apiFetch,
  getDetections,
  getDetectionAlerts,
  type Detection,
  type DetectionAlert,
} from "@/lib/api";
import { formatRelative } from "date-fns";
import {
  Cpu, MessageCircle, Loader2, Sparkles, RefreshCw,
  Search, Activity, BookOpen, FileText, TrendingUp, Zap, AlertTriangle, SendHorizonal, Plus,
  ShieldCheck,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { ProposeFixDialog } from "@/components/proposals/propose-fix-dialog";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  error?: boolean;
};

type QuickAction = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "sky" | "emerald" | "amber" | "purple";
  action?: string;
  prompt?: string;
  contextScope?: "portfolio" | "detection";
  autoSend?: boolean;
};

type AnalystGoal =
  | "find_weaknesses"
  | "reduce_false_positives"
  | "improve_detection_coverage"
  | "stabilize_failing_tests";

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
  // ``proposeSeed`` carries the assistant message content through to the
  // propose-fix dialog so the reviewer sees the AI's rationale verbatim,
  // not just the field patch. null means the dialog is closed.
  const [proposeSeed, setProposeSeed] = useState<string | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AI_REQUEST_TIMEOUT_MS = 20000;
  const AI_DISABLED = false;


  const detectionId = searchParams.get("detectionId");
  const alertId = searchParams.get("alertId");

  const showQuickActions = useMemo(() =>
    messages.length === 0 || (messages.length === 1 && messages[0]?.role === "assistant"),
    [messages]
  );

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
        setTimeout(() => reject(new Error("Watchtower took too long to load.")), 8000)
      );

      const allDetections = await Promise.race([
        getDetections(),
        timeout,
      ]);

        if (detectionId) {
          const det = allDetections.find(d => String(d.id) === detectionId);
          if (det) {
            setSelectedDetection(det);
            
            if (alertId) {
              try {
                const alerts = await getDetectionAlerts(detectionId);
                const alert = alerts.find(a => a.id === Number(alertId));
                if (alert) {
                  setSelectedAlert(alert);
                }
              } catch (err) {
                console.error("Failed to load alert:", err);
              }
            }
            
          const contextMessage = `I'm ready to help with **${det.title}** (${det.technique_id}).\n\nWhat would you like to know? I can:\n- Summarize this detection and its validation evidence\n- Analyze the latest validation results\n- Suggest improvements to the SPL query or Sigma rule${alertId ? "\n- Explain the selected evidence record" : ""}`;
          
          setMessages([{
                id: 1,
                role: "assistant",
                content: contextMessage,
                timestamp: new Date().toISOString(),
          }]);
          }
        } else {
            setMessages([]);
        }
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to load Watchtower data."));
    } finally {
      setLoading(false);
    }
  }, [detectionId, alertId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generalQuickActions: QuickAction[] = useMemo(() => [
    {
      id: "coverage-gaps",
      title: "Coverage Gaps",
      description: "Find missing telemetry and weak validation across the workspace",
      icon: Search,
      color: "sky",
      prompt: "Identify the highest-priority coverage gaps across the current PurveX workspace. Separate telemetry gaps from rule logic gaps and tell me what to fix first.",
      contextScope: "portfolio",
      autoSend: true,
    },
    {
      id: "workspace-health",
      title: "Validation Health",
      description: "Summarize trust instability and what analysts should fix next",
      icon: Activity,
      color: "emerald",
      prompt: "Summarize the current validation health of this PurveX workspace. Focus on trust, repeated failures, stale validations, and the next 3 actions for the team.",
      contextScope: "portfolio",
      autoSend: true,
    },
    {
      id: "team-priorities",
      title: "Team Priorities",
      description: "Turn current results into the top query/rule tuning priorities",
      icon: BookOpen,
      color: "amber",
      prompt: "Based on the current PurveX workspace, give me the top 3 improvements that would most increase detection trust and validation reliability.",
      contextScope: "portfolio",
      autoSend: true,
    },
  ], []);

  const detectionQuickActions: QuickAction[] = useMemo(() => {
    if (!selectedDetection) return [];
    
    return [
      {
        id: "summarize-detection",
        title: "Summarize Detection",
        description: `Explain what "${selectedDetection.title}" covers and what matters next`,
        icon: FileText,
        color: "sky",
        prompt: "Summarize this detection as a PurveX trust record. Explain what it covers, what evidence exists, whether it is trustworthy, and the next action.",
        contextScope: "detection",
        autoSend: true,
      },
      {
        id: "explain-latest-run",
        title: "Explain Latest Run",
        description: "Break down the latest validation result and the likely blocker",
        icon: TrendingUp,
        color: "emerald",
        prompt: "Explain the latest validation result for this detection. Tell me whether the issue looks like rule logic, field mismatch, telemetry gap, thresholding, or something else.",
        contextScope: "detection",
        autoSend: true,
      },
      {
        id: "improve-detection",
        title: "Fix Recommendations",
        description: "Get concrete query tuning + a retest plan",
        icon: Zap,
        color: "amber",
        prompt: "Give me concrete recommendations to improve this detection in PurveX. Include what to change, why, and how to validate the fix safely.",
        contextScope: "detection",
        autoSend: true,
      },
      ...(selectedAlert ? [{
        id: "explain-alert",
        title: "Explain Evidence",
        description: "Explain the selected evidence record and recommended action",
        icon: AlertTriangle,
        color: "purple",
        prompt: "Explain this evidence record in the context of the selected detection. Tell me what behavior it shows, why it matters, and what action a detection engineer should take next.",
        contextScope: "detection",
        autoSend: true,
      }] : []),
    ] as QuickAction[];
  }, [selectedDetection, selectedAlert]);

  const goalInstruction = useMemo(() => {
    switch (analystGoal) {
      case "reduce_false_positives":
        return "Goal: reduce false positives while preserving coverage. Prioritize precision improvements and safe thresholds.";
      case "improve_detection_coverage":
        return "Goal: improve detection coverage. Prioritize telemetry gaps, missing field mappings, and untested techniques.";
      case "stabilize_failing_tests":
        return "Goal: stabilize failing validations. Prioritize root-cause isolation, minimal query changes, and fast retest loops.";
      default:
        return "Goal: find detection weaknesses in query logic and tuning. Prioritize concrete fixes analysts can apply now.";
    }
  }, [analystGoal]);

  // Hooks must run on every render, so compute derived state BEFORE the
  // loading/error early returns below. Moving this after them causes
  // "Rendered more hooks than during the previous render" when the page
  // transitions from loading → ready.
  const visibleMessages = useMemo(
    () => (showQuickActions ? [] : messages),
    [showQuickActions, messages],
  );

  async function handleQuickAction(action: QuickAction) {
    if (AI_DISABLED) {
      const now = new Date().toISOString();
      const nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;
      const assistantMsg: ChatMessage = {
        id: nextId,
        role: "assistant",
        content: "Watchtower is not available yet. For now, run validations so PurveX can build trust evidence and next actions.",
        timestamp: now,
      };
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }
    if (action.autoSend) {
      void handleSend(action);
    }
  }

  const handleSend = useCallback(async (selectedAction?: QuickAction) => {
    const prompt = selectedAction?.prompt?.trim() ?? customPrompt.trim();
    const promptTitle = selectedAction?.title ?? prompt;
    const contextScope =
      selectedAction?.contextScope ??
      (selectedDetection || selectedAlert ? "detection" : "portfolio");

    if (!prompt || sending) return;
    if (AI_DISABLED) {
      return;
    }

    const now = new Date().toISOString();
    const nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;

    const userMsg: ChatMessage = {
      id: nextId,
      role: "user",
      content: promptTitle,
      timestamp: now,
    };
    
    setMessages(prev => [...prev, userMsg]);
    setSending(true);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const requestId = ++requestIdRef.current;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      abortControllerRef.current?.abort();
      setSending(false);
      const assistantMsg: ChatMessage = {
        id: nextId + 1,
        role: "assistant",
        content: "⏱️ The AI response timed out. Try a shorter question or use a smaller model.",
        timestamp: new Date().toISOString(),
        error: true,
      };
      setMessages(prev => [...prev, assistantMsg]);
    }, AI_REQUEST_TIMEOUT_MS);

    try {
      
      try {
        const res = (await apiFetch("/assistant/chat", {
          method: "POST",
          body: JSON.stringify({
            prompt: `${goalInstruction}\n\n${prompt}`,
            context_scope: contextScope,
            detection_id: selectedDetection?.id || null,
            alert_id: selectedAlert?.id || null,
            model_name: selectedModel,
          }),
          signal: abortControllerRef.current.signal,
        })) as { answer?: string };
        if (requestIdRef.current !== requestId) return;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        const assistantMsg: ChatMessage = {
          id: nextId + 1,
          role: "assistant",
          content: res.answer ?? "",
          timestamp: new Date().toISOString(),
        };
        
        setMessages(prev => [...prev, assistantMsg]);
        setCustomPrompt("");
      } catch (fetchErr: unknown) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (requestIdRef.current !== requestId) return;
        const fetchErrorMessage = getErrorMessage(fetchErr, "");
        if ((fetchErr instanceof Error && fetchErr.name === "AbortError") || fetchErrorMessage.includes("timeout")) {
          throw new Error(
            "Request timed out. The AI response is taking too long. Try a shorter question or a faster model."
          );
        }
        throw fetchErr;
      }
    } catch (error: unknown) {
      console.error("[Watchtower] Error sending message:", error);
      
      let errorMessage = "Watchtower could not process your request. ";
      const errorText = getErrorMessage(error, "");
      const activeProvider = selectedModel.startsWith("deepseek") ? "DeepSeek" : "OpenAI";
      const keyHint = activeProvider === "DeepSeek"
        ? "DEEPSEEK_API_KEY (or OPENAI_API_KEY compatibility variable)"
        : "OPENAI_API_KEY";
      
      if (errorText.includes("timeout") || errorText.includes("timed out") || errorText.includes("504")) {
        errorMessage = "The AI response timed out.\n\nTry:\n- A shorter, simpler question\n- A faster model\n- Checking backend logs for upstream latency";
      } else if (errorText.includes("503") || errorText.includes("OPENAI_API_KEY")) {
        errorMessage = `${activeProvider} is not configured.\n\nPlease ensure:\n- ${keyHint} is set on the backend\n- The AI provider is set to ${activeProvider}\n- The selected model and API base URL are valid`;
      } else if (errorText.includes("502") || errorText.includes("Error calling LLM") || errorText.includes("Error communicating with OpenAI") || errorText.includes("Error communicating with DeepSeek")) {
        errorMessage = `${activeProvider} returned an error.\n\nThis could mean:\n- The model name is invalid\n- The API key is missing or rejected\n- The request hit a provider-side issue\n\nError: ` + errorText;
      } else if (errorText.includes("500")) {
        errorMessage = "❌ Internal server error.\n\nCheck the backend logs for details.\n\nError: " + errorText;
      } else if (errorText) {
        errorMessage += "\n\n" + errorText;
      } else {
        errorMessage += `Check the API and ${activeProvider} configuration and try again.`;
      }
      
      const assistantMsg: ChatMessage = {
        id: nextId + 1,
        role: "assistant",
        content: errorMessage,
        timestamp: new Date().toISOString(),
        error: true,
      };
      
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  }, [sending, messages, selectedDetection, selectedAlert, customPrompt, AI_DISABLED, goalInstruction, selectedModel]);

  if (loading) {
    return (
      <PageContainer>
        <div className="rounded-3xl border border-slate-200 bg-[#f9f6f1] p-10 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="h-16 w-16 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
                <Cpu className="h-8 w-8 text-slate-700 animate-pulse" />
              </div>
              <Sparkles className="absolute -top-1 -right-1 h-5 w-5 text-amber-400 animate-ping" />
            </div>
            <div>
              <p className="text-lg font-display font-semibold text-slate-900">Loading Watchtower</p>
              <p className="text-sm text-slate-600">Preparing workspace context for trust and validation analysis...</p>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[500px]">
            <div className="text-center space-y-4">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
              <div>
              <p className="text-lg font-display font-semibold text-red-400 mb-2">Failed to load Watchtower</p>
                <p className="text-sm text-slate-600 mb-4">{error}</p>
              <Button
                onClick={() => loadData()}
                variant="outline"
                className="mt-4"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  const currentQuickActions = selectedDetection ? detectionQuickActions : generalQuickActions;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-page)] text-[var(--foreground)]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[var(--stroke-soft)] bg-[var(--surface-shell)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
              <Cpu className="h-4 w-4 text-[var(--accent-strong)]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight text-[var(--foreground)]">Watchtower</p>
              <p className="truncate text-xs text-[var(--surface-subtle-foreground)]">
                {selectedDetection
                  ? `${selectedDetection.title} · ${selectedDetection.technique_id}`
                  : "Portfolio analysis"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2.5 py-1.5 sm:flex">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Goal</span>
              <select
                value={analystGoal}
                onChange={(event) => setAnalystGoal(event.target.value as AnalystGoal)}
                className="bg-transparent text-xs font-medium text-[var(--foreground)] outline-none"
              >
                <option value="find_weaknesses">Find weaknesses</option>
                <option value="reduce_false_positives">Reduce false positives</option>
                <option value="improve_detection_coverage">Improve coverage</option>
                <option value="stabilize_failing_tests">Stabilize failing tests</option>
              </select>
            </div>
            <div className="hidden items-center gap-1.5 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2.5 py-1.5 sm:flex">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="bg-transparent text-xs font-medium text-[var(--foreground)] outline-none"
              >
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                <option value="gpt-4o-mini">GPT-4o mini</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
            </div>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMessages([]);
                  setCustomPrompt("");
                  if (abortControllerRef.current) abortControllerRef.current.abort();
                }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main scroll area */}
      <main ref={chatContainerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          {showQuickActions ? (
            <div className="flex min-h-[calc(100vh-260px)] flex-col items-center justify-center text-center animate-fade-in-scale">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                <Cpu className="h-6 w-6 text-[var(--accent-strong)]" />
              </div>
              <h1 className="text-xl font-display font-semibold text-[var(--foreground)] sm:text-2xl">
                {selectedDetection
                  ? `Analyze ${selectedDetection.title}`
                  : "What should Watchtower analyze?"}
              </h1>
              <p className="mt-2 max-w-md text-sm text-[var(--surface-subtle-foreground)]">
                Pick a starting point, or ask a custom question below.
              </p>

              <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {currentQuickActions.map((action, idx) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action)}
                      disabled={sending || AI_DISABLED}
                      className={cn(
                        "group flex h-full flex-col gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-left transition-all",
                        !AI_DISABLED && "hover:border-[var(--accent-line)] hover:bg-[var(--surface-subtle)] hover:shadow-sm",
                        AI_DISABLED && "cursor-not-allowed opacity-60",
                        "animate-fade-in-scale"
                      )}
                      style={{ animationDelay: `${idx * 40}ms` }}
                    >
                      <div className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                        action.color === "sky" && "bg-sky-100 text-sky-600",
                        action.color === "emerald" && "bg-emerald-100 text-emerald-600",
                        action.color === "amber" && "bg-amber-100 text-amber-600",
                        action.color === "purple" && "bg-purple-100 text-purple-600",
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--foreground)]">{action.title}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-[var(--surface-subtle-foreground)]">
                          {action.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {visibleMessages.map((msg, idx) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-3 animate-fade-in-scale",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  {msg.role === "assistant" && (
                    <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                      <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                    </div>
                  )}

                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3",
                    msg.role === "user"
                      ? "border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--foreground)]"
                      : cn(
                          "border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-[var(--foreground)]",
                          msg.error && "border-red-500/40 bg-red-50 dark:bg-red-500/10"
                        )
                  )}>
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {msg.content}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--surface-subtle-foreground)]">
                      <span>
                        {mounted ? safeFormatRelative(msg.timestamp) : "Just now"}
                      </span>
                      {msg.role === "assistant" && !msg.error && selectedDetection ? (
                        <button
                          type="button"
                          onClick={() => setProposeSeed(msg.content)}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-strong)] transition hover:brightness-110"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          File as proposal
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {msg.role === "user" && (
                    <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                      <Cpu className="h-4 w-4 text-[var(--foreground)]" />
                    </div>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex gap-3 justify-start animate-fade-in-scale">
                  <div className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                    <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                  </div>
                  <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--foreground)]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Sticky composer */}
      <footer className="flex-shrink-0 border-t border-[var(--stroke-soft)] bg-[var(--surface-shell)]">
        <div className="mx-auto w-full max-w-4xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] transition-colors focus-within:border-[var(--accent-line)]">
            <textarea
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !sending && customPrompt.trim() && !AI_DISABLED) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                selectedDetection
                  ? "Ask a question about this detection, its evidence, or how to improve it..."
                  : "Ask about validation health, coverage gaps, or what to fix first..."
              }
              disabled={AI_DISABLED}
              className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--surface-subtle-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-3 pb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-shell)] px-2 py-0.5 text-[11px] text-[var(--surface-subtle-foreground)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-strong)]" />
                {selectedDetection ? "Detection context" : "Portfolio context"}
              </span>
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
          {AI_DISABLED && (
            <p className="mt-2 text-center text-xs text-[var(--surface-subtle-foreground)]">
              Watchtower is temporarily unavailable for this workspace.
            </p>
          )}
        </div>
      </footer>

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
    </div>
  );
}

export default function WatchtowerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <WatchtowerPageContent />
    </Suspense>
  );
}

