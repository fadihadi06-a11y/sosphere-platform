# SOSphere - Invoke stripe-e2e-test-probe (R-22 followup verification)
# Pops a GUI dialog for PROBE_SECRET, then POSTs to the live probe.
# Pretty-prints the JSON result with pass/fail per phase.

Add-Type -AssemblyName Microsoft.VisualBasic

$secret = $env:PROBE_SECRET
if (-not $secret) {
    $secret = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Paste PROBE_SECRET value`n(the same one set in Supabase secrets)",
        "SOSphere - Stripe E2E Probe",
        ""
    )
}

if (-not $secret) {
    Write-Host "Cancelled - no PROBE_SECRET provided." -ForegroundColor Yellow
    exit 1
}

$secret = $secret.Trim()
$url = "https://rtfhkbskgrasamhjraul.supabase.co/functions/v1/stripe-e2e-test-probe"

Write-Host "Invoking probe... (this takes 60-90 seconds; 6 phases run sequentially)" -ForegroundColor Cyan
Write-Host ""

try {
    $response = Invoke-WebRequest `
        -Uri $url `
        -Method POST `
        -Headers @{ "Authorization" = "Bearer $secret"; "Content-Type" = "application/json" } `
        -Body "{}" `
        -TimeoutSec 180 `
        -UseBasicParsing

    $json = $response.Content | ConvertFrom-Json
    Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host ($json | ConvertTo-Json -Depth 10)
} catch {
    Write-Host "Probe call failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host "Response body:"
        Write-Host $reader.ReadToEnd()
    }
    exit 1
}
