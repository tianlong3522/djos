#Requires -RunAsAdministrator
<#
.SYNOPSIS
    将 DJOS ISO 原始写入 U 盘，制作可引导的安装盘（BIOS + UEFI 通用）。
.DESCRIPTION
    混合 ISO 自带分区表与引导记录，直接按字节写入即可，无需 Rufus。
    警告：目标 U 盘上的所有数据将被永久擦除。
.EXAMPLE
    .\make-usb.ps1 -Iso ..\..\out\DJOS-1.0.0-amd64.iso
.EXAMPLE
    .\make-usb.ps1 -Iso ..\..\out\DJOS-1.0.0-amd64.iso -DiskNumber 2 -Force
#>
param(
    [Parameter(Mandatory = $true)][string]$Iso,
    [int]$DiskNumber = -1,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Iso)) { throw "ISO 文件不存在：$Iso" }
$isoItem = Get-Item -LiteralPath $Iso
if ($isoItem.Length -lt 100MB) { throw "文件不像有效的 DJOS ISO：$($isoItem.FullName)" }

$usbDisks = Get-Disk | Where-Object {
    $_.BusType -in @("USB", "Removable") -and $_.Size -gt 1GB
}

if (-not $usbDisks) { throw "未检测到 U 盘，请插入后重试。" }

if ($DiskNumber -lt 0) {
    if (@($usbDisks).Count -ne 1) {
        $usbDisks | Select-Object Number, FriendlyName, @{N = "SizeGB"; E = { [math]::Round($_.Size / 1GB, 1) } } | Format-Table -AutoSize | Out-String | Write-Host
        throw "检测到多个 U 盘，请使用 -DiskNumber 指定目标编号。"
    }
    $DiskNumber = @($usbDisks)[0].Number
}

$disk = Get-Disk -Number $DiskNumber
if (-not $disk) { throw "找不到磁盘编号 $DiskNumber" }
if ($disk.BusType -notin @("USB", "Removable")) { throw "磁盘 $DiskNumber 不是 U 盘，已拒绝写入。" }
if ($disk.Size -lt $isoItem.Length) { throw "U 盘容量小于 ISO 大小。" }

Write-Host ""
Write-Host "目标 U 盘：$($disk.FriendlyName)" -ForegroundColor Yellow
Write-Host "容量：$([math]::Round($disk.Size / 1GB, 1)) GB    磁盘编号：$DiskNumber" -ForegroundColor Yellow
Write-Host "ISO：$($isoItem.FullName)  ($([math]::Round($isoItem.Length / 1MB, 0)) MB)" -ForegroundColor Yellow
Write-Host ""
Write-Host "警告：此操作将彻底擦除该 U 盘上的所有数据！" -ForegroundColor Red

if (-not $Force) {
    $answer = Read-Host "确认请输入 ERASE"
    if ($answer -ne "ERASE") { Write-Host "已取消。" -ForegroundColor Green; exit 1 }
}

Write-Host "`n正在卸载卷并清除分区信息..." -ForegroundColor Cyan
try {
    Get-Partition -DiskNumber $DiskNumber -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.DriveLetter) { cmd /c "mountvol $($_.DriveLetter): /P" | Out-Null }
    }
} catch { }
Clear-Disk -Number $DiskNumber -RemoveData -RemoveOEM -Confirm:$false -ErrorAction SilentlyContinue
Update-HostStorageCache

$devicePath = "\\.\PhysicalDrive$DiskNumber"
Write-Host "正在写入 ISO 到 $devicePath ..." -ForegroundColor Cyan

$src = [System.IO.File]::OpenRead($isoItem.FullName)
try {
    $dst = [System.IO.File]::Open($devicePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
    $src.Dispose()
    throw "无法打开 $devicePath，请确认已以管理员身份运行，并关闭占用 U 盘的程序。$($_.Exception.Message)"
}

try {
    $buffer = New-Object byte[] (4MB)
    $total = $src.Length
    $written = 0
    $lastReport = 0
    while (($read = $src.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $dst.Write($buffer, 0, $read)
        $written += $read
        if ($written - $lastReport -ge 100MB -or $written -eq $total) {
            $percent = [math]::Min(100, [math]::Round($written * 100 / $total, 0))
            Write-Progress -Activity "写入 DJOS 安装盘" -Status "$percent%" -PercentComplete $percent
            $lastReport = $written
        }
    }
    $dst.Flush($true)
}
finally {
    $dst.Dispose()
    $src.Dispose()
    Write-Progress -Activity "写入 DJOS 安装盘" -Completed
}

Write-Host "`n✅ 写入完成。现在可以将 U 盘插入目标 x86 主机并从 U 盘启动。" -ForegroundColor Green
Write-Host "   安装器会自动清空内置系统盘并完成部署（约 15 秒倒计时后开始）。" -ForegroundColor Green
Write-Host "   注意：部分主板需在 BIOS 中关闭 Secure Boot。" -ForegroundColor Yellow
