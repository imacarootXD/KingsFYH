# Retro Explorer

A retro-style Windows desktop file explorer built with C# and WinForms to throw you back. A proprietary file explorer and complete reskin for your desktop

## Requirements

- Windows 10 or Windows 11
- No separate .NET installation is required for the published self-contained app

## Run from source as an administrator if possible

```powershell
dotnet run --project .\RetroExplorer\RetroExplorer.csproj
```

Open `KingsFYH.sln` in Visual Studio, or run the project with the command above from a cmd window/powershell within the folder.

## Publish

```powershell
dotnet publish .\RetroExplorer\RetroExplorer.csproj --configuration Release --runtime win-x64 --self-contained true
```
## Bugs

Sometimes all the folders may not convert to the texture. Ensure you run it as an admin or restar it fixes the bug. If some of your folders do not change back, close the application and a safety will be triggered restoring your old application. Alternatively close and re-open win-98 mode