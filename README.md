_Repository to be submitted for the Kings first year hackathon (KingsFYH)._

# Rewind

Rewind is a single-window Electron browser. It looks up addresses and top-level links in the Wayback Machine, opens captures from 1995–1999, and applies a retro stylesheet when it opens the live page.

## Run

Use Node.js 22.12 or later. Electron downloads its desktop runtime on the first launch.

```sh
npm ci
npm start
```

## Demo

1. Enter `http://www.w3.org/`. Follow the link to Web Style Sheets, then click **CSS**. The three addresses and capture dates verified in Electron on macOS were `http://www.w3.org/` (1997-07-25), `http://www.w3.org/Style/` (1997-07-25), and `http://www.w3.org/Style/css/` (1997-07-30).
2. On Web Style Sheets, click **DSSSL** to scroll to `#dsssl` in the same capture. It makes no new Wayback request.
3. Enter `https://www.iana.org/help/example-domains` for **Live page · 1995 style**. Use **Back** and **Forward** to move between the CSS capture and the styled live page.


# The desktop application
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