@echo off
cd /d "C:\Users\herma\My Drive\Claude\Finance\Stock Opname Hotel\hotel-inventory"
git add -A
git commit -m "Block transfer to In-Use Warehouse if same item still has stock, make email optional"
git push
pause
