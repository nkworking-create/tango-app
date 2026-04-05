@echo off
:: サーバーが起動しているか確認
curl -s -o nul -w "%%{http_code}" http://localhost:3333/ | findstr "200" >nul 2>&1
if errorlevel 1 (
  echo サーバーを起動中...
  start /B node "c:\Users\PC_User\tango-app\server.js"
  timeout /t 2 /nobreak >nul
)
start http://localhost:3333/admin.html
