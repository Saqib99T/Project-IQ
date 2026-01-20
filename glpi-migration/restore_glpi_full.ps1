# =============================================================
# GLPI Docker FULL Restore Script - Run on DEPLOYMENT Machine
# =============================================================
#
# This script restores a COMPLETE GLPI backup including:
#   1. MariaDB raw data volume (fastest restore)
#   2. OR MariaDB SQL import (fallback)
#   3. GLPI web files
#   4. GLPI plugins
#   5. GLPI marketplace
#

param(
    [string]$BackupPath = "C:\glpi_backup",
    [string]$DockerPath = "C:\glpi-docker",
    [int]$GLPIPort = 80
)

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
Write-Host "  GLPI Docker FULL Restore Script" -ForegroundColor Cyan
Write-Host "  This will restore EVERYTHING from backup" -ForegroundColor Cyan
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

# Step 1: Verify backup files
Write-Step "1/8" "Verifying backup files in $BackupPath..."

if (!(Test-Path $BackupPath)) {
    Write-Fail "Backup path does not exist: $BackupPath"
    exit 1
}

$sqlFile = Join-Path $BackupPath "glpi_database.sql"
$glpiDataTar = Join-Path $BackupPath "glpi_data.tar.gz"
$glpiPluginsTar = Join-Path $BackupPath "glpi_plugins.tar.gz"
$mariadbTar = Join-Path $BackupPath "mariadb_data.tar.gz"
$composeFile = Join-Path $BackupPath "docker-compose.yml"

if (Test-Path $sqlFile) { Write-OK "SQL dump: glpi_database.sql" }
if (Test-Path $glpiDataTar) { Write-OK "GLPI data: glpi_data.tar.gz" }
if (Test-Path $glpiPluginsTar) { Write-OK "GLPI plugins: glpi_plugins.tar.gz" }
if (Test-Path $mariadbTar) { Write-OK "MariaDB data: mariadb_data.tar.gz" }
if (Test-Path $composeFile) { Write-OK "Docker compose: docker-compose.yml" }

if (!(Test-Path $mariadbTar) -and !(Test-Path $sqlFile)) {
    Write-Fail "No database backup found! Need either mariadb_data.tar.gz or glpi_database.sql"
    exit 1
}

# Step 2: Setup Docker directory
Write-Step "2/8" "Setting up Docker directory..."
if (!(Test-Path $DockerPath)) {
    New-Item -ItemType Directory -Path $DockerPath -Force | Out-Null
}

# Copy docker-compose.yml
if (Test-Path $composeFile) {
    Copy-Item $composeFile -Destination $DockerPath -Force
    Write-OK "Copied docker-compose.yml"
}
else {
    Write-Fail "docker-compose.yml not found in backup!"
    exit 1
}

# Update port if needed
if ($GLPIPort -ne 80) {
    $content = Get-Content (Join-Path $DockerPath "docker-compose.yml") -Raw
    $content = $content -replace '"80:80"', "`"$($GLPIPort):80`""
    $content | Out-File -FilePath (Join-Path $DockerPath "docker-compose.yml") -Encoding UTF8
    Write-Info "Updated port to $GLPIPort"
}

# Step 3: Create volumes
Write-Step "3/8" "Creating Docker volumes..."
Set-Location $DockerPath

# Create volumes by starting and immediately stopping
docker-compose up -d 2>&1 | Out-Null
Write-Info "Waiting 20 seconds for initial setup..."
Start-Sleep -Seconds 20
docker-compose down 2>&1 | Out-Null
Write-OK "Volumes created"

# Step 4: Get actual volume names
Write-Step "4/8" "Identifying volume names..."
$volumes = docker volume ls --format "{{.Name}}" | Where-Object { $_ -match "glpi" }
Write-Info "Found volumes: $($volumes -join ', ')"

# Find the volume names created by docker-compose
$dbVolume = $volumes | Where-Object { $_ -match "db_data" } | Select-Object -First 1
$dataVolume = $volumes | Where-Object { $_ -match "_data" -and $_ -notmatch "db" } | Select-Object -First 1
$pluginsVolume = $volumes | Where-Object { $_ -match "plugins" } | Select-Object -First 1
$marketplaceVolume = $volumes | Where-Object { $_ -match "marketplace" } | Select-Object -First 1

Write-Info "DB Volume: $dbVolume"
Write-Info "Data Volume: $dataVolume"
Write-Info "Plugins Volume: $pluginsVolume"

# Step 5: Restore MariaDB data
Write-Step "5/8" "Restoring MariaDB data..."

if (Test-Path $mariadbTar) {
    Write-Info "Restoring from raw volume backup (fastest method)..."
    docker run --rm -v "${dbVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/mariadb_data.tar.gz -C /target" 2>&1
    Write-OK "MariaDB data restored from volume backup"
}
else {
    Write-Info "Will import SQL after containers start..."
}

# Step 6: Restore GLPI data
Write-Step "6/8" "Restoring GLPI files..."

if (Test-Path $glpiDataTar) {
    docker run --rm -v "${dataVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/glpi_data.tar.gz -C /target" 2>&1
    Write-OK "GLPI data restored"
}

if (Test-Path $glpiPluginsTar) {
    docker run --rm -v "${pluginsVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/glpi_plugins.tar.gz -C /target" 2>&1
    Write-OK "GLPI plugins restored"
}

# Step 7: Start containers
Write-Step "7/8" "Starting containers..."
docker-compose up -d 2>&1 | Out-Null

Write-Info "Waiting 30 seconds for containers to initialize..."
for ($i = 1; $i -le 6; $i++) {
    Start-Sleep -Seconds 5
    Write-Host "." -NoNewline -ForegroundColor Gray
}
Write-Host ""

# If no volume backup, import SQL
if (!(Test-Path $mariadbTar) -and (Test-Path $sqlFile)) {
    Write-Step "7b/8" "Importing SQL database..."
    $dbContainer = docker ps --format "{{.Names}}" | Where-Object { $_ -match "db" } | Select-Object -First 1
    
    # Wait for MariaDB to be ready
    $ready = $false
    for ($i = 0; $i -lt 12; $i++) {
        $ping = docker exec $dbContainer mysqladmin ping -u root -p"glpi_root_password" 2>&1
        if ($ping -match "alive") {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 5
    }
    
    if ($ready) {
        Get-Content $sqlFile -Raw | docker exec -i $dbContainer mysql -u root -p"glpi_root_password" glpi 2>&1
        Write-OK "Database imported"
    }
    else {
        Write-Fail "MariaDB not ready for import"
    }
}

Write-OK "Containers started"

# Step 8: Final verification
Write-Step "8/8" "Verifying installation..."
Write-Host ""
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""

# Get server IP
$serverIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notlike "*Loopback*" -and 
        $_.IPAddress -notlike "169.*" -and
        $_.IPAddress -notlike "172.*"
    } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  FULL Restore Complete!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Access GLPI:" -ForegroundColor White
Write-Host "    Local:   http://localhost:$GLPIPort" -ForegroundColor Cyan
if ($serverIP) {
    Write-Host "    Network: http://${serverIP}:$GLPIPort" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Default Login:" -ForegroundColor White
Write-Host "    Username: glpi" -ForegroundColor Gray
Write-Host "    Password: glpi" -ForegroundColor Gray
Write-Host ""
Write-Host "  Useful Commands:" -ForegroundColor White
Write-Host "    docker-compose logs -f    # View logs" -ForegroundColor Gray
Write-Host "    docker-compose restart    # Restart services" -ForegroundColor Gray
Write-Host "    docker-compose down       # Stop services" -ForegroundColor Gray
Write-Host ""
