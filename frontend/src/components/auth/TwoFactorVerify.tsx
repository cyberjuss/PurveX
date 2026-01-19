"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, AlertCircle } from "lucide-react";
import { verify2FAToken } from "@/lib/api";

interface TwoFactorVerifyProps {
  twoFactorToken: string;
  onSuccess: (result: { verified: boolean; method: string; access_token?: string }) => void;
  onCancel?: () => void;
}

export default function TwoFactorVerify({ twoFactorToken, onSuccess, onCancel }: TwoFactorVerifyProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (!token || (token.length !== 6 && token.length !== 8)) {
      setError("Please enter a 6-digit code from your authenticator app or an 8-digit backup code");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await verify2FAToken(token, twoFactorToken);
      onSuccess(result);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "message" in err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setError((err as any).message || "Invalid code. Please try again.");
      } else {
        setError("Invalid code. Please try again.");
      }
      setToken("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-full bg-sky-100">
            <Shield className="h-6 w-6 text-sky-600" />
          </div>
          <CardTitle>Two-Factor Authentication</CardTitle>
        </div>
        <CardDescription>
          Enter the 6-digit code from your authenticator app, or use an 8-digit backup code
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <Label htmlFor="2fa-token">Verification Code</Label>
          <Input
            id="2fa-token"
            type="text"
            inputMode="numeric"
            maxLength={8}
            value={token}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, "");
              setToken(value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (token.length === 6 || token.length === 8)) {
                handleVerify();
              }
            }}
            placeholder="000000 or backup code"
            className="text-center text-2xl font-mono tracking-widest mt-2"
            disabled={loading}
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-2 text-center">
            Enter 6 digits from your authenticator app, or 8 digits for a backup code
          </p>
        </div>

        <div className="flex gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} className="flex-1" disabled={loading}>
              Cancel
            </Button>
          )}
          <Button
            onClick={handleVerify}
            disabled={loading || (token.length !== 6 && token.length !== 8)}
            className="flex-1"
          >
            {loading ? "Verifying..." : "Verify"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
