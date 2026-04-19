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
  Cpu, MessageCircle, Loader2, X, Sparkles, RefreshCw,
  Search, Activity, BookOpen, FileText, TrendingUp, Zap, AlertTriangle, SendHorizonal, Plus
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";

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
  const [showConversationRail] = useState(false);
  const [selectedModel, setSelectedModel] = useState("deepseek-chat");
  const [analystGoal, setAnalystGoal] = useState<AnalystGoal>("find_weaknesses");
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
  const conversationItems = useMemo(() => {
    const firstUserMessage = messages.find((msg) => msg.role === "user");
    const title = firstUserMessage?.content?.slice(0, 60) || (selectedDetection ? selectedDetection.title : "New analysis");
    return [
      {
        id: "active",
        title,
        subtitle: selectedDetection ? "Detection context" : "Portfolio context",
      },
    ];
  }, [messages, selectedDetection]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !chatContainerRef.current) return;
    
    const timer = setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 50);
    
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
      setTimeout(() => {
        handleSend(action);
      }, 100);
    } else {
      // No free-form input in MVP mode.
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
    
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 100);

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
        
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({
              top: chatContainerRef.current.scrollHeight,
              behavior: "smooth",
            });
          }
        }, 100);
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
      
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 100);
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
    <div className="w-full min-h-screen flex bg-[var(--surface-page)] text-[var(--foreground)] overflow-y-auto">
      {showConversationRail && (
        <aside className="hidden lg:flex w-72 shrink-0 border-r border-[var(--stroke-soft)] bg-[var(--surface-shell)]">
          <div className="flex h-full w-full flex-col">
            <div className="border-b border-[var(--stroke-soft)] p-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => {
                  setMessages([]);
                  setCustomPrompt("");
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New chat
              </Button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {conversationItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-left"
                >
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{item.title}</p>
                  <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">{item.subtitle}</p>
                </button>
              ))}
            </div>
            <div className="border-t border-[var(--stroke-soft)] p-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                Model
              </label>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="w-full rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-line)]"
              >
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                <option value="gpt-4o-mini">GPT-4o mini (fast)</option>
                <option value="gpt-4o">GPT-4o (balanced)</option>
              </select>
              <p className="mt-1 text-[11px] text-[var(--surface-subtle-foreground)]">Active model for this chat.</p>
            </div>
          </div>
        </aside>
      )}
      {/* Main Chat Area - Full Width and Height */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="sticky top-0 z-20 border-b border-[var(--stroke-soft)] bg-[var(--surface-shell)] px-4 py-2 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[var(--accent-strong)]" />
              <p className="text-sm font-medium text-[var(--foreground)]">Watchtower</p>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xs text-[var(--surface-subtle-foreground)]">Goal</span>
              <select
                value={analystGoal}
                onChange={(event) => setAnalystGoal(event.target.value as AnalystGoal)}
                className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2 py-1 text-xs outline-none focus:border-[var(--accent-line)]"
              >
                <option value="find_weaknesses">Find weaknesses</option>
                <option value="reduce_false_positives">Reduce false positives</option>
                <option value="improve_detection_coverage">Improve coverage</option>
                <option value="stabilize_failing_tests">Stabilize failing tests</option>
              </select>
              <span className="text-xs text-[var(--surface-subtle-foreground)]">Model</span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2 py-1 text-xs outline-none focus:border-[var(--accent-line)]"
              >
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner</option>
                <option value="gpt-4o-mini">GPT-4o mini</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
            </div>
          </div>
        </div>
            <div 
              ref={chatContainerRef}
          className={cn(
            "flex-1 overflow-x-hidden flex flex-col",
            messages.length > 0 ? "overflow-y-auto" : "overflow-y-hidden"
          )}
        >
          <div className={cn(
            "w-full px-4 sm:px-6 lg:px-8 flex-1 flex flex-col max-w-5xl mx-auto",
            showQuickActions ? "py-6" : "py-8",
            messages.length > 0 && "pb-24"
          )}>
            {/* Quick Actions - Full Page Layout */}
            {showQuickActions && (
              <div className="flex flex-col items-center justify-center flex-1 space-y-6 animate-fade-in-scale">
                <div className="text-center space-y-2 mb-4">
                  <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[var(--surface-elevated)] border border-[var(--stroke-soft)] mb-3">
                    <Cpu className="h-7 w-7 text-[var(--accent-strong)]" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-[var(--foreground)]">What should Watchtower analyze?</h2>
                  <p className="text-[var(--surface-subtle-foreground)] text-sm">Ask about trust, evidence, validation blockers, or what to fix next.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-4xl">
                  {currentQuickActions.map((action, idx) => {
                    const Icon = action.icon;
                    return (
                        <button
                        key={action.id}
                        onClick={() => handleQuickAction(action)}
                        disabled={sending || AI_DISABLED}
                        className={cn(
                          "group relative text-left px-5 py-4 rounded-xl border transition-all duration-200",
                          !AI_DISABLED && "hover:scale-[1.01] hover:shadow-md",
                          "bg-[var(--surface-elevated)] border-[var(--stroke-soft)]",
                          !AI_DISABLED && "hover:border-[var(--accent-line)] hover:bg-[var(--surface-subtle)]",
                          AI_DISABLED && "opacity-60 cursor-not-allowed",
                          "animate-fade-in-scale"
                        )}
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <div className="flex items-start gap-4">
                           <div className={cn(
                             "h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110",
                             action.color === "sky" && "bg-sky-100 text-sky-600",
                             action.color === "emerald" && "bg-emerald-100 text-emerald-600",
                             action.color === "amber" && "bg-amber-100 text-amber-600",
                             action.color === "purple" && "bg-purple-100 text-purple-600",
                           )}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-display font-semibold text-sm text-[var(--foreground)] mb-1">
                              {action.title}
                            </h3>
                            <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
                              {action.description}
                            </p>
                            </div>
                          </div>
                        </button>
                    );
                  })}
                </div>

                <div className="w-full max-w-4xl rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-sm font-display font-semibold text-[var(--foreground)]">Ask a custom PurveX question</h3>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">
                      Ask about trust, evidence, telemetry gaps, rule tuning, retest plans, or how to improve coverage.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <textarea
                      value={customPrompt}
                      onChange={(event) => setCustomPrompt(event.target.value)}
                      placeholder={
                        selectedDetection
                          ? "Example: What is the most likely reason this detection is failing, and what exact rule changes should I try first?"
                          : "Example: Which detections are hurting trust the most right now, and what should the team fix first?"
                      }
                      className="min-h-28 w-full resize-y rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-shell)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--surface-subtle-foreground)] focus:border-[var(--accent-line)]"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-[var(--surface-subtle-foreground)]">
                        Context: {selectedDetection ? "Selected detection" : "Portfolio workspace"}
                      </p>
                      <Button
                        onClick={() => void handleSend()}
                        disabled={sending || !customPrompt.trim() || AI_DISABLED}
                        className="bg-[var(--accent-strong)] text-white hover:opacity-90"
                      >
                        {sending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Asking...
                          </>
                        ) : (
                          <>
                            <SendHorizonal className="mr-2 h-4 w-4" />
                            Ask Watchtower
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Messages - Full Width Layout */}
            {messages.length > 0 && (
              <div className="space-y-6 py-8 max-w-4xl mx-auto w-full">
                {messages.map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-4 animate-fade-in-scale",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                    style={{ animationDelay: `${idx * 30}ms` }}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[var(--surface-elevated)] border border-[var(--stroke-soft)] flex items-center justify-center mt-1">
                        <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                          </div>
                    )}
                    
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-4",
                      msg.role === "user"
                        ? "bg-[var(--accent-soft)] text-[var(--foreground)] border border-[var(--accent-line)]"
                        : cn(
                            "bg-[var(--surface-elevated)] text-[var(--foreground)] border border-[var(--stroke-soft)]",
                            msg.error && "border-red-500/40 bg-red-50 dark:bg-red-500/10"
                          )
                    )}>
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">
                        {msg.content}
                      </div>
                      <div className={cn(
                        "mt-2 text-xs",
                        "text-[var(--surface-subtle-foreground)]"
                      )}>
                        {mounted ? formatRelative(new Date(msg.timestamp), new Date()) : "Just now"}
                      </div>
                    </div>

                    {msg.role === "user" && (
                      <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[var(--surface-elevated)] border border-[var(--stroke-soft)] flex items-center justify-center mt-1">
                        <Cpu className="h-4 w-4 text-[var(--foreground)]" />
                </div>
              )}
            </div>
                ))}
                
                {sending && (
                  <div className="flex gap-4 justify-start animate-fade-in-scale">
                    <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-[var(--surface-elevated)] border border-[var(--stroke-soft)] flex items-center justify-center mt-1">
                      <MessageCircle className="h-4 w-4 text-[var(--accent-strong)]" />
                    </div>
                    <div className="bg-[var(--surface-elevated)] text-[var(--foreground)] border border-[var(--stroke-soft)] rounded-2xl px-5 py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-[var(--foreground)]" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Focused Actions Footer */}
        <div className="flex-shrink-0 border-t border-[var(--stroke-soft)] bg-[var(--surface-shell)] z-10 sticky bottom-0 backdrop-blur">
          <div className="w-full px-4 py-3 sm:px-6 lg:px-12">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-sm text-[var(--surface-subtle-foreground)]">
                {AI_DISABLED ? (
                  <span className="text-xs text-[var(--surface-subtle-foreground)]">
                    Watchtower is temporarily unavailable for this workspace.
                  </span>
                ) : (
                  <span className="text-xs text-[var(--surface-subtle-foreground)]">
                    Watchtower uses your live PurveX workspace context to answer questions about trust, evidence, and validation blockers.
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMessages([]);
                      setCustomPrompt("");
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                      }
                    }}
                  >
                    <X className="h-4 w-4 mr-2" />
                    New analysis
                  </Button>
                )}
                {!showQuickActions && (
                  <Button
                    size="sm"
                    onClick={() => void handleSend()}
                    disabled={sending || !customPrompt.trim() || AI_DISABLED}
                    className="bg-[var(--accent-strong)] text-white hover:opacity-90"
                  >
                    <SendHorizonal className="h-4 w-4 mr-2" />
                    Ask
                  </Button>
                )}
              </div>
            </div>
            {!showQuickActions && (
              <div className="max-w-4xl mx-auto mt-3">
                <textarea
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  placeholder={
                    selectedDetection
                      ? "Ask a PurveX-specific question about this detection, its evidence, or how to improve it."
                      : "Ask a PurveX-specific question about validation health, failures, or what the team should do next."
                  }
                  className="min-h-24 w-full resize-y rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--surface-subtle-foreground)] focus:border-[var(--accent-line)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
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

