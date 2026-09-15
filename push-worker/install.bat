@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Freezer - تثبيت المتطلبات
echo جاري تثبيت مكتبات بايثون...
py -m pip install -r requirements.txt || python -m pip install -r requirements.txt
echo.
echo تم. شغّل start.bat
pause
