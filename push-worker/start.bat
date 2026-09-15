@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Freezer - سيرفر الإشعارات

if not exist config.json (
  echo مفيش config.json هنا.
  echo نزّله من لوحة التحكم: الأدمن ^> وركر الإشعارات ^> تنزيل config.json
  echo وحطه في المجلد ده جنب worker.py، بعدين شغّل start.bat تاني.
  pause
  exit /b 1
)

:run
py worker.py || python worker.py
echo.
echo الوركر وقف. هيعيد التشغيل بعد 5 ثواني... (اقفل الشاشة للإيقاف النهائي)
timeout /t 5 >nul
goto run
