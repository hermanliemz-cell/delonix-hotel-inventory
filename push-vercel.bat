@echo off
echo ========================================
echo   Push Hotel Inventory to Vercel
echo ========================================
echo.

cd /d "%~dp0"

echo [1/4] Checking git status...
git status

echo.
echo [2/4] Adding all changes...
git add -A

echo.
echo [3/4] Committing changes...
set /p msg="Commit message (Enter for default): "
if "%msg%"=="" set msg=Update Hotel Inventory System
git commit -m "%msg%"

echo.
echo [4/4] Pushing to origin main...
git push origin main

echo.
echo ========================================
echo   Done! Vercel will auto-deploy.
echo ========================================
pause
