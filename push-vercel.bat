@echo off
echo ========================================
echo   Push Hotel Inventory v2 to Vercel
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
set /p msg="Commit message: "
if "%msg%"=="" (
    echo Commit message tidak boleh kosong!
    pause
    exit /b 1
)
git commit -m "%msg%"
echo.

echo [4/4] Pushing to origin main...
git push origin main
echo.

echo ========================================
echo   Done! Vercel will auto-build v2.
echo   Build: cd hotel-inventory-v2 ^&^& npm install ^&^& npm run build
echo   Output: hotel-inventory-v2/dist/
echo ========================================
pause
