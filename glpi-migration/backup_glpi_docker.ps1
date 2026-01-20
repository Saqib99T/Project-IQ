# =============================================================
# GLPI Docker Backup Script - Run on SOURCE Machine
# =============================================================
# 
# Usage: .\backup_glpi_docker.ps1 [-BackupPath "C:\glpi_backup"] [-DBPassword "your_password"]
#
# This script will:
#   1. Export MariaDB database to SQL file
#   2. Backup GLPI files volume
#   3. Backup MariaDB data volume
#   4. Copy docker-compose.yml if specified
#

param(
    [string]$BackupPath = "C:\glpi_backup",
    [string]$MariaDBContainer = "glpi_db",
    [string]$GLPIContainer = "glpi_app",
    [string]$DBName = "glpi",
    [string]$DBUser = "root",
    [string]$DBPassword = "glpi_root_password",
    [string]$GLPIFilesVolume = "glpi_glpi_data",
    [string]$GLPIConfigVolume = "glpi_glpi_config",
    [string]$GLPIPluginsVolume = "glpi_glpi_plugins",
    [string]$GLPIMarketplaceVolume = "glpi_glpi_marketplace",
    [string]$MariaDBVolume = "glpi_mariadb_data",
    [string]$ComposeFilePath = ""
)

function Write-Step {
    param([string]$Step, [string]$Message)
    Write-Host "[$Step] $Message" -ForegroundColor Yellow
}

function Write-Success {
    param([string]$Message)
    Write-Host "   [OK] $Message" -ForegroundColor Green
}

function Write-Err {
    param([string]$Message)
    Write-Host "   [FAIL] $Message" -ForegroundColor Red
}

# Header
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GLPI Docker Backup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Docker is running
try {
    docker info 2>&1 | Out-Null
}
catch {
    Write-Err "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Create backup directory
if (!(Test-Path $BackupPath)) {
    New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    Write-Host "Created backup directory: $BackupPath" -ForegroundColor Gray
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Write-Step "1/7" "Starting backup at $timestamp..."

# Step 1: Check running containers
Write-Step "2/7" "Checking Docker containers..."
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""

# Step 2: Export MariaDB Database
Write-Step "3/7" "Exporting MariaDB database..."
$sqlFile = Join-Path $BackupPath "glpi_database_$timestamp.sql"

try {
    $result = docker exec $MariaDBContainer mysqldump -u $DBUser -p"$DBPassword" --single-transaction --routines --triggers $DBName 2>&1
    $result | Out-File -FilePath $sqlFile -Encoding UTF8
    
    if ((Test-Path $sqlFile) -and ((Get-Item $sqlFile).Length -gt 100)) {
        $sqlSize = "{0:N2} MB" -f ((Get-Item $sqlFile).Length / 1MB)
        Write-Success "Database exported to: $sqlFile ($sqlSize)"
    }
    else {
        Write-Err "Database export failed or file is too small!"
    }
}
catch {
    Write-Err "Database export failed: $_"
}

# Step 3: Backup GLPI Files Volume
Write-Step "4/7" "Backing up GLPI files volume ($GLPIFilesVolume)..."
$glpiFilesTar = "glpi_files_$timestamp.tar.gz"
try {
    docker run --rm -v "${GLPIFilesVolume}:/source" -v "${BackupPath}:/backup" alpine tar -czf "/backup/$glpiFilesTar" -C /source . 2>&1 | Out-Null
    
    $tarPath = Join-Path $BackupPath $glpiFilesTar
    if (Test-Path $tarPath) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $tarPath).Length / 1MB)
        Write-Success "GLPI files backed up ($tarSize)"
    }
    else {
        Write-Err "GLPI files backup failed!"
    }
}
catch {
    Write-Err "GLPI files backup failed: $_"
}

# Step 4: Backup GLPI Plugins Volume
Write-Step "5/7" "Backing up GLPI plugins volume ($GLPIPluginsVolume)..."
$glpiPluginsTar = "glpi_plugins_$timestamp.tar.gz"
try {
    docker run --rm -v "${GLPIPluginsVolume}:/source" -v "${BackupPath}:/backup" alpine tar -czf "/backup/$glpiPluginsTar" -C /source . 2>&1 | Out-Null
    
    $tarPath = Join-Path $BackupPath $glpiPluginsTar
    if (Test-Path $tarPath) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $tarPath).Length / 1MB)
        Write-Success "GLPI plugins backed up ($tarSize)"
    }
    else {
        Write-Host "   - Plugins volume backup skipped (may not exist)" -ForegroundColor Gray
    }
}
catch {
    Write-Host "   - Plugins volume backup skipped" -ForegroundColor Gray
}

# Step 5: Backup GLPI Marketplace Volume
Write-Step "6/7" "Backing up GLPI marketplace volume ($GLPIMarketplaceVolume)..."
$glpiMarketplaceTar = "glpi_marketplace_$timestamp.tar.gz"
try {
    docker run --rm -v "${GLPIMarketplaceVolume}:/source" -v "${BackupPath}:/backup" alpine tar -czf "/backup/$glpiMarketplaceTar" -C /source . 2>&1 | Out-Null
    
    $tarPath = Join-Path $BackupPath $glpiMarketplaceTar
    if (Test-Path $tarPath) {
        $tarSize = "{0:N2} MB" -f ((Get-Item $tarPath).Length / 1MB)
        Write-Success "GLPI marketplace backed up ($tarSize)"
    }
    else {
        Write-Host "   - Marketplace volume backup skipped (may not exist)" -ForegroundColor Gray
    }
}
catch {
    Write-Host "   - Marketplace volume backup skipped" -ForegroundColor Gray
}

# Step 6: Copy docker-compose.yml if specified or find it
Write-Step "7/7" "Looking for docker-compose.yml..."
if ($ComposeFilePath -and (Test-Path $ComposeFilePath)) {
    Copy-Item $ComposeFilePath -Destination (Join-Path $BackupPath "docker-compose.yml") -Force
    Write-Success "docker-compose.yml copied from: $ComposeFilePath"
}
else {
    # Try to find docker-compose.yml in common locations
    $possiblePaths = @(
        ".\docker-compose.yml",
        "..\docker-compose.yml",
        "$env:USERPROFILE\docker\glpi\docker-compose.yml",
        "C:\docker\glpi\docker-compose.yml"
    )
    
    $found = $false
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            Copy-Item $path -Destination (Join-Path $BackupPath "docker-compose.yml") -Force
            Write-Success "docker-compose.yml found and copied from: $path"
            $found = $true
            break
        }
    }
    
    if (!$found) {
        Write-Host "   - docker-compose.yml not found. You may need to create one on deployment machine." -ForegroundColor Yellow
    }
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Backup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Backup location: $BackupPath" -ForegroundColor White
Write-Host ""
Write-Host "Files created:" -ForegroundColor White
Get-ChildItem $BackupPath | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object { 
    $size = "{0:N2} MB" -f ($_.Length / 1MB)
    Write-Host "  - $($_.Name) ($size)" -ForegroundColor Gray
}

# Calculate total size
$totalSize = (Get-ChildItem $BackupPath | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ""
Write-Host "Total backup size: $([math]::Round($totalSize, 2)) MB" -ForegroundColor White
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Next Steps:" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  1. Copy '$BackupPath' folder to deployment machine" -ForegroundColor White
Write-Host "  2. Run 'restore_glpi_docker.ps1' on deployment machine" -ForegroundColor White
Write-Host ""
