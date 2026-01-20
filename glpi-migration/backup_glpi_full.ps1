# =============================================================
# GLPI Docker FULL Backup Script - Run on SOURCE Machine
# =============================================================
# 
# This script creates a COMPLETE backup of GLPI including:
#   1. MariaDB Database (SQL dump)
#   2. MariaDB raw data volume (for complete restore)
#   3. GLPI web files
#   4. GLPI plugins
#   5. GLPI marketplace
#   6. Docker compose configuration
#

param(
    [string]$BackupPath = "C:\glpi_backup"
)

# Your Docker configuration
$MariaDBContainer = "glpi_db"
$GLPIContainer = "glpi_app"
$DBName = "glpi"
$DBUser = "root"
$DBPassword = "glpi_root_password"

# Actual volume names (detected from your system)
$Volumes = @{
    "glpi_data"        = "glpi_glpi_data"
    "glpi_plugins"     = "glpi_glpi_plugins" 
    "glpi_marketplace" = "glpi_glpi_marketplace"
    "mariadb_data"     = "glpi_glpi_db_data"
}

function Write-Step {
    param([string]$Step, [string]$Message)
    Write-Host "[$Step] $Message" -ForegroundColor Yellow
}

function Write-OK {
    param([string]$Message)
    Write-Host "   [OK] $Message" -ForegroundColor Green
}

function Write-Fail {
    param([string]$Message)
    Write-Host "   [FAIL] $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "   $Message" -ForegroundColor Gray
}

# Header
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  GLPI Docker FULL Backup Script" -ForegroundColor Cyan
Write-Host "  This will backup EVERYTHING for complete migration" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker is running
try {
    docker info 2>&1 | Out-Null
}
catch {
    Write-Fail "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Create backup directory
if (!(Test-Path $BackupPath)) {
    New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    Write-Host "Created backup directory: $BackupPath" -ForegroundColor Gray
}

# Clean old backups
Write-Host "Cleaning old backup files..." -ForegroundColor Gray
Remove-Item "$BackupPath\*" -Force -ErrorAction SilentlyContinue

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Write-Step "1/8" "Starting FULL backup at $timestamp..."

# Step 2: Check running containers
Write-Step "2/8" "Checking Docker containers..."
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""

# Step 3: Stop containers for consistent backup
Write-Step "3/8" "Stopping containers for consistent backup..."
Write-Info "This ensures data integrity during backup..."
docker stop $GLPIContainer 2>&1 | Out-Null
Write-OK "GLPI container stopped"

# Step 4: Export MariaDB Database (while MariaDB is still running)
Write-Step "4/8" "Exporting MariaDB database (SQL dump)..."
$sqlFile = Join-Path $BackupPath "glpi_database.sql"

try {
    $result = docker exec $MariaDBContainer mysqldump -u $DBUser -p"$DBPassword" --single-transaction --routines --triggers --events $DBName 2>&1
    $result | Out-File -FilePath $sqlFile -Encoding UTF8
    
    if ((Test-Path $sqlFile) -and ((Get-Item $sqlFile).Length -gt 1000)) {
        $sqlSize = "{0:N2} MB" -f ((Get-Item $sqlFile).Length / 1MB)
        Write-OK "Database exported: $sqlSize"
    }
    else {
        Write-Fail "Database export failed!"
        Get-Content $sqlFile | Select-Object -First 5
    }
}
catch {
    Write-Fail "Database export failed: $_"
}

# Now stop MariaDB for volume backup
docker stop $MariaDBContainer 2>&1 | Out-Null
Write-OK "MariaDB container stopped"

# Step 5: Backup GLPI Data Volume
Write-Step "5/8" "Backing up GLPI data volume (glpi_glpi_data)..."
$glpiDataTar = Join-Path $BackupPath "glpi_data.tar.gz"
try {
    docker run --rm -v "glpi_glpi_data:/source:ro" -v "${BackupPath}:/backup" alpine tar -czf "/backup/glpi_data.tar.gz" -C /source . 2>&1
    
    if ((Test-Path $glpiDataTar) -and ((Get-Item $glpiDataTar).Length -gt 100)) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $glpiDataTar).Length / 1MB)
        Write-OK "GLPI data backed up: $tarSize"
    }
    else {
        Write-Fail "GLPI data backup failed!"
    }
}
catch {
    Write-Fail "GLPI data backup failed: $_"
}

