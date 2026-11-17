@echo off
cd /d "%~dp0"
rem Abre o Follow-up GTplan. Nao precisa instalar nada: o arquivo unico roda direto no navegador.
rem (Se o Node.js estiver instalado e voce preferir o modo servidor, rode: node server.mjs)
start "" "%~dp0dist\gtplan-followup.html"
