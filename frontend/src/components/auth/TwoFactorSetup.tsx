"use client";

import { useState, useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Copy, Download, X } from "lucide-react";
import { get2FASetup, complete2FASetup } from "@/lib/api";

interface TwoFactorSetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
}

export default function TwoFactorSetup({ onComplete, onCancel }: TwoFactorSetupProps) {
  const [step, setStep] = useState<"qr" | "verify" | "success">("qr");
  const [qrUri, setQrUri] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationToken, setVerificationToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showManualSecret, setShowManualSecret] = useState(false);

  useEffect(() => {
    loadSetup();
  }, []);

  async function loadSetup() {
    try {
      setLoading(true);
      setError(null);
      const data = await get2FASetup();
      setQrUri(data.qr_code_uri || data.qr_code || "");
      setSecret(data.secret || "");
      setBackupCodes(data.backup_codes || []);
    } catch (err: any) {
      setError(err.message || "Failed to load 2FA setup");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!verificationToken || verificationToken.length !== 6) {
      setError("Please enter a 6-digit code from your authenticator app");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await complete2FASetup(verificationToken);
      setBackupCodes(result.backup_codes);
      setStep("success");
    } catch (err: any) {
      setError(err.message || "Invalid verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    const text = backupCodes.join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadBackupCodes() {
    const text = backupCodes.join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purvex-2fa-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const handleDone = () => {
    if (onComplete) return onComplete();
    if (onCancel) onCancel();
  };

  const header = (
    <div className="flex items-center justify-between w-full px-6 pt-4">
      <div className="text-left">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Two-Factor</p>
        <p className="text-base font-semibold text-slate-900">Enable Two-Factor Authentication</p>
      </div>
      {onCancel && (
        <button
          aria-label="Close"
          onClick={onCancel}
          className="text-slate-400 hover:text-slate-600 transition"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );

  if (step === "success") {
    return (
      <div className="w-[480px] h-[480px] rounded-3xl bg-white shadow-xl flex flex-col items-center justify-between px-6 py-5">
        {header}
        <div className="flex flex-col items-center text-center gap-4 flex-1 justify-center">
          <div className="p-3 rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">2FA Enabled</p>
            <p className="text-sm text-slate-500 mt-1">Save these backup codes in a secure place.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm text-slate-900 w-full">
            {backupCodes.map((code) => (
              <div key={code} className="rounded-lg border border-slate-200 py-1 px-2">
                {code}
              </div>
            ))}
          </div>
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1" onClick={copyBackupCodes}>
              <Copy className="h-4 w-4 mr-2" />
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={downloadBackupCodes}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
        <div className="flex gap-3 w-full px-6 pb-4">
          <Button className="flex-1" onClick={handleDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[480px] h-[480px] rounded-3xl bg-white shadow-xl flex flex-col items-center justify-between px-6 py-5">
      {header}
      <div className="flex flex-1 flex-col items-center text-center gap-4 justify-center w-full">
        {error && (
          <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}
        <div className="p-3 rounded-2xl border border-slate-200 bg-white shadow-inner">
          {loading ? (
            <div className="h-[180px] w-[180px] flex items-center justify-center text-slate-400">
              Loading QR...
            </div>
          ) : (
            <QRCodeSVG value={qrUri} size={180} level="M" />
          )}
        </div>
        <div className="space-y-2 w-full">
          <button
            type="button"
            onClick={() => setShowManualSecret((prev) => !prev)}
            className="text-xs text-indigo-600 font-medium"
          >
            {showManualSecret ? "Hide manual code" : "Can't scan? Enter code manually"}
          </button>
          {showManualSecret && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700">
              {secret}
            </div>
          )}
        </div>
        <div className="w-full">
          <Input
            id="verification-token"
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={verificationToken}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, "");
              setVerificationToken(value);
              setError(null);
            }}
            placeholder="••••••"
            className="text-center text-2xl font-mono tracking-[0.6em] bg-slate-50"
            disabled={loading}
          />
        </div>
      </div>
      <div className="flex gap-3 w-full px-6 pb-4">
        {onCancel && (
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          onClick={handleVerify}
          disabled={loading || verificationToken.length !== 6}
        >
          {loading ? "Verifying..." : "Verify & Enable"}
        </Button>
      </div>
    </div>
  );
}
