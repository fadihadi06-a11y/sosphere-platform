# SOSphere - Stripe test-mode setup helper (R-25.2 ASCII-only)
# Pops up a Windows InputBox to receive the sk_test_ key, bypassing
# clipboard issues entirely. Pure ASCII to avoid PowerShell encoding
# problems on Windows-1252 default code pages.

Add-Type -AssemblyName Microsoft.VisualBasic

$prompt = "Paste your sk_test_ secret key from"
$prompt += "`nhttps://dashboard.stripe.com/test/apikeys"
$prompt += "`n`nThe key starts with 'sk_test_' and is about 100 chars long."

$key = [Microsoft.VisualBasic.Interaction]::InputBox(
    $prompt,
    "SOSphere - Stripe Test Setup",
    ""
)

if (-not $key) {
    Write-Host "Cancelled - no key entered." -ForegroundColor Yellow
    exit 1
}

$key = $key.Trim()

if (-not $key.StartsWith("sk_test_")) {
    $preview = if ($key.Length -ge 8) { $key.Substring(0, 8) } else { $key }
    Write-Host "ERROR: key must start with sk_test_  (got: $preview...)" -ForegroundColor Red
    Write-Host "Make sure you copied the SECRET key from Stripe (not publishable, not a command)."
    exit 1
}

Write-Host "OK: key looks valid (starts with sk_test_, length $($key.Length))" -ForegroundColor Green
Write-Host "Running stripe-test-setup.mjs..." -ForegroundColor Cyan
Write-Host ""

node scripts/stripe-test-setup.mjs $key
