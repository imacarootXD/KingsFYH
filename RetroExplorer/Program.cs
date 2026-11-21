namespace RetroExplorer;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--win98-watchdog" &&
            int.TryParse(args[1], out var parentId))
        {
            Win98ShellManager.RunWatchdog(parentId);
            return;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        ApplicationConfiguration.Initialize();

        var manager = new Win98ShellManager();
        manager.RestoreOrphanedSession();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => manager.Restore();
        AppDomain.CurrentDomain.UnhandledException += (_, _) => manager.Restore();

        var form = new MainForm(manager);
        Application.Run(form);
    }
}
