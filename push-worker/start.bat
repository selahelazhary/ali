@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Daily Bake - سيرفر الإشعارات

if not exist config.json (
  echo أول تشغيل — هنعمل الإعداد.
  py setup.py || python setup.py
  if errorlevel 1 pause & exit /b 1
)

:run
py worker.py || python worker.py
echo.
echo الوركر وقف. هيعيد التشغيل بعد 5 ثواني... (اقفل الشاشة للإيقاف النهائي)
timeout /t 5 >nul
goto run
