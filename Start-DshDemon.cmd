@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON=E:\dshwork\AAAAGENT\windows\code\desktop-pet\node_modules\electron\dist\electron.exe"
start "" /min "D:\nodejs\node.exe" "E:\dshwork\small-demon\server.js"
start "" "%ELECTRON%" --no-sandbox --no-process-singleton --user-data-dir=C:/Users/Public/sd-main "E:\dshwork\small-demon"
