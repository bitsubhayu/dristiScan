# (Python OCR Service must be started manually in WSL)
# Start Node Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; node server.js" -WindowStyle Normal

# Start React Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev" -WindowStyle Normal

Write-Host "Started all services in separate windows!"
Write-Host "Frontend: http://localhost:5173"
Write-Host "Backend: http://localhost:5000"
Write-Host "OCR Service: http://localhost:8000"
