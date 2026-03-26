@echo off
cd /d "C:\Users\herma\My Drive\Claude\Finance\Stock Opname Hotel\hotel-inventory"
git add -A
set /p MSG="Commit message: "
git commit -m "%MSG%"
git push
pause
