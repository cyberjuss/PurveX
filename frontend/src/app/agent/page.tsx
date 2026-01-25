"use client";

import { useEffect, useState, useRef, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  apiFetch,
  getDetections,
  getTests,
  getDetectionAlerts,
  type Detection,
  type TestWithDetectionTitle,
  type DetectionAlert,
} from "@/lib/api";
import { formatRelative } from "date-fns";
import { 
  Cpu, MessageCircle, Loader2, X, Sparkles, Shield, RefreshCw,
  Search, Activity, BookOpen, Brain, FileText, TrendingUp, Zap, AlertTriangle
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
  action: string;
  autoSend?: boolean;
};

function WatchtowerPageContent() {
  const searchParams = useSearchParams();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<DetectionAlert | null>(null);
  const [demoMode, setDemoMode] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AI_REQUEST_TIMEOUT_MS = 20000;
  const AI_DISABLED = true;


  const detectionId = searchParams.get("detectionId");
  const alertId = searchParams.get("alertId");

  const showQuickActions = useMemo(() => 
    messages.length === 0 || (messages.length === 1 && messages[0]?.role === "assistant"),
    [messages]
  );

  const metrics = useMemo(() => {
    const totalDetections = detections.length;
    const testedDetections = detections.filter((d) => d.last_tested_at).length;
    const totalTests = tests.length;
    const passedTests = tests.filter(t => (t.result || t.status) === "PASS").length;
    const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
    
    return { totalDetections, testedDetections, totalTests, passRate };
  }, [detections, tests]);

  const portfolioContext = useMemo(() => {
    if (!detections.length && !tests.length) return "";

    const recentTests = [...tests]
      .filter(t => t.started_at)
      .sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime())
      .slice(0, 5);

    const failingTests = tests
      .filter(t => (t.result || t.status) && (t.result || t.status) !== "PASS")
      .slice(0, 5);

    const recentTechniques = Array.from(new Set(
      recentTests.map(t => t.technique_id).filter(Boolean)
    )).slice(0, 5);

    return `[Portfolio Context]
Total detections: ${metrics.totalDetections}
Detections tested: ${metrics.testedDetections}
Total tests: ${metrics.totalTests}
Pass rate: ${metrics.passRate}%
Recent techniques: ${recentTechniques.length ? recentTechniques.join(", ") : "Not available"}
Recent tests: ${recentTests.map(t => `${t.id}:${t.result || t.status || "UNKNOWN"}`).join(", ") || "None"}
Recent failing tests: ${failingTests.map(t => `${t.id}:${t.result || t.status || "UNKNOWN"}`).join(", ") || "None"}`;
  }, [detections, tests, metrics]);

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

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Watchtower took too long to load.")), 8000)
      );

      const [allDetections, recentTests] = await Promise.race([
        Promise.all([getDetections(), getTests()]),
        timeout,
      ]);
      
        setDetections(allDetections);
        setTests(recentTests);

        if (detectionId) {
          const det = allDetections.find(d => String(d.id) === detectionId);
          if (det) {
            setSelectedDetection(det);
          
          const relatedTests = recentTests
            .filter(t => t.detection_id === det.id)
            .sort((a, b) => 
              new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
            );
            
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
            
          const contextMessage = `I'm ready to help with **${det.title}** (${det.technique_id}).\n\nWhat would you like to know? I can:\n• Summarize this detection and its events\n• Analyze test results\n• Suggest improvements to the SPL query or Sigma rule${selectedAlert ? "\n• Explain the selected event" : ""}`;
          
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
    } catch (err: any) {
      setError(err?.message || "Failed to load Watchtower data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [detectionId, alertId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generalQuickActions: QuickAction[] = useMemo(() => [
    {
      id: "find-issues",
      title: "Find Coverage Gaps",
      description: "Identify failing tests, coverage gaps, and detections that need attention",
      icon: Search,
      color: "sky",
      action: "coverage_gaps",
      autoSend: true,
    },
    {
      id: "health-summary",
      title: "Health Summary",
      description: "Get a concise overview of detection health and recommended actions",
      icon: Activity,
      color: "emerald",
      action: "portfolio_health",
      autoSend: true,
    },
    {
      id: "best-practices",
      title: "Improve Coverage",
      description: "Suggest the top 3 improvements to increase coverage based on existing detections",
      icon: BookOpen,
      color: "amber",
      action: "coverage_improve",
      autoSend: true,
    },
  ], []);

  const detectionQuickActions: QuickAction[] = useMemo(() => {
    if (!selectedDetection) return [];
    
    return [
      {
        id: "summarize",
        title: "Summarize Detection",
        description: `Summarize "${selectedDetection.title}" with clear next steps`,
        icon: FileText,
        color: "sky",
        action: "detection_summary",
        autoSend: true,
      },
      {
        id: "analyze-tests",
        title: "Explain Test Result",
        description: "Explain the latest test result and why it passed/failed",
        icon: TrendingUp,
        color: "emerald",
        action: "test_explain",
        autoSend: true,
      },
      {
        id: "improve",
        title: "Fix Recommendations",
        description: "Provide concrete fixes and how to validate them",
        icon: Zap,
        color: "amber",
        action: "fix_recommendations",
        autoSend: true,
      },
      ...(selectedAlert ? [{
        id: "explain-alert",
        title: "Explain Event",
        description: "Explain the selected event and recommended action",
        icon: AlertTriangle,
        color: "purple",
        action: "alert_explain",
        autoSend: true,
      }] : []),
    ] as QuickAction[];
  }, [selectedDetection, selectedAlert]);

  const handleQuickAction = useCallback(async (action: QuickAction) => {
    if (AI_DISABLED) {
      const now = new Date().toISOString();
      const nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;
      const assistantMsg: ChatMessage = {
        id: nextId,
        role: "assistant",
        content: "AI analysis is coming soon. For now, run tests to generate real data.",
        timestamp: now,
      };
      setMessages(prev => [...prev, assistantMsg]);
      return;
    }
    if (action.autoSend && action.action) {
      setTimeout(() => {
        handleSend(action);
      }, 100);
    } else {
      // No free-form input in MVP mode.
    }
  }, []);

  const handleSend = useCallback(async (selectedAction?: QuickAction) => {
    if (!selectedAction || sending) return;
    if (AI_DISABLED) {
      return;
    }

    const now = new Date().toISOString();
    const nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;

    const userMsg: ChatMessage = {
      id: nextId,
      role: "user",
      content: selectedAction.title,
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
            action: selectedAction.action,
            detection_id: selectedDetection?.id || null,
            alert_id: selectedAlert?.id || null,
            force_demo: demoMode,
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
        
        setTimeout(() => {
          if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({
              top: chatContainerRef.current.scrollHeight,
              behavior: "smooth",
            });
          }
        }, 100);
      } catch (fetchErr: any) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (requestIdRef.current !== requestId) return;
        if (fetchErr.name === "AbortError" || fetchErr.message?.includes("timeout")) {
          throw new Error(
            "Request timed out. The AI response is taking too long. Try a shorter question or use a smaller Ollama model."
          );
        }
        throw fetchErr;
      }
    } catch (err: any) {
      console.error("[Watchtower] Error sending message:", err);
      
      let errorMessage = "Watchtower could not process your request. ";
      const errorText = err.message || "";
      
      if (errorText.includes("timeout") || errorText.includes("timed out") || errorText.includes("504")) {
        errorMessage = "⏱️ The AI response timed out.\n\nTry:\n• A shorter, simpler question\n• Use a smaller Ollama model (e.g. gemma3:4b) for faster responses\n• Check backend logs for Ollama response time";
      } else if (errorText.includes("503") || errorText.includes("Cannot connect to Ollama")) {
        errorMessage = "🔌 Cannot connect to Ollama.\n\nPlease ensure:\n• Ollama is running on http://127.0.0.1:11434\n• You can test with: `curl http://127.0.0.1:11434/api/tags`\n• The model is available";
      } else if (errorText.includes("502") || errorText.includes("Error calling LLM")) {
        errorMessage = "⚠️ Ollama returned an error.\n\nThis could mean:\n• The model isn't loaded or available\n• Ollama is out of memory\n• Check Ollama logs for details\n\nError: " + errorText;
      } else if (errorText.includes("500")) {
        errorMessage = "❌ Internal server error.\n\nCheck the backend logs for details.\n\nError: " + errorText;
      } else if (errorText) {
        errorMessage += "\n\n" + errorText;
      } else {
        errorMessage += "Check the API / LLM service and try again.";
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
  }, [sending, messages, selectedDetection, selectedAlert, portfolioContext]);

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
              <p className="text-lg font-display font-semibold text-slate-900">Booting Watchtower</p>
              <p className="text-sm text-slate-600">Initializing AI assistant…</p>
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
                onClick={() => loadData(true)}
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
    <div className="w-full min-h-screen flex flex-col bg-white text-slate-900 overflow-y-auto">
      {/* Main Chat Area - Full Width and Height */}
      <div className="flex-1 flex flex-col min-h-0">
            <div 
              ref={chatContainerRef}
          className={cn(
            "flex-1 overflow-x-hidden flex flex-col",
            messages.length > 0 ? "overflow-y-auto" : "overflow-y-hidden"
          )}
        >
          <div className={cn(
            "w-full px-4 sm:px-6 lg:px-8 flex-1 flex flex-col",
            showQuickActions ? "py-6" : "py-8",
            messages.length > 0 && "pb-24"
          )}>
            {/* Quick Actions - Full Page Layout */}
            {showQuickActions && (
              <div className="flex flex-col items-center justify-center flex-1 space-y-6 animate-fade-in-scale">
                <div className="text-center space-y-2 mb-4">
                  <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-indigo-50 border border-indigo-100 mb-3">
                    <Cpu className="h-7 w-7 text-indigo-500" />
                  </div>
                  <h2 className="text-2xl font-display font-bold text-slate-900">How can I help you today?</h2>
                  <p className="text-slate-600 text-sm">Ask about detections, events, or test results</p>
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
                          "bg-white border-slate-200",
                          !AI_DISABLED && "hover:border-indigo-200 hover:bg-indigo-50",
                          !AI_DISABLED && action.color === "sky" && "hover:bg-sky-50",
                          !AI_DISABLED && action.color === "emerald" && "hover:bg-emerald-50",
                          !AI_DISABLED && action.color === "amber" && "hover:bg-amber-50",
                          !AI_DISABLED && action.color === "purple" && "hover:bg-purple-50",
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
                            <h3 className="font-display font-semibold text-sm text-slate-900 mb-1">
                              {action.title}
                            </h3>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {action.description}
                            </p>
                            </div>
                          </div>
                        </button>
                    );
                  })}
                </div>
              </div>
            )}

            {AI_DISABLED && (
              <div className="fixed inset-0 z-20 flex items-center justify-center">
                <div className="absolute inset-0 bg-white/95 backdrop-blur-[2px]" />
                <div className="relative mx-6 w-full max-w-[72rem] overflow-hidden rounded-[40px] border border-transparent bg-white p-16 text-center shadow-[0_18px_42px_-30px_rgba(15,23,42,0.1)] animate-fade-in-scale">
                  <div className="relative">
                    <div className="mx-auto mb-10 flex h-28 w-28 items-center justify-center rounded-[30px] bg-white border border-slate-200 shadow-[0_14px_30px_-18px_rgba(15,23,42,0.15)] animate-pulse">
                      <Cpu className="h-11 w-11 text-slate-900" />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-[0.45em] text-slate-500">Coming soon</p>
                    <h3 className="mt-4 text-5xl font-display font-semibold text-slate-900">Watchtower AI</h3>
                    <p className="mt-6 text-xl text-slate-600">
                      Premium AI analysis is in progress. For now, run tests to generate real data.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Messages - Full Width Layout */}
            {messages.length > 0 && (
              <div className="space-y-6 py-8 max-w-4xl mx-auto">
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
                      <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30 flex items-center justify-center mt-1">
                        <MessageCircle className="h-4 w-4 text-emerald-300" />
                          </div>
                    )}
                    
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-4 shadow-lg",
                      msg.role === "user"
                        ? "bg-gradient-to-br from-sky-500/30 to-sky-600/20 text-slate-900 border border-sky-400/40"
                        : cn(
                            "bg-white text-slate-900 border border-slate-200",
                            msg.error && "border-red-500/40 bg-red-50"
                          )
                    )}>
                      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
                        {msg.content}
                      </div>
                      <div className={cn(
                        "mt-2 text-xs",
                        msg.role === "user" ? "text-slate-700" : "text-slate-600"
                      )}>
                        {mounted ? formatRelative(new Date(msg.timestamp), new Date()) : "Just now"}
                      </div>
                    </div>

                    {msg.role === "user" && (
                      <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500/20 to-sky-600/20 border border-sky-500/30 flex items-center justify-center mt-1">
                        <Cpu className="h-4 w-4 text-sky-300" />
                </div>
              )}
            </div>
                ))}
                
                {sending && (
                  <div className="flex gap-4 justify-start animate-fade-in-scale">
                    <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30 flex items-center justify-center mt-1">
                      <MessageCircle className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="bg-white text-slate-900 border border-slate-200 rounded-2xl px-5 py-4 shadow-lg">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-900" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Focused Actions Footer */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white z-10">
          <div className="w-full px-4 py-3 sm:px-6 lg:px-12">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-sm text-slate-600">
                {AI_DISABLED ? (
                  <span className="text-xs text-slate-500">
                    AI analysis is coming soon.
                  </span>
                ) : (
                  <>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={demoMode}
                        onChange={(e) => setDemoMode(e.target.checked)}
                      />
                      Demo mode
                    </label>
                    <span className="text-xs text-slate-500">
                      Use sample context instead of live data
                    </span>
                  </>
                )}
              </div>
              {messages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMessages([]);
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                    }
                  }}
                >
                  <X className="h-4 w-4 mr-2" />
                  New analysis
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WatchtowerPage() {
  return <WatchtowerPageContent />;
}
