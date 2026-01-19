package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

// RunAtomicRequest describes the minimal contract PurveX expects when
// orchestrating a lab run via the Agent.
//
// This matches the design you described:
//   {
//     "test_run_id": "uuid",
//     "atomic_ids": ["T1059.001"],
//     "os_type": "linux",
//     "extra_tags": { "org_id": "...", "env": "lab" }
//   }
type RunAtomicRequest struct {
	TestRunID string            `json:"test_run_id"`
	AtomicIDs []string          `json:"atomic_ids"`
	OSType    string            `json:"os_type"`   // "windows" | "linux" | "both"
	ExtraTags map[string]string `json:"extra_tags"` // optional metadata
}

// RunAtomicResponse is what PurveX expects back from the Agent when the
// local/lab execution finishes.
type RunAtomicResponse struct {
	Status          string `json:"status"`            // "completed" | "error"
	Stdout          string `json:"stdout,omitempty"`  // trimmed execution output
	Stderr          string `json:"stderr,omitempty"`  // trimmed error output
	DurationSeconds int64  `json:"duration_seconds"`  // whole‑seconds duration
}

type serverConfig struct {
	ListenAddr string
	AuthToken  string
	AllowInsecure bool
}

func loadConfig() serverConfig {
	addr := os.Getenv("PURVEX_AGENT_LISTEN_ADDR")
	if addr == "" {
		addr = ":8081"
	}

	token := os.Getenv("PURVEX_AGENT_TOKEN")
	allowInsecure := strings.EqualFold(os.Getenv("PURVEX_AGENT_ALLOW_INSECURE"), "1") ||
		strings.EqualFold(os.Getenv("PURVEX_AGENT_ALLOW_INSECURE"), "true")

	return serverConfig{
		ListenAddr:    addr,
		AuthToken:     token,
		AllowInsecure: allowInsecure,
	}
}

func main() {
	cfg := loadConfig()

	if cfg.AuthToken == "" && !cfg.AllowInsecure {
		log.Fatal("PURVEX_AGENT_TOKEN is not set. For local, non-production testing you may set PURVEX_AGENT_ALLOW_INSECURE=1, but never do this in a real environment.")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"version": "v0.1.0",
		})
	})

	// Main orchestration endpoint used by PurveX backend.
	mux.Handle("/run_atomic", authMiddleware(cfg.AuthToken, http.HandlerFunc(handleRunAtomic)))

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("PurveX Agent starting on %s\n", cfg.ListenAddr)

	// Graceful shutdown.
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	<-stop
	log.Println("Shutting down PurveX Agent...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	} else {
		log.Println("PurveX Agent stopped cleanly")
	}
}

// handleRunAtomic is the core stub for lab execution.
//
// In this MVP it does NOT execute Atomics yet; instead it simulates work and
// returns a structured response that PurveX can already consume while you
// wire it up to your real Atomic runner.
func handleRunAtomic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Protect against unexpectedly large payloads.
	const maxBodyBytes = 1 << 20 // 1 MiB
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	var req RunAtomicRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.TestRunID == "" || len(req.AtomicIDs) == 0 {
		http.Error(w, "test_run_id and at least one atomic_id are required", http.StatusBadRequest)
		return
	}

	// Basic allow‑list validation for OS and technique ids to reduce misuse and
	// make future command execution safer.
	switch strings.ToLower(req.OSType) {
	case "windows", "linux", "both":
	default:
		http.Error(w, "os_type must be one of: windows, linux, both", http.StatusBadRequest)
		return
	}
	for _, id := range req.AtomicIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			http.Error(w, "atomic_ids must not contain empty values", http.StatusBadRequest)
			return
		}
		if !strings.HasPrefix(strings.ToUpper(id), "T") {
			http.Error(w, "atomic_ids must start with a MITRE technique id like T1059.001", http.StatusBadRequest)
			return
		}
	}

	start := time.Now()

	// --- Execution stub ----------------------------------------------------
	//
	// Here you will eventually:
	//  - invoke Invoke-AtomicTest / pwsh on Windows
	//  - invoke your shell / Python runner on Linux
	//  - or fan out to SSH / WinRM for remote lab hosts.
	//
	// For now we just sleep briefly and echo back a fake command line so the
	// rest of PurveX can develop against a stable Agent contract.

	time.Sleep(2 * time.Second)

	cmd := fmt.Sprintf(
		"Simulated Atomic run for %s on os=%s (atomics=%s)",
		req.TestRunID,
		req.OSType,
		strings.Join(req.AtomicIDs, ","),
	)

	resp := RunAtomicResponse{
		Status:          "completed",
		Stdout:          cmd,
		Stderr:          "",
		DurationSeconds: int64(time.Since(start).Round(time.Second) / time.Second),
	}

	writeJSON(w, http.StatusOK, resp)
}

// authMiddleware enforces a simple shared‑secret header:
//   X-Purvex-Token: <PURVEX_AGENT_TOKEN>
//
// When PURVEX_AGENT_TOKEN is empty, auth is effectively disabled – useful
// for quick local development but not recommended for real deployments.
func authMiddleware(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if secret == "" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Purvex-Token") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		remoteIP := clientIPFromRequest(r)
		log.Printf("%s %s %s %s", remoteIP, r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
	})
}

func clientIPFromRequest(r *http.Request) string {
	// Do not trust X-Forwarded-For blindly in all deployments; this is mainly
	// for observability. In locked-down environments you can put the agent
	// behind a trusted reverse proxy that overwrites these headers.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		ip := strings.TrimSpace(parts[0])
		if ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	if err := enc.Encode(payload); err != nil {
		log.Printf("error writing JSON response: %v", err)
	}
}


