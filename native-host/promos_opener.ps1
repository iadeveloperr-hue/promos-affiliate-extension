# Native messaging host da extensão Promos.
# Lê UMA mensagem do Chrome (4 bytes little-endian = tamanho, depois JSON UTF-8)
# e abre o Chrome no perfil indicado, na URL recebida.
$ErrorActionPreference = 'Stop'
try {
  $stdin = [Console]::OpenStandardInput()

  # Tamanho da mensagem (4 bytes LE)
  $lenBytes = New-Object byte[] 4
  $got = 0
  while ($got -lt 4) {
    $n = $stdin.Read($lenBytes, $got, 4 - $got)
    if ($n -le 0) { return }
    $got += $n
  }
  $len = [BitConverter]::ToInt32($lenBytes, 0)
  if ($len -le 0 -or $len -gt 1048576) { return }

  # Corpo (JSON)
  $buf = New-Object byte[] $len
  $off = 0
  while ($off -lt $len) {
    $n = $stdin.Read($buf, $off, $len - $off)
    if ($n -le 0) { break }
    $off += $n
  }
  $json = [System.Text.Encoding]::UTF8.GetString($buf, 0, $len)
  $msg = $json | ConvertFrom-Json

  $url     = $msg.url
  $profile = $msg.profileDir
  $chrome  = $msg.chromePath
  if (-not $chrome) { $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }

  # Arquivo compartilhado entre os perfis do Chrome (cada perfil tem seu próprio
  # chrome.storage, então o cofre de cupons precisa de um ponto comum no disco).
  $reply = '{"ok":true}'
  if ($msg.cmd -eq 'readShared' -or $msg.cmd -eq 'writeShared') {
    $dir = Join-Path $env:LOCALAPPDATA 'PromosExtension'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $safe = ($msg.file -replace '[^A-Za-z0-9_.-]', '')
    if (-not $safe) { $safe = 'shared.json' }
    $path = Join-Path $dir $safe

    if ($msg.cmd -eq 'writeShared') {
      [System.IO.File]::WriteAllText($path, [string]$msg.data, [System.Text.UTF8Encoding]::new($false))
      $reply = '{"ok":true}'
    } else {
      $data = ''
      if (Test-Path $path) { $data = [System.IO.File]::ReadAllText($path) }
      $reply = (@{ ok = $true; data = $data } | ConvertTo-Json -Compress -Depth 3)
    }
  }
  elseif ($url -and $profile) {
    # Aspas explícitas: "Profile 4" tem espaço e, sem aspas, o Chrome quebra o
    # argumento (vira perfil errado + "4" interpretado como IP 0.0.0.4).
    $argline = '--profile-directory="' + $profile + '" "' + $url + '"'
    Start-Process -FilePath $chrome -ArgumentList $argline
  }

  # Resposta (o Chrome espera o mesmo formato length-prefixed)
  $rb = [System.Text.Encoding]::UTF8.GetBytes($reply)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write([BitConverter]::GetBytes([int]$rb.Length), 0, 4)
  $stdout.Write($rb, 0, $rb.Length)
  $stdout.Flush()
} catch {
  # Silencioso: se algo falhar, apenas não abre. O lado da extensão trata o erro.
}