# Step 6: Backup GLPI Plugins Volume
Write-Step "6/8" "Backing up GLPI plugins volume (glpi_glpi_plugins)..."
$glpiPluginsTar = Join-Path $BackupPath "glpi_plugins.tar.gz"
try {
    docker run --rm -v "glpi_glpi_plugins:/source:ro" -v "${BackupPath}:/backup" alpine tar -czf "/backup/glpi_plugins.tar.gz" -C /source . 2>&1
    
    if ((Test-Path $glpiPluginsTar) -and ((Get-Item $glpiPluginsTar).Length -gt 50)) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $glpiPluginsTar).Length / 1MB)
        Write-OK "GLPI plugins backed up: $tarSize"
    }
    else {
        Write-Info "Plugins volume empty or minimal"
    }
}
catch {
    Write-Info "Plugins backup skipped"
}

# Step 7: Backup MariaDB Data Volume (raw database files)
Write-Step "7/8" "Backing up MariaDB data volume (glpi_glpi_db_data)..."
$mariadbTar = Join-Path $BackupPath "mariadb_data.tar.gz"
try {
    docker run --rm -v "glpi_glpi_db_data:/source:ro" -v "${BackupPath}:/backup" alpine tar -czf "/backup/mariadb_data.tar.gz" -C /source . 2>&1
    
    if ((Test-Path $mariadbTar) -and ((Get-Item $mariadbTar).Length -gt 1000)) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $mariadbTar).Length / 1MB)
        Write-OK "MariaDB data backed up: $tarSize"
    }
    else {
        Write-Fail "MariaDB data backup failed!"
    }
}
catch {
    Write-Fail "MariaDB data backup failed: $_"
}

# Step 8: Create docker-compose.yml for deployment
Write-Step "8/8" "Creating docker-compose.yml for deployment..."
$composeContent = @"
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
      - glpi_db_data:/var/lib/mysql
    networks:
      - glpi-network
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
    depends_on:
      mariadb:
        condition: service_healthy
    networks:
      - glpi-network

volumes:
  glpi_db_data:
  glpi_data:
  glpi_plugins:
  glpi_marketplace:

networks:
  glpi-network:
    driver: bridge
"@
$composeContent | Out-File -FilePath (Join-Path $BackupPath "docker-compose.yml") -Encoding UTF8
Write-OK "docker-compose.yml created"

# Restart containers
Write-Host ""
Write-Host "Restarting containers..." -ForegroundColor Yellow
docker start $MariaDBContainer 2>&1 | Out-Null
Start-Sleep -Seconds 5
docker start $GLPIContainer 2>&1 | Out-Null
Write-OK "Containers restarted"

# Summary
Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  FULL Backup Complete!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backup location: $BackupPath" -ForegroundColor White
Write-Host ""
Write-Host "Files created:" -ForegroundColor White
$totalSize = 0
Get-ChildItem $BackupPath | ForEach-Object { 
    $size = $_.Length / 1MB
    $totalSize += $size
    $sizeStr = "{0:N2} MB" -f $size
    Write-Host "  - $($_.Name) ($sizeStr)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Total backup size: $([math]::Round($totalSize, 2)) MB" -ForegroundColor White
Write-Host ""
Write-Host "========================================================" -ForegroundColor Yellow
Write-Host "  MIGRATION STEPS:" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Copy entire '$BackupPath' folder to deployment machine" -ForegroundColor White
Write-Host "  2. On deployment machine, run:" -ForegroundColor White
Write-Host "     .\restore_glpi_full.ps1 -BackupPath C:\glpi_backup" -ForegroundColor Cyan
Write-Host ""
