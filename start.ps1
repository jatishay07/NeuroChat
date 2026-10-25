# One-command start for Windows (double-click start.cmd, or run .\start.ps1 in PowerShell).
# On the first run it sets up a virtualenv, installs Ollama and downloads the local model;
# then it launches the companion app and opens the portal.
#   --simulate      try it without a headset
#   --skip-model    don't install Ollama or download the model
#   --no-update     don't pull the latest version first
#   --no-webui      don't start Open WebUI (the full chat portal on http://127.0.0.1:3000)
# It also installs a `neurochat` command that runs this from any terminal.
# NEUROCHAT_MODEL picks another Ollama model (default qwen3.5:4b, a 3.3 GB download).
# NEUROCHAT_WEBUI=docker|local|off picks how Open WebUI runs (default: Docker when it's running).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Update to the latest version on every run, then restart with the new script. Skipped when
# offline, when you have local changes, or when you're on a branch other than main.
if (-not $env:NEUROCHAT_UPDATED -and -not ($args -contains "--no-update") -and (Test-Path .git) -and (Get-Command git -ErrorAction SilentlyContinue)) {
  $branch = git rev-parse --abbrev-ref HEAD 2>$null
  git diff --quiet HEAD 2>$null
  if ($branch -eq "main" -and $LASTEXITCODE -eq 0) {
    $before = git rev-parse HEAD
    $env:GIT_TERMINAL_PROMPT = "0"
    git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 pull --quiet --ff-only origin main 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "Couldn't check for updates (offline?); starting the version you have." }
    elseif ((git rev-parse HEAD) -ne $before) { Write-Host "Updated NeuroChat to the latest version." }
  }
  $env:NEUROCHAT_UPDATED = "1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @args
  exit $LASTEXITCODE
}

$Model = if ($env:NEUROCHAT_MODEL) { $env:NEUROCHAT_MODEL } else { "qwen3.5:4b" }
$SkipModel = $args -contains "--skip-model"
$WebUIMode = if ($args -contains "--no-webui") { "off" } elseif ($env:NEUROCHAT_WEBUI) { $env:NEUROCHAT_WEBUI } else { "auto" }
$Rest = @($args | Where-Object { $_ -ne "--skip-model" -and $_ -ne "--no-update" -and $_ -ne "--no-webui" })

