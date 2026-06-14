@echo off
cd /d F:\Projects\knowledge-harvester

echo Starting PostgreSQL (pgvector)...
docker compose up -d postgres
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to start PostgreSQL. Is Docker running?
    pause
    exit /b 1
)

echo Waiting for PostgreSQL to be healthy...
:wait_pg
docker compose ps postgres --format "{{.Health}}" 2>nul | findstr /i "healthy" >nul
if %ERRORLEVEL% NEQ 0 (
    timeout /t 2 /nobreak >nul
    goto wait_pg
)

echo PostgreSQL ready. Starting Knowledge Harvester...
node src/server.js
