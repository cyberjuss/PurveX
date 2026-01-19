"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, CheckCircle2, XCircle, AlertTriangle, Key } from "lucide-react";
import { get2FAStatus, disable2FA, regenerateBackupCodes } from "@/lib/api";
import TwoFactorSetup from "@/components/auth/TwoFactorSetup";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

export default function SecuritySettingsPage() {
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [hasBackupCodes, setHasBackupCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [backupCodesDialogOpen, setBackupCodesDialogOpen] = useState(false);
  const [latestBackupCodes, setLatestBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    load2FAStatus();
  }, []);

  async function load2FAStatus() {
    try {
      setLoading(true);
      const status = await get2FAStatus();
      setTwoFactorEnabled(status.enabled);
      setHasBackupCodes(status.has_backup_codes);
    } catch (err: any) {
      setError(err.message || "Failed to load 2FA status");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable2FA() {
    if (!disablePassword) {
      setError("Password is required to disable 2FA");
      return;
    }

    try {
      setDisabling(true);
      setError(null);
      await disable2FA(disablePassword);
      setTwoFactorEnabled(false);
      setHasBackupCodes(false);
      setShowDisableDialog(false);
      setDisablePassword("");
    } catch (err: any) {
      setError(err.message || "Failed to disable 2FA");
    } finally {
      setDisabling(false);
    }
  }

  async function handleRegenerateBackupCodes() {
    try {
      setError(null);
      const result = await regenerateBackupCodes();
      setLatestBackupCodes(result.backup_codes);
      setBackupCodesDialogOpen(true);
      setHasBackupCodes(true);
    } catch (err: any) {
      setError(err.message || "Failed to regenerate backup codes");
    }
  }

  const handleCopyBackupCodes = async () => {
    try {
      await navigator.clipboard.writeText(latestBackupCodes.join("\n"));
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  };

  const handleDownloadBackupCodes = () => {
    const blob = new Blob([latestBackupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "purvex-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          title="Security Settings"
          subtitle="Manage your account security settings including two-factor authentication"
        />
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-3 text-2xl font-display font-semibold">
                <Shield className="h-5 w-5 text-sky-500" />
                Two-Factor Authentication (2FA)
              </CardTitle>
              <CardDescription className="mt-2">
                Add an extra layer of security to your account using an authenticator app
              </CardDescription>
            </div>
            {twoFactorEnabled ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm font-medium">Enabled</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-600">
                <XCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Disabled</span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {twoFactorEnabled ? (
            <>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-700 mb-3">
                  Two-factor authentication is enabled for your account. You'll need to enter a code from your 
                  authenticator app when signing in.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateBackupCodes}
                    disabled={!twoFactorEnabled}
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Regenerate Backup Codes
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowDisableDialog(true)}
                  >
                    Disable 2FA
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 mb-1">
                      Recommended for Admin Accounts
                    </p>
                    <p className="text-xs text-amber-800">
                      Enable 2FA to protect your account from unauthorized access. You'll use an authenticator app 
                      like Google Authenticator, Authy, or Microsoft Authenticator.
                    </p>
                  </div>
                </div>
              </div>
              <Button onClick={() => setShowSetup(true)} className="w-full">
                <Shield className="h-4 w-4 mr-2" />
                Enable Two-Factor Authentication
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2FA Setup Dialog */}
      {showSetup && (
        <Dialog open={showSetup} onOpenChange={setShowSetup}>
          <DialogContent className="border-none bg-transparent shadow-none p-0 flex items-center justify-center">
            <DialogTitle className="sr-only">Enable Two-Factor Authentication</DialogTitle>
            <TwoFactorSetup
              onComplete={() => {
                setShowSetup(false);
                load2FAStatus();
              }}
              onCancel={() => setShowSetup(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Disable 2FA Dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent className="max-w-md rounded-2xl border border-slate-200 bg-white">
          <DialogHeader>
            <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
            <DialogDescription>
              Enter your password to confirm you want to disable 2FA. This will make your account less secure.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="disable-password">Password</Label>
              <Input
                id="disable-password"
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Enter your password"
                className="mt-2"
                disabled={disabling}
              />
            </div>
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                {error}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDisableDialog(false);
                  setDisablePassword("");
                  setError(null);
                }}
                disabled={disabling}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable2FA}
                disabled={disabling || !disablePassword}
              >
                {disabling ? "Disabling..." : "Disable 2FA"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Backup Codes Dialog */}
      <Dialog open={backupCodesDialogOpen} onOpenChange={setBackupCodesDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Backup Codes</DialogTitle>
            <DialogDescription>
              Save these one-time codes securely. Each code can be used once if you lose access to your authenticator app.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 font-mono text-sm">
            {latestBackupCodes.map((code) => (
              <div
                key={code}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center text-slate-900"
              >
                {code}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={handleCopyBackupCodes} disabled={!latestBackupCodes.length}>
              Copy
            </Button>
            <Button onClick={handleDownloadBackupCodes} disabled={!latestBackupCodes.length}>
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