function Test-Python($exe, $pre) {
  try { & $exe @pre -c "import sys; sys.exit(sys.version_info < (3, 11))" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

function Find-Uv {
  $uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
  $default = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
  if (-not $uv -and (Test-Path $default)) { $uv = $default }
  if (-not $uv) {
    Write-Host "Installing uv (fetches the right Python, no admin rights needed)..."
    $env:UV_NO_MODIFY_PATH = "1"
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $uv = $default
  }
  return $uv
}

# Python 3.11+: use one that's installed, otherwise let uv download one (no admin rights needed).
$Venv = Join-Path $PSScriptRoot ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  Write-Host "First run: setting up (this takes a minute)..."
  if (Test-Python "py" @("-3")) { & py -3 -m venv $Venv }
  elseif (Test-Python "python" @()) { & python -m venv $Venv }
  else {
    Write-Host "No Python 3.11+ found."
    $uv = Find-Uv
    & $uv venv --quiet --seed --python 3.12 $Venv
  }
  if (-not (Test-Path $VenvPy)) { throw "Couldn't create the Python environment in .venv" }
}

$Extras = if ($Rest -contains "--simulate") { "dev" } else { "dev,hardware" }
$Stamp = Join-Path $Venv ".installed-$Extras"
if (-not (Test-Path $Stamp) -or (Get-Item pyproject.toml).LastWriteTime -gt (Get-Item $Stamp).LastWriteTime) {
  & $VenvPy -m pip install --quiet --upgrade pip
  & $VenvPy -m pip install --quiet -e ".[$Extras]"
  if ($LASTEXITCODE -eq 0) { New-Item -ItemType File -Force $Stamp | Out-Null }
  else {
    # Bluetooth/LSL packages can fail on some machines; still start so eye tracking works.
    & $VenvPy -m pip install --quiet -e ".[dev]"
    if ($LASTEXITCODE -ne 0) { throw "Installing NeuroChat failed" }
    Write-Warning "Headset support didn't install, so connecting a headset won't work yet; eye tracking still does."
  }
}

# Local model: install Ollama if it's missing, make sure it's running, download the model once.
function Install-Ollama {
  Write-Host "Installing the latest Ollama (runs the local model)..."
  Get-Process "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
  $setup = Join-Path $env:TEMP "OllamaSetup.exe"
  Invoke-WebRequest https://ollama.com/download/OllamaSetup.exe -OutFile $setup
  Start-Process $setup -ArgumentList "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART" -Wait
  Remove-Item $setup -ErrorAction SilentlyContinue
  if (-not (Test-Path (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"))) { throw "Ollama didn't install. Get it from https://ollama.com/download" }
}
function Start-Ollama($ollama) {
  & $ollama list *> $null
  if ($LASTEXITCODE -ne 0) {
    Start-Process $ollama -ArgumentList "serve" -WindowStyle Hidden
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; & $ollama list *> $null; if ($LASTEXITCODE -eq 0) { break } }
  }
}
function Test-Model($ollama) {
  $have = & $ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split "\s+")[0] }
  return $have -contains $Model
}
function Setup-Model {
  $ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
  $default = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (-not $ollama -and (Test-Path $default)) { $ollama = $default }
  if (-not $ollama) { Install-Ollama; $ollama = $default }
  Start-Ollama $ollama
  if (-not (Test-Model $ollama)) {
    Write-Host "Downloading $Model (one time only)..."
    $ErrorActionPreference = "Continue"  # ollama writes progress to stderr; don't treat it as a failure
    & $ollama pull $Model 2>&1 | Tee-Object -Variable pullLog | Out-Host
    if (($pullLog | Out-String) -match "newer version of Ollama") {
      # The model needs a newer Ollama than the one installed: update it and try once more.
      Install-Ollama
      Start-Ollama $default
      $ollama = $default
      & $ollama pull $Model
    }
  }
  if (-not (Test-Model $ollama)) { throw "Couldn't download $Model. If it says Ollama is too old, update it from https://ollama.com/download." }
  Write-Host "Local model ready: $Model"
}
if (-not $SkipModel) {
  try { Setup-Model } catch { Write-Warning "$_ Carrying on without the local model; the headset screens still work." }
}
$env:NEUROCHAT_MODEL = $Model

# `neurochat` command: a tiny launcher in %USERPROFILE%\.local\bin, added to your PATH.
try {
  $bin = Join-Path $env:USERPROFILE ".local\bin"
  New-Item -ItemType Directory -Force $bin | Out-Null
  $launcher = "@echo off`r`nrem Installed by NeuroChat. Updates and starts it.`r`ncall `"$PSScriptRoot\start.cmd`" %*`r`n"
  $target = Join-Path $bin "neurochat.cmd"
  if (-not (Test-Path $target) -or (Get-Content $target -Raw) -ne $launcher) { Set-Content -Path $target -Value $launcher -NoNewline -Encoding ASCII }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") -contains $bin)) {
    [Environment]::SetEnvironmentVariable("Path", (@($userPath, $bin) | Where-Object { $_ }) -join ";", "User")
    Write-Host "Added the neurochat command. Open a new terminal window, then just type: neurochat"
  }
} catch { Write-Warning "Couldn't install the neurochat command; start.cmd still works." }

# Open WebUI: the full chat portal, where tutor conversations carry on ("Continue in Open WebUI").
# It runs in Docker when Docker is running, otherwise in its own Python environment in .webui.
# Sign-in is off: it only listens on this computer and is for one person. Fewer background
# requests (follow-up suggestions, tags, autocomplete) keep a small model responsive.
$WebUIVars = @{ WEBUI_AUTH = "False"; ENABLE_OPENAI_API = "False"; DEFAULT_MODELS = "neurochat-tutor";
  ENABLE_FOLLOW_UP_GENERATION = "False"; ENABLE_TAGS_GENERATION = "False"; ENABLE_AUTOCOMPLETE_GENERATION = "False" }
$WebUIProc = $null
$WebUIContainer = $null
function Test-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  docker info *> $null
  return $LASTEXITCODE -eq 0
}
function Start-WebUIDocker {
  if (-not (Test-Docker)) { throw "Docker isn't running." }
  docker container inspect neurochat-webui *> $null
  if ($LASTEXITCODE -eq 0) { docker start neurochat-webui | Out-Null }
  else {
    Write-Host "Starting Open WebUI in Docker (the first time downloads about 4 GB)..."
    $envArgs = $WebUIVars.GetEnumerator() | ForEach-Object { "-e"; "$($_.Key)=$($_.Value)" }
    docker run -d --name neurochat-webui -p 127.0.0.1:3000:8080 -v neurochat-webui:/app/backend/data `
      -e OLLAMA_BASE_URL=http://host.docker.internal:11434 @envArgs ghcr.io/open-webui/open-webui:main | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "Docker couldn't start Open WebUI." }
  $script:WebUIContainer = "neurochat-webui"
}
function Start-WebUILocal {
  $dir = Join-Path $PSScriptRoot ".webui"
  $exe = Join-Path $dir "Scripts\open-webui.exe"
  if (-not (Test-Path $exe)) {
    Write-Host "Installing Open WebUI (one time only, about 2 GB)..."
    $uv = Find-Uv
    & $uv venv --quiet --python 3.11 $dir
    & $uv pip install --quiet --python (Join-Path $dir "Scripts\python.exe") open-webui
    if (-not (Test-Path $exe)) { throw "Open WebUI didn't install." }
  }
  $data = Join-Path $PSScriptRoot ".webui-data"
  New-Item -ItemType Directory -Force $data | Out-Null
  foreach ($kv in $WebUIVars.GetEnumerator()) { Set-Item "env:$($kv.Key)" $kv.Value }
  $env:DATA_DIR = $data
  $env:OLLAMA_BASE_URL = "http://127.0.0.1:11434"
  # Run it from its data folder: it keeps its secret key (.webui_secret_key) in the current folder.
  $script:WebUIProc = Start-Process $exe -WorkingDirectory $data -ArgumentList "serve", "--host", "127.0.0.1", "--port", "3000" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $data "open-webui.log") -RedirectStandardError (Join-Path $data "open-webui.err.log")
}
function Stop-WebUI {
  if ($WebUIProc) { Stop-Process -Id $WebUIProc.Id -Force -ErrorAction SilentlyContinue }
  if ($WebUIContainer) { docker stop $WebUIContainer *> $null }
}
$webuiUp = $false
try { Invoke-RestMethod http://127.0.0.1:3000/health -TimeoutSec 2 | Out-Null; $webuiUp = $true } catch {}
if ($webuiUp) { Write-Host "Open WebUI is already running on http://127.0.0.1:3000" }
elseif ($WebUIMode -ne "off") {
  try {
    if ($WebUIMode -eq "docker") { Start-WebUIDocker }
    elseif ($WebUIMode -eq "local") { Start-WebUILocal }
    # Keep using whichever it was set up with before, so earlier chats are still there.
    elseif (-not (Test-Path (Join-Path $PSScriptRoot ".webui")) -and (Test-Docker)) {
      try { Start-WebUIDocker } catch { Start-WebUILocal }
    } else { Start-WebUILocal }
    Write-Host "Open WebUI is starting on http://127.0.0.1:3000 (it takes up to a minute)."
  } catch { Write-Warning "$_ Open WebUI didn't start, so chats stay in the NeuroChat page." }
}

$Url = "http://127.0.0.1:8765"
Start-Job { Start-Sleep 2; Start-Process $using:Url } | Out-Null
Write-Host "Opening $Url (Ctrl+C to stop)"
try { & $VenvPy -m companion @Rest } finally { Stop-WebUI }
