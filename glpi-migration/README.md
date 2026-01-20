# GLPI Docker Migration Guide

This folder contains scripts to migrate GLPI with MariaDB from one Docker host to another.

## Quick Start

### On Source Machine (Local)

```powershell
# Run backup script
.\backup_glpi_docker.ps1 -DBPassword "your_db_password"
```

### On Deployment Machine

```powershell
# Copy backup folder to deployment machine, then run:
.\restore_glpi_docker.ps1 -BackupPath "C:\glpi_backup" -DBPassword "your_db_password"
```

---

## Files Included

| File | Description |
|------|-------------|
| `backup_glpi_docker.ps1` | Run on source machine to backup GLPI |
| `restore_glpi_docker.ps1` | Run on deployment machine to restore GLPI |
| `README.md` | This guide |

---

## Backup Script Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-BackupPath` | `C:\glpi_backup` | Where to save backup files |
| `-MariaDBContainer` | `glpi-mariadb` | MariaDB container name |
| `-GLPIContainer` | `glpi` | GLPI container name |
| `-DBName` | `glpi` | Database name |
| `-DBUser` | `root` | Database user |
| `-DBPassword` | `your_root_password` | Database password |
| `-GLPIFilesVolume` | `glpi_files` | GLPI files volume name |
| `-GLPIConfigVolume` | `glpi_config` | GLPI config volume name |
| `-MariaDBVolume` | `mariadb_data` | MariaDB data volume name |
| `-ComposeFilePath` | `` | Path to docker-compose.yml |

### Example

```powershell
.\backup_glpi_docker.ps1 `
    -BackupPath "D:\Backups\glpi" `
    -DBPassword "MySecurePassword123" `
    -MariaDBContainer "my-mariadb" `
    -GLPIFilesVolume "my_glpi_files"
```

---

## Restore Script Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-BackupPath` | `C:\glpi_backup` | Backup folder location |
| `-DockerPath` | `C:\glpi-docker` | Where to setup Docker files |
| `-GLPIPort` | `80` | Port to expose GLPI on |
| `-Timezone` | `Asia/Karachi` | Container timezone |
| *(Plus all backup parameters)* | | |

### Example

```powershell
.\restore_glpi_docker.ps1 `
    -BackupPath "C:\glpi_backup" `
    -DockerPath "C:\docker\glpi" `
    -DBPassword "MySecurePassword123" `
    -GLPIPort 8080 `
    -Timezone "Asia/Dubai"
```

---

## What Gets Backed Up

1. **MariaDB Database** (`glpi_database_*.sql`)
   - All tables, data, routines, and triggers

2. **GLPI Files Volume** (`glpi_files_*.tar.gz`)
   - Uploaded documents and attachments
   - Session files
   - Logs

3. **GLPI Config Volume** (`glpi_config_*.tar.gz`)
   - Database connection settings
   - Custom configuration

4. **MariaDB Data Volume** (`mariadb_data_*.tar.gz`)
   - Raw database files (optional backup)

5. **docker-compose.yml**
   - Container configuration

---

## Prerequisites

### Source Machine
- Docker Desktop running
- GLPI containers running
- PowerShell 5.1+

### Deployment Machine
- Docker Desktop installed and running
- PowerShell 5.1+
- Sufficient disk space

---

## Troubleshooting

### "Database connection failed" after restore

1. Check credentials in docker-compose.yml match backup
2. Verify MariaDB is running: `docker ps`
3. Check MariaDB logs: `docker-compose logs mariadb`

### "File permissions denied"

Run PowerShell as Administrator.

### GLPI shows installation page

The config volume may not have restored properly. Check:
```powershell
docker exec glpi ls -la /var/www/html/glpi/config/
```

### Container not starting

```powershell
# Check logs
docker-compose logs -f

# Restart from scratch
docker-compose down -v
docker-compose up -d
# Then re-import database
```

### Port already in use

Change the port in restore script:
```powershell
.\restore_glpi_docker.ps1 -GLPIPort 8080
```

---

## Manual Commands

### Backup database manually
```powershell
docker exec glpi-mariadb mysqldump -u root -p'password' glpi > backup.sql
```

### Restore database manually
```powershell
Get-Content backup.sql | docker exec -i glpi-mariadb mysql -u root -p'password' glpi
```

### Backup volume manually
```powershell
docker run --rm -v volume_name:/source -v C:\backup:/backup alpine tar -czf /backup/volume.tar.gz -C /source .
```

### Restore volume manually
```powershell
docker run --rm -v volume_name:/target -v C:\backup:/backup alpine tar -xzf /backup/volume.tar.gz -C /target
```

---

## Support

For issues with these scripts, check the GLPI Docker documentation:
- https://github.com/DiouxX/docker-glpi
- https://glpi-project.org/documentation/
