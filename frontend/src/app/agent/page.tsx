"use client";

import { useEffect, useState, useRef, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  Cpu, MessageCircle, Send, Loader2, X, Sparkles, Shield, RefreshCw,
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
  prompt: string;
  autoSend?: boolean;
};

function WatchtowerPageContent() {
  const searchParams = useSearchParams();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<DetectionAlert | null>(null);
  const [mounted, setMounted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    if (!mounted || !textareaRef.current) return;
    
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (target) {
        target.style.height = "auto";
        const newHeight = Math.min(target.scrollHeight, 200);
        target.style.height = `${newHeight}px`;
      }
    });
  }, [input, mounted]);

  const loadData = useCallback(async (isRefresh = false) => {
      try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
        setError(null);
      
        const [allDetections, recentTests] = await Promise.all([
          getDetections(),
          getTests(),
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
      title: "Find Issues",
      description: "Identify failing tests, coverage gaps, and detections that need attention",
      icon: Search,
      color: "sky",
      prompt: "What detections need attention? Show me failing tests and coverage gaps.",
      autoSend: true,
    },
    {
      id: "health-summary",
      title: "Health Summary",
      description: "Get a comprehensive overview of your detection portfolio health",
      icon: Activity,
      color: "emerald",
      prompt: "Summarize the overall detection health and provide recommendations",
      autoSend: true,
    },
    {
      id: "best-practices",
      title: "Best Practices",
      description: "Learn detection engineering best practices and optimization techniques",
      icon: BookOpen,
      color: "amber",
      prompt: "What are the best practices for writing effective SPL queries and Sigma rules?",
      autoSend: true,
    },
    {
      id: "ask-anything",
      title: "Ask Watchtower",
      description: "Ask any question about your detections, events, or test results",
      icon: Brain,
      color: "purple",
      prompt: "",
      autoSend: false,
    },
  ], []);

  const detectionQuickActions: QuickAction[] = useMemo(() => {
    if (!selectedDetection) return [];
    
    return [
      {
        id: "summarize",
        title: "Summarize Detection",
        description: `Get a complete overview of "${selectedDetection.title}" including events and analysis`,
        icon: FileText,
        color: "sky",
        prompt: `Summarize the detection "${selectedDetection.title}" (ID: ${selectedDetection.id}) based on its triggered events. Provide a complete overview including: detection purpose, MITRE technique coverage (${selectedDetection.technique_id}), event patterns, test results, and any issues or recommendations.`,
        autoSend: true,
      },
      {
        id: "analyze-tests",
        title: "Analyze Test Results",
        description: "Review PASS/FAIL/INCONCLUSIVE results and get actionable recommendations",
        icon: TrendingUp,
        color: "emerald",
        prompt: `Analyze the latest test results for "${selectedDetection.title}"`,
        autoSend: true,
      },
      {
        id: "improve",
        title: "Improve Detection Logic",
        description: "Get optimized SPL queries and enhanced Sigma rules with better performance",
        icon: Zap,
        color: "amber",
        prompt: `Suggest improvements to the SPL query and Sigma rule for "${selectedDetection.title}"`,
        autoSend: true,
      },
      ...(selectedAlert ? [{
        id: "explain-alert",
        title: "Explain Event",
        description: "Understand what this event means and get recommended actions",
        icon: AlertTriangle,
        color: "purple",
        prompt: `Explain this event: ${selectedAlert.name}. What does it mean and what should I do?`,
        autoSend: true,
      }] : []),
    ] as QuickAction[];
  }, [selectedDetection, selectedAlert]);

  const handleQuickAction = useCallback(async (action: QuickAction) => {
    if (action.autoSend && action.prompt) {
      setInput(action.prompt);
      setTimeout(() => {
        handleSend(action.prompt);
      }, 100);
    } else {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  }, []);

  const handleSend = useCallback(async (promptOverride?: string) => {
    const trimmed = promptOverride || input.trim();
    if (!trimmed || sending) return;

    if (trimmed.toLowerCase() === "/back") {
      setMessages([]);
      setInput("");
      return;
    }

    const now = new Date().toISOString();
    const nextId = messages.length ? messages[messages.length - 1].id + 1 : 1;

    const userMsg: ChatMessage = {
      id: nextId,
      role: "user",
      content: trimmed,
      timestamp: now,
    };
    
    setMessages(prev => [...prev, userMsg]);
    if (!promptOverride) setInput("");
    setSending(true);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setTimeout(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTo({
          top: chatContainerRef.current.scrollHeight,
          behavior: "smooth",
        });
      }
    }, 100);

    try {
      let enhancedPrompt = trimmed;
      
      if (selectedDetection) {
        const relatedTests = tests
          .filter(t => t.detection_id === selectedDetection.id)
          .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        const latestTest = relatedTests[0];

        enhancedPrompt = `[Detection Context]
Title: ${selectedDetection.title}
MITRE Technique: ${selectedDetection.technique_id}
SIEM Type: ${selectedDetection.siem_type}
Status: ${selectedDetection.status || "DRAFT"}
${selectedDetection.description ? `Description: ${selectedDetection.description}\n` : ""}
${selectedDetection.siem_query ? `SIEM Query:\n${selectedDetection.siem_query}\n` : ""}
${selectedDetection.sigma_rule ? `Sigma Rule (YAML):\n${selectedDetection.sigma_rule}\n` : ""}
${latestTest ? `Latest Test Run:\n- Test ID: ${latestTest.id}\n- Started: ${new Date(latestTest.started_at).toLocaleString()}\n- Environment: ${latestTest.environment}\n- Status: ${latestTest.status}\n- Result: ${latestTest.result || latestTest.status}\n- Score: ${typeof latestTest.score === "number" ? latestTest.score : "N/A"}\n` : ""}`;

        if (selectedAlert) {
          enhancedPrompt += `\n[Alert Context]
Alert Name: ${selectedAlert.name}
Time: ${new Date(selectedAlert.time).toLocaleString()}
Host: ${selectedAlert.host || "N/A"}
Severity: ${selectedAlert.severity}
SPL Query: ${selectedAlert.query}
Raw Event: ${selectedAlert.raw_event}`;
        }

        enhancedPrompt += `\n\n[User Question]\n${trimmed}\n\nWhen answering, ground your analysis in the latest test run and SIEM query context above.`;
      }
      
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort();
      }, 95000);
      
      try {
        const res = (await apiFetch("/assistant/chat", {
          method: "POST",
          body: JSON.stringify({ prompt: enhancedPrompt }),
          signal: abortControllerRef.current.signal,
        })) as { answer?: string };
        
        clearTimeout(timeoutId);
        
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
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError" || fetchErr.message?.includes("timeout")) {
          throw new Error(
            "Request timed out. The AI response is taking too long (over 90 seconds). Please try again with a shorter question or use a smaller Ollama model."
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
    }
  }, [input, sending, messages, selectedDetection, selectedAlert, tests]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center space-y-6">
          <div className="relative inline-block">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center">
              <Cpu className="h-10 w-10 text-sky-400 animate-pulse" />
            </div>
            <Sparkles className="absolute -top-2 -right-2 h-6 w-6 text-emerald-400 animate-ping" />
            </div>
            <div>
            <p className="text-lg font-display font-semibold text-slate-200 mb-2">Booting Watchtower</p>
            <p className="text-sm text-slate-400">Initializing AI assistant...</p>
          </div>
        </div>
      </div>
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
    <div className="w-full h-screen flex flex-col bg-white text-slate-900 overflow-hidden">
      {/* Main Chat Area - Full Width and Height */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
                        disabled={sending}
                        className={cn(
                          "group relative text-left px-5 py-4 rounded-xl border transition-all duration-200",
                          "hover:scale-[1.01] hover:shadow-md",
                          "bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50",
                          action.color === "sky" && "hover:bg-sky-50",
                          action.color === "emerald" && "hover:bg-emerald-50",
                          action.color === "amber" && "hover:bg-amber-50",
                          action.color === "purple" && "hover:bg-purple-50",
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

        {/* Input Area - Fixed at Bottom */}
        <div className="flex-shrink-0 border-t border-slate-200 bg-white z-10">
          <div className="w-full px-4 py-3 sm:px-6 lg:px-12">
            <div className="relative max-w-4xl mx-auto">
              <div className="flex items-end gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-lg">
                  {messages.length > 0 && (
                    <button
                      onClick={() => {
                        setMessages([]);
                        setInput("");
                      if (abortControllerRef.current) {
                        abortControllerRef.current.abort();
                      }
                      }}
                    className="flex-shrink-0 h-10 w-10 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center transition-colors"
                    title="New chat"
                    >
                    <X className="h-4 w-4 text-slate-600" />
                    </button>
                  )}
                
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Watchtower about a detection, alert, or test result..."
                  className="min-h-[52px] w-full flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 border-0 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none px-0 py-2"
                    disabled={sending}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!sending && input.trim()) {
                          handleSend();
                        }
                      }
                    }}
                    rows={1}
                    wrap="soft"
                    autoFocus
                  />
                
                  <Button
                    size="sm"
                    disabled={sending || !input.trim()}
                  className="flex-shrink-0 h-10 w-10 rounded-lg text-white bg-indigo-600 hover:bg-indigo-500 font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-indigo-500/70"
                  onClick={() => handleSend()}
                  aria-label="Send message to Watchtower AI"
                >
                  {sending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                  </Button>
              </div>
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

