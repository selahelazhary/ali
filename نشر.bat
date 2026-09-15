@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ================================
echo     Freezer - Publish + SEO update
echo   ================================
echo.
node seo\publish.js
echo.
pause
