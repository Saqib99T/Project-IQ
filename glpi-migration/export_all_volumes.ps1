# =============================================================
# GLPI Docker COMPLETE Volume Export - Run on SOURCE Machine
# =============================================================
# 
# This script exports ALL Docker volumes for complete migration:
#   - MariaDB data (345 MB)
#   - GLPI var data (10 MB) 
#   - All named volumes
#   - Docker compose configuration
#

param(
    [string]$BackupPath = "C:\glpi_backup"
)

$MariaDBContainer = "glpi_db"
$GLPIContainer = "glpi_app"
$DBUser = "root"
$DBPassword = "glpi_root_password"
$DBName = "glpi"

function Write-Step { param([string]$S, [string]$M) Write-Host "[$S] $M" -ForegroundColor Yellow }
function Write-OK { param([string]$M) Write-Host "   [OK] $M" -ForegroundColor Green }
function Write-Fail { param([string]$M) Write-Host "   [FAIL] $M" -ForegroundColor Red }
function Write-Info { param([string]$M) Write-Host "   $M" -ForegroundColor Gray }

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  GLPI Docker COMPLETE Volume Export" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker
try { docker info 2>&1 | Out-Null } catch { Write-Fail "Docker not running"; exit 1 }

# Create/clean backup directory  
if (!(Test-Path $BackupPath)) { New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null }
Remove-Item "$BackupPath\*" -Force -ErrorAction SilentlyContinue
Write-Host "Backup location: $BackupPath" -ForegroundColor Gray
Write-Host ""

# Step 1: Stop containers for consistent backup
Write-Step "1/5" "Stopping all containers for consistent backup..."
docker stop $GLPIContainer 2>&1 | Out-Null
docker stop $MariaDBContainer 2>&1 | Out-Null
Write-OK "Containers stopped"

# Step 2: Get all volumes used by containers
Write-Step "2/5" "Identifying all volumes..."

# Get volumes from glpi_app
$glpiVolumes = docker inspect $GLPIContainer --format "{{range .Mounts}}{{.Name}}|{{.Destination}}{{println}}{{end}}" 2>&1
Write-Info "GLPI volumes:"
$glpiVolumes | ForEach-Object { if ($_ -match '\|') { Write-Host "     $_" -ForegroundColor Gray } }

# Get volumes from glpi_db  
$dbVolumes = docker inspect $MariaDBContainer --format "{{range .Mounts}}{{.Name}}|{{.Destination}}{{println}}{{end}}" 2>&1
Write-Info "MariaDB volumes:"
$dbVolumes | ForEach-Object { if ($_ -match '\|') { Write-Host "     $_" -ForegroundColor Gray } }

# Step 3: Backup each volume
Write-Step "3/5" "Backing up all volumes..."

# All volumes to backup (name -> backup filename)
$volumesToBackup = @(
    @{ Name = "glpi_glpi_db_data"; File = "vol_mariadb.tar.gz"; Desc = "MariaDB Data" },
    @{ Name = "glpi_glpi_data"; File = "vol_glpi_data.tar.gz"; Desc = "GLPI Data" },
    @{ Name = "glpi_glpi_plugins"; File = "vol_glpi_plugins.tar.gz"; Desc = "GLPI Plugins" },
    @{ Name = "glpi_glpi_marketplace"; File = "vol_glpi_marketplace.tar.gz"; Desc = "GLPI Marketplace" },
    @{ Name = "dec304de7cf4b3beb28e0cb0be125402ae58360d11b9d9bb9a1206e349772ec8"; File = "vol_glpi_var.tar.gz"; Desc = "GLPI Var" }
)

foreach ($vol in $volumesToBackup) {
    Write-Info "Backing up $($vol.Desc) ($($vol.Name))..."
    $tarPath = Join-Path $BackupPath $vol.File
    
    docker run --rm -v "$($vol.Name):/source:ro" -v "${BackupPath}:/backup" alpine tar -czf "/backup/$($vol.File)" -C /source . 2>&1 | Out-Null
    
    if ((Test-Path $tarPath) -and ((Get-Item $tarPath).Length -gt 50)) {
        $size = "{0:N2} MB" -f ((Get-Item $tarPath).Length / 1MB)
        Write-OK "$($vol.Desc): $size"
    }
    else {
        Write-Info "$($vol.Desc): empty or minimal"
    }
}

# Step 4: Export SQL dump as backup
Write-Step "4/5" "Creating SQL dump backup..."
docker start $MariaDBContainer 2>&1 | Out-Null
Start-Sleep -Seconds 10

$sqlFile = Join-Path $BackupPath "database.sql"
docker exec $MariaDBContainer mysqldump -u $DBUser -p"$DBPassword" --single-transaction --routines --triggers $DBName 2>&1 | Out-File -FilePath $sqlFile -Encoding UTF8

if ((Test-Path $sqlFile) -and ((Get-Item $sqlFile).Length -gt 1000)) {
    $size = "{0:N2} MB" -f ((Get-Item $sqlFile).Length / 1MB)
    Write-OK "SQL dump: $size"
}
docker stop $MariaDBContainer 2>&1 | Out-Null

