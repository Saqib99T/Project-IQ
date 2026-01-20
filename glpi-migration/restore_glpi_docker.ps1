# =============================================================
# GLPI Docker Restore Script - Run on DEPLOYMENT Machine
# =============================================================
#
# Usage: .\restore_glpi_docker.ps1 [-BackupPath "C:\glpi_backup"] [-DBPassword "your_password"]
#
# This script will:
#   1. Create docker-compose.yml if not exists
#   2. Pull and start Docker containers
#   3. Restore GLPI files and config volumes
#   4. Import MariaDB database
#   5. Restart all services
#

param(
    [string]$BackupPath = "C:\glpi_backup",
    [string]$DockerPath = "C:\glpi-docker",
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
    [int]$GLPIPort = 80,
    [string]$Timezone = "Asia/Karachi"
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

function Write-Info {
    param([string]$Message)
    Write-Host "   $Message" -ForegroundColor Gray
}

# Header
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GLPI Docker Restore Script" -ForegroundColor Cyan
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

# Step 1: Verify backup files exist
Write-Step "1/9" "Verifying backup files in $BackupPath..."

if (!(Test-Path $BackupPath)) {
    Write-Err "Backup path does not exist: $BackupPath"
    exit 1
}

$sqlFile = Get-ChildItem -Path $BackupPath -Filter "glpi_database_*.sql" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$glpiFilesTar = Get-ChildItem -Path $BackupPath -Filter "glpi_files_*.tar.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$glpiPluginsTar = Get-ChildItem -Path $BackupPath -Filter "glpi_plugins_*.tar.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$glpiMarketplaceTar = Get-ChildItem -Path $BackupPath -Filter "glpi_marketplace_*.tar.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$composeFile = Join-Path $BackupPath "docker-compose.yml"

if (!$sqlFile) { 
    Write-Err "No SQL backup file found in $BackupPath"
    Write-Host "   Expected file pattern: glpi_database_*.sql" -ForegroundColor Gray
    exit 1 
}
Write-Success "SQL file: $($sqlFile.Name)"

if ($glpiFilesTar) { Write-Success "GLPI files: $($glpiFilesTar.Name)" }
else { Write-Info "No GLPI files backup found (will use fresh install)" }

if ($glpiPluginsTar) { Write-Success "GLPI plugins: $($glpiPluginsTar.Name)" }
else { Write-Info "No GLPI plugins backup found" }

if ($glpiMarketplaceTar) { Write-Success "GLPI marketplace: $($glpiMarketplaceTar.Name)" }
else { Write-Info "No GLPI marketplace backup found" }

# Step 2: Create Docker directory
Write-Step "2/9" "Setting up Docker directory..."
if (!(Test-Path $DockerPath)) {
    New-Item -ItemType Directory -Path $DockerPath -Force | Out-Null
    Write-Success "Created directory: $DockerPath"
}
else {
    Write-Info "Directory exists: $DockerPath"
}

# Step 3: Create or copy docker-compose.yml
Write-Step "3/9" "Setting up docker-compose.yml..."
$targetCompose = Join-Path $DockerPath "docker-compose.yml"

if (Test-Path $composeFile) {
    Copy-Item $composeFile -Destination $targetCompose -Force
    Write-Success "Copied docker-compose.yml from backup"
}
else {
    # Create default docker-compose.yml
    $composeContent = @"
version: '3.8'

services:
  mariadb:
    image: mariadb:10.11
    container_name: $MariaDBContainer
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: $DBPassword
      MYSQL_DATABASE: $DBName
      MYSQL_USER: glpi_user
      MYSQL_PASSWORD: glpi_password
    volumes:
      - $($MariaDBVolume):/var/lib/mysql
    networks:
      - glpi-network
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p$DBPassword"]
      interval: 10s
      timeout: 5s
      retries: 5

  glpi:
    image: diouxx/glpi
    container_name: $GLPIContainer
    restart: always
    ports:
      - "$($GLPIPort):80"
    environment:
      - TIMEZONE=$Timezone
    volumes:
      - $($GLPIFilesVolume):/var/www/html/glpi/files
      - $($GLPIPluginsVolume):/var/www/html/glpi/plugins
      - $($GLPIMarketplaceVolume):/var/www/html/glpi/marketplace
    depends_on:
      mariadb:
        condition: service_healthy
    networks:
      - glpi-network

volumes:
  $($MariaDBVolume):
  $($GLPIFilesVolume):
  $($GLPIPluginsVolume):
  $($GLPIMarketplaceVolume):

networks:
  glpi-network:
    driver: bridge
"@
    $composeContent | Out-File -FilePath $targetCompose -Encoding UTF8
    Write-Success "Created default docker-compose.yml"
}

# Step 4: Pull Docker images
Write-Step "4/9" "Pulling Docker images (this may take a few minutes)..."
Set-Location $DockerPath
docker-compose pull 2>&1 | Out-Null
Write-Success "Docker images pulled"

# Step 5: Start containers to create volumes
Write-Step "5/9" "Starting containers to create volumes..."
docker-compose up -d 2>&1 | Out-Null
Write-Info "Waiting 45 seconds for initialization..."

# Progress indicator
for ($i = 1; $i -le 9; $i++) {
    Start-Sleep -Seconds 5
    Write-Host "." -NoNewline -ForegroundColor Gray
}
Write-Host ""
Write-Success "Containers initialized"

# Step 6: Stop containers for restoration
Write-Step "6/9" "Stopping containers for data restoration..."
docker-compose stop 2>&1 | Out-Null
Write-Success "Containers stopped"

# Step 7: Restore volumes
Write-Step "7/9" "Restoring backup data to volumes..."

# Restore GLPI files volume
if ($glpiFilesTar) {
    Write-Info "Restoring GLPI files volume..."
    $tarFileName = $glpiFilesTar.Name
    docker run --rm -v "${GLPIFilesVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/$tarFileName -C /target" 2>&1 | Out-Null
    Write-Success "GLPI files restored"
}

# Restore GLPI plugins volume
if ($glpiPluginsTar) {
    Write-Info "Restoring GLPI plugins volume..."
    $tarFileName = $glpiPluginsTar.Name
    docker run --rm -v "${GLPIPluginsVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/$tarFileName -C /target" 2>&1 | Out-Null
    Write-Success "GLPI plugins restored"
}

# Restore GLPI marketplace volume
if ($glpiMarketplaceTar) {
    Write-Info "Restoring GLPI marketplace volume..."
    $tarFileName = $glpiMarketplaceTar.Name
    docker run --rm -v "${GLPIMarketplaceVolume}:/target" -v "${BackupPath}:/backup" alpine sh -c "rm -rf /target/* && tar -xzf /backup/$tarFileName -C /target" 2>&1 | Out-Null
    Write-Success "GLPI marketplace restored"
}

# Step 8: Start MariaDB and import database
Write-Step "8/9" "Starting MariaDB and importing database..."
docker-compose start mariadb 2>&1 | Out-Null
Write-Info "Waiting 25 seconds for MariaDB to be ready..."

for ($i = 1; $i -le 5; $i++) {
    Start-Sleep -Seconds 5
    Write-Host "." -NoNewline -ForegroundColor Gray
}
Write-Host ""

# Wait for MariaDB to be truly ready
$maxRetries = 10
$retryCount = 0
$dbReady = $false

while (!$dbReady -and $retryCount -lt $maxRetries) {
    $result = docker exec $MariaDBContainer mysqladmin ping -u $DBUser -p"$DBPassword" 2>&1
    if ($result -match "alive") {
        $dbReady = $true
    }
    else {
        $retryCount++
        Start-Sleep -Seconds 3
    }
}

if (!$dbReady) {
    Write-Err "MariaDB is not responding. Please check the logs."
    docker-compose logs mariadb
    exit 1
}

Write-Info "Importing database (this may take several minutes for large databases)..."
$sqlPath = $sqlFile.FullName

# Import using docker exec with file input
try {
    Get-Content $sqlPath -Raw | docker exec -i $MariaDBContainer mysql -u $DBUser -p"$DBPassword" $DBName 2>&1
    Write-Success "Database imported successfully"
}
catch {
    Write-Err "Database import failed: $_"
    Write-Host "   Try manual import: docker exec -i $MariaDBContainer mysql -u $DBUser -p'$DBPassword' $DBName < $sqlPath" -ForegroundColor Yellow
}

# Step 9: Start all containers
Write-Step "9/9" "Starting all containers..."
docker-compose up -d 2>&1 | Out-Null
Start-Sleep -Seconds 10
Write-Success "All containers started"

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Restore Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Container Status:" -ForegroundColor White
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1
Write-Host ""

# Get server IP
$serverIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Access GLPI:" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Local:   http://localhost:$GLPIPort" -ForegroundColor White
if ($serverIP) {
    Write-Host "  Network: http://${serverIP}:$GLPIPort" -ForegroundColor White
}
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Useful Commands:" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "  View logs:       docker-compose logs -f" -ForegroundColor Gray
Write-Host "  Restart:         docker-compose restart" -ForegroundColor Gray
Write-Host "  Stop:            docker-compose down" -ForegroundColor Gray
Write-Host "  Start:           docker-compose up -d" -ForegroundColor Gray
Write-Host "  Enter GLPI:      docker exec -it $GLPIContainer bash" -ForegroundColor Gray
Write-Host "  Enter MariaDB:   docker exec -it $MariaDBContainer mysql -u root -p" -ForegroundColor Gray
Write-Host ""
