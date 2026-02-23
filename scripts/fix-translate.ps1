$root = Split-Path $PSScriptRoot -Parent
$dirs = @("$root\components", "$root\app")

$files = $dirs | ForEach-Object {
  Get-ChildItem -Recurse -Include "*.tsx","*.ts" -Path $_ -ErrorAction SilentlyContinue
} | Where-Object { $_.FullName -notmatch "node_modules|\.next" }

foreach ($f in $files) {
  $c = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
  $orig = $c
  $c = $c -creplace "tranwarm-", "translate-"
  if ($c -ne $orig) {
    [System.IO.File]::WriteAllText($f.FullName, $c, [System.Text.UTF8Encoding]::new($false))
    Write-Host "fixed: $($f.Name)"
  }
}
Write-Host "Done."
