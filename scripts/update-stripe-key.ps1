# SOSphere - Update STRIPE_SECRET_KEY in Supabase (post-key-rotation)
# When the Stripe sk_test_ key has been rolled on the Dashboard, the
# value stored in Supabase secrets becomes "Expired API Key". This
# helper accepts the NEW key via GUI and pushes it to Supabase secrets
# in one shot. Pure ASCII for PowerShell Windows-1252 compatibility.

Add-Type -AssemblyName Microsoft.VisualBasic

$prompt = "Paste your CURRENT (post-roll) sk_test_ secret key from"
$prompt += "`nhttps://dashboard.stripe.com/test/apikeys"
$prompt += "`n`nThis updates Supabase secrets so the live edge functions"
$prompt += "`ncan reach Stripe API again."

$key = [Microsoft.VisualBasic.Interaction]::InputBox(
    $prompt,
    "SOSphere - Update Stripe Key in Supabase",
    ""
)

if (-not $key) {
    Write-Host "Cancelled." -ForegroundColor Yellow
    exit 1
}

$key = $key.Trim()

if (-not $key.StartsWith("sk_test_")) {
    Write-Host "ERROR: key must start with sk_test_" -ForegroundColor Red
    exit 1
}

Write-Host "OK: key looks valid (length $($key.Length))" -ForegroundColor Green
Write-Host "Pushing STRIPE_SECRET_KEY to Supabase secrets..." -ForegroundColor Cyan

npx supabase secrets set "STRIPE_SECRET_KEY=$key" --project-ref rtfhkbskgrasamhjraul

Write-Host ""
Write-Host "Done. The live stripe-checkout/stripe-webhook/stripe-e2e-test-probe" -ForegroundColor Green
Write-Host "will pick up the new key on their next invocation (no redeploy needed)." -ForegroundColor Green