# Step 5: Create docker-compose.yml
Write-Step "5/5" "Creating deployment files..."

$compose = @'
version: '3.8'

services:
  mariadb:
    image: mariadb:10.11
    container_name: glpi_db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: glpi_root_password
      MYSQL_DATABASE: glpi
      MYSQL_USER: glpi
      MYSQL_PASSWORD: glpi_password
    volumes:
      - db_data:/var/lib/mysql
    networks:
      - glpi-net
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-pglpi_root_password"]
      interval: 10s
      timeout: 5s
      retries: 5

  glpi:
    image: diouxx/glpi
    container_name: glpi_app
    restart: always
    ports:
      - "80:80"
    environment:
      - TIMEZONE=Asia/Karachi
    volumes:
      - glpi_data:/var/www/html
      - glpi_plugins:/var/www/html/plugins
      - glpi_marketplace:/var/www/html/marketplace
      - glpi_var:/var/glpi
    depends_on:
      mariadb:
        condition: service_healthy
    networks:
      - glpi-net

volumes:
  db_data:
  glpi_data:
  glpi_plugins:
  glpi_marketplace:
  glpi_var:

networks:
  glpi-net:
'@
$compose | Out-File -FilePath (Join-Path $BackupPath "docker-compose.yml") -Encoding UTF8
Write-OK "docker-compose.yml created"

# Create restore script
$restore = @'
# GLPI Restore Script - Run on DEPLOYMENT Machine
param([string]$BackupPath = "C:\glpi_backup", [int]$Port = 80)

Write-Host "`n=== GLPI Docker Restore ===" -ForegroundColor Cyan

# Update port in compose
$compose = Get-Content "$BackupPath\docker-compose.yml" -Raw
$compose = $compose -replace '"80:80"', "`"$($Port):80`""
$compose | Out-File "$BackupPath\docker-compose.yml" -Encoding UTF8

Set-Location $BackupPath

# Create volumes and start
Write-Host "[1/4] Creating containers..." -ForegroundColor Yellow
docker-compose up -d 2>&1 | Out-Null
Start-Sleep -Seconds 15
docker-compose down 2>&1 | Out-Null
Write-Host "   [OK] Volumes created" -ForegroundColor Green

# Get volume names
$prefix = (Get-Location | Split-Path -Leaf) -replace '[^a-zA-Z0-9]', ''
if ($prefix -eq "") { $prefix = "glpi_backup" }

Write-Host "[2/4] Restoring volumes..." -ForegroundColor Yellow

# Restore each volume
$volMap = @{
    "vol_mariadb.tar.gz" = "${prefix}_db_data"
    "vol_glpi_data.tar.gz" = "${prefix}_glpi_data"
    "vol_glpi_plugins.tar.gz" = "${prefix}_glpi_plugins"
    "vol_glpi_marketplace.tar.gz" = "${prefix}_glpi_marketplace"
    "vol_glpi_var.tar.gz" = "${prefix}_glpi_var"
}

foreach ($tar in $volMap.Keys) {
    $volName = $volMap[$tar]
    $tarPath = Join-Path $BackupPath $tar
    if (Test-Path $tarPath) {
        docker run --rm -v "${volName}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/$tar -C /target" 2>&1 | Out-Null
        Write-Host "   [OK] Restored $tar" -ForegroundColor Green
    }
}

Write-Host "[3/4] Starting containers..." -ForegroundColor Yellow
docker-compose up -d 2>&1 | Out-Null
Start-Sleep -Seconds 10
Write-Host "   [OK] Containers started" -ForegroundColor Green

Write-Host "[4/4] Verifying..." -ForegroundColor Yellow
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

Write-Host "`n=== Restore Complete ===" -ForegroundColor Green
Write-Host "Access GLPI at: http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Login: glpi / glpi" -ForegroundColor Gray
'@
$restore | Out-File -FilePath (Join-Path $BackupPath "restore.ps1") -Encoding UTF8
Write-OK "restore.ps1 created"

# Restart original containers
Write-Host ""
Write-Host "Restarting containers..." -ForegroundColor Yellow
docker start $MariaDBContainer 2>&1 | Out-Null
Start-Sleep -Seconds 5
docker start $GLPIContainer 2>&1 | Out-Null
Write-OK "Containers restarted"

# Summary
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  COMPLETE Volume Export Done!" -ForegroundColor Green  
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Files created in $BackupPath :" -ForegroundColor White
$total = 0
Get-ChildItem $BackupPath | ForEach-Object {
    $s = $_.Length / 1MB
    $total += $s
    Write-Host ("  - {0,-30} {1,10:N2} MB" -f $_.Name, $s) -ForegroundColor Gray
}
Write-Host ""
Write-Host "Total: $([math]::Round($total,2)) MB" -ForegroundColor White
Write-Host ""
Write-Host "=== TO MIGRATE ===" -ForegroundColor Yellow
Write-Host "1. Copy C:\glpi_backup folder to deployment machine" -ForegroundColor White
Write-Host "2. On deployment machine run:" -ForegroundColor White
Write-Host "   cd C:\glpi_backup" -ForegroundColor Cyan
Write-Host "   .\restore.ps1" -ForegroundColor Cyan
Write-Host ""
