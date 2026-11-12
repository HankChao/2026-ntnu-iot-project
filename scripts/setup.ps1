# MQTT / .env setup helper (PowerShell port of scripts/setup.sh). See docs/MQTT.md.
#
#   .\scripts\setup.ps1 [init] [-MqttPassword PW] [-RotateMqtt]
#   .\scripts\setup.ps1 show
#   .\scripts\setup.ps1 tls -SelfSigned -TlsHost HOST[,HOST...] [-KeepLanPlain|-NoLanPlain]
#   .\scripts\setup.ps1 tls -Cert FULLCHAIN.pem -Key PRIVKEY.pem [-Ca CA.pem] [-TlsHost HOST]
#   .\scripts\setup.ps1 tls -Disable
#   .\scripts\setup.ps1 check [-Watch SECONDS]
[CmdletBinding()]
param(
    [Parameter(Position = 0)][ValidateSet('init', 'show', 'tls', 'check')][string]$Command = 'init',
    [string]$MqttPassword,
    [switch]$RotateMqtt,
    [switch]$SelfSigned,
    [string]$TlsHost,
    [string]$Cert,
    [string]$Key,
    [string]$Ca,
    [switch]$KeepLanPlain,
    [switch]$NoLanPlain,
    [switch]$Disable,
    [int]$Watch = 0
)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$EnvFile = Join-Path $Root '.env'
$EnvExample = Join-Path $Root '.env.example'
$CertDir = Join-Path $Root 'mosquitto/certs'
$TlsConf = Join-Path $Root 'mosquitto/conf.d/tls.conf'
$MosquittoImage = 'eclipse-mosquitto:2'
$PasswdMode = if (Test-Path (Join-Path $Root 'mosquitto/start.sh')) { 'generated' } else { 'file' }
$HasEsp32 = Test-Path (Join-Path $Root 'firmware')
# Firmware with APP_MQTT_TLS verifies the broker against public CAs + hostname only.
$Esp32ConfigExample = Join-Path $Root 'firmware/esp32-s3/main/app_config.example.h'
$Esp32Tls = $HasEsp32 -and (Test-Path $Esp32ConfigExample) -and [bool](Select-String -LiteralPath $Esp32ConfigExample -Pattern 'APP_MQTT_TLS' -Quiet)
$IsWin = ($PSVersionTable.PSEdition -eq 'Desktop') -or $IsWindows

