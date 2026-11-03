# dump-mem.ps1 — 把目标进程的可写内存区域转储到本地，交给 scan-mem.js 扫 key
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File dump-mem.ps1 -ProcessName Yuna-Win64-Shipping
#   powershell ... -File dump-mem.ps1 -ProcessName xxx -OutDir D:\dump -MinRegionMB 4 -MaxTotalMB 4096
#
# 说明：游戏跑起来、进到主菜单之后再抓，此时 pak/ucas 已经挂载，key 就在内存里。
param(
  [string]$ProcessName = '',
  [int]$TargetPid = 0,
  [string]$OutDir = '',
  [int]$MinRegionMB = 1,
  [int]$MaxTotalMB = 8192,
  [switch]$IncludeReadOnly
)

$ErrorActionPreference = 'Stop'

# 允许把 pid 直接填在进程名里：-ProcessName 22748  等价于 -TargetPid 22748
if ($TargetPid -eq 0 -and $ProcessName -match '^\d+$') {
  $TargetPid = [int]$ProcessName
  $ProcessName = ''
}
if ($TargetPid -eq 0 -and [string]::IsNullOrWhiteSpace($ProcessName)) {
  Write-Host '[FAIL] 必须给进程名或 pid。例：-ProcessName "Game-Win64-Shipping" 或 -ProcessName 22748' -ForegroundColor Red
  Write-Host '       先确认游戏已经开起来并停在主菜单。' -ForegroundColor Yellow
  exit 2
}


$sig = @'
using System;
using System.Runtime.InteropServices;
public class MemDump {
  [StructLayout(LayoutKind.Sequential)]
  public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress;
    public IntPtr AllocationBase;
    public uint AllocationProtect;
    public IntPtr RegionSize;
    public uint State;
    public uint Protect;
    public uint Type;
  }
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, IntPtr len);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
}
'@
Add-Type -TypeDefinition $sig

if ($TargetPid -eq 0) {
  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 1
  if (-not $proc) { Write-Host ("找不到进程 {0}。先把游戏开起来，或者直接填 pid：-ProcessName 22748" -f $ProcessName) -ForegroundColor Red; exit 2 }
} else {
  $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
  if (-not $proc) { Write-Host "找不到 pid $TargetPid" -ForegroundColor Red; exit 2 }
}
$ProcessName = $proc.ProcessName
if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ("mem\" + $ProcessName) }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

Write-Host ("进程   : {0} (pid {1})" -f $proc.ProcessName, $proc.Id) -ForegroundColor Cyan
Write-Host ("工作集 : {0:N0} MB" -f ($proc.WorkingSet64 / 1MB))
Write-Host ("输出   : {0}" -f $OutDir) -ForegroundColor Cyan

$PROCESS_QUERY_INFORMATION = 0x0400
$PROCESS_VM_READ = 0x0010
$h = [MemDump]::OpenProcess($PROCESS_QUERY_INFORMATION -bor $PROCESS_VM_READ, $false, $proc.Id)
if ($h -eq [IntPtr]::Zero) { Write-Host "OpenProcess 失败（需要管理员权限或进程受保护）" -ForegroundColor Red; exit 3 }

$allowed = @(0x04, 0x40, 0x08, 0x80)          # RW, EXEC_RW, WRITECOPY, EXEC_WRITECOPY
if ($IncludeReadOnly) { $allowed += @(0x02, 0x20) }   # R, EXEC_R

$mbi = New-Object MemDump+MEMORY_BASIC_INFORMATION
$mbiSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mbi)
$addr = [IntPtr]::Zero
# 用户态地址上限，不能用 VirtualMemorySize64 —— 64 位游戏的内存常落在 1TB 以上，用它会一个区域都扫不到
$maxAddr = [IntPtr]0x7FFFFFFEFFFF
$minBytes = [int64]$MinRegionMB * 1MB
$maxBytes = [int64]$MaxTotalMB * 1MB

$written = [int64]0
$chunkBytes = 16777216
$count = 0
$read = [IntPtr]::Zero
$t0 = Get-Date

while ($addr.ToInt64() -lt $maxAddr.ToInt64() -and $written -lt $maxBytes) {
  $r = [MemDump]::VirtualQueryEx($h, $addr, [ref]$mbi, [IntPtr]$mbiSize)
  if ($r -eq 0) { break }
  $size = [int64]$mbi.RegionSize
  $state = [int64]$mbi.State
  $protect = [int64]($mbi.Protect -band 0xFF)

  if ($state -eq 0x1000 -and $size -ge $minBytes -and ($allowed -contains $protect)) {
    # 分块读写：整块 New-Object byte[] 几 GB + 再 $buf[0..($n-1)] 切一份副本，
    # 会直接把 PowerShell 撑爆（OutOfMemoryException）。这里固定 16MB 一块，直写 FileStream。
    $name = ('r_{0:x}_{1:x}.bin' -f $mbi.BaseAddress.ToInt64(), $size)
    $path = Join-Path $OutDir $name
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $off = [int64]0
    $got = [int64]0
    try {
      while ($off -lt $size -and $written -lt $maxBytes) {
        $todo = [int][Math]::Min($chunkBytes, $size - $off)
        $buf = New-Object byte[] $todo
        $read = [IntPtr]::Zero
        $ok = [MemDump]::ReadProcessMemory($h, [IntPtr]($mbi.BaseAddress.ToInt64() + $off), $buf, [IntPtr]$todo, [ref]$read)
        if ($ok -and $read.ToInt64() -gt 0) {
          $n = [int]$read.ToInt64()
          $fs.Write($buf, 0, $n)
          $got += $n
          $written += $n
        }
        $off += $todo
        if (-not $ok) { break }   # 撞到保护页/未提交页，跳过这块的剩余部分
      }
    } finally { $fs.Close() }
    if ($got -eq 0) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    } else {
      $count++
      Write-Host ("  dumped {0} ({1:N1} MB, protect=0x{2:x})" -f $name, ($got / 1MB), $protect)
    }
  }
  $next = [int64]$mbi.BaseAddress.ToInt64() + $size
  if ($next -le $addr.ToInt64()) { $next = $addr.ToInt64() + 0x1000 }
  $addr = [IntPtr]$next
}
[MemDump]::CloseHandle($h) | Out-Null

$el = ((Get-Date) - $t0).TotalSeconds
Write-Host ""
Write-Host ("完成：{0} 个区域，{1:N0} MB，用时 {2:N1} 秒" -f $count, ($written / 1MB), $el) -ForegroundColor Green
Write-Host ("下一步：node scan-mem.js `"{0}`"" -f $OutDir) -ForegroundColor Yellow
