# One-command start for Windows (double-click start.cmd, or run .\start.ps1 in PowerShell).
# On the first run it sets up a virtualenv, installs Ollama and downloads the local model;
# then it launches the companion app and opens the portal.
#   --simulate      try it without a headset
#   --skip-model    don't install Ollama or download the model
# NEUROCHAT_MODEL picks another Ollama model (default qwen3.5:4b, a 3.3 GB download).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Model = if ($env:NEUROCHAT_MODEL) { $env:NEUROCHAT_MODEL } else { "qwen3.5:4b" }
$SkipModel = $args -contains "--skip-model"
$Rest = @($args | Where-Object { $_ -ne "--skip-model" })

function Test-Python($exe, $pre) {
  try { & $exe @pre -c "import sys; sys.exit(sys.version_info < (3, 11))" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

# Python 3.11+: use one that's installed, otherwise let uv download one (no admin rights needed).
$Venv = Join-Path $PSScriptRoot ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  Write-Host "First run: setting up (this takes a minute)..."
  if (Test-Python "py" @("-3")) { & py -3 -m venv $Venv }
  elseif (Test-Python "python" @()) { & python -m venv $Venv }
  else {
    $uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
    if (-not $uv) {
      Write-Host "No Python 3.11+ found; installing uv to fetch one..."
      $env:UV_NO_MODIFY_PATH = "1"
      Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
      $uv = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
    }
    & $uv venv --quiet --seed --python 3.12 $Venv
  }
  if (-not (Test-Path $VenvPy)) { throw "Couldn't create the Python environment in .venv" }
}

$Extras = if ($Rest -contains "--simulate") { "dev" } else { "dev,hardware" }
$Stamp = Join-Path $Venv ".installed-$Extras"
if (-not (Test-Path $Stamp) -or (Get-Item pyproject.toml).LastWriteTime -gt (Get-Item $Stamp).LastWriteTime) {
  & $VenvPy -m pip install --quiet --upgrade pip
  & $VenvPy -m pip install --quiet -e ".[$Extras]"
  if ($LASTEXITCODE -ne 0) { throw "Installing NeuroChat failed" }
  New-Item -ItemType File -Force $Stamp | Out-Null
}

# Local model: install Ollama if it's missing, make sure it's running, download the model once.
function Setup-Model {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  $default = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (-not $ollama -and (Test-Path $default)) { $ollama = $default }
  if (-not $ollama) {
    Write-Host "Installing Ollama (runs the local model)..."
    $setup = Join-Path $env:TEMP "OllamaSetup.exe"
    Invoke-WebRequest https://ollama.com/download/OllamaSetup.exe -OutFile $setup
    Start-Process $setup -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait
    Remove-Item $setup -ErrorAction SilentlyContinue
    if (-not (Test-Path $default)) { throw "Ollama didn't install. Get it from https://ollama.com/download" }
    $ollama = $default
  }
  & $ollama list *> $null
  if ($LASTEXITCODE -ne 0) {
    Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 500; & $ollama list *> $null; if ($LASTEXITCODE -eq 0) { break } }
  }
  $have = & $ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split "\s+")[0] }
  if ($have -notcontains $Model) {
    Write-Host "Downloading $Model (one time only)..."
    & $ollama pull $Model
  }
  Write-Host "Local model ready: $Model"
}
if (-not $SkipModel) {
  try { Setup-Model } catch { Write-Warning "$_ Carrying on without the local model; the headset screens still work." }
}
$env:NEUROCHAT_MODEL = $Model

$Url = "http://127.0.0.1:8765"
Start-Job { Start-Sleep 2; Start-Process $using:Url } | Out-Null
Write-Host "Opening $Url (Ctrl+C to stop)"
& $VenvPy -m companion @Rest