function Info($msg) { Write-Host "==> $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "[error] $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- .env helpers
function Read-EnvLines { if (Test-Path $EnvFile) { @(Get-Content -LiteralPath $EnvFile) } else { @() } }

function Write-EnvLines([string[]]$lines) {
    # LF + UTF-8 without BOM so docker compose and bash read it the same way.
    [IO.File]::WriteAllText($EnvFile, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
}

function Test-EnvKey([string]$k) { [bool](Read-EnvLines | Where-Object { $_ -like "$k=*" }) }

function Get-EnvValue([string]$k) {
    $line = Read-EnvLines | Where-Object { $_ -like "$k=*" } | Select-Object -Last 1
    if (-not $line) { return '' }
    $v = $line.Substring($k.Length + 1)
    if ($v -match '^"(.*)"$' -or $v -match "^'(.*)'$") { $v = $Matches[1] }
    return $v
}

function Set-EnvValue([string]$k, [string]$v) {
    $out = New-Object System.Collections.Generic.List[string]
    $done = $false
    foreach ($line in (Read-EnvLines)) {
        if ($line -like "$k=*") {
            if (-not $done) { $out.Add("$k=$v"); $done = $true }
        } else { $out.Add($line) }
    }
    if (-not $done) { $out.Add("$k=$v") }
    Write-EnvLines $out.ToArray()
}

function New-Secret([int]$len = 24) {
    $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] $len
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

# Characters that break docker compose interpolation, YAML or C strings.
function Assert-Password([string]$pw) {
    if (-not $pw) { Die 'Password must not be empty.' }
    if ($pw -match '[\s$"''`\\#]') { Die 'Password must not contain spaces or any of: $ " '' ` \ #' }
}

function Get-LanIp {
    # Connecting a UDP socket sends nothing; it only picks the outbound interface.
    try {
        $s = New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetwork, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp)
        $s.Connect('8.8.8.8', 80)
        $ip = $s.LocalEndPoint.Address.ToString()
        $s.Dispose()
        if ($ip -and $ip -ne '0.0.0.0') { return $ip }
    } catch { }
    return '<this-computer-LAN-IP>'
}

function Or-Default([string]$v, [string]$d) { if ($v) { $v } else { $d } }

function Get-DefaultUser {
    $line = if (Test-Path $EnvExample) { Get-Content -LiteralPath $EnvExample | Where-Object { $_ -like 'MQTT_USERNAME=*' } | Select-Object -Last 1 }
    if ($line -and $line.Length -gt 'MQTT_USERNAME='.Length) { $line.Substring('MQTT_USERNAME='.Length) } else { 'maps' }
}

# ------------------------------------------------------------ passwd (server)
function Write-PasswdFile {
    if ($PasswdMode -ne 'file') { return }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die 'docker is required to generate mosquitto/passwd' }
    $user = Or-Default (Get-EnvValue 'MQTT_USERNAME') (Get-DefaultUser)
    $env:MQTT_U = $user
    $env:MQTT_P = Get-EnvValue 'MQTT_PASSWORD'
    try {
        $out = & docker run --rm -e MQTT_U -e MQTT_P --entrypoint sh $MosquittoImage -c 'mosquitto_passwd -b -c /tmp/passwd $MQTT_U $MQTT_P >/dev/null && cat /tmp/passwd'
        if ($LASTEXITCODE -ne 0 -or -not $out) { Die 'mosquitto_passwd failed' }
    } finally {
        Remove-Item Env:MQTT_U, Env:MQTT_P -ErrorAction SilentlyContinue
    }
    [IO.File]::WriteAllText((Join-Path $Root 'mosquitto/passwd'), ((@($out) -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
    Info "Regenerated mosquitto/passwd for user '$user'"
}

# ----------------------------------------------------------------------- init
function Invoke-Init {
    $created = $false; $mqttChanged = $false; $explicit = [bool]$MqttPassword
    if (-not (Test-Path $EnvFile)) {
        if (-not (Test-Path $EnvExample)) { Die '.env.example not found' }
        Write-EnvLines @(Get-Content -LiteralPath $EnvExample)
        $created = $true
        Info 'Created .env from .env.example'
    } else {
        # Never overwrite existing values; only add keys the example has and .env lacks.
        foreach ($line in (Get-Content -LiteralPath $EnvExample)) {
            if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) { continue }
            $k = $line.Split('=')[0]
            if (-not (Test-EnvKey $k)) { Write-EnvLines ((Read-EnvLines) + $line); Info "Added missing $k to .env" }
        }
    }

    $current = Get-EnvValue 'MQTT_PASSWORD'
    $pw = $MqttPassword
    if ($pw) {
        Assert-Password $pw
    } elseif ($RotateMqtt -or -not $current -or ($created -and $current -eq 'iisnrl')) {
        if (-not [Console]::IsInputRedirected) {
            $pw = Read-Host "MQTT password for user '$(Get-EnvValue 'MQTT_USERNAME')' (Enter = random)"
        }
        if ($pw) { Assert-Password $pw } else { $pw = New-Secret 20 }
    }
    if ($pw -and $pw -ne $current) {
        Set-EnvValue 'MQTT_PASSWORD' $pw
        $mqttChanged = $true
        Info 'MQTT_PASSWORD set'
    }

    if ($created) {
        $s = Get-EnvValue 'SESSION_SECRET'
        if (-not $s -or $s -eq 'maps6_super_secret_session_key') {
            Set-EnvValue 'SESSION_SECRET' (New-Secret 40)
            Info 'SESSION_SECRET generated'
        }
        # Only on a fresh .env: the password is baked into the postgres volume on first start.
        $pgOld = Get-EnvValue 'POSTGRES_PASSWORD'
        if (-not $pgOld -or $pgOld -eq 'maps6_secret') {
            $pgNew = New-Secret 24
            Set-EnvValue 'POSTGRES_PASSWORD' $pgNew
            $url = Get-EnvValue 'DATABASE_URL'
            if ($url -and $pgOld) { Set-EnvValue 'DATABASE_URL' ($url.Replace(":$pgOld@", ":$pgNew@")) }
            Info 'POSTGRES_PASSWORD generated (only applies before the postgres volume is first created)'
        }
    } elseif ((Get-EnvValue 'POSTGRES_PASSWORD') -eq 'maps6_secret') {
        Warn 'POSTGRES_PASSWORD is still the example default. Changing it now does not change an existing database volume.'
    }

    $passwdPath = Join-Path $Root 'mosquitto/passwd'
    if ($PasswdMode -eq 'file' -and ($mqttChanged -or $explicit -or -not (Test-Path $passwdPath) -or (Get-Item $passwdPath).Length -eq 0)) {
        Write-PasswdFile
    }

    Invoke-Show
    Write-Host ''
    if ($mqttChanged -or $created) {
        Info 'Apply with: docker compose up -d --force-recreate mosquitto app'
        if ($mqttChanged -and -not $created) { Warn 'The MQTT password changed: update every device (MAPS boxes, ESP32) with the new value.' }
    }
}

# ----------------------------------------------------------------------- show
function Test-Tls { Test-Path $TlsConf }
function Test-TlsCa { (Test-Tls) -and [bool](Select-String -LiteralPath $TlsConf -Pattern '^cafile' -Quiet) }

function Invoke-Show {
    if (-not (Test-Path $EnvFile)) { Die '.env not found. Run scripts/setup.ps1 first.' }
    $user = Or-Default (Get-EnvValue 'MQTT_USERNAME') (Get-DefaultUser)
    $pass = Get-EnvValue 'MQTT_PASSWORD'
    $port = Or-Default (Get-EnvValue 'MQTT_PORT') '1883'
    $tlsPort = Or-Default (Get-EnvValue 'MQTT_TLS_PORT') '8883'
    $webPort = Or-Default (Get-EnvValue 'WEB_PORT') $(if ($HasEsp32) { '8088' } else { '8080' })
    $plainBind = Or-Default (Get-EnvValue 'MQTT_PLAIN_BIND') '0.0.0.0'
    $tlsHost = Get-EnvValue 'MQTT_TLS_HOST'
    $topic = Or-Default (Get-EnvValue 'CLOTHES_MQTT_TOPIC') 'clothes/raw'
    $ip = Get-LanIp

    Write-Host ''
    Info 'MAPS box: /home/pi/maps6/maps6.yaml  (then: sudo systemctl restart maps6d)'
    if (Test-Tls) {
        $broker = Or-Default $tlsHost $ip
        Write-Host "upload:`n  mqtt:`n    broker: `"$broker`"`n    port: $tlsPort`n    username: `"$user`"`n    password: `"$pass`"`n    topic_prefix: `"MAPS`"`n    use_tls: true"
        if (Test-TlsCa) {
            Write-Host '    ca_file: "/home/pi/maps6/mqtt-ca.crt"   # copy mosquitto/certs/ca.crt here'
        } else {
            Write-Host '    ca_file: ""                            # public CA (e.g. Let''s Encrypt)'
        }
    } else {
        Write-Host "upload:`n  mqtt:`n    broker: `"$ip`"`n    port: $port`n    username: `"$user`"`n    password: `"$pass`"`n    topic_prefix: `"MAPS`"`n    use_tls: false"
    }
    Write-Host "    server_url: `"http://${ip}:$webPort`"   # must be reachable from the box"

    if (Test-TlsCa) {
        Write-Host ''
        Info 'Copy the CA to each box:  scp mosquitto/certs/ca.crt pi@<BOX_IP>:/home/pi/maps6/mqtt-ca.crt'
    }

    if ($HasEsp32) {
        Write-Host ''
        if ($Esp32Tls -and (Test-Tls) -and -not (Test-TlsCa)) {
            Info 'ESP32: firmware/esp32-s3/main/app_config.h or the phone setup page (TLS)'
            $espHost = Or-Default $tlsHost '<domain on the certificate>'
            Write-Host "#define APP_MQTT_HOST       `"$espHost`"`n#define APP_MQTT_PORT       $tlsPort`n#define APP_MQTT_TLS        1`n#define APP_MQTT_USERNAME   `"$user`"`n#define APP_MQTT_PASSWORD   `"$pass`"`n#define APP_MQTT_TOPIC      `"$topic`""
        } else {
            Info 'ESP32: firmware/esp32-s3/main/app_config.h  (plain MQTT on the LAN)'
            Write-Host "#define APP_MQTT_HOST       `"$ip`"`n#define APP_MQTT_PORT       $port"
            if ($Esp32Tls) { Write-Host '#define APP_MQTT_TLS        0' }
            Write-Host "#define APP_MQTT_USERNAME   `"$user`"`n#define APP_MQTT_PASSWORD   `"$pass`"`n#define APP_MQTT_TOPIC      `"$topic`""
            if (Test-TlsCa) {
                Warn 'The ESP32 only trusts public CAs, so it cannot use this self-signed certificate; keep it on plain MQTT in the LAN.'
            } elseif (Test-Tls) {
                Warn 'This firmware has no APP_MQTT_TLS support, so the ESP32 stays on plain MQTT in the LAN.'
            }
            if ($plainBind -eq '127.0.0.1') {
                Warn "MQTT_PLAIN_BIND=127.0.0.1: port $port is closed to the LAN, so the ESP32 cannot connect. Re-run 'scripts/setup.ps1 tls ... -KeepLanPlain'."
            }
        }
    }
}

# ------------------------------------------------------------------------ tls
function Invoke-OpenSsl([string[]]$opensslArgs) {
    if (Get-Command openssl -ErrorAction SilentlyContinue) {
        Push-Location $CertDir
        try { & openssl @opensslArgs 2>&1 | Out-Null; $code = $LASTEXITCODE } finally { Pop-Location }
    } else {
        & docker run --rm -v "${CertDir}:/work" -w /work alpine/openssl @opensslArgs 2>&1 | Out-Null
        $code = $LASTEXITCODE
    }
    return $code
}

function New-SelfSigned([string]$hosts) {
    $san = @()
    foreach ($h in ($hosts -split ',')) {
        $h = $h.Trim()
        if (-not $h) { continue }
        if ($h -match '^[0-9.]+$' -or $h.Contains(':')) { $san += "IP:$h" } else { $san += "DNS:$h" }
    }
    if (-not $san) { Die '-TlsHost is required with -SelfSigned' }
    $sanText = $san -join ','
    $first = ($hosts -split ',')[0].Trim()

    if (-not (Test-Path (Join-Path $CertDir 'ca.key')) -or -not (Test-Path (Join-Path $CertDir 'ca.crt'))) {
        if ((Invoke-OpenSsl @('req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '3650', '-subj', '/CN=MAPS MQTT CA')) -ne 0) { Die 'Failed to create CA' }
        Info 'Created CA mosquitto/certs/ca.crt (keep ca.key private)'
    } else {
        Info 'Reusing existing CA mosquitto/certs/ca.crt'
    }
    [IO.File]::WriteAllText((Join-Path $CertDir 'server.ext'), "subjectAltName=$sanText`nbasicConstraints=CA:FALSE`nkeyUsage=digitalSignature,keyEncipherment`nextendedKeyUsage=serverAuth`n", (New-Object Text.UTF8Encoding $false))
    if ((Invoke-OpenSsl @('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', "/CN=$first")) -ne 0) { Die 'Failed to create server key' }
    if ((Invoke-OpenSsl @('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '825', '-extfile', 'server.ext')) -ne 0) { Die 'Failed to sign server certificate' }
    foreach ($f in 'server.csr', 'server.ext', 'ca.srl') { Remove-Item (Join-Path $CertDir $f) -ErrorAction SilentlyContinue }
    Info "Issued mosquitto/certs/server.crt for: $sanText"
}

function Invoke-Tls {
    if (-not (Test-Path $EnvFile)) { Die '.env not found. Run scripts/setup.ps1 first.' }
    New-Item -ItemType Directory -Force -Path $CertDir, (Split-Path $TlsConf) | Out-Null
    # The ESP32 needs plain MQTT on the LAN unless its firmware can verify this certificate.
    $keepPlain = if ($KeepLanPlain) { $true } elseif ($NoLanPlain) { $false } else { $HasEsp32 -and ($SelfSigned -or $Ca -or -not $Esp32Tls) }

    if ($Disable) {
        Remove-Item $TlsConf -ErrorAction SilentlyContinue
        Set-EnvValue 'MQTT_PLAIN_BIND' '0.0.0.0'
        Info "TLS listener disabled; MQTT port $(Or-Default (Get-EnvValue 'MQTT_PORT') '1883') is open to the LAN again."
        Info 'Apply with: docker compose up -d --force-recreate mosquitto'
        return
    }
    if ($SelfSigned) {
        New-SelfSigned $TlsHost
    } elseif ($Cert) {
        if (-not (Test-Path $Cert) -or -not (Test-Path $Key)) { Die '-Cert and -Key must point to existing files' }
        Copy-Item $Cert (Join-Path $CertDir 'server.crt') -Force
        Copy-Item $Key (Join-Path $CertDir 'server.key') -Force
        if ($Ca) { Copy-Item $Ca (Join-Path $CertDir 'ca.crt') -Force } else { Remove-Item (Join-Path $CertDir 'ca.crt') -ErrorAction SilentlyContinue }
        Info 'Installed certificate into mosquitto/certs/'
    } else {
        Die 'Use -SelfSigned -TlsHost HOST, -Cert/-Key, or -Disable'
    }

    if (-not $IsWin) {
        # The broker drops root before loading certificates, so they must be world-readable.
        & chmod 644 (Join-Path $CertDir 'server.crt') (Join-Path $CertDir 'server.key')
        if (Test-Path (Join-Path $CertDir 'ca.crt')) { & chmod 644 (Join-Path $CertDir 'ca.crt') }
        if (Test-Path (Join-Path $CertDir 'ca.key')) { & chmod 600 (Join-Path $CertDir 'ca.key') }
    }

    $conf = @('# Generated by scripts/setup.ps1 tls. Delete this file to disable TLS.', 'listener 8883')
    if ($SelfSigned -or $Ca) { $conf += 'cafile /mosquitto/certs/ca.crt' }
    $conf += 'certfile /mosquitto/certs/server.crt', 'keyfile /mosquitto/certs/server.key'
    [IO.File]::WriteAllText($TlsConf, (($conf -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))

    if ($TlsHost) { Set-EnvValue 'MQTT_TLS_HOST' ($TlsHost -split ',')[0].Trim() }
    if ($keepPlain) {
        Set-EnvValue 'MQTT_PLAIN_BIND' '0.0.0.0'
        Info 'Plain MQTT stays open on the LAN (forward only port 8883 on the router).'
    } else {
        Set-EnvValue 'MQTT_PLAIN_BIND' '127.0.0.1'
        Info 'Plain MQTT now only listens on 127.0.0.1; devices must use TLS on 8883.'
    }

    Invoke-Show
    Write-Host ''
    Info 'Apply with: docker compose up -d --force-recreate mosquitto'
}

# ---------------------------------------------------------------------- check
function Invoke-MosquittoSub([string]$shCmd, [string]$user, [string]$pass, [switch]$Show) {
    # The sh command avoids double quotes so Windows PowerShell 5.1 passes it intact.
    $out = & docker compose exec -T -e "MQTT_U=$user" -e "MQTT_P=$pass" -e "W=$Watch" mosquitto sh -c $shCmd 2>&1
    if ($Show) { $out | ForEach-Object { Write-Host $_ } }
    return ($LASTEXITCODE -eq 0)
}

function Invoke-Check {
    if (-not (Test-Path $EnvFile)) { Die '.env not found. Run scripts/setup.ps1 first.' }
    $user = Or-Default (Get-EnvValue 'MQTT_USERNAME') (Get-DefaultUser)
    $pass = Get-EnvValue 'MQTT_PASSWORD'
    $ok = $true

    $running = & docker compose ps --status running --services 2>$null
    if (-not ($running -contains 'mosquitto')) { Die 'The mosquitto container is not running (docker compose up -d).' }

    if (Invoke-MosquittoSub 'mosquitto_sub -h localhost -p 1883 -u $MQTT_U -P $MQTT_P -t \$SYS/broker/version -C 1 -W 5' $user $pass) {
        Info "Plain listener (1883): login as '$user' OK"
    } else {
        if ($PasswdMode -eq 'file') {
            Warn "Plain listener (1883): login as '$user' FAILED. mosquitto/passwd does not match .env; run 'scripts/setup.ps1 -MqttPassword <current .env password>' and recreate mosquitto."
        } else {
            Warn "Plain listener (1883): login as '$user' FAILED. Recreate the containers so the broker picks up .env: docker compose up -d --force-recreate mosquitto app"
        }
        $ok = $false
    }

    if (Test-Tls) {
        if (Test-TlsCa) {
            if (Invoke-MosquittoSub 'mosquitto_sub -h localhost -p 8883 --cafile /mosquitto/certs/ca.crt --insecure -u $MQTT_U -P $MQTT_P -t \$SYS/broker/version -C 1 -W 5' $user $pass) {
                Info 'TLS listener (8883): handshake and login OK'
            } else {
                Warn 'TLS listener (8883): connection FAILED (see: docker compose logs mosquitto)'
                $ok = $false
            }
        } else {
            Info 'TLS listener (8883): enabled (public CA, not tested from inside the container)'
        }
        if (Get-Command openssl -ErrorAction SilentlyContinue) {
            Info ("Server certificate " + (& openssl x509 -in (Join-Path $CertDir 'server.crt') -noout -enddate))
        }
    }

    $denied = & docker compose logs --since 24h mosquitto 2>&1 | Select-String -Pattern 'not authori[sz]ed|bad user name or password' | Select-Object -Last 5
    if ($denied) {
        Warn 'Rejected logins in the last 24h (device uses a different username/password):'
        $denied | ForEach-Object { Write-Host $_.Line }
    } else {
        Info 'No rejected logins in the broker log (last 24h)'
    }

    if ($Watch -gt 0) {
        Info "Listening on MAPS/# and clothes/# for ${Watch}s ..."
        Invoke-MosquittoSub 'mosquitto_sub -h localhost -p 1883 -u $MQTT_U -P $MQTT_P -t MAPS/# -t clothes/# -v -W $W' $user $pass -Show | Out-Null
    }
    if (-not $ok) { exit 1 }
}

switch ($Command) {
    'init' { Invoke-Init }
    'show' { Invoke-Show }
    'tls' { Invoke-Tls }
    'check' { Invoke-Check }
}
