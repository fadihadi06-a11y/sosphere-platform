# ═══════════════════════════════════════════════════════════════════════════
# SOSphere — Stripe test-mode setup helper (R-25 follow-up)
# ─────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#   Reliably getting a sk_test_ key into a PowerShell process turned out to
#   be surprisingly fragile when the user is also copy-pasting commands
#   from a chat window — every copy obliterates the clipboard, so any
#   workflow that depends on clipboard state at the right moment is
#   error-prone.
#
#   This helper sidesteps clipboard entirely by popping up a Windows GUI
#   InputBox. The user pastes the key into the dialog whenever they're
#   ready — clipboard state at the time of script invocation doesn't
#   matter.
#
# USAGE
#   .\scripts\stripe-setup-helper.ps1
#   (a dialog pops up; paste key; OK; script runs)
# ═══════════════════════════════════════════════════════════════════════════

Add-Type -AssemblyName Microsoft.VisualBasic

$key = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Paste your sk_test_... secret key from https://dashboard.stripe.com/test/apikeys`n`nThe key starts with 'sk_test_' and is about 100 characters long.",
    "SOSphere — Stripe Test Setup",
    ""
)

if (-not $key) {
    Write-Host "Cancelled — no key entered." -ForegroundColor Yellow
    exit 1
}

$key = $key.Trim()

if (-not $key.StartsWith("sk_test_")) {
    Write-Host "ERROR: key must start with sk_test_  (got: $($key.Substring(0, [Math]::Min(8, $key.Length)))...)" -ForegroundColor Red
    Write-Host "Make sure you copied the SECRET key from Stripe (not the publishable key, not a command)."
    exit 1
}

Write-Host "✓ key looks valid (starts with sk_test_, length $($key.Length))" -ForegroundColor Green
Write-Host "Running stripe-test-setup.mjs..." -ForegroundColor Cyan
Write-Host ""

node scripts/stripe-test-setup.mjs $key
