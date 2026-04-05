$s = (New-Object -COM WScript.Shell).CreateShortcut('C:\Users\PC_User\Desktop\TangoAdmin.lnk')
$s.TargetPath = 'C:\Users\PC_User\tango-app\open-admin.bat'
$s.WorkingDirectory = 'C:\Users\PC_User\tango-app'
$s.Save()
Write-Host "Done"
