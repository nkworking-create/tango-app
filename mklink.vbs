Set oWS = WScript.CreateObject("WScript.Shell")
sDesktop = oWS.SpecialFolders("Desktop")
sLinkFile = sDesktop & "\TangoAdmin.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "C:\Users\PC_User\tango-app\open-admin.bat"
oLink.WorkingDirectory = "C:\Users\PC_User\tango-app"
oLink.Description = "Tango Admin"
oLink.Save
WScript.Echo "Created: " & sLinkFile
